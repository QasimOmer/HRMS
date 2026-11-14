import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  PERMISSIONS as P,
  decision,
  foodAllowanceRuleSchema,
  loanDecisionSchema,
  loanRepaymentSchema,
  loanRequestSchema,
  loanSchema,
  medicalClaimSchema,
  medicalDecisionSchema,
  payrollReopenSchema,
  payrollRunSchema,
  payslipAdjustmentSchema,
  salaryComponentSchema,
  type DecisionInput,
} from '@hrms/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config';
import { currentUser } from '../../common/context';
import { Audit, RequireAny, RequireModule } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { todayIn } from '../../common/tz';
import { one, round2, tenantInfo, requireDelete, assertUnused, countWhere } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { ApprovalsService } from '../../core/approvals.service';
import { NotificationsService } from '../../core/notifications.service';
import { ScopeService } from '../../core/scope.service';
import { StorageService, type UploadedFileLike } from '../../core/storage.service';
import { DbService } from '../../db/db.service';
import {
  departments,
  employees,
  foodAllowanceRules,
  loanRepayments,
  loans,
  medicalClaims,
  payrollRuns,
  payslips,
  salaryComponents,
  type PayslipLine,
  compensationRequests,
  incentives,
} from '../../db/schema';
import { PayrollService } from './payroll.service';
import { renderPayslipPdf } from './payslip.pdf';

const VISIBLE_RUN_STATUSES = ['APPROVED', 'PAID'] as const;

