import nodemailer from 'nodemailer';
import type { SmtpConfig } from './smtpConfig';
import type { CompletionEmail } from './emailContent';

/** The minimal transport surface the mailer needs; satisfied by a nodemailer transport. */
export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/** Builds a transport from SMTP connection options; defaults to nodemailer. */
export type TransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => MailTransport;

/** Options for constructing a {@link Mailer}. */
export interface MailerOptions {
  config: SmtpConfig;
  transportFactory?: TransportFactory;
}

/** Sends onboarding completion emails over SMTP. */
export interface Mailer {
  sendCompletion(to: string, content: CompletionEmail): Promise<void>;
}

/**
 * Creates a {@link Mailer} backed by an SMTP transport.
 *
 * `transportFactory` is injectable so tests never open a real SMTP connection
 * (Req 6.3); it defaults to `nodemailer.createTransport`. A send failure is
 * rethrown as a fixed, safe message — the underlying SMTP error (which can name
 * the host or the authenticating user) is never propagated (Req 6.1).
 */
export function createMailer({
  config,
  transportFactory = options =>
    nodemailer.createTransport(options) as unknown as MailTransport,
}: MailerOptions): Mailer {
  const transport = transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  return {
    async sendCompletion(to, content): Promise<void> {
      try {
        await transport.sendMail({
          from: config.from,
          to,
          subject: content.subject,
          text: content.text,
          html: content.html,
        });
      } catch {
        throw new Error('Failed to send onboarding email');
      }
    },
  };
}
