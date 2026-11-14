import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Module, Permission } from '@hrms/shared';
import { currentUser, type AuthUser } from './context';

export const IS_PUBLIC = 'isPublic';
/** Route needs no session (login, signup, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMS_ANY = 'permsAny';
/** Caller needs at least one of the listed permissions. */
export const RequireAny = (...perms: Permission[]) => SetMetadata(PERMS_ANY, perms);

export const AUDIT_ACTION = 'auditAction';
/** Name the audit action explicitly (otherwise derived from controller + handler). */
export const Audit = (action: string, entityType?: string) => SetMetadata(AUDIT_ACTION, { action, entityType });

export const SKIP_AUDIT = 'skipAudit';
export const SkipAudit = () => SetMetadata(SKIP_AUDIT, true);

export const SKIP_CSRF = 'skipCsrf';
/** Machine-to-machine endpoints authenticated by API key (biometric devices). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const User = createParamDecorator((_: unknown, _ctx: ExecutionContext): AuthUser => currentUser());

export const MODULE_KEY = 'requiredModule';
/** Feature module (subscription) an endpoint belongs to; 'CORE' marks endpoints every plan includes. */
export const RequireModule = (m: Module | 'CORE') => SetMetadata(MODULE_KEY, m);
