import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';

export const notFound = (what = 'Resource') => new NotFoundException({ message: `${what} not found`, code: 'NOT_FOUND' });
export const forbidden = (message = 'You do not have access to this resource') =>
  new ForbiddenException({ message, code: 'FORBIDDEN' });
export const conflict = (message: string, code = 'CONFLICT', details?: Record<string, unknown>) => new ConflictException({ message, code, ...(details ? { details } : {}) });
export const badRequest = (message: string, code = 'BAD_REQUEST') => new BadRequestException({ message, code });

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

function pgCause(err: unknown): PgError | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const c = e as PgError & { cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    e = c.cause;
  }
  return undefined;
}

/**
 * Uniform error envelope: { statusCode, code, message, issues? }.
 * Internal errors never leak stack traces or SQL to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Rate limits: a plain sentence instead of "ThrottlerException: Too Many Requests".
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        // The rate limiter has already set Retry-After (seconds); pass it on so the page can count down.
        const retryAfter = Math.max(1, Math.ceil(Number(res.getHeader('Retry-After') ?? 60)) || 60);
        res.status(status).json({ statusCode: status, code: 'TOO_MANY_REQUESTS', message: `Too many attempts. Please try again in ${retryAfter} seconds.`, details: { retryAfter } });
        return;
      }
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { message: body }
          : (body as Record<string, unknown>);
      res.status(status).json({
        statusCode: status,
        code: payload.code ?? HttpStatus[status],
        message: Array.isArray(payload.message) ? payload.message.join(', ') : payload.message,
        ...(payload.issues ? { issues: payload.issues } : {}),
        ...(payload.details ? { details: payload.details } : {}),
      });
      return;
    }

    const pg = pgCause(exception);
    if (pg?.code === '23505') {
      res.status(409).json({ statusCode: 409, code: 'DUPLICATE', message: 'A record with these details already exists' });
      return;
    }
    if (pg?.code === '23503') {
      const p = pg as { constraint?: string; detail?: string };
      this.logger.warn(`Foreign key failed: ${p.constraint ?? '?'} ${p.detail ?? ''}`);
      res.status(409).json({ statusCode: 409, code: 'REFERENCE', message: 'This record is linked to other data' });
      return;
    }
    if (pg?.code === '22P02') {
      res.status(400).json({ statusCode: 400, code: 'BAD_REQUEST', message: 'Invalid identifier' });
      return;
    }

    const cause = pg ? ` | cause: [${pg.code}] ${(pg as { message?: string }).message ?? ''} ${pg.detail ?? ''}` : '';
    this.logger.error(`${exception instanceof Error ? exception.stack : String(exception)}${cause}`);
    res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}
