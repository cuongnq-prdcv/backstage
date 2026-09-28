import type { RootConfigService } from '@backstage/backend-plugin-api';

/**
 * SMTP settings read from the `tenantOnboarding.smtp` config block, used by the
 * completion-email mailer.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}

/** Reads a required string key, throwing a config error naming the key when absent or empty. */
function readRequiredString(config: RootConfigService, key: string): string {
  const value = config.getOptionalString(key);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required config value '${key}'`);
  }
  return value;
}

/**
 * Reads and validates the `tenantOnboarding.smtp` config block.
 *
 * - `host`, `user`, `password`, and `from` are required; each throws naming the
 *   missing key when absent or empty (Req 5.4).
 * - `port` is required and coerced to a number; a value that is absent or not a
 *   number throws naming the key. Environment variables arrive as strings, so
 *   both `'2525'` and `2525` are accepted.
 * - `secure` defaults to `false` (STARTTLS), matching Mailtrap.
 *
 * Values come from `${ENV_VAR}` references in app-config, never literals.
 */
export function readSmtpConfig(config: RootConfigService): SmtpConfig {
  const host = readRequiredString(config, 'tenantOnboarding.smtp.host');
  const user = readRequiredString(config, 'tenantOnboarding.smtp.user');
  const password = readRequiredString(config, 'tenantOnboarding.smtp.password');
  const from = readRequiredString(config, 'tenantOnboarding.smtp.from');

  const rawPort = config.getOptional('tenantOnboarding.smtp.port');
  const port =
    typeof rawPort === 'number' ? rawPort : Number(rawPort as string);
  if (rawPort === undefined || rawPort === '' || Number.isNaN(port)) {
    throw new Error(
      `Missing or invalid required config value 'tenantOnboarding.smtp.port'`,
    );
  }

  const secure =
    config.getOptionalBoolean('tenantOnboarding.smtp.secure') ?? false;

  return { host, port, user, password, from, secure };
}
