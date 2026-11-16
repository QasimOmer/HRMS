CREATE TABLE "device_serials" (
	"serial_number" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "held_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_user_id" text NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"type" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_positions" ALTER COLUMN "salary" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "basic_salary" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "settings" SET DEFAULT '{"directoryShowJoinDate":false,"sessionIdleMinutes":30,"communityPostingMode":"GRANTED_ONLY","communityEngagementEnabled":true,"medicalAnnualLimit":50000,"overtimeThresholdMinutes":30,"payrollWorkingHoursBased":true}'::jsonb;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "protocol" text DEFAULT 'GENERIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "work_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "biometric_user_id" text;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "carry_forward" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "carry_forward_max" numeric(5, 1);--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "current_step" text;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "requested_by_employee" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "reopen_reason" text;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "device_serials" ADD CONSTRAINT "device_serials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_punches" ADD CONSTRAINT "held_punches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "held_punches_dedupe_uq" ON "held_punches" USING btree ("device_id","device_user_id","punched_at");--> statement-breakpoint
CREATE INDEX "held_punches_open_idx" ON "held_punches" USING btree ("tenant_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_tenant_biometric_uq" ON "employees" USING btree ("tenant_id","biometric_user_id");--> statement-breakpoint
ALTER TABLE "work_schedules" DROP COLUMN "grace_minutes";