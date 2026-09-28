/**
 * Unit tests for `readSmtpConfig`.
 *
 * Covers the `tenantOnboarding.smtp` defaults, required-key fail-fast, and the
 * string→number coercion of `port` (Requirements 5.2, 5.4). No network is used.
 */

import { mockServices } from '@backstage/backend-test-utils';
import { JsonObject } from '@backstage/types';
import { readSmtpConfig } from '../../lib/smtpConfig';

/** Build a `RootConfigService` from a `tenantOnboarding.smtp` block. */
function makeConfig(smtp: JsonObject) {
  return mockServices.rootConfig({ data: { tenantOnboarding: { smtp } } });
}

describe('readSmtpConfig', () => {
  const baseValid = {
    host: 'sandbox.smtp.mailtrap.io',
    port: '2525',
    user: 'smtp-user',
    password: 'smtp-pass',
    from: 'Onboarding <no-reply@example.com>',
  };

  it('resolves all fields for a valid config, coercing port to a number', () => {
    const config = makeConfig({ ...baseValid });

    expect(readSmtpConfig(config)).toEqual({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      user: 'smtp-user',
      password: 'smtp-pass',
      from: 'Onboarding <no-reply@example.com>',
      secure: false,
    });
  });

  it('accepts a numeric port', () => {
    const config = makeConfig({ ...baseValid, port: 587 });

    expect(readSmtpConfig(config).port).toBe(587);
  });

  it('defaults secure to false when absent', () => {
    const config = makeConfig({ ...baseValid });

    expect(readSmtpConfig(config).secure).toBe(false);
  });

  it('uses the configured secure flag when supplied', () => {
    const config = makeConfig({ ...baseValid, secure: true });

    expect(readSmtpConfig(config).secure).toBe(true);
  });

  it.each(['host', 'user', 'password', 'from'])(
    'fails with a key-naming error when %s is absent',
    key => {
      const smtp: JsonObject = { ...baseValid };
      delete smtp[key];
      const config = makeConfig(smtp);

      expect(() => readSmtpConfig(config)).toThrow(
        new RegExp(`tenantOnboarding\\.smtp\\.${key}`),
      );
    },
  );

  it.each(['host', 'user', 'password', 'from'])(
    'fails with a key-naming error when %s is empty',
    key => {
      const config = makeConfig({ ...baseValid, [key]: '' });

      expect(() => readSmtpConfig(config)).toThrow(
        new RegExp(`tenantOnboarding\\.smtp\\.${key}`),
      );
    },
  );

  it('fails naming port when it is absent', () => {
    const smtp: JsonObject = { ...baseValid };
    delete smtp.port;
    const config = makeConfig(smtp);

    expect(() => readSmtpConfig(config)).toThrow(
      /tenantOnboarding\.smtp\.port/,
    );
  });

  it('fails naming port when it is not a number', () => {
    const config = makeConfig({ ...baseValid, port: 'not-a-number' });

    expect(() => readSmtpConfig(config)).toThrow(
      /tenantOnboarding\.smtp\.port/,
    );
  });
});
