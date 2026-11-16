ALTER TABLE "user_directory" DROP CONSTRAINT "user_directory_email_tenant_id_pk";--> statement-breakpoint
ALTER TABLE "user_directory" ADD CONSTRAINT "user_directory_email_pk" PRIMARY KEY("email");--> statement-breakpoint
CREATE INDEX "user_directory_tenant_idx" ON "user_directory" USING btree ("tenant_id");--> statement-breakpoint
-- Emails are now unique platform-wide: a second account with the same email (in any company) is refused
-- by the primary key instead of being silently re-pointed.
CREATE OR REPLACE FUNCTION sync_user_directory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    DELETE FROM user_directory WHERE user_id = OLD.id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO user_directory (email, tenant_id, user_id) VALUES (lower(NEW.email), NEW.tenant_id, NEW.id);
  END IF;
  RETURN NULL;
END $$;
