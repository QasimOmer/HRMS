CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"default_currency" text DEFAULT 'PKR' NOT NULL,
	"copyright" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_single_row" CHECK ("id" = 'default');--> statement-breakpoint
INSERT INTO "platform_settings" ("id") VALUES ('default') ON CONFLICT DO NOTHING;
