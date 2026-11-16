import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req, UnauthorizedException, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { als } from '../../common/context';
import { sha256 } from '../../common/crypto';
import { Public, SkipAudit, SkipCsrf } from '../../common/decorators';
import { offsetMinutes } from '../../common/tz';
import { zp } from '../../common/zod.pipe';
import { AuditService } from '../../core/audit.service';
import { DbService } from '../../db/db.service';
import { attendanceDevices, deviceSerials, tenants } from '../../db/schema';
import { AttendanceService } from './attendance.service';
import { parseHikvisionEvents, parseZkAttlog, zkHandshake } from './biometric';

const serialQuery = z.object({ SN: z.string().trim().min(3).max(64), table: z.string().max(40).optional() });

/** Reads a text body whatever content type the device firmware sent. */
async function rawText(req: Request): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.readableEnded) return '';
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8').slice(0, 2_000_000);
}

/**
 * Endpoints called by biometric devices themselves (BIO-01). They authenticate by registered serial number
 * (ZKTeco ADMS) or by the device key in the URL (Hikvision ISAPI), never by user session.
 */
@Controller()
@Public()
@SkipCsrf()
@SkipAudit()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class BiometricController {
  constructor(
    private readonly db: DbService,
    private readonly svc: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  /** Finds the company and device for a ZKTeco serial, then runs `fn` inside that company's RLS scope. */
  private async withZkDevice<T>(serial: string, fn: (device: typeof attendanceDevices.$inferSelect, tz: string) => Promise<T>): Promise<T> {
    const [reg] = await this.db.root.select().from(deviceSerials).where(eq(deviceSerials.serialNumber, serial)).limit(1);
    if (!reg) throw new ForbiddenException('Device not registered');
    const store = als.getStore();
    if (store) store.tenantId = reg.tenantId;
    return this.db.inTenant(reg.tenantId, async (tx) => {
      const [device] = await tx.select().from(attendanceDevices).where(eq(attendanceDevices.id, reg.deviceId));
      if (!device || !device.isActive || device.protocol !== 'ZKTECO_ADMS') throw new ForbiddenException('Device not registered');
      const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, reg.tenantId));
      return fn(device, t?.tz ?? 'Asia/Karachi');
    });
  }

  /* ---------------- ZKTeco ADMS / Push SDK ---------------- */

  @Get('iclock/cdata')
  @Header('Content-Type', 'text/plain')
  async zkHandshake(@Query(zp(serialQuery)) q: z.infer<typeof serialQuery>) {
    return this.withZkDevice(q.SN, async (device, tz) => {
      await this.db.tx.update(attendanceDevices).set({ lastSeenAt: new Date() }).where(eq(attendanceDevices.id, device.id));
      return zkHandshake(q.SN, offsetMinutes(new Date(), tz));
    });
  }

  @Post('iclock/cdata')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  async zkUpload(@Req() req: Request, @Query(zp(serialQuery)) q: z.infer<typeof serialQuery>) {
    const body = await rawText(req);
    return this.withZkDevice(q.SN, async (device, tz) => {
      if ((q.table ?? '').toUpperCase() !== 'ATTLOG') {
        // Operation logs, user info, photos… are acknowledged but not stored.
        await this.db.tx.update(attendanceDevices).set({ lastSeenAt: new Date() }).where(eq(attendanceDevices.id, device.id));
        return 'OK';
      }
      const punches = parseZkAttlog(body, tz);
      const r = await this.svc.ingestDevicePunches(device.id, punches);
      await this.audit.log(this.db.tx, { tenantId: device.tenantId, action: 'attendance.device_push', actorLabel: `device:${device.name}`, entityType: 'attendance_device', entityId: device.id, metadata: { protocol: 'ZKTECO_ADMS', ...r } });
      return `OK: ${punches.length}`;
    });
  }

  /** Devices poll for commands; none are sent, but the call marks the device online (BIO-07). */
  @Get('iclock/getrequest')
  @Header('Content-Type', 'text/plain')
  async zkPoll(@Query(zp(serialQuery)) q: z.infer<typeof serialQuery>) {
    return this.withZkDevice(q.SN, async (device) => {
      await this.db.tx.update(attendanceDevices).set({ lastSeenAt: new Date() }).where(eq(attendanceDevices.id, device.id));
      return 'OK';
    });
  }

  @Post('iclock/devicecmd')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  zkCommandResult() {
    return 'OK';
  }

  /* ---------------- Hikvision ISAPI event notification ---------------- */

  /** Configure the device's HTTP listening URL as https://<host>/api/v1/attendance/hikvision/<device key>. */
  @Post('attendance/hikvision/:key')
  @HttpCode(200)
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 2 * 1024 * 1024, files: 4 } }))
  async hikvision(@Param('key') key: string, @Body() body: unknown) {
    const dot = key.indexOf('.');
    const tenantId = key.slice(0, dot);
    if (dot !== 36 || !z.uuid().safeParse(tenantId).success) throw new UnauthorizedException({ message: 'Invalid device key', code: 'DEVICE_AUTH' });
    const store = als.getStore();
    if (store) store.tenantId = tenantId;
    return this.db.inTenant(tenantId, async (tx) => {
      const [device] = await tx.select().from(attendanceDevices).where(eq(attendanceDevices.apiKeyHash, sha256(key.slice(37))));
      if (!device || !device.isActive) throw new UnauthorizedException({ message: 'Invalid device key', code: 'DEVICE_AUTH' });
      const punches = parseHikvisionEvents(body);
      const r = await this.svc.ingestDevicePunches(device.id, punches);
      if (punches.length) await this.audit.log(tx, { tenantId, action: 'attendance.device_push', actorLabel: `device:${device.name}`, entityType: 'attendance_device', entityId: device.id, metadata: { protocol: 'HIKVISION_ISAPI', ...r } });
      return { ok: true, received: r.received };
    });
  }
}
