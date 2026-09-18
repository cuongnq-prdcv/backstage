/**
 * Fixed, non-reversible placeholder substituted for every secret occurrence.
 * It carries no information about the original secret (no length, no hash),
 * so redaction cannot be reversed from the output (Req 7.3).
 */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Replaces every occurrence of each secret value in `message` with a fixed,
 * non-reversible placeholder, leaving all non-secret substrings unchanged.
 *
 * Pure function: reads only its arguments and returns a new string.
 *
 * - Every occurrence of every non-empty secret is replaced with
 *   {@link REDACTION_PLACEHOLDER}. All other characters are preserved exactly.
 * - Secrets are matched as literal strings (not regular expressions).
 * - Empty-string secrets are ignored.
 * - Longer secrets are applied before shorter ones so that when one secret is a
 *   substring of another, the longer value is fully redacted.
 */
export function redact(message: string, secrets: string[]): string {
  const effectiveSecrets = Array.from(new Set(secrets))
    .filter(secret => secret.length > 0)
    .sort((a, b) => b.length - a.length);

  let result = message;
  for (const secret of effectiveSecrets) {
    result = result.split(secret).join(REDACTION_PLACEHOLDER);
  }
  return result;
}
