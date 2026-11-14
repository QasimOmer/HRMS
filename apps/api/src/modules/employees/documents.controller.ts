import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  EMPLOYMENT_DOC_CATEGORIES,
  ONBOARDING_DOC_CATEGORIES,
  PERMISSIONS as P,
  REQUIRED_ONBOARDING_DOCS,
  documentUploadSchema,
  type DocCategory,
} from '@hrms/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { config } from '../../config';
import { currentUser } from '../../common/context';
import { Audit } from '../../common/decorators';
import { badRequest, conflict, forbidden } from '../../common/errors';
import { one } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { NotificationsService } from '../../core/notifications.service';
import { StorageService, type UploadedFileLike } from '../../core/storage.service';
import { DbService } from '../../db/db.service';
import { employeeDocuments, employees, files, tenants } from '../../db/schema';

const upload = () => FileInterceptor('file', { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

const isOnboarding = (c: string) => (ONBOARDING_DOC_CATEGORIES as readonly string[]).includes(c);
const isEmployment = (c: string) => (EMPLOYMENT_DOC_CATEGORIES as readonly string[]).includes(c);

/**
 * B2 onboarding documents: uploaded once by the employee, then read-only for them; only HR can change.
 * B3 employment documents: uploaded by HR; visible only to the employee and HR (F4).
 */
@Controller()
export class DocumentsController {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly notify: NotificationsService,
  ) {}

  private canManage(category: string) {
    const u = currentUser();
    return isEmployment(category) ? u.permissions.has(P.EMPLOYMENT_DOCS_MANAGE) : u.permissions.has(P.EMPLOYEE_DOCS_MANAGE);
  }

  private canViewAll() {
    const u = currentUser();
    return u.permissions.has(P.EMPLOYEE_DOCS_MANAGE) || u.permissions.has(P.EMPLOYMENT_DOCS_MANAGE);
  }

  @Get('employees/:id/documents')
  async list(@Param('id', ParseUUIDPipe) id: string) {
    const u = currentUser();
    if (u.employeeId !== id && !this.canViewAll()) throw forbidden();
    const rows = await this.db.tx
      .select({
        storageKey: files.storageKey,
        id: employeeDocuments.id,
        category: employeeDocuments.category,
        title: employeeDocuments.title,
        source: employeeDocuments.source,
        fileName: files.originalName,
        mimeType: files.mimeType,
        size: files.size,
        createdAt: employeeDocuments.createdAt,
        updatedAt: employeeDocuments.updatedAt,
      })
      .from(employeeDocuments)
      .innerJoin(files, eq(files.id, employeeDocuments.fileId))
      .where(eq(employeeDocuments.employeeId, id))
      .orderBy(desc(employeeDocuments.createdAt));
    // `missing`: the record is there but the file isn't on disk any more (it can be uploaded again).
    return rows.map(({ storageKey, ...d }) => ({ ...d, missing: !this.storage.isOnDisk(storageKey) }));
  }

  /** Employee self-upload during onboarding (once per category; a lost file can be replaced). */
  @Post('me/documents')
  @UseInterceptors(upload())
  @Audit('document.self_uploaded', 'employee_document')
  async selfUpload(@UploadedFile() file: UploadedFileLike, @Body(zp(documentUploadSchema)) body: z.infer<typeof documentUploadSchema>) {
    const u = currentUser();
    if (!u.employeeId) throw forbidden();
    if (!isOnboarding(body.category)) throw forbidden('HR uploads employment documents');
    const [exists] = await this.db.tx
      .select({ id: employeeDocuments.id, storageKey: files.storageKey })
      .from(employeeDocuments)
      .innerJoin(files, eq(files.id, employeeDocuments.fileId))
      .where(and(eq(employeeDocuments.employeeId, u.employeeId), eq(employeeDocuments.category, body.category)));
    // The earlier upload's file is gone from storage: let them replace it instead of being stuck.
    if (exists && body.category !== 'OTHER_ONBOARDING' && !this.storage.isOnDisk(exists.storageKey)) {
      await this.db.tx.delete(employeeDocuments).where(eq(employeeDocuments.id, exists.id));
    } else if (exists && body.category !== 'OTHER_ONBOARDING') {
      throw conflict('This document was already submitted. Contact HR to change it.', 'DOCUMENT_LOCKED');
    }
    if (body.category === 'OTHER_ONBOARDING') {
      const [{ n }] = (await this.db.tx.select({ n: sql<number>`count(*)::int` }).from(employeeDocuments).where(and(eq(employeeDocuments.employeeId, u.employeeId), eq(employeeDocuments.category, 'OTHER_ONBOARDING')))) as [{ n: number }];
      if (n >= 20) throw conflict('You can upload up to 20 other documents. Ask HR to remove old ones first.', 'TOO_MANY');
    }
    const f = await this.storage.save(file, body.category === 'PHOTO' ? 'image' : 'document');
    // The onboarding photograph doubles as the profile photo (directory, ID card) if none is set yet.
    if (body.category === 'PHOTO') {
      await this.db.tx.update(employees).set({ avatarFileId: f.id }).where(and(eq(employees.id, u.employeeId), isNull(employees.avatarFileId)));
    }
    return one(
      await this.db.tx
        .insert(employeeDocuments)
        .values({ tenantId: u.tenantId, employeeId: u.employeeId, fileId: f.id, category: body.category, title: body.title, source: 'EMPLOYEE', uploadedByUserId: u.userId })
        .returning(),
    );
  }

  @Post('me/onboarding/complete')
  @Audit('employee.onboarding_completed', 'employee')
  async completeOnboarding() {
    const u = currentUser();
    if (!u.employeeId) throw forbidden();
    const docs = await this.db.tx
      .select({ category: employeeDocuments.category })
      .from(employeeDocuments)
      .where(and(eq(employeeDocuments.employeeId, u.employeeId), inArray(employeeDocuments.category, REQUIRED_ONBOARDING_DOCS)));
    const missing = REQUIRED_ONBOARDING_DOCS.filter((c) => !docs.some((d) => d.category === c));
    if (missing.length) throw badRequest(`Please upload: ${missing.join(', ')}`, 'DOCUMENTS_MISSING');
    const [emp] = await this.db.tx.select().from(employees).where(eq(employees.id, u.employeeId));
    if (!emp?.cnic || !emp.emergencyContact) throw badRequest('Please complete your CNIC and emergency contact first', 'PROFILE_INCOMPLETE');
    await this.db.tx.update(employees).set({ onboardingCompletedAt: new Date() }).where(eq(employees.id, u.employeeId));
    await this.notify.notifyPermission(P.EMPLOYEE_DOCS_MANAGE, { type: 'onboarding.completed', title: `${emp.fullName} completed onboarding`, link: `/employees/${emp.id}` });
    return { ok: true };
  }

  /** HR uploads or replaces a document for an employee. */
  @Post('employees/:id/documents')
  @UseInterceptors(upload())
  @Audit('document.hr_uploaded', 'employee_document')
  async hrUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike,
    @Body(zp(documentUploadSchema)) body: z.infer<typeof documentUploadSchema>,
  ) {
    if (!this.canManage(body.category)) throw forbidden();
    const u = currentUser();
    one(await this.db.tx.select({ id: employees.id }).from(employees).where(eq(employees.id, id)), 'Employee');
    const f = await this.storage.save(file, body.category === 'PHOTO' ? 'image' : 'document');
    const doc = one(
      await this.db.tx
        .insert(employeeDocuments)
        .values({ tenantId: u.tenantId, employeeId: id, fileId: f.id, category: body.category, title: body.title, source: 'HR', uploadedByUserId: u.userId })
        .returning(),
    );
    if (isEmployment(body.category)) {
      await this.notify.notifyEmployees([id], { type: 'document.issued', title: 'HR shared a new document with you', link: '/profile?tab=documents' });
    }
    return doc;
  }

  @Delete('documents/:docId')
  @Audit('document.deleted', 'employee_document')
  async remove(@Param('docId', ParseUUIDPipe) docId: string) {
    const doc = one(await this.db.tx.select().from(employeeDocuments).where(eq(employeeDocuments.id, docId)), 'Document');
    if (!this.canManage(doc.category)) throw forbidden('Only HR can remove submitted documents');
    await this.db.tx.delete(employeeDocuments).where(eq(employeeDocuments.id, docId));
    return { id: docId, deleted: true };
  }

  @Get('documents/:docId/file')
  async download(@Param('docId', ParseUUIDPipe) docId: string) {
    const doc = one(await this.db.tx.select().from(employeeDocuments).where(eq(employeeDocuments.id, docId)), 'Document');
    const u = currentUser();
    if (u.employeeId !== doc.employeeId && !this.canViewAll()) throw forbidden();
    return this.storage.stream(doc.fileId, 'attachment');
  }

  /* ---------------- Avatars ---------------- */

  @Put('me/avatar')
  @UseInterceptors(upload())
  @Audit('employee.avatar_updated', 'employee')
  async myAvatar(@UploadedFile() file: UploadedFileLike) {
    const u = currentUser();
    if (!u.employeeId) throw forbidden();
    const f = await this.storage.save(file, 'image');
    await this.db.tx.update(employees).set({ avatarFileId: f.id }).where(eq(employees.id, u.employeeId));
    return { avatarFileId: f.id };
  }

  @Put('employees/:id/avatar')
  @UseInterceptors(upload())
  @Audit('employee.avatar_updated', 'employee')
  async setAvatar(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike) {
    if (!currentUser().permissions.has(P.EMPLOYEES_MANAGE)) throw forbidden();
    const f = await this.storage.save(file, 'image');
    await this.db.tx.update(employees).set({ avatarFileId: f.id }).where(eq(employees.id, id));
    return { avatarFileId: f.id };
  }

  /* ---------------- Company logo ---------------- */

  @Put('settings/logo')
  @UseInterceptors(upload())
  @Audit('settings.logo_updated', 'tenant')
  async setLogo(@UploadedFile() file: UploadedFileLike) {
    const u = currentUser();
    if (!u.permissions.has(P.TENANT_SETTINGS)) throw forbidden();
    const f = await this.storage.save(file, 'image');
    await this.db.tx.update(tenants).set({ logoFileId: f.id }).where(eq(tenants.id, u.tenantId));
    return { id: u.tenantId, logoFileId: f.id };
  }

  @Delete('settings/logo')
  @Audit('settings.logo_removed', 'tenant')
  async removeLogo() {
    const u = currentUser();
    if (!u.permissions.has(P.TENANT_SETTINGS)) throw forbidden();
    await this.db.tx.update(tenants).set({ logoFileId: null }).where(eq(tenants.id, u.tenantId));
    return { id: u.tenantId, logoFileId: null };
  }

  /** Every signed-in member of the company may see its logo. */
  @Get('company/logo/:fileId')
  async logo(@Param('fileId', ParseUUIDPipe) fileId: string) {
    const [t] = await this.db.tx.select({ logo: tenants.logoFileId }).from(tenants).where(eq(tenants.id, currentUser().tenantId));
    if (t?.logo !== fileId) throw forbidden();
    return this.storage.stream(fileId, 'inline');
  }

  /** Avatars are visible company-wide (directory, birthdays – B5, G3). */
  @Get('avatars/:fileId')
  async avatar(@Param('fileId', ParseUUIDPipe) fileId: string) {
    const [owner] = await this.db.tx.select({ id: employees.id }).from(employees).where(eq(employees.avatarFileId, fileId)).limit(1);
    if (!owner) throw forbidden();
    return this.storage.stream(fileId, 'inline');
  }
}

export type { DocCategory };
