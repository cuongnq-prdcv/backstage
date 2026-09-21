/**
 * Expands the user's selected component names against the configured
 * Allowed_Components into the full boolean record the manifest renderer consumes.
 *
 * Every allowed name is present in the returned record, `true` when it is a
 * member of `selected` and `false` otherwise. Throws if any selected name is
 * not a member of `allowed`.
 *
 * The function is pure and deterministic: the same `(selected, allowed)` pair
 * always produces the same record. Duplicate entries in `selected` collapse to
 * a single `true`. An empty `selected` yields every allowed name mapped to
 * `false`; an empty `allowed` yields the empty record `{}` (subject to the
 * membership check, which rejects any non-empty selection against an empty
 * allowed-set).
 *
 * @param selected - The component names the user selected (a subset of `allowed`).
 * @param allowed - The authoritative Allowed_Components (assumed already
 *   pattern/size validated by the ConfigReader).
 * @returns A record with one entry per allowed name: `true` iff in `selected`.
 * @throws If any name in `selected` is not a member of `allowed` (Req 9.6).
 */
export function expandComponents(
  selected: string[],
  allowed: string[],
): Record<string, boolean> {
  const allowedSet = new Set(allowed);

  // Reject any unrecognized selected component before producing any record.
  for (const name of selected) {
    if (!allowedSet.has(name)) {
      throw new Error(
        `Unrecognized component: '${name}' is not an allowed component`,
      );
    }
  }

  const selectedSet = new Set(selected);
  const record: Record<string, boolean> = {};
  for (const name of allowed) {
    record[name] = selectedSet.has(name);
  }

  return record;
}
