export interface Config {
  /**
   * Configuration for the `onboarding:create-jira-issue` scaffolder action
   * and the request-lookup endpoint that reads the same Jira project.
   */
  tenantOnboarding?: {
    jira?: {
      /**
       * Jira Cloud site base URL, e.g. `https://your-site.atlassian.net`.
       * Sourced from `${JIRA_BASE_URL}`. Required.
       */
      baseUrl?: string;

      /**
       * Email of the Jira account the API token belongs to, used for Basic
       * authentication. Sourced from `${JIRA_USER_EMAIL}`. Required.
       */
      email?: string;

      /**
       * Jira API token used for Basic authentication. Sourced from
       * `${JIRA_API_TOKEN}`. Required.
       *
       * @visibility secret
       */
      apiToken?: string;

      /**
       * The Jira project key onboarding issues are created in and searched
       * within. Sourced from `${JIRA_PROJECT_KEY}`. Required.
       */
      projectKey?: string;

      /**
       * The Jira issue type name to create. Defaults to `Task` when omitted;
       * the named issue type must exist in `projectKey`.
       */
      issueType?: string;

      /**
       * Shared secret matched against the `X-Onboarding-Token` header on the
       * completion webhook. Sourced from `${JIRA_WEBHOOK_SECRET}`. Required.
       *
       * @visibility secret
       */
      webhookSecret?: string;

      /**
       * The Jira status name treated as "completed" by the completion webhook.
       * Defaults to `Done` when omitted; depends on the project's workflow.
       */
      doneStatus?: string;
    };

    /**
     * SMTP settings used to send the tenant-onboarding completion email.
     */
    smtp?: {
      /**
       * SMTP host, e.g. `sandbox.smtp.mailtrap.io`. Sourced from `${SMTP_HOST}`.
       * Required.
       */
      host?: string;

      /**
       * SMTP port, e.g. `2525`. Sourced from `${SMTP_PORT}`. Required.
       */
      port?: number | string;

      /**
       * SMTP username. Sourced from `${SMTP_USER}`. Required.
       */
      user?: string;

      /**
       * SMTP password. Sourced from `${SMTP_PASSWORD}`. Required.
       *
       * @visibility secret
       */
      password?: string;

      /**
       * The `From` address on the completion email, e.g.
       * `Onboarding <no-reply@example.com>`. Sourced from `${SMTP_FROM}`.
       * Required.
       */
      from?: string;

      /**
       * Whether to use an implicit TLS connection. Defaults to `false`
       * (STARTTLS), matching Mailtrap.
       */
      secure?: boolean;
    };
  };
}
