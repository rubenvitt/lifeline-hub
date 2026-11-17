import type { FeldVermerk } from '../api/types';

/**
 * Wer eine Angabe zuletzt geändert hat, als kurze Angabe „Anna, 14:05“ (LLH-1834, Change
 * `nvhnqynd-konflikt-und-aenderungsvermerk`, Spec `aenderungsvermerk`). Ohne Namen nur die Zeit.
 * `zeitKurz` kommt aus `useAnzeigeKonventionen`, damit Zeitdarstellung und Zone der Seite gelten.
 */
export function vermerkKurz(vermerk: FeldVermerk, zeitKurz: (s: string) => string): string {
  const zeit = zeitKurz(vermerk.at);
  return vermerk.von ? `${vermerk.von}, ${zeit}` : zeit;
}

/** Der jüngste von mehreren Vermerken (für den Paneelkopf), oder `undefined` ohne Vermerk. */
export function juengsterVermerk(
  vermerke: Record<string, FeldVermerk> | undefined,
  felder: readonly string[],
): FeldVermerk | undefined {
  let juengster: FeldVermerk | undefined;
  for (const feld of felder) {
    const v = vermerke?.[feld];
    // SQLite-Zeitpunkte im selben Format: der Textvergleich ist der zeitliche.
    if (v && (!juengster || v.at > juengster.at)) juengster = v;
  }
  return juengster;
}

/**
 * Die Schlüssel eines Patches aus einem Datensatz in Wire-Form (fehlende als `null`): Altwert
 * (`erwartet`) und Vergleichswert des Feld-CAS mit denselben Schlüsseln wie die Änderung
 * (LLH-1831, design.md D6).
 */
export function ausschnitt<P extends object>(quelle: object, patch: P): Partial<P> {
  const aus: Record<string, unknown> = {};
  for (const schluessel of Object.keys(patch)) {
    aus[schluessel] = (quelle as Record<string, unknown>)[schluessel] ?? null;
  }
  return aus as Partial<P>;
}

/** Lesbarer Text eines Ausschnitts für die Rückfrage: die Werte, mit Komma getrennt. */
export function ausschnittText(wert: object): string {
  return Object.values(wert)
    .filter((v) => v != null && v !== '')
    .map((v) =>
      Array.isArray(v)
        ? `${v.length} Einträge`
        : typeof v === 'object'
          ? String((v as { name?: unknown }).name ?? 'eine Person')
          : String(v),
    )
    .join(', ');
}

/** Ein Ausschnitt ist leer, wenn jeder Wert leer ist. */
export function ausschnittLeer(wert: object): boolean {
  return Object.values(wert).every(
    (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0),
  );
}

/**
 * Der Vermerk zu den Schlüsseln eines Patches: Koordinatenpaare stehen im Vermerk als eine Angabe
 * (`einsatzort_koordinate`, `standort_koordinate`), die Soll-Stärke als `soll`; bei mehreren der
 * jüngste.
 */
export function vermerkFuer(
  vermerke: Record<string, FeldVermerk> | undefined,
  patch: object,
): FeldVermerk | undefined {
  const felder = Object.keys(patch).map((s) =>
    /^(einsatzort|standort)_(lat|lon)$/.test(s)
      ? s.replace(/_(lat|lon)$/, '_koordinate')
      : s.startsWith('soll_')
        ? 'soll'
        : s,
  );
  return juengsterVermerk(vermerke, felder);
}
