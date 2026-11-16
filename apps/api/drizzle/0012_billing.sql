CREATE TABLE "billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid,
	"plan_name" text NOT NULL,
	"cycle" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payment_method_id" uuid,
	"payment_reference" text,
	"submitted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"company" text,
	"phone" text,
	"source" text NOT NULL,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'BANK_TRANSFER' NOT NULL,
	"instructions" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_plans" ADD COLUMN "price_annual" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_cycle" text DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_status" text DEFAULT 'PAID' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "paid_until" date;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "signup_source" text DEFAULT 'PLATFORM' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_invoices_tenant_idx" ON "billing_invoices" USING btree ("tenant_id","period_start");--> statement-breakpoint
-- Default annual price: two months free. Editable per plan.
UPDATE "platform_plans" SET "price_annual" = "price_monthly" * 10 WHERE "price_annual" IS NULL;
