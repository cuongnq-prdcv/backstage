/**
 * Unit tests for the ConfigReader (`readCrossplaneProvisioningConfig`).
 *
 * Example-based tests covering the config defaults and validation rules from
 * the design's "Testing Strategy" section. They use
 * `@backstage/backend-test-utils`' `mockServices.rootConfig` to build the
 * `crossplaneProvisioning` block the reader consumes.
 *
 * No git/network/crossplane operation is exercised here.
 */

import { mockServices } from '@backstage/backend-test-utils';
import { JsonObject } from '@backstage/types';
import { readCrossplaneProvisioningConfig } from '../config';

/** Build a `RootConfigService` from a `crossplaneProvisioning` block. */
function makeConfig(crossplaneProvisioning: JsonObject) {
  return mockServices.rootConfig({ data: { crossplaneProvisioning } });
}

describe('readCrossplaneProvisioningConfig', () => {
  const baseValid = {
    liveRepoUrl: 'https://github.com/example/hello-crossplane-aws',
  };

  it('defaults liveRepoBranch to "main" when the branch is absent (Req 1.7)', () => {
    const config = makeConfig({ ...baseValid });

    expect(readCrossplaneProvisioningConfig(config).liveRepoBranch).toBe('main');
  });

  it('uses the configured liveRepoBranch when supplied (Req 1.7)', () => {
    const config = makeConfig({ ...baseValid, liveRepoBranch: 'develop' });

    expect(readCrossplaneProvisioningConfig(config).liveRepoBranch).toBe(
      'develop',
    );
  });

  it('defaults apiVersion and kind when absent (Req 1.11)', () => {
    const config = makeConfig({ ...baseValid });

    const result = readCrossplaneProvisioningConfig(config);

    expect(result.apiVersion).toBe('platform.hello-crossplane.io/v1alpha1');
    expect(result.kind).toBe('TenantEnvironment');
  });

  it('uses the configured apiVersion and kind when supplied (Req 1.11)', () => {
    const config = makeConfig({
      ...baseValid,
      apiVersion: 'platform.azure.example/v1beta1',
      kind: 'AzureTenantEnvironment',
    });

    const result = readCrossplaneProvisioningConfig(config);

    expect(result.apiVersion).toBe('platform.azure.example/v1beta1');
    expect(result.kind).toBe('AzureTenantEnvironment');
  });

  it('fails with a key-naming error when liveRepoUrl is absent (Req 1.8)', () => {
    const config = makeConfig({ liveRepoBranch: 'main' });

    expect(() => readCrossplaneProvisioningConfig(config)).toThrow(
      /crossplaneProvisioning\.liveRepoUrl/,
    );
  });

  it('fails with a key-naming error when liveRepoUrl is empty (Req 1.8)', () => {
    const config = makeConfig({ liveRepoUrl: '' });

    expect(() => readCrossplaneProvisioningConfig(config)).toThrow(
      /crossplaneProvisioning\.liveRepoUrl/,
    );
  });

  it('defaults allowedComponents to [table, repository] when components is absent (Req 1.10)', () => {
    const config = makeConfig({ ...baseValid });

    expect(readCrossplaneProvisioningConfig(config).allowedComponents).toEqual([
      'table',
      'repository',
    ]);
  });

  it('uses the configured components list when supplied (Req 1.10)', () => {
    const config = makeConfig({
      ...baseValid,
      components: ['table', 'repository', 'bucket'],
    });

    expect(readCrossplaneProvisioningConfig(config).allowedComponents).toEqual([
      'table',
      'repository',
      'bucket',
    ]);
  });

  it('fails when an allowed component name violates ^[a-z0-9_]+$ (Req 9.7)', () => {
    const config = makeConfig({
      ...baseValid,
      components: ['table', 'Invalid-Name'],
    });

    expect(() => readCrossplaneProvisioningConfig(config)).toThrow(
      /Invalid-Name/,
    );
  });

  it('fails when the allowed-set has more than 100 entries (Req 9.8)', () => {
    const oversized = Array.from({ length: 101 }, (_, i) => `component_${i}`);
    const config = makeConfig({ ...baseValid, components: oversized });

    expect(() => readCrossplaneProvisioningConfig(config)).toThrow(
      /exceeds the allowed maximum/,
    );
  });

  it('accepts an allowed-set at the 100-entry boundary (Req 9.8)', () => {
    const atLimit = Array.from({ length: 100 }, (_, i) => `component_${i}`);
    const config = makeConfig({ ...baseValid, components: atLimit });

    expect(
      readCrossplaneProvisioningConfig(config).allowedComponents,
    ).toHaveLength(100);
  });

  it('resolves all fields for a fully valid config', () => {
    const config = makeConfig({
      ...baseValid,
      liveRepoBranch: 'main',
      components: ['table', 'repository'],
    });

    expect(readCrossplaneProvisioningConfig(config)).toEqual({
      liveRepoUrl: baseValid.liveRepoUrl,
      liveRepoBranch: 'main',
      apiVersion: 'platform.hello-crossplane.io/v1alpha1',
      kind: 'TenantEnvironment',
      allowedComponents: ['table', 'repository'],
    });
  });
});
