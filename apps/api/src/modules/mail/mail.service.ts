import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import { createTransport, type Transporter } from 'nodemailer';
import { InjectEnv } from '../../config/env.validation';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Resend in production (plain HTTPS call, no SDK); SMTP → Mailhog everywhere
 * else. Moves behind the email:send BullMQ queue in Phase 4 (§8).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly smtp?: Transporter;

  constructor(@InjectEnv() private readonly env: Env) {
    if (!env.RESEND_API_KEY) {
      this.smtp = createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false });
    }
  }

  async send(msg: MailMessage): Promise<void> {
    if (this.smtp) {
      await this.smtp.sendMail({ from: this.env.MAIL_FROM, ...msg });
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.env.MAIL_FROM, ...msg }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }

  /** For mail that must not block or fail the request (and must not leak timing). */
  sendInBackground(msg: MailMessage) {
    this.send(msg).catch((err: unknown) =>
      this.logger.error({ err, subject: msg.subject }, 'Email delivery failed'),
    );
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
