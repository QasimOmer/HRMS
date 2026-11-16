import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { PERMISSIONS as P, billingCycleSchema, submitPaymentSchema } from '@hrms/shared';
import type { z } from 'zod';
import { currentUser } from '../../common/context';
import { Audit, RequireAny } from '../../common/decorators';
import { zp } from '../../common/zod.pipe';
import { BillingService } from './billing.service';

/**
 * The company's own subscription: plan, prices for both cycles, invoices and how to pay.
 * Works while the workspace is locked for non-payment (the guard lets /billing through).
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequireAny(P.TENANT_SETTINGS)
  overview() {
    return this.billing.overview(currentUser().tenantId);
  }

  /** Switch between monthly and yearly billing (Company Admin). */
  @Post('cycle')
  @HttpCode(200)
  @RequireAny(P.TENANT_SETTINGS)
  @Audit('billing.cycle_changed', 'tenant')
  async cycle(@Body(zp(billingCycleSchema)) body: z.infer<typeof billingCycleSchema>) {
    const r = await this.billing.changeCycle(currentUser().tenantId, body.cycle);
    return { ...r, overview: await this.billing.overview(currentUser().tenantId) };
  }

  /** One of the company's own invoices. */
  @Get('invoices/:id')
  @RequireAny(P.TENANT_SETTINGS)
  invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.invoice(id, currentUser().tenantId);
  }

  @Get('invoices/:id/pdf')
  @RequireAny(P.TENANT_SETTINGS)
  async invoicePdf(@Param('id', ParseUUIDPipe) id: string) {
    const { file, name } = await this.billing.invoicePdf(id, currentUser().tenantId);
    return new StreamableFile(file, { type: 'application/pdf', disposition: `attachment; filename="${name}"` });
  }

  /** "We've paid": method + transaction reference. The Super Admin confirms and unlocks the workspace. */
  @Post('invoices/:id/submit')
  @HttpCode(200)
  @RequireAny(P.TENANT_SETTINGS)
  @Audit('billing.payment_submitted', 'invoice')
  submit(@Param('id', ParseUUIDPipe) id: string, @Body(zp(submitPaymentSchema)) body: z.infer<typeof submitPaymentSchema>) {
    return this.billing.submitPayment(currentUser().tenantId, id, body.paymentMethodId, body.reference);
  }
}
