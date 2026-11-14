import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Public } from './common/decorators';
import { AllExceptionsFilter } from './common/errors';
import { AuthGuard, CsrfGuard, ModuleGuard } from './common/guards';
import { AuditInterceptor, TenantTxInterceptor } from './common/interceptors';
import { CoreModule } from './core/core.module';
import { DbService } from './db/db.service';
import { FEATURE_MODULES } from './modules';

@Controller()
class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get('health')
  async health() {
    await this.db.pool.query('select 1');
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    CoreModule,
    ...FEATURE_MODULES,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order: rate limit → CSRF → authentication/permissions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
    // Interceptor order: tenant transaction (outer) → audit (inner, same transaction).
    { provide: APP_INTERCEPTOR, useClass: TenantTxInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
