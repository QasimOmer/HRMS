CREATE TABLE "platform_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly" numeric(14, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_employees" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "modules" jsonb DEFAULT '["ATTENDANCE","LEAVE","PAYROLL","PERFORMANCE","COMPLIANCE","COMMUNITY","BIOMETRIC"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "max_employees" integer;--> statement-breakpoint
INSERT INTO "platform_plans" ("name", "description", "price_monthly", "modules", "max_employees") VALUES
  ('Starter', 'Employees, attendance and leave', 15000, '["ATTENDANCE","LEAVE"]'::jsonb, 25),
  ('Professional', 'Adds payroll, compliance and community', 35000, '["ATTENDANCE","LEAVE","PAYROLL","COMPLIANCE","COMMUNITY"]'::jsonb, 100),
  ('Enterprise', 'Every module including KPIs and biometric devices', 75000, '["ATTENDANCE","LEAVE","PAYROLL","PERFORMANCE","COMPLIANCE","COMMUNITY","BIOMETRIC"]'::jsonb, NULL)
ON CONFLICT ("name") DO NOTHING;
