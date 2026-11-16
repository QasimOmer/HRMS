import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PERMISSIONS as P, PROFILE_RECORD_KINDS, PROFILE_RECORD_SCHEMAS, durationLabel, recordBatchSchema, type ProfileRecordKind } from '@hrms/shared';
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config';
import { currentUser } from '../../common/context';
import { Audit } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { one } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { ScopeService } from '../../core/scope.service';
import { StorageService, type UploadedFileLike } from '../../core/storage.service';
import { DbService } from '../../db/db.service';
import { employeeCertifications, employeeEducations, employeeExperiences, employeeReferences, employees, files } from '../../db/schema';

const TABLES = {
  experience: employeeExperiences,
  education: employeeEducations,
  certifications: employeeCertifications,
  references: employeeReferences,
} as const;

/** Kinds the employee may enter only once; after that HR / Company Admin manage them. */
const SUBMIT_ONCE: Partial<Record<ProfileRecordKind, 'educationSubmittedAt' | 'referencesSubmittedAt'>> = {
  education: 'educationSubmittedAt',
  references: 'referencesSubmittedAt',
};

const KIND_LABEL: Record<ProfileRecordKind, string> = {
  experience: 'experience',
  education: 'education details',
  certifications: 'certifications',
  references: 'references',
};

