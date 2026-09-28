/**
 * Wiring tests for `templates/tenant-onboarding/template.yaml`.
 *
 * Pure file parsing: no scaffolder run, no network. Verifies the form shape,
 * the single onboarding step, that no infrastructure action is invoked, and
 * that the result screen surfaces the Jira issue.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TEMPLATE_PATH = path.join(
  REPO_ROOT,
  'templates/tenant-onboarding/template.yaml',
);

const template = parse(readFileSync(TEMPLATE_PATH, 'utf8'));

type Step = { id: string; action: string; input: Record<string, unknown> };

const parameters = template.spec.parameters;
const firstPage = Array.isArray(parameters) ? parameters[0] : parameters;
const properties = firstPage.properties as Record<string, unknown>;
const steps: Step[] = template.spec.steps;

const EXPECTED_FIELDS = [
  'tenantName',
  'contactEmail',
  'contactName',
  'organization',
  'environment',
  'location',
  'purpose',
];

describe('tenant-onboarding template', () => {
  it('is a Template of type onboarding tagged onboarding', () => {
    expect(template.kind).toBe('Template');
    expect(template.spec.type).toBe('onboarding');
    expect(template.metadata.tags).toContain('onboarding');
  });

  it('collects exactly the seven fields, all required', () => {
    expect(Object.keys(properties).sort()).toEqual([...EXPECTED_FIELDS].sort());
    expect((firstPage.required as string[]).sort()).toEqual(
      [...EXPECTED_FIELDS].sort(),
    );
  });

  it('constrains tenantName with the shared RFC1123 pattern', () => {
    expect((properties.tenantName as { pattern: string }).pattern).toBe(
      '^[a-z0-9]([a-z0-9-]{1,20})[a-z0-9]$',
    );
  });

  it('constrains the environment and location enums', () => {
    expect((properties.environment as { enum: string[] }).enum).toEqual([
      'dev',
      'staging',
      'prod',
    ]);
    expect((properties.location as { enum: string[] }).enum).toEqual([
      'japaneast',
      'japanwest',
      'southeastasia',
    ]);
  });

  it('declares contactEmail as an email and purpose as a bounded textarea', () => {
    expect((properties.contactEmail as { format: string }).format).toBe(
      'email',
    );
    expect((properties.purpose as Record<string, unknown>)['ui:widget']).toBe(
      'textarea',
    );
    expect((properties.purpose as { maxLength: number }).maxLength).toBe(1000);
  });

  it('has createJiraIssue as its first step', () => {
    expect(steps[0].id).toBe('createJiraIssue');
    expect(steps[0].action).toBe('onboarding:create-jira-issue');
  });

  it('includes the debug:wait delay window step (for the cross-guest cancel test)', () => {
    const waitStep = steps.find(
      (s: { action: string }) => s.action === 'debug:wait',
    );
    expect(waitStep).toBeDefined();
  });

  it('forwards every form field to the action', () => {
    for (const field of EXPECTED_FIELDS) {
      expect(steps[0].input[field]).toBe(`\${{ parameters.${field} }}`);
    }
  });

  it('invokes no infrastructure or publishing action', () => {
    for (const step of steps) {
      expect(step.action).not.toMatch(
        /publish:|fetch:|terraform|terragrunt|crossplane/i,
      );
    }
  });

  it('surfaces the Jira issue on the result screen', () => {
    expect(template.spec.output.links[0].url).toBe(
      '${{ steps.createJiraIssue.output.issueUrl }}',
    );
    const text = JSON.stringify(template.spec.output.text);
    expect(text).toContain('${{ steps.createJiraIssue.output.issueKey }}');
  });
});
