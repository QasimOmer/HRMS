import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, Role } from '@hrms/shared';
import type { Tx } from '../db/db.service';

/** The authenticated principal for the current request. */
export interface AuthUser {
  userId: string;
  tenantId: string;
  email: string;
  employeeId: string | null;
  roles: Role[];
  permissions: Set<Permission>;
  /** Team ids this user leads (Team Lead data scope, F4). */
  ledTeamIds: string[];
  canPost: boolean;
  /** Feature modules in the company's plan (permissions outside them are removed). */
  modules: string[];
  /** UNPAID locks the workspace to Billing; DUE shows a reminder. */
  billingStatus: 'PAID' | 'DUE' | 'UNPAID';
  /** The public read-only demo company. */
  isDemo: boolean;
}

export interface RequestContext {
  tenantId?: string;
  user?: AuthUser;
  tx?: Tx;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  /** Set by handlers that must not record the actor (anonymous complaints, F3). */
  anonymous?: boolean;
  /** Extra details handlers attach for the audit trail. */
  audit?: { action?: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> };
}

export const als = new AsyncLocalStorage<RequestContext>();

export function ctx(): RequestContext {
  const store = als.getStore();
  if (!store) throw new Error('No request context');
  return store;
}

export function currentUser(): AuthUser {
  const u = als.getStore()?.user;
  if (!u) throw new Error('No authenticated user in context');
  return u;
}

export function hasPermission(p: Permission, user: AuthUser = currentUser()): boolean {
  return user.permissions.has(p);
}

/** Attach audit details to the current request (picked up by AuditInterceptor). */
export function auditNote(note: RequestContext['audit']): void {
  const store = als.getStore();
  if (store) store.audit = { ...store.audit, ...note };
}