const kindParam = zp(z.enum(PROFILE_RECORD_KINDS));
const upload = () => FileInterceptor('file', { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

/**
 * Previous experience, education, certifications and references on an employee profile.
 * - Experience and certifications: the employee and HR add, edit and delete.
 * - Education and references: the employee submits once (several entries at a time), then only HR changes them.
 * - Reference contact details (email, phone) are returned to HR / Company Admin only.
 */
@Controller()
export class ProfileRecordsController {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly storage: StorageService,
  ) {}

  private hr() {
    return currentUser().permissions.has(P.EMPLOYEES_MANAGE);
  }

  private async assertView(employeeId: string) {
    if (currentUser().employeeId === employeeId) return;
    await this.scope.assertCanView(employeeId, P.EMPLOYEES_READ_ALL, P.EMPLOYEES_READ_TEAM);
  }

  /** HR, or the person themselves. */
  private assertWriter(employeeId: string) {
    if (this.hr() || currentUser().employeeId === employeeId) return;
    throw forbidden('Only HR or the employee can change these details');
  }

  private async employee(id: string) {
    return one(
      await this.db.tx
        .select({ id: employees.id, noExperience: employees.noExperience, educationSubmittedAt: employees.educationSubmittedAt, referencesSubmittedAt: employees.referencesSubmittedAt })
        .from(employees)
        .where(eq(employees.id, id)),
      'Employee',
    );
  }

  /** Attachments must be files this person (or HR) uploaded in this company. */
  private async assertFiles(fileIds: (string | null | undefined)[]) {
    const ids = [...new Set(fileIds.filter((f): f is string => !!f))];
    if (!ids.length) return;
    const rows = await this.db.tx.select({ id: files.id, by: files.uploadedByUserId }).from(files).where(inArray(files.id, ids));
    const u = currentUser();
    for (const id of ids) {
      const f = rows.find((r) => r.id === id);
      if (!f) throw badRequest('An attached file was not found. Upload it again.', 'FILE_NOT_FOUND');
      if (f.by !== u.userId && !this.hr()) throw forbidden('You can only attach files you uploaded');
    }
  }

  @Get('employees/:id/records')
  async list(@Param('id', ParseUUIDPipe) id: string) {
    await this.assertView(id);
    const u = currentUser();
    const emp = await this.employee(id);
    const tx = this.db.tx;
    const [experience, education, certifications, references] = await Promise.all([
      tx.select().from(employeeExperiences).where(eq(employeeExperiences.employeeId, id)).orderBy(desc(employeeExperiences.startDate)),
      tx.select().from(employeeEducations).where(eq(employeeEducations.employeeId, id)).orderBy(desc(employeeEducations.startDate)),
      tx.select().from(employeeCertifications).where(eq(employeeCertifications.employeeId, id)).orderBy(desc(employeeCertifications.issueDate)),
      tx.select().from(employeeReferences).where(eq(employeeReferences.employeeId, id)).orderBy(employeeReferences.createdAt),
    ]);
    const fileIds = [...experience, ...education, ...certifications].map((r) => r.fileId).filter((f): f is string => !!f);
    const fileRows = fileIds.length ? await tx.select({ id: files.id, name: files.originalName, mimeType: files.mimeType, size: files.size }).from(files).where(inArray(files.id, fileIds)) : [];
    const file = (fid: string | null) => (fid ? (fileRows.find((f) => f.id === fid) ?? null) : null);
    const hr = this.hr();
    const self = u.employeeId === id;
    return {
      noExperience: emp.noExperience,
      educationSubmittedAt: emp.educationSubmittedAt,
      referencesSubmittedAt: emp.referencesSubmittedAt,
      canEdit: {
        experience: hr || self,
        education: hr || (self && !emp.educationSubmittedAt),
        certifications: hr || self,
        references: hr || (self && !emp.referencesSubmittedAt),
      },
      /** Whether existing entries can be edited / deleted (education & references: HR only once submitted). */
      // Once saved, entries are read-only for the employee: only HR / Company Admin edit or delete them.
      canChange: { experience: hr, education: hr, certifications: hr, references: hr },
      experience: experience.map((r) => ({ ...r, duration: durationLabel(r.startDate, r.endDate), file: file(r.fileId) })),
      education: education.map((r) => ({ ...r, file: file(r.fileId) })),
      certifications: certifications.map((r) => ({ ...r, file: file(r.fileId) })),
      // Contact details of references never leave the server for anyone but HR / Company Admin.
      references: references.map((r) => (hr ? { ...r, contactHidden: false } : { ...r, email: null, phone: null, contactHidden: true })),
    };
  }

  /** "Add more": every entry in `items` becomes its own record. */
  @Post('employees/:id/records/:kind')
  @Audit('employee.record_added', 'employee')
  async add(@Param('id', ParseUUIDPipe) id: string, @Param('kind', kindParam) kind: ProfileRecordKind, @Body() raw: unknown) {
    this.assertWriter(id);
    const hr = this.hr();
    const u = currentUser();
    const emp = await this.employee(id);
    const once = SUBMIT_ONCE[kind];
    if (once && !hr && emp[once]) throw forbidden(`Your ${KIND_LABEL[kind]} were already submitted. Ask HR to make changes.`);
    if (kind === 'experience' && emp.noExperience) throw badRequest('Untick "No previous experience" before adding experience.', 'NO_EXPERIENCE');
    const { items } = parse(recordBatchSchema(PROFILE_RECORD_SCHEMAS[kind] as z.ZodType<Record<string, unknown>>), raw);
    await this.assertFiles(items.map((i) => i.fileId as string | null | undefined));
    const table = TABLES[kind];
    const rows = await this.db.tx
      .insert(table)
      .values(items.map((i) => ({ ...i, tenantId: u.tenantId, employeeId: id, createdByUserId: u.userId })) as never)
      .returning();
    // The employee's one submission: lock it (HR adding entries doesn't use up the employee's turn).
    if (once && !hr) await this.db.tx.update(employees).set({ [once]: new Date() }).where(eq(employees.id, id));
    return { id, kind, added: (rows as unknown[]).length };
  }

  @Patch('employees/:id/records/:kind/:recordId')
  @Audit('employee.record_updated', 'employee')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', kindParam) kind: ProfileRecordKind,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() raw: unknown,
  ) {
    await this.assertChange(id, kind);
    const body = parse(PROFILE_RECORD_SCHEMAS[kind] as z.ZodType<Record<string, unknown>>, raw);
    await this.assertFiles([body.fileId as string | null | undefined]);
    const table = TABLES[kind];
    // Optional fields left out are cleared, so the record matches the form.
    const blank = Object.fromEntries(Object.keys(getTableColumns(table)).filter((k) => !['id', 'tenantId', 'employeeId', 'createdByUserId', 'createdAt', 'updatedAt'].includes(k)).map((k) => [k, null]));
    const t = table as typeof employeeExperiences;
    const [row] = await this.db.tx
      .update(t)
      .set({ ...blank, ...body } as never)
      .where(and(eq(t.id, recordId), eq(t.employeeId, id)))
      .returning();
    if (!row) throw badRequest('That entry was not found', 'NOT_FOUND');
    return { id, kind, recordId };
  }

  @Delete('employees/:id/records/:kind/:recordId')
  @Audit('employee.record_deleted', 'employee')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('kind', kindParam) kind: ProfileRecordKind, @Param('recordId', ParseUUIDPipe) recordId: string) {
    await this.assertChange(id, kind);
    const t = TABLES[kind] as typeof employeeExperiences;
    const [row] = await this.db.tx.delete(t).where(and(eq(t.id, recordId), eq(t.employeeId, id))).returning({ id: t.id });
    if (!row) throw badRequest('That entry was not found', 'NOT_FOUND');
    return { id, kind, recordId, deleted: true };
  }

  /** Editing / deleting: HR always; the employee only for experience and certifications. */
  private async assertChange(id: string, kind: ProfileRecordKind) {
    this.assertWriter(id);
    if (this.hr()) return;
    // Saved entries (and their documents) are locked for the employee; HR makes any changes.
    throw forbidden(`Submitted ${KIND_LABEL[kind]} can only be changed by HR.`);
  }

  /** Supporting document for an experience, education or certification entry (PDF or image, content-checked). */
  @Post('employees/:id/record-files')
  @UseInterceptors(upload())
  @Audit('employee.record_file_uploaded', 'employee')
  async uploadFile(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike) {
    this.assertWriter(id);
    await this.employee(id);
    const f = await this.storage.save(file, 'document');
    return { id, fileId: f.id, name: f.originalName, mimeType: f.mimeType, size: f.size };
  }

  /**
   * View (`inline`) or download (`?download=1`) an attachment: one on this employee's saved entries, or a file
   * the person just uploaded for a form they haven't submitted yet (so they can check it before submitting).
   */
  @Get('employees/:id/record-files/:fileId')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Query('download') download?: string) {
    await this.assertView(id);
    const tx = this.db.tx;
    const [{ n }] = (await tx.execute(sql`
      select ((select count(*) from employee_experiences where employee_id = ${id} and file_id = ${fileId})
        + (select count(*) from employee_educations where employee_id = ${id} and file_id = ${fileId})
        + (select count(*) from employee_certifications where employee_id = ${id} and file_id = ${fileId}))::int as n`)).rows as [{ n: number }];
    if (!n) {
      // Not attached yet: only the uploader (the employee or HR working on this profile) may open it.
      this.assertWriter(id);
      const [f] = await tx.select({ by: files.uploadedByUserId }).from(files).where(eq(files.id, fileId));
      if (!f || f.by !== currentUser().userId) throw forbidden();
    }
    return this.storage.stream(fileId, download ? 'attachment' : 'inline');
  }
}
