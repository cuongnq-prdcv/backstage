/**
 * Wiring tests for `templates/tenant-provisioning-crossplane/template.yaml`.
 *
 * The provisioning flow is now split across two steps: the custom
 * `tenant:render-crossplane-manifest` action and the built-in
 * `publish:github:pull-request` action. The built-in action is not ours to test,
 * so this file verifies the contract *between* them — that every input the
 * built-in step needs is wired to an output the custom step actually emits, and
 * that `update: true` is set so the deterministic branch updates one pull
 * request instead of creating duplicates.
 *
 * Also asserts the module no longer depends on a git or GitHub client library
 * (Req 2.1).
 *
 * Pure file parsing: no scaffolder run, no network.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';

import { createRenderCrossplaneManifestAction } from '../actions/renderCrossplaneManifest';
import { mockServices } from '@backstage/backend-test-utils';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TEMPLATE_PATH = path.join(
  REPO_ROOT,
  'templates/tenant-provisioning-crossplane/template.yaml',
);
const PACKAGE_JSON_PATH = path.resolve(__dirname, '../../package.json');

type Step = {
  id: string;
  action: string;
  input: Record<string, unknown>;
};

const template = parse(readFileSync(TEMPLATE_PATH, 'utf8'));
const steps: Step[] = template.spec.steps;
const renderStep = steps.find(s => s.id === 'renderManifest')!;
const pullRequestStep = steps.find(s => s.id === 'createPullRequest')!;

/** Output names the render action actually declares. */
const renderOutputNames = Object.keys(
  (
    createRenderCrossplaneManifestAction({
      config: mockServices.rootConfig({
        data: {
          crossplaneProvisioning: {
            liveRepoUrl: 'https://github.com/example/adp-gitops-tenants',
          },
        },
      }),
      logger: mockServices.logger.mock(),
    }).schema?.output as { properties?: Record<string, unknown> }
  )?.properties ?? {},
);

describe('tenant-provisioning-crossplane template wiring', () => {
  it('composes the custom render step and the built-in pull-request step in order (Req 5.1)', () => {
    expect(steps.map(s => s.action)).toEqual([
      'tenant:render-crossplane-manifest',
      'publish:github:pull-request',
    ]);
  });

  it('uses camelCase step ids so output expressions resolve', () => {
    for (const step of steps) {
      expect(step.id).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it('forwards the form parameters to the render step (Req 1.3)', () => {
    expect(renderStep.input).toEqual({
      tenantName: '${{ parameters.tenantName }}',
      environment: '${{ parameters.environment }}',
      location: '${{ parameters.location }}',
      storageAccountSkuName: '${{ parameters.storageAccountSkuName }}',
    });
  });

  it('opens the pull request with update: true (Req 5.2)', () => {
    expect(pullRequestStep.input.update).toBe(true);
  });

  it('wires every pull-request input to an output of the render step (Req 4.2, 4.4, 5.1)', () => {
    const expected = [
      'repoUrl',
      'branchName',
      'targetBranchName',
      'sourcePath',
      'targetPath',
      'title',
      'description',
      'commitMessage',
    ];

    for (const key of expected) {
      expect(pullRequestStep.input[key]).toBe(
        `\${{ steps.renderManifest.output.${key} }}`,
      );
    }
  });

  it('references only outputs the render action declares', () => {
    // Guard against this assertion going vacuous if schema introspection ever
    // stops working: the action declares exactly these nine outputs.
    expect(renderOutputNames.sort()).toEqual(
      [
        'branchName',
        'commitMessage',
        'description',
        'manifestPath',
        'repoUrl',
        'sourcePath',
        'targetBranchName',
        'targetPath',
        'title',
      ].sort(),
    );

    const referenced = Object.values(pullRequestStep.input)
      .filter((v): v is string => typeof v === 'string')
      .map(v => /steps\.renderManifest\.output\.([a-zA-Z0-9]+)/.exec(v)?.[1])
      .filter((v): v is string => Boolean(v));

    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(renderOutputNames).toContain(name);
    }
  });

  it('never hardcodes the live repo URL or base branch (Req 1.9)', () => {
    const raw = readFileSync(TEMPLATE_PATH, 'utf8');
    // The URL and base branch must arrive via the render step's outputs, which
    // read them from app-config, not as literals in the template.
    expect(raw).not.toMatch(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/);
    expect(raw).not.toMatch(/repoUrl:\s*github\.com\?/);
  });

  it('surfaces the pull request URL from the built-in step output (Req 5.4)', () => {
    expect(template.spec.output.links[0].url).toBe(
      '${{ steps.createPullRequest.output.remoteUrl }}',
    );
    const text = template.spec.output.text[0].content as string;
    expect(text).toContain('${{ steps.renderManifest.output.branchName }}');
    expect(text).toContain(
      '${{ steps.createPullRequest.output.remoteUrl }}',
    );
  });

  it('no longer depends on a git or GitHub client library (Req 2.1)', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(deps).not.toHaveProperty('isomorphic-git');
    expect(deps).not.toHaveProperty('@octokit/rest');
    expect(deps).not.toHaveProperty('@backstage/integration');
  });
});
