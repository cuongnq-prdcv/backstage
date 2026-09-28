/**
 * Unit tests for `createMailer`.
 *
 * The mailer is exercised entirely offline: the nodemailer transport is
 * injected as a fake so `sendMail` is never a real SMTP call (Requirement 6.3).
 * Asserts the transport is built from the SMTP config and called with the
 * configured `from` plus the given recipient/content, and that a transport
 * failure is translated to a safe error that leaks no SMTP detail (Req 6.1).
 */

import type { SmtpConfig } from '../../lib/smtpConfig';
import { createMailer } from '../../lib/mailer';

const config: SmtpConfig = {
  host: 'sandbox.smtp.mailtrap.io',
  port: 2525,
  user: 'smtp-user',
  password: 'smtp-pass',
  from: 'Onboarding <no-reply@example.com>',
  secure: false,
};

const content = {
  subject: 'Subject line',
  text: 'plain body',
  html: '<p>html body</p>',
};

describe('createMailer', () => {
  it('builds the transport from the SMTP config', () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id' });
    const transportFactory = jest.fn().mockReturnValue({ sendMail });

    createMailer({ config, transportFactory });

    expect(transportFactory).toHaveBeenCalledWith({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      secure: false,
      auth: { user: 'smtp-user', pass: 'smtp-pass' },
    });
  });

  it('sends with the configured from, the recipient, and the content', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id' });
    const transportFactory = jest.fn().mockReturnValue({ sendMail });

    const mailer = createMailer({ config, transportFactory });
    await mailer.sendCompletion('to@example.com', content);

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Onboarding <no-reply@example.com>',
      to: 'to@example.com',
      subject: 'Subject line',
      text: 'plain body',
      html: '<p>html body</p>',
    });
  });

  it('translates a transport failure to a safe error with no SMTP detail', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValue(new Error('535 auth failed for smtp-user@host'));
    const transportFactory = jest.fn().mockReturnValue({ sendMail });

    const mailer = createMailer({ config, transportFactory });

    await expect(
      mailer.sendCompletion('to@example.com', content),
    ).rejects.toThrow('Failed to send onboarding email');

    // The safe error must not carry the underlying SMTP message or credentials.
    await expect(
      mailer.sendCompletion('to@example.com', content),
    ).rejects.not.toThrow(/535|smtp-user|host/);
  });
});