@RequireModule('PAYROLL')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly db: DbService,
    private readonly svc: PayrollService,
    private readonly approvals: ApprovalsService,
    private readonly notify: NotificationsService,
    private readonly scope: ScopeService,
    private readonly storage: StorageService,
  ) {}

  /* ---------------- Salary components (D1) ---------------- */

  @Get('components')
  @RequireAny(P.PAYROLL_READ_ALL)
  components() {
    return this.db.tx
      .select({ c: salaryComponents, employeeName: employees.fullName, departmentName: departments.name })
      .from(salaryComponents)
      .leftJoin(employees, eq(employees.id, salaryComponents.employeeId))
      .leftJoin(departments, eq(departments.id, salaryComponents.departmentId))
      .orderBy(asc(salaryComponents.kind), asc(salaryComponents.label))
      .then((r) => r.map((x) => ({ ...x.c, employeeName: x.employeeName, departmentName: x.departmentName })));
  }

  @Post('components')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.component_created', 'salary_component')
  async createComponent(@Body(zp(salaryComponentSchema)) body: z.infer<typeof salaryComponentSchema>) {
    return one(await this.db.tx.insert(salaryComponents).values({ ...body, tenantId: currentUser().tenantId }).returning());
  }

  @Put('components/:id')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.component_updated', 'salary_component')
  async updateComponent(@Param('id', ParseUUIDPipe) id: string, @Body(zp(salaryComponentSchema)) body: z.infer<typeof salaryComponentSchema>) {
    return one(await this.db.tx.update(salaryComponents).set(body).where(eq(salaryComponents.id, id)).returning(), 'Component');
  }

  @Delete('components/:id')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.component_deleted', 'salary_component')
  async removeComponent(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    one(await this.db.tx.delete(salaryComponents).where(eq(salaryComponents.id, id)).returning({ id: salaryComponents.id }), 'Component');
    return { id, deleted: true };
  }

  /* ---------------- Payroll runs (HR + Operations approval) ---------------- */

  @Get('runs')
  @RequireAny(P.PAYROLL_READ_ALL)
  async runs() {
    const user = currentUser();
    const rows = await this.db.tx.select().from(payrollRuns).orderBy(desc(payrollRuns.period));
    return Promise.all(rows.map(async (r) => ({ ...r, canDecide: await this.canDecideRun(r) })));
  }

  private async canDecideRun(r: typeof payrollRuns.$inferSelect) {
    if (r.status !== 'PENDING_APPROVAL') return false;
    return this.approvals.canDecide('PAYROLL', { id: r.id, status: 'PENDING', currentStep: r.currentStep, employeeId: await this.submitterEmployee(r) });
  }

  private async submitterEmployee(r: typeof payrollRuns.$inferSelect): Promise<string> {
    if (!r.processedByUserId) return '00000000-0000-0000-0000-000000000000';
    const [e] = await this.db.tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, r.processedByUserId));
    return e?.id ?? '00000000-0000-0000-0000-000000000000';
  }

  @Post('runs')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.run_created', 'payroll_run')
  async createRun(@Body(zp(payrollRunSchema)) body: z.infer<typeof payrollRunSchema>) {
    const t = await tenantInfo(this.db.tx);
    if (body.period > todayIn(t.timezone).slice(0, 7)) throw badRequest('You cannot process payroll for a future month');
    const run = one(await this.db.tx.insert(payrollRuns).values({ tenantId: t.id, period: body.period }).returning());
    await this.svc.calculate(run.id);
    return one(await this.db.tx.select().from(payrollRuns).where(eq(payrollRuns.id, run.id)));
  }

  @Get('runs/:id')
  @RequireAny(P.PAYROLL_READ_ALL)
  async run(@Param('id', ParseUUIDPipe) id: string) {
    const run = one(await this.db.tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)), 'Payroll run');
    const slips = await this.db.tx
      .select({ p: payslips, fullName: employees.fullName, employeeCode: employees.employeeCode, departmentName: departments.name })
      .from(payslips)
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(payslips.payrollRunId, id))
      .orderBy(asc(employees.fullName));
    return {
      ...run,
      canDecide: await this.canDecideRun(run),
      history: await this.approvals.history('PAYROLL', id),
      payslips: slips.map((s) => ({ ...s.p, fullName: s.fullName, employeeCode: s.employeeCode, departmentName: s.departmentName })),
    };
  }

  @Post('runs/:id/recalculate')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.run_recalculated', 'payroll_run')
  async recalc(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.calculate(id);
    await this.db.tx.update(payrollRuns).set({ status: 'DRAFT', currentStep: null }).where(eq(payrollRuns.id, id));
    return { id, ok: true };
  }

  @Post('runs/:id/submit')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.run_submitted', 'payroll_run')
  async submit(@Param('id', ParseUUIDPipe) id: string) {
    const run = one(await this.db.tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)), 'Payroll run');
    if (!['DRAFT', 'REJECTED'].includes(run.status)) throw badRequest('This run was already submitted');
    await this.svc.calculate(id); // always submit fresh numbers
    const submitter = currentUser().employeeId ?? '00000000-0000-0000-0000-000000000000';
    const wf = await this.approvals.submit('PAYROLL', id, submitter, { title: `Payroll ${run.period}`, link: `/payroll/runs/${id}` });
    await this.db.tx.update(payrollRuns).set({ status: wf.status === 'APPROVED' ? 'APPROVED' : 'PENDING_APPROVAL', currentStep: wf.currentStep }).where(eq(payrollRuns.id, id));
    return { id, status: 'PENDING_APPROVAL', currentStep: wf.currentStep };
  }

  @Post('runs/:id/decision')
  @RequireAny(P.PAYROLL_APPROVE_HR, P.PAYROLL_APPROVE_OPS)
  @Audit('payroll.run_decided', 'payroll_run')
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body(zp(decision)) body: DecisionInput) {
    const tx = this.db.tx;
    const run = one(await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)), 'Payroll run');
    if (run.status !== 'PENDING_APPROVAL') throw badRequest('This run is not awaiting approval');
    const wf = await this.approvals.decide(
      'PAYROLL',
      { id, status: 'PENDING', currentStep: run.currentStep, employeeId: await this.submitterEmployee(run) },
      body.approve,
      body.comment,
      { title: `Payroll ${run.period}`, link: `/payroll/runs/${id}` },
    );
    const status = wf.status === 'APPROVED' ? 'APPROVED' : wf.status === 'REJECTED' ? 'REJECTED' : 'PENDING_APPROVAL';
    await tx.update(payrollRuns).set({ status, currentStep: wf.currentStep }).where(eq(payrollRuns.id, id));
    if (status === 'APPROVED') {
      await this.svc.finalize(id);
      const emps = await tx.select({ id: payslips.employeeId }).from(payslips).where(eq(payslips.payrollRunId, id));
      await this.notify.notifyEmployees(emps.map((e) => e.id), { type: 'payroll.slip_ready', title: `Your salary slip for ${run.period} is ready`, link: '/payslips' });
    }
    return { id, status };
  }

  /** Only a draft (or rejected) run can be deleted; approved payroll is part of the record. */
  @Delete('runs/:id')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.run_deleted', 'payroll_run')
  async removeRun(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    const run = one(await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)), 'Payroll run');
    if (!['DRAFT', 'REJECTED'].includes(run.status)) throw badRequest('Only draft payroll can be deleted. Reopen it first if it was approved.', 'NOT_DRAFT');
    // Items a reopened run had booked go back to "not yet paid".
    await tx.update(compensationRequests).set({ payrollRunId: null }).where(eq(compensationRequests.payrollRunId, id));
    await tx.update(medicalClaims).set({ payrollRunId: null }).where(eq(medicalClaims.payrollRunId, id));
    await tx.update(incentives).set({ payrollRunId: null, status: 'APPROVED' }).where(eq(incentives.payrollRunId, id));
    await tx.delete(payrollRuns).where(eq(payrollRuns.id, id));
    return { id, deleted: true };
  }

  @Post('runs/:id/mark-paid')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.run_paid', 'payroll_run')
  async markPaid(@Param('id', ParseUUIDPipe) id: string) {
    const run = one(await this.db.tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)), 'Payroll run');
    if (run.status !== 'APPROVED') throw badRequest('Only approved runs can be marked as paid');
    await this.db.tx.update(payrollRuns).set({ status: 'PAID', paidAt: new Date() }).where(eq(payrollRuns.id, id));
    return { id, status: 'PAID' };
  }

  /** PAY-08: an approved run is locked; HR reopens it with a reason (audited), which unbooks its side effects. */
  @Post('runs/:id/reopen')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.run_reopened', 'payroll_run')
  async reopen(@Param('id', ParseUUIDPipe) id: string, @Body(zp(payrollReopenSchema)) body: z.infer<typeof payrollReopenSchema>) {
    const tx = this.db.tx;
    const run = one(await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)), 'Payroll run');
    if (run.status !== 'APPROVED') throw badRequest(run.status === 'PAID' ? 'Salaries for this month were already paid; it can no longer be reopened' : 'Only approved payroll can be reopened', 'NOT_LOCKED');
    await this.svc.reopen(id);
    await tx.update(payrollRuns).set({ status: 'DRAFT', currentStep: null, reopenedAt: new Date(), reopenReason: body.reason }).where(eq(payrollRuns.id, id));
    await this.notify.notifyPermission(P.PAYROLL_APPROVE_OPS, { type: 'payroll.reopened', title: `Payroll ${run.period} was reopened by HR`, body: body.reason, link: `/payroll/runs/${id}` }, currentUser().userId);
    return { id, status: 'DRAFT' };
  }

  @Post('payslips/:id/adjustments')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.payslip_adjusted', 'payslip')
  async adjust(@Param('id', ParseUUIDPipe) id: string, @Body(zp(payslipAdjustmentSchema)) body: z.infer<typeof payslipAdjustmentSchema>) {
    const p = await this.editableSlip(id);
    const line: PayslipLine = { kind: body.kind === 'BONUS' ? 'BONUS' : body.kind === 'ALLOWANCE' ? 'ALLOWANCE' : 'DEDUCTION', code: 'ADJ', label: body.label, amount: round2(body.amount), manual: true };
    await this.svc.applyManualLines(id, [...p.lines, line]);
    return { id, ok: true };
  }

  @Delete('payslips/:id/adjustments/:index')
  @RequireAny(P.PAYROLL_PROCESS)
  @Audit('payroll.payslip_adjustment_removed', 'payslip')
  async removeAdjustment(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    const p = await this.editableSlip(id);
    if (!p.lines[index]?.manual) throw badRequest('Only manual adjustments can be removed');
    await this.svc.applyManualLines(id, p.lines.filter((_, i) => i !== index));
    return { id, ok: true };
  }

  private async editableSlip(id: string) {
    const p = one(await this.db.tx.select().from(payslips).where(eq(payslips.id, id)), 'Payslip');
    const [run] = await this.db.tx.select().from(payrollRuns).where(eq(payrollRuns.id, p.payrollRunId));
    if (!run || !['DRAFT', 'REJECTED'].includes(run.status)) throw badRequest('Payslips can only be adjusted while the run is a draft');
    return p;
  }

  /* ---------------- Employee payslips (D1: web + PDF, previous months) ---------------- */

  @Get('me/payslips')
  async myPayslips() {
    const employeeId = this.scope.requireEmployee();
    return this.db.tx
      .select({ id: payslips.id, period: payslips.period, gross: payslips.gross, net: payslips.net, totalDeductions: payslips.totalDeductions, status: payrollRuns.status })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
      .where(and(eq(payslips.employeeId, employeeId), inArray(payrollRuns.status, [...VISIBLE_RUN_STATUSES])))
      .orderBy(desc(payslips.period));
  }

  private async slipForViewer(id: string) {
    const [row] = await this.db.tx
      .select({ p: payslips, runStatus: payrollRuns.status })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
      .where(eq(payslips.id, id));
    if (!row) throw forbidden();
    const u = currentUser();
    const own = row.p.employeeId === u.employeeId && (VISIBLE_RUN_STATUSES as readonly string[]).includes(row.runStatus);
    // F4: salary is confidential – only the employee and payroll staff.
    if (!own && !u.permissions.has(P.PAYROLL_READ_ALL)) throw forbidden();
    return row;
  }

  @Get('payslips/:id')
  async payslip(@Param('id', ParseUUIDPipe) id: string) {
    const { p, runStatus } = await this.slipForViewer(id);
    return { ...p, runStatus };
  }

  @Get('payslips/:id/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string) {
    const { p, runStatus } = await this.slipForViewer(id);
    const t = await tenantInfo(this.db.tx);
    const s = p.snapshot as Record<string, string>;
    const buf = await renderPayslipPdf({
      company: t.name,
      currency: t.currency,
      period: p.period,
      status: runStatus,
      employee: { fullName: s.fullName ?? '', employeeCode: s.employeeCode ?? '', designation: s.designation ?? '', departmentName: s.departmentName ?? '', level: s.level ?? '' },
      scheduledMinutes: p.scheduledMinutes,
      payableMinutes: p.payableMinutes,
      lines: p.lines,
      gross: p.gross,
      totalDeductions: p.totalDeductions,
      net: p.net,
    });
    return new StreamableFile(buf, { type: 'application/pdf', disposition: `attachment; filename="salary-slip-${p.period}-${s.employeeCode}.pdf"` });
  }

  /* ---------------- Loans (D2) ---------------- */

  @Get('loans')
  async loans(@Query(zp(z.object({ mine: z.coerce.boolean().optional() }))) query: { mine?: boolean }) {
    const u = currentUser();
    const all = u.permissions.has(P.LOANS_MANAGE) && !query.mine;
    const q = this.db.tx
      .select({ l: loans, fullName: employees.fullName, paid: sql<number>`coalesce((select sum(amount) from loan_repayments r where r.loan_id = ${loans.id}), 0)::float` })
      .from(loans)
      .innerJoin(employees, eq(employees.id, loans.employeeId));
    const rows = all ? await q.orderBy(desc(loans.createdAt)) : await q.where(eq(loans.employeeId, this.scope.requireEmployee())).orderBy(desc(loans.createdAt));
    return rows.map((r) => ({ ...r.l, fullName: r.fullName, repaid: round2(r.paid), outstanding: round2(r.l.principal - r.paid) }));
  }

  @Post('loans')
  @RequireAny(P.LOANS_MANAGE)
  @Audit('loan.created', 'loan')
  async createLoan(@Body(zp(loanSchema)) body: z.infer<typeof loanSchema>) {
    if (body.installment > body.principal) throw badRequest('Instalment cannot exceed the loan amount');
    const u = currentUser();
    const loan = one(await this.db.tx.insert(loans).values({ ...body, tenantId: u.tenantId, createdByUserId: u.userId }).returning());
    await this.notify.notifyEmployees([body.employeeId], { type: 'loan.created', title: `A loan of ${body.principal} was recorded for you`, link: '/loans' });
    return loan;
  }

  /** LON-04: employees request a loan from their own portal, optionally with supporting documents. */
  @Post('loans/requests')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024 } }))
  @Audit('loan.requested', 'loan')
  async requestLoan(@UploadedFiles() files: UploadedFileLike[] | undefined, @Body(zp(loanRequestSchema)) body: z.infer<typeof loanRequestSchema>) {
    const employeeId = this.scope.requireEmployee();
    if (body.installment > body.principal) throw badRequest('Instalment cannot exceed the loan amount');
    const [open] = await this.db.tx.select({ id: loans.id }).from(loans).where(and(eq(loans.employeeId, employeeId), eq(loans.status, 'PENDING'))).limit(1);
    if (open) throw badRequest('You already have a loan request waiting for HR', 'ALREADY_PENDING');
    const saved: string[] = [];
    for (const f of files ?? []) saved.push((await this.storage.save(f, 'document')).id);
    const u = currentUser();
    const row = one(await this.db.tx.insert(loans).values({ tenantId: u.tenantId, employeeId, principal: body.principal, installment: body.installment, startPeriod: body.startPeriod, reason: body.reason, status: 'PENDING', fileIds: saved, requestedByEmployee: true, createdByUserId: u.userId }).returning());
    const wf = await this.approvals.submit('LOAN_REQUEST', row.id, employeeId, { title: `Loan request (${body.principal})`, link: '/loans' });
    await this.db.tx.update(loans).set({ status: wf.status === 'APPROVED' ? 'ACTIVE' : 'PENDING', currentStep: wf.currentStep }).where(eq(loans.id, row.id));
    return { ...row, currentStep: wf.currentStep };
  }

  @Post('loans/:id/decision')
  @RequireAny(P.LOANS_MANAGE)
  @Audit('loan.request_decided', 'loan')
  async decideLoan(@Param('id', ParseUUIDPipe) id: string, @Body(zp(loanDecisionSchema)) body: z.infer<typeof loanDecisionSchema>) {
    const tx = this.db.tx;
    const loan = one(await tx.select().from(loans).where(eq(loans.id, id)), 'Loan');
    if (loan.status !== 'PENDING') throw badRequest('This loan request was already decided');
    const installment = body.installment ?? loan.installment;
    if (body.approve && installment > loan.principal) throw badRequest('Instalment cannot exceed the loan amount');
    const wf = await this.approvals.decide('LOAN_REQUEST', { id, status: 'PENDING', currentStep: loan.currentStep, employeeId: loan.employeeId }, body.approve, body.comment, { title: 'Loan request', link: '/loans' });
    const status = wf.status === 'APPROVED' ? 'ACTIVE' : wf.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    await tx.update(loans).set({ status, currentStep: wf.currentStep, installment, startPeriod: body.startPeriod ?? loan.startPeriod }).where(eq(loans.id, id));
    return { id, status };
  }

  @Get('loans/:id/files/:index')
  async loanFile(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    const loan = one(await this.db.tx.select().from(loans).where(eq(loans.id, id)), 'Loan');
    const u = currentUser();
    if (loan.employeeId !== u.employeeId && !u.permissions.has(P.LOANS_MANAGE)) throw forbidden();
    const fileId = loan.fileIds[index];
    if (!fileId) throw badRequest('No such file');
    return this.storage.stream(fileId, 'attachment');
  }

  @Get('loans/:id/repayments')
  async repayments(@Param('id', ParseUUIDPipe) id: string) {
    const loan = one(await this.db.tx.select().from(loans).where(eq(loans.id, id)), 'Loan');
    const u = currentUser();
    if (loan.employeeId !== u.employeeId && !u.permissions.has(P.LOANS_MANAGE)) throw forbidden();
    return this.db.tx.select().from(loanRepayments).where(eq(loanRepayments.loanId, id)).orderBy(asc(loanRepayments.paidOn));
  }

  /** For loans recorded by mistake: only when nothing has been repaid yet. */
  @Delete('loans/:id')
  @RequireAny(P.LOANS_MANAGE)
  @Audit('loan.deleted', 'loan')
  async removeLoan(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    one(await tx.select({ id: loans.id }).from(loans).where(eq(loans.id, id)), 'Loan');
    assertUnused('This loan', [[await countWhere(tx, loanRepayments, eq(loanRepayments.loanId, id)), 'repayment(s)']]);
    await tx.delete(loans).where(eq(loans.id, id));
    return { id, deleted: true };
  }

  @Post('loans/:id/repayments')
  @RequireAny(P.LOANS_MANAGE)
  @Audit('loan.repayment_recorded', 'loan')
  async repay(@Param('id', ParseUUIDPipe) id: string, @Body(zp(loanRepaymentSchema)) body: z.infer<typeof loanRepaymentSchema>) {
    const outstanding = await this.svc.loanOutstanding(id);
    if (body.amount > outstanding) throw badRequest(`Amount exceeds the outstanding balance (${outstanding})`);
    await this.db.tx.insert(loanRepayments).values({ tenantId: currentUser().tenantId, loanId: id, amount: body.amount, paidOn: body.paidOn, note: body.note, source: 'MANUAL' });
    if (outstanding - body.amount <= 0) await this.db.tx.update(loans).set({ status: 'CLOSED' }).where(eq(loans.id, id));
    return { id, outstanding: round2(outstanding - body.amount) };
  }

  /* ---------------- Medical claims (D3) ---------------- */

  @Get('medical')
  async medical(@Query(zp(z.object({ mine: z.coerce.boolean().optional() }))) q: { mine?: boolean }) {
    const u = currentUser();
    const all = u.permissions.has(P.MEDICAL_MANAGE) && !q.mine;
    const base = this.db.tx.select({ c: medicalClaims, fullName: employees.fullName }).from(medicalClaims).innerJoin(employees, eq(employees.id, medicalClaims.employeeId));
    const rows = all ? await base.orderBy(desc(medicalClaims.createdAt)) : await base.where(eq(medicalClaims.employeeId, this.scope.requireEmployee())).orderBy(desc(medicalClaims.createdAt));
    const t = await tenantInfo(this.db.tx);
    const year = todayIn(t.timezone).slice(0, 4);
    const usedFor = async (employeeId: string) => {
      const [r] = await this.db.tx
        .select({ s: sql<number>`coalesce(sum(coalesce(${medicalClaims.approvedAmount}, ${medicalClaims.amount})), 0)::float` })
        .from(medicalClaims)
        .where(and(eq(medicalClaims.employeeId, employeeId), eq(medicalClaims.status, 'APPROVED'), sql`extract(year from ${medicalClaims.claimDate}) = ${Number(year)}`));
      return r?.s ?? 0;
    };
    const limit = t.settings.medicalAnnualLimit;
    const mineUsed = u.employeeId ? await usedFor(u.employeeId) : 0;
    return {
      annualLimit: limit,
      usedThisYear: round2(mineUsed),
      remaining: round2(Math.max(0, limit - mineUsed)),
      items: await Promise.all(rows.map(async (r) => ({ ...r.c, fullName: r.fullName, canDecide: r.c.employeeId !== u.employeeId && (await this.approvals.canDecide('MEDICAL_CLAIM', r.c)) }))),
    };
  }

  /** Eligibility requires supporting documents (D3). */
  @Post('medical')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024 } }))
  @Audit('medical.claim_submitted', 'medical_claim')
  async claim(@UploadedFiles() files: UploadedFileLike[] | undefined, @Body(zp(medicalClaimSchema)) body: z.infer<typeof medicalClaimSchema>) {
    const employeeId = this.scope.requireEmployee();
    const [me] = await this.db.tx.select({ eligible: employees.medicalEligible }).from(employees).where(eq(employees.id, employeeId));
    const t = await tenantInfo(this.db.tx);
    if (!me?.eligible || !(t.settings.medicalAnnualLimit > 0)) throw forbidden('Medical claims are not part of your benefits. Ask HR if you think this is wrong.');
    if (!files?.length) throw badRequest('Attach at least one supporting document (receipt, prescription…)', 'DOCUMENTS_REQUIRED');
    const saved = [];
    for (const f of files) saved.push((await this.storage.save(f, 'document')).id);
    const row = one(await this.db.tx.insert(medicalClaims).values({ tenantId: currentUser().tenantId, employeeId, ...body, fileIds: saved }).returning());
    const wf = await this.approvals.submit('MEDICAL_CLAIM', row.id, employeeId, { title: `Medical claim (${body.amount})`, link: '/medical' });
    await this.db.tx.update(medicalClaims).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(medicalClaims.id, row.id));
    return { ...row, status: wf.status };
  }

  @Get('medical/:id/files/:index')
  async claimFile(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    const c = one(await this.db.tx.select().from(medicalClaims).where(eq(medicalClaims.id, id)), 'Claim');
    const u = currentUser();
    if (c.employeeId !== u.employeeId && !u.permissions.has(P.MEDICAL_MANAGE)) throw forbidden();
    const fileId = c.fileIds[index];
    if (!fileId) throw badRequest('No such file');
    return this.storage.stream(fileId, 'attachment');
  }

  @Post('medical/:id/decision')
  @RequireAny(P.MEDICAL_MANAGE)
  @Audit('medical.claim_decided', 'medical_claim')
  async decideClaim(@Param('id', ParseUUIDPipe) id: string, @Body(zp(medicalDecisionSchema)) body: z.infer<typeof medicalDecisionSchema>) {
    const tx = this.db.tx;
    const c = one(await tx.select().from(medicalClaims).where(eq(medicalClaims.id, id)), 'Claim');
    const approvedAmount = body.approve ? Math.min(body.approvedAmount ?? c.amount, c.amount) : null;
    if (body.approve) {
      const t = await tenantInfo(tx);
      const [used] = await tx
        .select({ s: sql<number>`coalesce(sum(coalesce(${medicalClaims.approvedAmount}, ${medicalClaims.amount})), 0)::float` })
        .from(medicalClaims)
        .where(and(eq(medicalClaims.employeeId, c.employeeId), eq(medicalClaims.status, 'APPROVED'), sql`extract(year from ${medicalClaims.claimDate}) = extract(year from ${c.claimDate}::date)`));
      if ((used?.s ?? 0) + (approvedAmount ?? 0) > t.settings.medicalAnnualLimit) {
        throw badRequest(`This exceeds the annual medical limit (${t.settings.medicalAnnualLimit}; already used ${used?.s ?? 0})`, 'LIMIT_EXCEEDED');
      }
    }
    const wf = await this.approvals.decide('MEDICAL_CLAIM', c, body.approve, body.comment, { title: 'Medical claim', link: '/medical' });
    await tx.update(medicalClaims).set({ status: wf.status, currentStep: wf.currentStep, approvedAmount }).where(eq(medicalClaims.id, id));
    return { id, status: wf.status };
  }

  /* ---------------- Food allowance (D4) ---------------- */

  @Get('food-rules')
  async foodRules() {
    const depts = await this.db.tx.select().from(departments).orderBy(asc(departments.name));
    const rules = await this.db.tx.select().from(foodAllowanceRules);
    return depts.map((d) => ({ departmentId: d.id, departmentName: d.name, enabled: d.foodAllowanceEnabled, rule: rules.find((r) => r.departmentId === d.id) ?? null }));
  }

  @Put('food-rules')
  @RequireAny(P.FOOD_ALLOWANCE_MANAGE)
  @Audit('food_allowance.rule_saved', 'food_allowance_rule')
  async saveFoodRule(@Body(zp(foodAllowanceRuleSchema)) body: z.infer<typeof foodAllowanceRuleSchema>) {
    const tx = this.db.tx;
    const values = { dailyAmount: body.dailyAmount, minWorkedMinutes: body.minWorkedMinutes, excludeWorkFromHome: body.excludeWorkFromHome, excludeEarlyLeave: body.excludeEarlyLeave, isActive: body.isActive };
    await tx
      .insert(foodAllowanceRules)
      .values({ tenantId: currentUser().tenantId, departmentId: body.departmentId, ...values })
      .onConflictDoUpdate({ target: foodAllowanceRules.departmentId, set: values });
    await tx.update(departments).set({ foodAllowanceEnabled: body.isActive }).where(eq(departments.id, body.departmentId));
    return { ok: true };
  }
}
