ALTER TABLE "employees" ADD COLUMN "medical_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kpi_submissions" ADD COLUMN "file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Keep medical claims visible for anyone who has already used them.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE employees e SET medical_eligible = true WHERE EXISTS (SELECT 1 FROM medical_claims c WHERE c.employee_id = e.id);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
