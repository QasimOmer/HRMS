CREATE TABLE "employee_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"issue_date" date NOT NULL,
	"expiry_date" date,
	"credential_id" text,
	"verification_url" text,
	"description" text,
	"file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "employee_educations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualification_level" text NOT NULL,
	"degree_title" text NOT NULL,
	"field_of_study" text,
	"institution" text NOT NULL,
	"board" text,
	"start_date" date NOT NULL,
	"completion_date" date,
	"currently_studying" boolean DEFAULT false NOT NULL,
	"grade" text,
	"file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "employee_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_name" text NOT NULL,
	"designation" text NOT NULL,
	"employment_type" text NOT NULL,
	"department" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"responsibilities" text NOT NULL,
	"achievements" text,
	"reason_for_leaving" text,
	"file_id" uuid
);
--> statement-breakpoint
CREATE TABLE "employee_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"designation" text,
	"organisation" text NOT NULL,
	"relationship" text NOT NULL,
	"email" text,
	"phone" text,
	"years_known" integer,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "hide_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "dependents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "no_experience" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "education_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "references_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD CONSTRAINT "employee_educations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD CONSTRAINT "employee_educations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_educations" ADD CONSTRAINT "employee_educations_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_experiences" ADD CONSTRAINT "employee_experiences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_experiences" ADD CONSTRAINT "employee_experiences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_experiences" ADD CONSTRAINT "employee_experiences_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_references" ADD CONSTRAINT "employee_references_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_references" ADD CONSTRAINT "employee_references_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emp_certifications_employee_idx" ON "employee_certifications" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "emp_educations_employee_idx" ON "employee_educations" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "emp_experiences_employee_idx" ON "employee_experiences" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "emp_references_employee_idx" ON "employee_references" USING btree ("employee_id");