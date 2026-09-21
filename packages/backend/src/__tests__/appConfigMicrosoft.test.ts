/**
 * Config-shape and no-literal-value tests for the Microsoft (Azure Entra ID)
 * authentication feature (task 5.3).
 *
 * These verify the declarative `app-config` parts (Requirement 2): the
 * `microsoft` provider blocks exist under the correct environment keys with
 * exact `${AZURE_*}` references, the guest block is retained, and no literal
 * Azure value ever appears in any `app-config*` file.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/** Repository root, resolved relative to this test file (packages/backend/src). */
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const devConfigPath = path.join(repoRoot, 'app-config.yaml');
const prodConfigPath = path.join(repoRoot, 'app-config.production.yaml');

const EXPECTED_REFS = [
  '${AZURE_CLIENT_ID}',
  '${AZURE_CLIENT_SECRET}',
  '${AZURE_TENANT_ID}',
];

function loadYaml(filePath: string): any {
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as any;
}

function findAppConfigFiles(): string[] {
  return fs
    .readdirSync(repoRoot)
    .filter(name => /^app-config.*\.ya?ml$/.test(name))
    .map(name => path.join(repoRoot, name));
}

describe('app-config Microsoft provider shape', () => {
  describe('app-config.yaml (development)', () => {
    const config = loadYaml(devConfigPath);

    it('defines the microsoft provider under the development environment key (Req 2.1)', () => {
      expect(config.auth.providers.microsoft).toBeDefined();
      expect(config.auth.providers.microsoft.development).toBeDefined();
    });

    it('uses exact ${AZURE_*} references for clientId/clientSecret/tenantId (Req 2.2)', () => {
      const dev = config.auth.providers.microsoft.development;
      expect(dev.clientId).toBe('${AZURE_CLIENT_ID}');
      expect(dev.clientSecret).toBe('${AZURE_CLIENT_SECRET}');
      expect(dev.tenantId).toBe('${AZURE_TENANT_ID}');
    });

    it('retains the guest provider block (Req 2.5)', () => {
      expect(config.auth.providers.guest).toBeDefined();
    });
  });

  describe('app-config.production.yaml (production)', () => {
    const config = loadYaml(prodConfigPath);

    it('defines the microsoft provider under the production environment key (Req 2.3)', () => {
      expect(config.auth.providers.microsoft).toBeDefined();
      expect(config.auth.providers.microsoft.production).toBeDefined();
    });

    it('uses exact ${AZURE_*} references for clientId/clientSecret/tenantId (Req 2.3)', () => {
      const prod = config.auth.providers.microsoft.production;
      expect(prod.clientId).toBe('${AZURE_CLIENT_ID}');
      expect(prod.clientSecret).toBe('${AZURE_CLIENT_SECRET}');
      expect(prod.tenantId).toBe('${AZURE_TENANT_ID}');
    });

    it('retains the guest provider block (Req 2.5)', () => {
      expect(config.auth.providers.guest).toBeDefined();
    });
  });
});

describe('app-config no-literal-value scan for Microsoft (Req 2.4)', () => {
  const appConfigFiles = findAppConfigFiles();

  it.each(appConfigFiles.map(f => [path.basename(f), f]))(
    '%s uses only ${...} references for microsoft clientId/clientSecret/tenantId',
    (_name, filePath) => {
      const config = loadYaml(filePath);
      const microsoft = config?.auth?.providers?.microsoft;

      // Only assert on files that define a microsoft block.
      if (!microsoft) {
        return;
      }

      const values: string[] = [];
      for (const envBlock of Object.values<any>(microsoft)) {
        if (envBlock && typeof envBlock === 'object') {
          for (const field of ['clientId', 'clientSecret', 'tenantId']) {
            if (field in envBlock) {
              values.push(envBlock[field]);
            }
          }
        }
      }

      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(value).toMatch(/^\$\{[A-Z0-9_]+\}$/);
        expect(EXPECTED_REFS).toContain(value);
      }
    },
  );
});
