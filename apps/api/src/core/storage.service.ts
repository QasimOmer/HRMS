import { NotFoundException } from '@nestjs/common';
import { Injectable, StreamableFile } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { config } from '../config';
import { currentUser } from '../common/context';
import { badRequest, notFound } from '../common/errors';
import { DbService } from '../db/db.service';
import { files } from '../db/schema';

export type FileKind = 'image' | 'document' | 'pdf';

const SIGNATURES: { mime: string; ext: string[]; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: ['.pdf'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: ['.png'], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: ['.jpg', '.jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    ext: ['.webp'],
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const ALLOWED: Record<FileKind, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  document: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  pdf: ['application/pdf'],
};

export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * File storage with content sniffing (the client-supplied MIME type is ignored).
 * STORAGE_DRIVER=disk keeps files under STORAGE_DIR; STORAGE_DRIVER=db keeps the bytes in `files.content`
 * (needed on Vercel, whose disk is read-only and not shared between instances).
 */
const DB_PREFIX = 'db:';

@Injectable()
export class StorageService {
  constructor(private readonly db: DbService) {}

  private root() {
    return resolve(config().STORAGE_DIR);
  }

  /** Is the stored file actually available? (A disk record can outlive its file, e.g. after a storage mishap.) */
  isOnDisk(storageKey: string): boolean {
    if (storageKey.startsWith(DB_PREFIX)) return true; // bytes live in the same row
    const abs = resolve(this.root(), storageKey);
    return abs.startsWith(this.root() + sep) && existsSync(abs);
  }

  /** `anonymous` skips recording the uploader (F3 anonymous complaints). */
  async save(file: UploadedFileLike | undefined, kind: FileKind, opts: { anonymous?: boolean } = {}) {
    if (!file?.buffer?.length) throw badRequest('Please attach a file');
    const max = config().MAX_UPLOAD_MB * 1024 * 1024;
    if (file.size > max) throw badRequest(`File is larger than ${config().MAX_UPLOAD_MB} MB`);
    const sig = SIGNATURES.find((s) => s.test(file.buffer));
    if (!sig || !ALLOWED[kind].includes(sig.mime)) {
      throw badRequest(`Unsupported file type. Allowed: ${ALLOWED[kind].map((m) => m.split('/')[1]).join(', ')}`);
    }
    const user = currentUser();
    const now = new Date();
    const key = `${user.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${sig.ext[0]}`;
    const inDb = config().STORAGE_DRIVER === 'db';
    if (!inDb) {
      const abs = resolve(this.root(), key);
      if (!abs.startsWith(this.root() + sep)) throw badRequest('Invalid storage path');
      await mkdir(resolve(abs, '..'), { recursive: true });
      await writeFile(abs, file.buffer, { flag: 'wx' });
    }

    const safeName = file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `file${sig.ext[0]}`;
    const [row] = await this.db.tx
      .insert(files)
      .values({
        tenantId: user.tenantId,
        storageKey: inDb ? `${DB_PREFIX}${key}` : key,
        content: inDb ? file.buffer : null,
        originalName: extname(safeName) ? safeName : `${safeName}${sig.ext[0]}`,
        mimeType: sig.mime,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedByUserId: opts.anonymous ? null : user.userId,
      })
      .returning();
    const { content: _bytes, ...meta } = row!; // never hand the file bytes back to callers/responses
    return meta;
  }

  /** Stream a file. Callers MUST authorise access before calling. */
  async stream(fileId: string, disposition: 'inline' | 'attachment' = 'inline'): Promise<StreamableFile> {
    const [f] = await this.db.tx.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!f) throw notFound('File');
    const opts = { type: f.mimeType, length: f.size, disposition: `${disposition}; filename="${encodeURIComponent(f.originalName)}"` };
    if (f.storageKey.startsWith(DB_PREFIX)) {
      if (!f.content) throw new NotFoundException({ message: 'This file is missing from storage. Please upload it again.', code: 'FILE_MISSING' });
      return new StreamableFile(f.content, { ...opts, length: f.content.length });
    }
    const abs = resolve(this.root(), f.storageKey);
    if (!abs.startsWith(this.root() + sep)) throw notFound('File');
    // The record exists but the file is gone from storage: say so (a stream error would only give "Bad Request").
    if (!existsSync(abs)) throw new NotFoundException({ message: 'This file is missing from storage. Please upload it again.', code: 'FILE_MISSING' });
    return new StreamableFile(createReadStream(abs), opts);
  }
}
