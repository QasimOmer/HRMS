import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { JobsService } from './jobs.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Emails are always sent via the job queue (retries, and only after the transaction commits). */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger('Mail');
  private transporter?: Transporter;

  constructor(private readonly jobs: JobsService) {}

  onModuleInit() {
    const url = config().SMTP_URL;
    if (url) this.transporter = nodemailer.createTransport(url);
    this.jobs.register('email', async (p) => this.deliver(p as unknown as MailMessage));
  }

  send(msg: MailMessage) {
    return this.jobs.enqueue('email', { ...msg });
  }

  /** Where email goes, without credentials (for the platform console). */
  status() {
    const url = config().SMTP_URL;
    let host: string | null = null;
    try {
      host = url ? new URL(url).host : null;
    } catch {
      host = 'invalid SMTP_URL';
    }
    return { configured: !!this.transporter, host, from: config().MAIL_FROM };
  }

  /** Sends immediately (not queued) so the platform owner sees whether the SMTP settings work. */
  async sendNow(msg: MailMessage): Promise<{ delivered: boolean; info: string }> {
    if (!this.transporter) {
      await this.deliver(msg);
      return { delivered: false, info: 'SMTP is not configured; the email was written to the API log instead.' };
    }
    await this.transporter.verify();
    const r = await this.transporter.sendMail({ from: config().MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
    return { delivered: true, info: `Accepted by the mail server (${String(r.response ?? r.messageId).slice(0, 120)})` };
  }

  private async deliver(msg: MailMessage) {
    if (!this.transporter) {
      // Development: no SMTP configured – print instead of sending.
      this.logger.log(`\n----- EMAIL (dev) -----\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n-----------------------`);
      return;
    }
    await this.transporter.sendMail({ from: config().MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
  }
}
