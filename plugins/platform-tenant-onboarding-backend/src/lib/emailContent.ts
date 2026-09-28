import type { OnboardingSubmission } from './fieldMapping';

/** The rendered completion email, ready to hand to the mailer. */
export interface CompletionEmail {
  subject: string;
  text: string;
  html: string;
}

/** Escapes the five HTML-significant characters so submitted values cannot inject markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the tenant-onboarding completion email sent once the Jira issue is
 * Done: it confirms the Azure subscription and Entra ID invitation and points
 * the contact at the next step (sign in with Microsoft and run the provisioning
 * template with this tenant name).
 *
 * The body echoes `tenantName`, `contactName`, `organization`, `environment`,
 * `location`, and the Jira issue URL (Req 4.2). It deliberately omits
 * `purpose`, which is an internal reviewer note (Req 4.3).
 */
export function buildCompletionEmail(
  submission: OnboardingSubmission,
  issueUrl: string,
): CompletionEmail {
  const { tenantName, contactName, organization, environment, location } =
    submission;

  const subject = `[Onboarding] Tenant ${tenantName} is ready`;

  const text = [
    `Hi ${contactName},`,
    ``,
    `Your onboarding request for tenant "${tenantName}" (organization ${organization}) has been approved and completed:`,
    `- The Azure subscription has been created (environment: ${environment}, location: ${location}).`,
    `- Your email has been invited into Entra ID.`,
    ``,
    `Next step: sign in to Backstage with the Microsoft account you were invited with, open the provisioning template, and run it with the tenant name "${tenantName}".`,
    ``,
    `Your Jira request: ${issueUrl}`,
  ].join('\n');

  const html = [
    `<p>Hi ${escapeHtml(contactName)},</p>`,
    `<p>Your onboarding request for tenant <strong>${escapeHtml(
      tenantName,
    )}</strong> (organization ${escapeHtml(
      organization,
    )}) has been approved and completed:</p>`,
    `<ul>`,
    `<li>The Azure subscription has been created (environment: <strong>${escapeHtml(
      environment,
    )}</strong>, location: <strong>${escapeHtml(location)}</strong>).</li>`,
    `<li>Your email has been invited into Entra ID.</li>`,
    `</ul>`,
    `<p>Next step: sign in to Backstage with the Microsoft account you were invited with, open the provisioning template, and run it with the tenant name <strong>${escapeHtml(
      tenantName,
    )}</strong>.</p>`,
    `<p>Your Jira request: <a href="${escapeHtml(
      issueUrl,
    )}">${escapeHtml(issueUrl)}</a></p>`,
  ].join('\n');

  return { subject, text, html };
}
