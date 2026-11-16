ALTER TABLE "billing_invoices" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "kind" text DEFAULT 'SUBSCRIPTION' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "invoice_template" jsonb;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_number_unique" UNIQUE("number");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "billing_invoice_number_seq";--> statement-breakpoint
-- Number existing invoices in date order, and give them a title and one line.
WITH numbered AS (
  SELECT id, created_at, row_number() OVER (ORDER BY created_at, id) AS n FROM billing_invoices WHERE number IS NULL
)
UPDATE billing_invoices b SET number = 'INV-' || to_char(numbered.created_at, 'YYYY') || '-' || lpad((numbered.n)::text, 5, '0')
FROM numbered WHERE numbered.id = b.id;--> statement-breakpoint
SELECT setval('billing_invoice_number_seq', GREATEST((SELECT count(*) FROM billing_invoices), 1), (SELECT count(*) FROM billing_invoices) > 0);--> statement-breakpoint
UPDATE billing_invoices SET title = plan_name || ' subscription (' || lower(cycle) || ')', items = jsonb_build_array(jsonb_build_object('description', plan_name || ' plan, ' || period_start || ' to ' || period_end, 'quantity', 1, 'unitPrice', amount)) WHERE title IS NULL;
