import PDFDocument from 'pdfkit';
import type { InvoiceTemplate } from '@hrms/shared';

export interface InvoicePdfData {
  number: string;
  title: string;
  status: 'PENDING' | 'PAID' | 'VOID';
  issuedOn: string; // YYYY-MM-DD
  dueDate: string | null;
  periodStart: string;
  periodEnd: string;
  kind: 'SUBSCRIPTION' | 'CUSTOM';
  currency: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  total: number;
  notes: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  /** Billed to. */
  company: { name: string; workspace: string; emailDomain: string | null };
  /** From: the platform's invoice template (Super Admin). */
  template: InvoiceTemplate;
  platformName: string;
  /** Platform logo (PNG or JPG; other formats are skipped). */
  logo: { data: Buffer; type: string } | null;
}

const money = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Renders a subscription or custom invoice as an A4 PDF, styled by the Super Admin's invoice template. */
export function renderInvoicePdf(d: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const t = d.template;
    const from = t.businessName || d.platformName;
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${d.number}`, Author: from, Subject: d.title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ink = '#0f172a';
    const muted = '#64748b';
    const line = '#e2e8f0';
    const accent = t.accentColor || '#1d4ed8';
    const L = 48;
    const W = doc.page.width - 96;
    const R = L + W;

    // Accent bar
    doc.rect(0, 0, doc.page.width, 8).fill(accent);

    // From (left): logo, business name and contact details
    let y = 36;
    let textX = L;
    if (t.showLogo && d.logo && /png|jpe?g/.test(d.logo.type)) {
      try {
        doc.image(d.logo.data, L, y, { fit: [56, 56] });
        textX = L + 68;
      } catch {
        /* unreadable image: carry on without it */
      }
    }
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text(from, textX, y, { width: 260 });
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    const fromLines = [t.address, [t.phone, t.email].filter(Boolean).join('  ·  '), t.website, t.taxId ? `Tax / Reg. no: ${t.taxId}` : ''].filter(Boolean);
    let fy = doc.y + 2;
    for (const l of fromLines) {
      doc.text(l, textX, fy, { width: 260 });
      fy = doc.y + 1;
    }

    // Invoice heading (right)
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(24).text('INVOICE', R - 220, 36, { width: 220, align: 'right' });
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text(d.number, R - 220, 66, { width: 220, align: 'right' });
    const statusText = d.status === 'PAID' ? 'PAID' : d.status === 'VOID' ? 'CANCELLED' : 'UNPAID';
    const statusColor = d.status === 'PAID' ? '#15803d' : d.status === 'VOID' ? muted : '#b91c1c';
    doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(10).text(statusText, R - 220, 82, { width: 220, align: 'right' });

    // Bill to + dates
    y = Math.max(fy, 110) + 18;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(1).stroke();
    y += 14;
    doc.fillColor(muted).font('Helvetica').fontSize(8).text('BILL TO', L, y);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(d.company.name, L, y + 12, { width: W / 2 });
    doc.font('Helvetica').fontSize(9).fillColor(muted).text(`Workspace: ${d.company.workspace}${d.company.emailDomain ? `  ·  ${d.company.emailDomain}` : ''}`, L, doc.y + 2, { width: W / 2 });

    const meta: [string, string][] = [
      ['Invoice date', day(d.issuedOn)],
      ['Due date', d.dueDate ? day(d.dueDate) : 'On receipt'],
      ...(d.kind === 'SUBSCRIPTION' ? ([['Period', `${day(d.periodStart)} – ${day(d.periodEnd)}`]] as [string, string][]) : []),
    ];
    let my = y;
    for (const [k, v] of meta) {
      doc.fillColor(muted).font('Helvetica').fontSize(9).text(k, R - 220, my, { width: 90 });
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text(v, R - 130, my, { width: 130, align: 'right' });
      my += 15;
    }

    // What it's for
    y = Math.max(doc.y, my) + 22;
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(13).text(d.title, L, y, { width: W });
    y = doc.y + 12;

    // Line items
    const cols = { desc: L, qty: L + W * 0.58, unit: L + W * 0.7, amt: L + W * 0.85 };
    doc.rect(L, y, W, 22).fill(accent);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    doc.text('Description', cols.desc + 8, y + 7);
    doc.text('Qty', cols.qty, y + 7, { width: W * 0.1, align: 'right' });
    doc.text('Unit price', cols.unit, y + 7, { width: W * 0.14, align: 'right' });
    doc.text('Amount', cols.amt, y + 7, { width: W * 0.15 - 8, align: 'right' });
    y += 22;
    doc.font('Helvetica').fontSize(9);
    d.items.forEach((it, i) => {
      const h = Math.max(22, doc.heightOfString(it.description, { width: W * 0.55 - 8 }) + 12);
      if (i % 2 === 1) doc.rect(L, y, W, h).fill('#f8fafc');
      doc.fillColor(ink).text(it.description, cols.desc + 8, y + 6, { width: W * 0.55 - 8 });
      doc.text(String(it.quantity), cols.qty, y + 6, { width: W * 0.1, align: 'right' });
      doc.text(money(it.unitPrice, d.currency), cols.unit, y + 6, { width: W * 0.14, align: 'right' });
      doc.text(money(it.quantity * it.unitPrice, d.currency), cols.amt, y + 6, { width: W * 0.15 - 8, align: 'right' });
      y += h;
    });
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();

    // Total
    y += 10;
    doc.rect(R - 220, y, 220, 30).fill('#f1f5f9');
    doc.fillColor(muted).font('Helvetica').fontSize(10).text('Total', R - 210, y + 10);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(13).text(money(d.total, d.currency), R - 210, y + 8, { width: 200, align: 'right' });
    y += 44;

    if (d.status === 'PAID') {
      doc.fillColor('#15803d').font('Helvetica-Bold').fontSize(10).text(`Paid${d.paidAt ? ` on ${day(d.paidAt)}` : ''}${d.paymentReference ? `  ·  Ref ${d.paymentReference}` : ''}`, L, y, { width: W });
      y = doc.y + 10;
    }
    if (d.notes) {
      doc.fillColor(muted).font('Helvetica-Bold').fontSize(9).text('Notes', L, y);
      doc.fillColor(ink).font('Helvetica').fontSize(9).text(d.notes, L, doc.y + 2, { width: W });
      y = doc.y + 10;
    }

    // Footer note from the template
    if (t.footerNote) {
      const fh = doc.heightOfString(t.footerNote, { width: W });
      const fyBottom = doc.page.height - 48 - fh;
      doc.moveTo(L, fyBottom - 10).lineTo(R, fyBottom - 10).strokeColor(line).stroke();
      doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(t.footerNote, L, fyBottom, { width: W, align: 'center' });
    }
    doc.end();
  });
}
