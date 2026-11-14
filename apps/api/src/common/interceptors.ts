import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { from, lastValueFrom, Observable } from 'rxjs';
import { als } from './context';
import { AUDIT_ACTION, SKIP_AUDIT } from './decorators';
import { DbService } from '../db/db.service';
import * as schema from '../db/schema';
import { auditLogs } from '../db/schema';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACT = /pass(word)?|token|secret|otp|cnic|apikey|hash/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AUD-04: audit entity type → table, so old and new values can be captured around a change. */
const ENTITY_TABLES: Record<string, PgTable & { id: unknown }> = {
  attendance_correction: schema.attendanceCorrections,
  attendance_device: schema.attendanceDevices,
  calendar_event: schema.calendarEvents,
  compensation_request: schema.compensationRequests,
  department: schema.departments,
  employee: schema.employees,
  employee_document: schema.employeeDocuments,
  holiday: schema.holidays,
  incentive: schema.incentives,
  kpi_submission: schema.kpiSubmissions,
  kpi_target: schema.kpiTargets,
  leave_request: schema.leaveRequests,
  leave_type: schema.leaveTypes,
  level: schema.levels,
  loan: schema.loans,
  medical_claim: schema.medicalClaims,
  overtime: schema.overtimeRecords,
  payroll_run: schema.payrollRuns,
  payslip: schema.payslips,
  policy: schema.policies,
  post: schema.posts,
  post_comment: schema.postComments,
  query: schema.queries,
  resignation: schema.resignations,
  salary_component: schema.salaryComponents,
  survey: schema.surveys,
  team: schema.teams,
  team_transfer: schema.teamTransferRequests,
  user: schema.users,
  work_schedule: schema.workSchedules,
};
const IGNORE_FIELDS = new Set(['updatedAt', 'createdAt', 'tenantId']);

type Row = Record<string, unknown>;
const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

/** Field-level old → new values, with confidential fields masked. */
export function diffRows(before: Row | null, after: Row | null): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (IGNORE_FIELDS.has(k)) continue;
    const o = norm(before?.[k]);
    const n = norm(after?.[k]);
    if (JSON.stringify(o) === JSON.stringify(n)) continue;
    out[k] = REDACT.test(k) ? { old: o == null ? null : '[redacted]', new: n == null ? null : '[redacted]' } : { old: sanitize(o), new: sanitize(n) };
  }
  return out;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? '[redacted]' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

/**
 * Wraps each authenticated request in one DB transaction with the tenant set for RLS.
 * Registered first, so it is the outermost interceptor.
 */
@Injectable()
export class TenantTxInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenantId = als.getStore()?.user?.tenantId;
    if (!tenantId) return next.handle();
    return from(this.db.inTenant(tenantId, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }
}

/**
 * F5 / H2 – records every successful mutation inside the same transaction as the change,
 * so a change can never be committed without its audit entry.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    if (!MUTATING.has(req.method) || this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT, targets)) {
      return next.handle();
    }
    const meta = this.reflector.getAllAndOverride<{ action: string; entityType?: string }>(AUDIT_ACTION, targets);

    return from(
      (async () => {
        const table = meta?.entityType ? ENTITY_TABLES[meta.entityType] : undefined;
        const paramId = req.params?.id as string | undefined;
        const load = async (id: string | undefined): Promise<Row | null> => {
          const tx = als.getStore()?.tx;
          if (!table || !tx || !id || !UUID.test(id)) return null;
          const t = table as unknown as { id: Parameters<typeof eq>[0] };
          const [row] = await tx.select().from(table).where(eq(t.id, id)).limit(1);
          return (row as Row | undefined) ?? null;
        };
        const before = await load(paramId);
        const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
        const store = als.getStore();
        const tenantId = store?.tenantId ?? store?.user?.tenantId;
        if (!tenantId || !store?.tx) return result;
        const res = context.switchToHttp().getResponse<Response>();
        const anonymous = !!store.anonymous;
        const resultId =
          result && typeof result === 'object' && 'id' in result ? String((result as { id: unknown }).id) : undefined;
        const after = await load(paramId ?? resultId);
        const changes = before || after ? diffRows(before, after) : undefined;
        await store.tx.insert(auditLogs).values({
          tenantId,
          actorUserId: anonymous ? null : (store.user?.userId ?? null),
          actorLabel: anonymous ? 'anonymous' : (store.user?.email ?? null),
          action: store.audit?.action ?? meta?.action ?? `${context.getClass().name.replace('Controller', '')}.${context.getHandler().name}`,
          entityType: store.audit?.entityType ?? meta?.entityType ?? null,
          entityId: store.audit?.entityId ?? (req.params?.id as string | undefined) ?? resultId ?? null,
          method: req.method,
          path: req.route?.path ?? req.path,
          statusCode: res.statusCode,
          ip: anonymous ? null : (store.ip ?? null),
          userAgent: anonymous ? null : (store.userAgent?.slice(0, 300) ?? null),
          metadata: anonymous
            ? null
            : ({ body: sanitize(req.body), ...(changes && Object.keys(changes).length ? { changes } : {}), ...(store.audit?.metadata ?? {}) } as Record<string, unknown>),
        });
        return result;
      })(),
    );
  }
}
