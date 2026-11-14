ALTER TABLE "tenants" ADD COLUMN "email_domain" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_email_domain_unique" UNIQUE("email_domain");--> statement-breakpoint
-- Give existing companies a domain made from their name (falling back to the workspace if taken).
DO $$
DECLARE t record; d text;
BEGIN
  FOR t IN SELECT id, name, slug FROM tenants WHERE email_domain IS NULL ORDER BY created_at LOOP
    d := coalesce(nullif(regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g'), ''), 'company') || '.com';
    IF EXISTS (SELECT 1 FROM tenants WHERE email_domain = d) THEN
      d := regexp_replace(t.slug, '[^a-z0-9]', '', 'g') || '.com';
    END IF;
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE tenants SET email_domain = d WHERE id = t.id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
