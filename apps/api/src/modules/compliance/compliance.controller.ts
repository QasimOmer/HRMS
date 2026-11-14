import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  PERMISSIONS as P,
  complaintSchema,
  complaintTrackSchema,
  complaintUpdateSchema,
  policySchema,
  queryMessageSchema,
  querySchema,
  queryStatusSchema,
} from '@hrms/shared';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config';
import { als, currentUser } from '../../common/context';
import { randomToken, sha256 } from '../../common/crypto';
import { Audit, RequireAny, RequireModule } from '../../common/decorators';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { todayIn } from '../../common/tz';
import { one, tenantInfo, requireDelete, assertUnused, countWhere } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { NotificationsService } from '../../core/notifications.service';
import { ScopeService } from '../../core/scope.service';
import { StorageService, type UploadedFileLike } from '../../core/storage.service';
import { DbService } from '../../db/db.service';
import {
  complaints,
  departments,
  employees,
  policies,
  queries,
  queryMessages,
  users,
} from '../../db/schema';

const uploadLimits = { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024 } };

@RequireModule('COMPLIANCE')
@Controller()
export class ComplianceController {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly notify: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  /* ---------------- F1 Policies & documents ---------------- */

  @Get('policies')
  async policies() {
    const u = currentUser();
    const q = this.db.tx.select().from(policies);
    // Employees see only published documents.
    return (u.permissions.has(P.POLICIES_MANAGE) ? q : q.where(eq(policies.status, 'PUBLISHED'))).orderBy(asc(policies.category), asc(policies.title));
  }

  @Get('policies/:id')
  async policy(@Param('id', ParseUUIDPipe) id: string) {
    const p = one(await this.db.tx.select().from(policies).where(eq(policies.id, id)), 'Policy');
    if (p.status !== 'PUBLISHED' && !currentUser().permissions.has(P.POLICIES_MANAGE)) throw notFound('Policy');
    return p;
  }

  /** Inline only – the viewer disables download/right-click (deterrent, not DRM). */
  @Get('policies/:id/file')
  async policyFile(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.policy(id);
    if (!p.fileId) throw notFound('File');
    return this.storage.stream(p.fileId, 'inline');
  }

  @Post('policies')
  @RequireAny(P.POLICIES_MANAGE)
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  @Audit('policy.created', 'policy')
  async createPolicy(@UploadedFile() file: UploadedFileLike | undefined, @Body(zp(policySchema)) body: z.infer<typeof policySchema>) {
    if (!file && !body.content) throw badRequest('Add policy text or attach a PDF');
    const f = file ? await this.storage.save(file, 'pdf') : null;
    return one(await this.db.tx.insert(policies).values({ ...body, fileId: f?.id ?? null, tenantId: currentUser().tenantId }).returning());
  }

  @Put('policies/:id')
  @RequireAny(P.POLICIES_MANAGE)
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  @Audit('policy.updated', 'policy')
  async updatePolicy(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike | undefined, @Body(zp(policySchema)) body: z.infer<typeof policySchema>) {
    const cur = one(await this.db.tx.select().from(policies).where(eq(policies.id, id)), 'Policy');
    const f = file ? await this.storage.save(file, 'pdf') : null;
    return one(
      await this.db.tx
        .update(policies)
        .set({ ...body, fileId: f?.id ?? cur.fileId, version: cur.status === 'PUBLISHED' ? cur.version + 1 : cur.version })
        .where(eq(policies.id, id))
        .returning(),
    );
  }

