import type { Einheit } from '../../api/types';

/**
 * Reiner Kern der Einheit-Ansicht (LLH-1036, design.md D6 und D15): was die Bauteile unter
 * `pages/einheit/` ableiten, ohne React. Das Suffix `Kern` ist Pflicht (`frontend/AGENTS.md`,
 * „Direkteinstieg“).
 */

/**
 * Die Einheit selbst und alle ihre Nachfahren: wer darunter hängt, kann nicht ihre Über-Einheit
 * werden, sonst entstünde ein Kreis. Ein Kreis im Bestand bricht die Suche nicht.
 */
export function collectNachfahren(einheiten: readonly Einheit[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const e of einheiten) {
    if (e.ueber_einheit_id != null) {
      if (!kinder.has(e.ueber_einheit_id)) kinder.set(e.ueber_einheit_id, []);
      kinder.get(e.ueber_einheit_id)!.push(e.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}
