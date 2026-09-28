/**
 * Unit tests for `buildCompletionEmail`.
 *
 * The completion email must name the tenant and contact, echo the request's
 * environment/location/organization and the Jira issue URL, and must NOT leak
 * the internal `purpose` note (Requirements 4.2, 4.3). Pure function, no I/O.
 */

import type { OnboardingSubmission } from '../../lib/fieldMapping';
import { buildCompletionEmail } from '../../lib/emailContent';

const submission: OnboardingSubmission = {
  tenantName: 'tenant-a',
  contactEmail: 'cuong@example.com',
  contactName: 'Cuong Nguyen',
  organization: 'PA',
  environment: 'prod',
  location: 'japaneast',
  purpose: 'INTERNAL-ONLY-secret-reason',
};

const issueUrl = 'https://example.atlassian.net/browse/SCRUM-1';

describe('buildCompletionEmail', () => {
  it('includes the tenant name, contact name, org, environment, location, and issue URL in the body', () => {
    const { text, html } = buildCompletionEmail(submission, issueUrl);

    for (const value of [
      submission.tenantName,
      submission.contactName,
      submission.organization,
      submission.environment,
      submission.location,
      issueUrl,
    ]) {
      expect(text).toContain(value);
      expect(html).toContain(value);
    }
  });

  it('puts the tenant name in the subject', () => {
    const { subject } = buildCompletionEmail(submission, issueUrl);

    expect(subject).toContain(submission.tenantName);
  });

  it('never includes the internal purpose in subject, text, or html', () => {
    const { subject, text, html } = buildCompletionEmail(submission, issueUrl);

    expect(subject).not.toContain(submission.purpose);
    expect(text).not.toContain(submission.purpose);
    expect(html).not.toContain(submission.purpose);
  });

  it('returns non-empty subject, text, and html', () => {
    const email = buildCompletionEmail(submission, issueUrl);

    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
  });
});
