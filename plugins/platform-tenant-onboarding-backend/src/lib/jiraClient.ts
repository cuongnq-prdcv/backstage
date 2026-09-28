import type { JiraConfig } from './config';
import type { JiraIssuePayload } from './fieldMapping';

/** The result of creating a Jira issue. */
export interface CreatedIssue {
  id: string;
  key: string;
  url: string;
}

/** One row returned by a Jira issue search, shaped for the lookup response. */
export interface IssueSummary {
  issueKey: string;
  summary: string;
  status: string;
  created: string;
  url: string;
}

/** A client for the subset of the Jira Cloud REST API v3 this feature needs. */
export interface JiraClient {
  createIssue(payload: JiraIssuePayload): Promise<CreatedIssue>;
  searchIssues(
    jql: string,
    fields: string[],
    maxResults: number,
  ): Promise<IssueSummary[]>;
  getIssue(
    key: string,
    fields: string[],
  ): Promise<{ status: string; description: unknown }>;
}

/** Options for constructing a {@link JiraClient}. */
export interface JiraClientOptions {
  config: JiraConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface JiraIssueResponse {
  id?: unknown;
  key?: unknown;
}

interface JiraSearchResponse {
  issues?: unknown;
}

interface JiraIssueFields {
  summary?: unknown;
  status?: unknown;
  created?: unknown;
}

interface JiraIssue {
  key?: unknown;
  fields?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJson(text: string): unknown {
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Jira returned an invalid JSON response');
  }
}

/**
 * Converts a Jira HTTP failure into a safe, actionable error. This function
 * intentionally uses only status and error *field names*; Jira response
 * values can contain request data and must never be copied into an error.
 */
function translateError(status: number, bodyText: string): Error {
  if (status === 401 || status === 403) {
    return new Error('Jira rejected the credentials or authorization');
  }

  if (status === 400) {
    const parsed = parseJsonWithoutThrowing(bodyText);
    const errors = isRecord(parsed) ? parsed.errors : undefined;
    const fieldNames = isRecord(errors) ? Object.keys(errors) : [];

    if (fieldNames.length > 0) {
      return new Error(
        `Jira rejected the request for fields: ${fieldNames.join(', ')}`,
      );
    }

    return new Error('Jira rejected the request because it was invalid');
  }

  if (status === 404) {
    return new Error('Jira project or endpoint was not found');
  }

  if (status === 429) {
    return new Error('Jira rate limit exceeded; try again later');
  }

  if (status >= 500) {
    return new Error('Jira request failed due to a temporary outage; try again later');
  }

  return new Error(`Jira request failed with HTTP status ${status}`);
}

function parseJsonWithoutThrowing(text: string): unknown {
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function isAbortError(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Creates a {@link JiraClient} backed by the Jira Cloud REST API v3.
 *
 * Uses `POST /rest/api/3/issue` to create and `POST /rest/api/3/search/jql`
 * to search — the legacy `GET /rest/api/3/search` endpoint has been removed
 * from Jira Cloud and must never be used.
 *
 * `fetchImpl` is injectable so all automated tests remain offline. Each
 * request has a bounded timeout and no request is retried automatically.
 */
export function createJiraClient({
  config,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}: JiraClientOptions): JiraClient {
  const authorization = `Basic ${Buffer.from(
    `${config.email}:${config.apiToken}`,
  ).toString('base64')}`;

  async function request(path: string, body: unknown): Promise<unknown> {
    let response: Response;

    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error('Jira request timed out');
      }

      throw new Error('Jira is temporarily unavailable; try again later');
    }

    const responseText = await response.text();

    if (!response.ok) {
      throw translateError(response.status, responseText);
    }

    return parseJson(responseText);
  }

  async function requestGet(path: string): Promise<unknown> {
    let response: Response;

    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error('Jira request timed out');
      }

      throw new Error('Jira is temporarily unavailable; try again later');
    }

    const responseText = await response.text();

    if (!response.ok) {
      throw translateError(response.status, responseText);
    }

    return parseJson(responseText);
  }

  return {
    async createIssue(payload): Promise<CreatedIssue> {
      const response = (await request('/rest/api/3/issue', payload)) as JiraIssueResponse;
      const id = readString(response.id);
      const key = readString(response.key);

      if (id.length === 0 || key.length === 0) {
        throw new Error('Jira returned an invalid issue response');
      }

      return {
        id,
        key,
        url: `${config.baseUrl}/browse/${key}`,
      };
    },

    async searchIssues(jql, fields, maxResults): Promise<IssueSummary[]> {
      const response = (await request('/rest/api/3/search/jql', {
        jql,
        fields,
        maxResults,
      })) as JiraSearchResponse;

      if (!Array.isArray(response.issues)) {
        return [];
      }

      return response.issues.map((issue): IssueSummary => {
        const jiraIssue = isRecord(issue) ? (issue as JiraIssue) : {};
        const issueFields = isRecord(jiraIssue.fields)
          ? (jiraIssue.fields as JiraIssueFields)
          : {};
        const status = isRecord(issueFields.status)
          ? readString(issueFields.status.name)
          : '';
        const issueKey = readString(jiraIssue.key);

        return {
          issueKey,
          summary: readString(issueFields.summary),
          status,
          created: readString(issueFields.created),
          url: `${config.baseUrl}/browse/${issueKey}`,
        };
      });
    },

    async getIssue(key, fields): Promise<{ status: string; description: unknown }> {
      const query = `?fields=${encodeURIComponent(fields.join(','))}`;
      const response = (await requestGet(
        `/rest/api/3/issue/${encodeURIComponent(key)}${query}`,
      )) as JiraIssue;

      const issueFields = isRecord(response.fields)
        ? (response.fields as Record<string, unknown>)
        : {};
      const status = isRecord(issueFields.status)
        ? readString(issueFields.status.name)
        : '';

      return { status, description: issueFields.description };
    },
  };
}
