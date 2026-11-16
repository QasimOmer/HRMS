import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type LoginInput,
} from '@hrms/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Public, SkipAudit, User } from '../../common/decorators';
import { als } from '../../common/context';
import { DbService } from '../../db/db.service';
import { AccessService } from './access.service';
import type { AuthUser } from '../../common/context';
import { loginAttempts, resetAttempts } from '../../common/attempt-limiter';
import { zp } from '../../common/zod.pipe';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, ACTIVITY_HEADER, REFRESH_COOKIE, clearSessionCookies, issueCsrfCookie, setSessionCookies, verifyAccessToken } from './tokens';

const STRICT = { default: { limit: 10, ttl: 60_000 } };
/**
 * Sign-in per network address. A whole office usually shares one internet address, so this is generous;
 * guessing passwords is stopped by the per-account lockout (5 wrong attempts) instead.
 */
const LOGIN = { default: { limit: 30, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly db: DbService,
  ) {}

  /** Issues the CSRF cookie the web app echoes back on mutations. */
  @Public()
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response) {
    return { csrfToken: issueCsrfCookie(res) };
  }

  // No public sign-up: companies and their Super Admins are created by platform owners (/platform).

  @Public()
  @Throttle(LOGIN)
  @HttpCode(200)
  @Post('login')
  async login(@Body(zp(loginSchema)) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    loginAttempts.hit(`company:${body.email}`);
    const t = await this.auth.loginByEmail(body);
    setSessionCookies(res, t.access, t.refresh);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const t = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      setSessionCookies(res, t.access, t.refresh);
      return { ok: true };
    } catch (e) {
      clearSessionCookies(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(res);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  async forgot(@Body(zp(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    resetAttempts.hit(`reset:${body.email}`);
    await this.auth.forgotPassword(body.workspace, body.email);
    return { ok: true, message: 'If an account exists, a reset link has been sent.' };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('reset-password')
  async reset(@Body(zp(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Get('me')
  me() {
    return this.auth.me();
  }

  /**
   * One call for the web app to restore a session: returns the signed-in user, rotating an expired access
   * token from the refresh cookie on the way. "Not signed in" is a normal 200 answer, not an error.
   */
  @Public()
  @SkipAudit()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('session')
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const load = async (token: string | undefined) => {
      const claims = token ? await verifyAccessToken(token) : null;
      if (!claims) return null;
      const session = claims.sid ? { sid: claims.sid, active: req.header(ACTIVITY_HEADER) === '1' } : undefined;
      return this.access.load(claims.tid, claims.sub, claims.ver, session);
    };
    let user = await load(req.cookies?.[ACCESS_COOKIE]);
    if (!user && req.cookies?.[REFRESH_COOKIE]) {
      try {
        const t = await this.auth.refresh(req.cookies[REFRESH_COOKIE]);
        setSessionCookies(res, t.access, t.refresh);
        user = await load(t.access);
      } catch {
        clearSessionCookies(res);
      }
    }
    if (!user) return { authenticated: false as const };
    const store = als.getStore();
    if (store) {
      store.user = user;
      store.tenantId = user.tenantId;
    }
    return { authenticated: true as const, ...(await this.db.inTenant(user.tenantId, () => this.auth.me())) };
  }

  @Throttle(STRICT)
  @HttpCode(200)
  @Post('change-password')
  async changePassword(
    @User() user: AuthUser,
    @Body(zp(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.changePassword(user.userId, body.currentPassword, body.newPassword);
    setSessionCookies(res, t.access, t.refresh);
    return { ok: true };
  }
}
