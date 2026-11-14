CREATE TABLE "user_directory" (
	"email" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "user_directory_email_tenant_id_pk" PRIMARY KEY("email","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_directory_user_idx" ON "user_directory" USING btree ("user_id");--> statement-breakpoint
-- Keep user_directory in sync with users (SECURITY DEFINER: the directory is platform-wide, users is per-company).
CREATE OR REPLACE FUNCTION sync_user_directory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    DELETE FROM user_directory WHERE user_id = OLD.id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO user_directory (email, tenant_id, user_id) VALUES (lower(NEW.email), NEW.tenant_id, NEW.id)
    ON CONFLICT (email, tenant_id) DO UPDATE SET user_id = EXCLUDED.user_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS users_directory_sync ON users;
--> statement-breakpoint
CREATE TRIGGER users_directory_sync AFTER INSERT OR DELETE OR UPDATE OF email, tenant_id ON users FOR EACH ROW EXECUTE FUNCTION sync_user_directory();
--> statement-breakpoint
-- Backfill existing accounts company by company (users has forced row-level security).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    INSERT INTO user_directory (email, tenant_id, user_id)
      SELECT lower(email), tenant_id, id FROM users
      ON CONFLICT (email, tenant_id) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
