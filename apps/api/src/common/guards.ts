import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_INFO, type Module, type Permission } from '@hrms/shared';
import type { Request } from 'express';
import { als } from './context';
import { IS_PUBLIC, MODULE_KEY, PERMS_ANY, SKIP_CSRF } from './decorators';
// SKIP_CSRF routes must also be @Public() and authenticate themselves (e.g. device API keys).
import { safeEqual } from './crypto';
import { AccessService } from '../modules/auth/access.service';
import { ACCESS_COOKIE, ACTIVITY_HEADER, CSRF_COOKIE, CSRF_HEADER, verifyAccessToken } from '../modules/auth/tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit CSRF check on every state-changing request. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;
    const cookie = req.cookies?.[CSRF_COOKIE];
    const header = req.header(CSRF_HEADER);
    if (typeof cookie !== 'string' || typeof header !== 'string' || !safeEqual(cookie, header)) {
      throw new ForbiddenException({ message: 'Invalid or missing CSRF token', code: 'CSRF' });
    }
    return true;
  }
}

/**
 * Authenticates the session cookie, re-validates the user against the DB on every request
 * (instant revocation), and enforces @RequireAny permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[ACCESS_COOKIE];
    const claims = typeof token === 'string' ? await verifyAccessToken(token) : null;
    if (!claims) throw new UnauthorizedException({ message: 'Please sign in', code: 'UNAUTHENTICATED' });

    const session = claims.sid ? { sid: claims.sid, active: req.header(ACTIVITY_HEADER) === '1' } : undefined;
    const user = await this.access.load(claims.tid, claims.sub, claims.ver, session);
    if (!user) throw new UnauthorizedException({ message: 'Session expired', code: 'UNAUTHENTICATED' });

    const store = als.getStore();
    if (store) {
      store.user = user;
      store.tenantId = user.tenantId;
    }

    // The public demo can look at everything but change nothing.
    if (user.isDemo && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      throw new ForbiddenException({ message: 'This is a read-only demo. Sign up to try it with your own company.', code: 'DEMO_READ_ONLY' });
    }
    // Unpaid subscription: only Billing (to pay), the person's notifications, their own profile and their
    // own password (a required password change must still work) are open until it's paid.
    if (user.billingStatus === 'UNPAID' && !/\/api\/v1\/(billing|notifications|auth|me\/profile)(\/|$|\?)/.test(req.originalUrl ?? req.url)) {
      throw new HttpException({ message: 'Your workspace is waiting for payment. Your Company Admin can pay on the Billing page.', code: 'PAYMENT_REQUIRED' }, HttpStatus.PAYMENT_REQUIRED);
    }

    // Plan check first, so people outside the plan are told why rather than "no permission".
    assertModule(this.reflector.getAllAndOverride<Module | 'CORE' | undefined>(MODULE_KEY, targets), user.modules);

    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMS_ANY, targets);
    if (needed?.length && !needed.some((p) => user.permissions.has(p))) {
      throw new ForbiddenException({ message: 'You do not have permission to do this', code: 'FORBIDDEN' });
    }
    return true;
  }
}

/**
 * Subscription check: endpoints of a module the company's plan doesn't include are refused,
 * whatever the person's role (even Super Admin).
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const m = this.reflector.getAllAndOverride<Module | 'CORE' | undefined>(MODULE_KEY, [context.getHandler(), context.getClass()]);
    const user = als.getStore()?.user;
    if (user) assertModule(m, user.modules); // public endpoints check modules themselves
    return true;
  }
}

function assertModule(m: Module | 'CORE' | undefined, modules: string[]) {
  if (!m || m === 'CORE' || modules.includes(m)) return;
  throw new ForbiddenException({ message: `${MODULE_INFO[m].label} isn't included in your company's plan. Contact your provider to add it.`, code: 'MODULE_DISABLED' });
}
