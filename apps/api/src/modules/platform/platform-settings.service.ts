import { Injectable } from '@nestjs/common';
import { invoiceTemplate, planPrice, type InvoiceTemplate, type PlatformSettingsInput } from '@hrms/shared';
import { eq, sql } from 'drizzle-orm';
import { badRequest } from '../../common/errors';
import { DbService } from '../../db/db.service';
import { platformPlans, platformSettings } from '../../db/schema';

export interface PlatformSettings {
  defaultCurrency: string;
  siteName: string | null;
  copyright: string | null;
  /** Cache-busting versions; null when no custom image is set. */
  logoVersion: string | null;
  faviconVersion: string | null;
}

export type BrandImage = 'logo' | 'favicon';

const DEFAULTS: PlatformSettings = { defaultCurrency: 'PKR', siteName: null, copyright: null, logoVersion: null, faviconVersion: null };
const MAX_IMAGE_BYTES = 256 * 1024;

/** Detects the image type from its first bytes; the browser-supplied type is not trusted. SVG is refused (it can carry scripts). */
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return null;
}

/**
 * Platform-wide settings owned by the Super Admin (a single row): default currency, sign-in footer,
 * logo and favicon. Reads are cached briefly because public pages ask for them on every visit.
 */
@Injectable()
export class PlatformSettingsService {
  private cache: { value: PlatformSettings; at: number } | null = null;
  private static readonly TTL_MS = 60_000;

  constructor(private readonly db: DbService) {}

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < PlatformSettingsService.TTL_MS) return this.cache.value;
    const [row] = await this.db.root
      .select({
        defaultCurrency: platformSettings.defaultCurrency,
        siteName: platformSettings.siteName,
        copyright: platformSettings.copyright,
        hasLogo: sql<boolean>`${platformSettings.logo} is not null`,
        hasFavicon: sql<boolean>`${platformSettings.favicon} is not null`,
        updatedAt: platformSettings.updatedAt,
      })
      .from(platformSettings)
      .where(eq(platformSettings.id, 'default'));
    const version = row ? String(row.updatedAt.getTime()) : null;
    const value: PlatformSettings = row
      ? { defaultCurrency: row.defaultCurrency, siteName: row.siteName, copyright: row.copyright, logoVersion: row.hasLogo ? version : null, faviconVersion: row.hasFavicon ? version : null }
      : DEFAULTS;
    this.cache = { value, at: Date.now() };
    return value;
  }

  /** How invoices look and who they're from (Super Admin → Platform settings → Invoices). */
  async invoiceTemplate(): Promise<InvoiceTemplate> {
    const [row] = await this.db.root.select({ t: platformSettings.invoiceTemplate }).from(platformSettings).where(eq(platformSettings.id, 'default'));
    return invoiceTemplate(row?.t as Partial<InvoiceTemplate> | null);
  }

  async setInvoiceTemplate(input: InvoiceTemplate): Promise<InvoiceTemplate> {
    const value = input as unknown as Record<string, unknown>;
    await this.db.root.insert(platformSettings).values({ id: 'default', invoiceTemplate: value })
      .onConflictDoUpdate({ target: platformSettings.id, set: { invoiceTemplate: value, updatedAt: new Date() } });
    return this.invoiceTemplate();
  }

  /** The product name for emails and anything else server-side: the Super Admin's setting, or the default. */
  async name(): Promise<string> {
    return (await this.get()).siteName || process.env.NEXT_PUBLIC_APP_NAME || 'HRMS';
  }

  async update(input: PlatformSettingsInput): Promise<PlatformSettings> {
    const values = { defaultCurrency: input.defaultCurrency, siteName: input.siteName ?? null, copyright: input.copyright ?? null };
    await this.db.root.transaction(async (tx) => {
      await tx.insert(platformSettings).values({ id: 'default', ...values }).onConflictDoUpdate({ target: platformSettings.id, set: { ...values, updatedAt: new Date() } });
      // One platform currency: every plan follows it, so prices everywhere (console, homepage) match.
      await tx.update(platformPlans).set({ currency: input.defaultCurrency });
    });
    this.cache = null;
    return this.get();
  }

  /** Sets (base64 data) or clears (null) the logo or favicon. */
  async setImage(kind: BrandImage, base64: string | null): Promise<PlatformSettings> {
    let data: Buffer | null = null;
    let type: string | null = null;
    if (base64) {
      data = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64');
      if (data.length > MAX_IMAGE_BYTES) throw badRequest('The image must be 256 KB or smaller', 'TOO_LARGE');
      type = sniffImage(data);
      if (!type || (kind === 'logo' && type === 'image/x-icon')) throw badRequest(kind === 'logo' ? 'Use a PNG, JPG or WebP image' : 'Use a PNG, ICO, JPG or WebP image', 'BAD_IMAGE');
    }
    const set = kind === 'logo' ? { logo: data, logoType: type } : { favicon: data, faviconType: type };
    await this.db.root.insert(platformSettings).values({ id: 'default', ...set }).onConflictDoUpdate({ target: platformSettings.id, set: { ...set, updatedAt: new Date() } });
    this.cache = null;
    return this.get();
  }

  async image(kind: BrandImage): Promise<{ data: Buffer; type: string } | null> {
    const [row] = await this.db.root
      .select(kind === 'logo' ? { data: platformSettings.logo, type: platformSettings.logoType } : { data: platformSettings.favicon, type: platformSettings.faviconType })
      .from(platformSettings)
      .where(eq(platformSettings.id, 'default'));
    return row?.data && row.type ? { data: row.data, type: row.type } : null;
  }

  /** What the public pages need: footer text with `{year}` filled in, and image versions. */
  async branding() {
    const s = await this.get();
    return {
      siteName: s.siteName,
      copyright: s.copyright ? s.copyright.replaceAll('{year}', String(new Date().getFullYear())) : null,
      logoVersion: s.logoVersion,
      faviconVersion: s.faviconVersion,
    };
  }

  /** Active plans for the public homepage (no company data). */
  async publicPlans() {
    const rows = await this.db.root
      .select({ id: platformPlans.id, name: platformPlans.name, description: platformPlans.description, priceMonthly: platformPlans.priceMonthly, priceAnnual: platformPlans.priceAnnual, currency: platformPlans.currency, modules: platformPlans.modules, maxEmployees: platformPlans.maxEmployees })
      .from(platformPlans)
      .where(eq(platformPlans.isActive, true))
      .orderBy(platformPlans.priceMonthly);
    return rows.map((p) => ({ ...p, priceAnnual: planPrice(p, 'ANNUAL') }));
  }
}
