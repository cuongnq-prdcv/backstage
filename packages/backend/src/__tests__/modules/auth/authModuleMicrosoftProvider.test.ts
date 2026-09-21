/**
 * Backend startup smoke test for the Microsoft (Azure Entra ID) auth feature
 * (task 4.3).
 *
 * Boots a minimal backend with `startTestBackend` from
 * `@backstage/backend-test-utils`, wiring the real Auth Backend, the stock
 * guest provider, and the custom `authModuleMicrosoftProvider`, and asserts:
 *
 *   - the backend boots with the guest and Microsoft providers registered and
 *     the Microsoft provider endpoint is reachable (not 404) (Req 1.1, 1.3);
 *   - when the Microsoft credentials are absent, the Auth Backend surfaces a
 *     configuration error naming the missing field rather than starting with an
 *     empty credential (Req 1.4).
 *
 * As with the GitHub smoke test, config is injected via `mockServices.rootConfig`
 * with values inlined, so the `${AZURE_*}` environment substitution (which
 * happens in the real config loader) is not exercised here; what IS exercised is
 * that the provider factory refuses to start with missing values.
 */

import { startTestBackend, mockServices } from '@backstage/backend-test-utils';
import type { JsonObject } from '@backstage/types';
import authBackend from '@backstage/plugin-auth-backend';
import authGuestProvider from '@backstage/plugin-auth-backend-module-guest-provider';
import request from 'supertest';
import { authModuleMicrosoftProvider } from '../../../modules/auth/authModuleMicrosoftProvider';

/**
 * Base config shared by the boot scenarios. Auth environment is `development`
 * (matching `app-config.yaml`); the guest provider is retained alongside
 * Microsoft. The `microsoftDev` argument is spliced in as the
 * `microsoft.development` block.
 */
function makeConfig(microsoftDev: JsonObject | undefined): JsonObject {
  const microsoft =
    microsoftDev === undefined ? undefined : { development: microsoftDev };
  return {
    app: { baseUrl: 'http://localhost:3000' },
    backend: {
      baseUrl: 'http://localhost:7007',
      listen: { port: 0 },
    },
    auth: {
      environment: 'development',
      providers: {
        // Retained alongside Microsoft (Requirement 1.2 / 2.5).
        guest: {},
        ...(microsoft ? { microsoft } : {}),
      },
    },
  };
}

/** Feature list: real Auth Backend, guest provider, Microsoft module, config. */
function features(configData: JsonObject) {
  return [
    authBackend,
    authGuestProvider,
    authModuleMicrosoftProvider,
    mockServices.rootConfig.factory({ data: configData }),
  ];
}

describe('authModuleMicrosoftProvider backend startup smoke', () => {
  it('boots with the guest and Microsoft providers registered and the Microsoft endpoint reachable (Req 1.1, 1.2, 1.3)', async () => {
    // Dummy, non-secret placeholder credentials so the factory initializes.
    const backend = await startTestBackend({
      features: features(
        makeConfig({
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          tenantId: 'test-tenant-id',
        }),
      ),
    });

    try {
      // The Microsoft provider endpoint is reachable: its `start` route for the
      // configured environment does NOT yield the 404 an unregistered provider
      // returns (a 302 redirect or a non-404 error both prove wiring). Req 1.3.
      const microsoftResponse = await request(backend.server).get(
        '/api/auth/microsoft/start?env=development',
      );
      expect(microsoftResponse.status).not.toBe(404);

      // The guest provider is registered in parallel (not 404). Req 1.2.
      const guestResponse = await request(backend.server).get(
        '/api/auth/guest/refresh',
      );
      expect(guestResponse.status).not.toBe(404);

      // Control: an unregistered provider returns 404, confirming the checks
      // above are meaningful.
      const unknownResponse = await request(backend.server).get(
        '/api/auth/does-not-exist/start?env=development',
      );
      expect(unknownResponse.status).toBe(404);
    } finally {
      await backend.stop();
    }
  });
});

describe('authModuleMicrosoftProvider missing-credential startup error', () => {
  it('surfaces a configuration error naming the missing credential when clientId/clientSecret are absent (Req 1.4)', async () => {
    // The microsoft.development block is present (so the factory runs at
    // startup) but the credentials are missing — the same outcome as an
    // unresolved `${AZURE_CLIENT_ID}` reference. Startup must fail and name the
    // missing field rather than run with an empty credential.
    await expect(
      startTestBackend({
        features: features(makeConfig({})),
      }),
    ).rejects.toThrow(/clientId/i);
  });
});