  @Post('policies/:id/publish')
  @RequireAny(P.POLICIES_MANAGE)
  @Audit('policy.published', 'policy')
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    const p = one(await this.db.tx.update(policies).set({ status: 'PUBLISHED', publishedAt: new Date() }).where(eq(policies.id, id)).returning(), 'Policy');
    const all = await this.db.tx.select({ id: users.id }).from(users).where(eq(users.status, 'ACTIVE'));
    await this.notify.notifyUsers(all.map((a) => a.id), { type: 'policy.published', title: `Policy published: ${p.title}`, link: `/policies/${p.id}` });
    return p;
  }

  @Post('policies/:id/archive')
  @RequireAny(P.POLICIES_MANAGE)
  @Audit('policy.archived', 'policy')
  async archive(@Param('id', ParseUUIDPipe) id: string) {
    return one(await this.db.tx.update(policies).set({ status: 'ARCHIVED' }).where(eq(policies.id, id)).returning(), 'Policy');
  }

  @Delete('policies/:id')
  @RequireAny(P.POLICIES_MANAGE)
  @Audit('policy.deleted', 'policy')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    one(await this.db.tx.delete(policies).where(eq(policies.id, id)).returning({ id: policies.id }), 'Policy');
    return { id, deleted: true };
  }

  /* ---------------- F3 Anonymous complaints ---------------- */

  /**
   * Stores no user reference, no IP/user agent in the audit log, and only the submission date.
   * The submitter gets a one-time tracking code to follow up.
   */
  @Post('complaints')
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @UseInterceptors(FilesInterceptor('files', 5, uploadLimits))
  @Audit('complaint.submitted', 'complaint')
  async submitComplaint(@UploadedFiles() files: UploadedFileLike[] | undefined, @Body(zp(complaintSchema)) body: z.infer<typeof complaintSchema>) {
    const store = als.getStore();
    if (store) store.anonymous = true;
    const t = await tenantInfo(this.db.tx);
    const fileIds: string[] = [];
    for (const f of files ?? []) fileIds.push((await this.storage.save(f, 'document', { anonymous: true })).id);
    const code = `CMP-${randomToken(12)}`;
    await this.db.tx.insert(complaints).values({
      tenantId: t.id,
      trackingCodeHash: sha256(code),
      category: body.category,
      description: body.description,
      fileIds,
      submittedOn: todayIn(t.timezone),
    });
    await this.notify.notifyPermission(P.COMPLAINTS_MANAGE, { type: 'complaint.submitted', title: 'A new confidential complaint was submitted', link: '/complaints' }, currentUser().userId);
    return { trackingCode: code };
  }

  @Post('complaints/track')
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  async track(@Body(zp(complaintTrackSchema)) body: z.infer<typeof complaintTrackSchema>) {
    const store = als.getStore();
    if (store) store.anonymous = true;
    const [c] = await this.db.tx
      .select({ category: complaints.category, status: complaints.status, resolutionNote: complaints.resolutionNote, submittedOn: complaints.submittedOn, updatedAt: complaints.updatedAt })
      .from(complaints)
      .where(eq(complaints.trackingCodeHash, sha256(body.trackingCode)));
    if (!c) throw notFound('Complaint');
    return c;
  }

  @Get('complaints')
  @RequireAny(P.COMPLAINTS_MANAGE)
  complaints(@Query(zp(z.object({ status: z.string().max(20).optional() }))) q: { status?: string }) {
    const base = this.db.tx
      .select({ id: complaints.id, category: complaints.category, description: complaints.description, status: complaints.status, resolutionNote: complaints.resolutionNote, submittedOn: complaints.submittedOn, updatedAt: complaints.updatedAt, attachments: sql<number>`jsonb_array_length(${complaints.fileIds})` })
      .from(complaints);
    return (q.status ? base.where(eq(complaints.status, q.status)) : base).orderBy(desc(complaints.submittedOn));
  }

  @Patch('complaints/:id')
  @RequireAny(P.COMPLAINTS_MANAGE)
  @Audit('complaint.updated', 'complaint')
  async updateComplaint(@Param('id', ParseUUIDPipe) id: string, @Body(zp(complaintUpdateSchema)) body: z.infer<typeof complaintUpdateSchema>) {
    one(await this.db.tx.update(complaints).set(body).where(eq(complaints.id, id)).returning({ id: complaints.id }), 'Complaint');
    return { id, ...body };
  }

  @Get('complaints/:id/files/:index')
  @RequireAny(P.COMPLAINTS_MANAGE)
  async complaintFile(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    const c = one(await this.db.tx.select().from(complaints).where(eq(complaints.id, id)), 'Complaint');
    const fileId = c.fileIds[index];
    if (!fileId) throw notFound('File');
    return this.storage.stream(fileId, 'attachment');
  }

  /* ---------------- F6 Employee queries & support ---------------- */

  private async canAccessQuery(q: typeof queries.$inferSelect) {
    const u = currentUser();
    return q.employeeId === u.employeeId || q.assignedToEmployeeId === u.employeeId || u.permissions.has(P.QUERIES_READ_ALL);
  }

  @Get('queries')
  async queries(@Query(zp(z.object({ scope: z.enum(['mine', 'assigned', 'all']).default('mine'), status: z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED']).optional() }))) q: { scope: 'mine' | 'assigned' | 'all'; status?: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' }) {
    const u = currentUser();
    const conds: SQL[] = [];
    if (q.scope === 'mine') conds.push(eq(queries.employeeId, this.scope.requireEmployee()));
    else if (q.scope === 'assigned') conds.push(eq(queries.assignedToEmployeeId, this.scope.requireEmployee()));
    else if (!u.permissions.has(P.QUERIES_READ_ALL)) throw forbidden();
    if (q.status) conds.push(eq(queries.status, q.status));
    const assignee = sql<string | null>`(select full_name from employees a where a.id = ${queries.assignedToEmployeeId})`;
    return this.db.tx
      .select({
        id: queries.id,
        subject: queries.subject,
        category: queries.category,
        status: queries.status,
        createdAt: queries.createdAt,
        updatedAt: queries.updatedAt,
        employeeId: queries.employeeId,
        employeeName: employees.fullName,
        departmentName: departments.name,
        assignedToEmployeeId: queries.assignedToEmployeeId,
        assignedToName: assignee,
      })
      .from(queries)
      .innerJoin(employees, eq(employees.id, queries.employeeId))
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(queries.updatedAt))
      .limit(500);
  }

  @Post('queries')
  @Audit('query.created', 'query')
  async createQuery(@Body(zp(querySchema)) body: z.infer<typeof querySchema>) {
    const employeeId = this.scope.requireEmployee();
    const lead = await this.scope.teamLeadOf(employeeId);
    const assignedTo = lead && lead.employeeId !== employeeId ? lead.employeeId : null; // auto-assign to Team Lead (F6)
    const row = one(await this.db.tx.insert(queries).values({ tenantId: currentUser().tenantId, employeeId, assignedToEmployeeId: assignedTo, ...body }).returning());
    if (assignedTo) await this.notify.notifyEmployees([assignedTo], { type: 'query.assigned', title: `New query: ${body.subject}`, link: `/queries/${row.id}` });
    else await this.notify.notifyPermission(P.QUERIES_READ_ALL, { type: 'query.unassigned', title: `New query: ${body.subject}`, link: `/queries/${row.id}` });
    return row;
  }

  @Get('queries/:id')
  async query(@Param('id', ParseUUIDPipe) id: string) {
    const q = one(await this.db.tx.select().from(queries).where(eq(queries.id, id)), 'Query');
    if (!(await this.canAccessQuery(q))) throw forbidden();
    const messages = await this.db.tx
      .select({ id: queryMessages.id, body: queryMessages.body, createdAt: queryMessages.createdAt, authorUserId: queryMessages.authorUserId, authorName: employees.fullName, authorEmail: users.email })
      .from(queryMessages)
      .innerJoin(users, eq(users.id, queryMessages.authorUserId))
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(eq(queryMessages.queryId, id))
      .orderBy(asc(queryMessages.createdAt));
    const [emp] = await this.db.tx.select({ fullName: employees.fullName }).from(employees).where(eq(employees.id, q.employeeId));
    const u = currentUser();
    return { ...q, employeeName: emp?.fullName, messages, canRespond: q.assignedToEmployeeId === u.employeeId || u.permissions.has(P.QUERIES_READ_ALL) };
  }

  @Post('queries/:id/messages')
  @Audit('query.replied', 'query')
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body(zp(queryMessageSchema)) body: z.infer<typeof queryMessageSchema>) {
    const tx = this.db.tx;
    const q = one(await tx.select().from(queries).where(eq(queries.id, id)), 'Query');
    if (!(await this.canAccessQuery(q))) throw forbidden();
    const u = currentUser();
    await tx.insert(queryMessages).values({ tenantId: u.tenantId, queryId: id, authorUserId: u.userId, body: body.body });
    const responder = q.employeeId !== u.employeeId;
    await tx
      .update(queries)
      .set({ status: responder && q.status === 'PENDING' ? 'IN_PROGRESS' : q.status === 'RESOLVED' && !responder ? 'IN_PROGRESS' : q.status })
      .where(eq(queries.id, id));
    if (responder) await this.notify.notifyEmployees([q.employeeId], { type: 'query.reply', title: `Reply on: ${q.subject}`, link: `/queries/${id}` });
    else await this.notify.notifyEmployees([q.assignedToEmployeeId], { type: 'query.reply', title: `Employee replied on: ${q.subject}`, link: `/queries/${id}` });
    return { ok: true };
  }

  @Patch('queries/:id/status')
  @Audit('query.status_changed', 'query')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zp(queryStatusSchema)) body: z.infer<typeof queryStatusSchema>) {
    const q = one(await this.db.tx.select().from(queries).where(eq(queries.id, id)), 'Query');
    const u = currentUser();
    if (q.assignedToEmployeeId !== u.employeeId && !u.permissions.has(P.QUERIES_READ_ALL)) throw forbidden();
    await this.db.tx.update(queries).set({ status: body.status }).where(eq(queries.id, id));
    if (body.status === 'RESOLVED') await this.notify.notifyEmployees([q.employeeId], { type: 'query.resolved', title: `Your query was resolved: ${q.subject}`, link: `/queries/${id}` });
    return { id, status: body.status };
  }

  @Post('queries/:id/assign')
  @RequireAny(P.QUERIES_READ_ALL)
  @Audit('query.assigned', 'query')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body(zp(z.object({ employeeId: z.uuid().nullable() }))) body: { employeeId: string | null }) {
    await this.db.tx.update(queries).set({ assignedToEmployeeId: body.employeeId }).where(eq(queries.id, id));
    if (body.employeeId) await this.notify.notifyEmployees([body.employeeId], { type: 'query.assigned', title: 'A query was assigned to you', link: `/queries/${id}` });
    return { id, assignedToEmployeeId: body.employeeId };
  }
}
