import { FIELD_ORDER, type OnboardingSubmission } from './fieldMapping';

/** Reverse lookup: human-readable label → submission key. */
const LABEL_TO_KEY = new Map<string, keyof OnboardingSubmission>(
  FIELD_ORDER.map(({ key, label }) => [label, key]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Concatenates the `text` of every text node directly under a paragraph node.
 * The onboarding builder emits exactly one text node per paragraph, but joining
 * defensively means a value that Jira split across text nodes still recombines.
 */
function paragraphText(node: unknown): string {
  if (!isRecord(node) || !Array.isArray(node.content)) {
    return '';
  }
  return node.content
    .filter(
      (child): child is { type: 'text'; text: string } =>
        isRecord(child) &&
        child.type === 'text' &&
        typeof child.text === 'string',
    )
    .map(child => child.text)
    .join('');
}

/**
 * Parses an Atlassian Document Format description back into onboarding fields —
 * the inverse of the description builder in `fieldMapping.ts`.
 *
 * For each top-level paragraph it reads the `"<Label>: <value>"` text, maps the
 * label to a submission key via the shared `FIELD_ORDER`, and takes everything
 * after the first `": "` as the value (so a value that itself contains `": "`
 * survives). Unrecognised paragraphs are ignored; a non-ADF or empty input
 * yields an empty object rather than throwing (Requirements 3.1, 3.2).
 */
export function parseAdfDescription(
  description: unknown,
): Partial<OnboardingSubmission> {
  if (!isRecord(description) || !Array.isArray(description.content)) {
    return {};
  }

  const result: Partial<OnboardingSubmission> = {};

  for (const node of description.content) {
    const text = paragraphText(node);
    const separator = text.indexOf(': ');
    if (separator === -1) {
      continue;
    }

    const label = text.slice(0, separator);
    const key = LABEL_TO_KEY.get(label);
    if (key === undefined) {
      continue;
    }

    // Enum-typed keys (environment/location) are stored as plain strings here;
    // the webhook validates contactEmail and only echoes the enums. The cast to
    // a string-valued record avoids TypeScript's union-indexed-write error while
    // remaining sound at runtime (every field is a string).
    (result as Record<string, string>)[key] = text.slice(separator + 2);
  }

  return result;
}
