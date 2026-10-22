import type { KommunikationsVerbindung, NeueVerbindung, Verbindungsmittel } from '../api/types';

/**
 * Verbindungen außerhalb des Funks (LLH-1134, Entscheidung LLH-1126 Option B): typisiert wie die
 * Stellen des Kommunikationsplans — Mittel, Wert, Hinweis. Abschnitt, Einheit und eigene
 * Führungsstelle tragen sie als Liste (`verbindungen`); Funk zeigt sich dort an Rufname und
 * Sprechgruppen. Reiner Kern ohne React, geteilt von `VerbindungenFeld`, `FunkUndTelefon`, dem
 * Kommunikationsplan und dem Funkplan.
 */

export const VERBINDUNGSMITTEL_LABEL: Record<Verbindungsmittel, string> = {
  festnetz: 'Festnetz',
  mobil: 'Mobil',
  fax: 'Fax',
  email: 'E-Mail',
  messenger: 'Messenger',
  melder: 'Melder',
  sonstiges: 'Sonstiges',
};

export const VERBINDUNGSMITTEL_OPTIONEN = (
  Object.entries(VERBINDUNGSMITTEL_LABEL) as [Verbindungsmittel, string][]
).map(([value, label]) => ({ value, label }));

/** Festnetz und Mobil sind die Mittel, die „Telefon“ heißen (Funkplan-Spalte, Lücke). */
export function istTelefon(mittel: Verbindungsmittel): boolean {
  return mittel === 'festnetz' || mittel === 'mobil';
}

/**
 * `tel:` nur für Festnetz und Mobil, auf Ziffern und ein führendes `+` reduziert; `mailto:` nur
 * mit `@`. Bleibt nichts Wählbares übrig, ist der Wert Text (LFH-848 design.md D5).
 */
export function verbindungsVerweis(mittel: Verbindungsmittel | null, wert: string): string | null {
  const w = wert.trim();
  if (mittel === 'festnetz' || mittel === 'mobil') {
    const plus = w.startsWith('+') ? '+' : '';
    const ziffern = w.replace(/\D/g, '');
    return ziffern.length >= 3 ? `tel:${plus}${ziffern}` : null;
  }
  if (mittel === 'email') return w.includes('@') && !/\s/.test(w) ? `mailto:${w}` : null;
  return null;
}

/** Die Telefonverbindungen (Festnetz, Mobil) in Eingabefolge. */
export function telefonVerbindungen(
  verbindungen: readonly KommunikationsVerbindung[] | null | undefined,
): KommunikationsVerbindung[] {
  return (verbindungen ?? []).filter((v) => istTelefon(v.mittel));
}

/** „Mobil 0170 1234567 (nur tagsüber)“ — eine Verbindung als Text für Druck und Bericht. */
export function verbindungText(v: Pick<KommunikationsVerbindung, 'mittel' | 'wert' | 'hinweis'>) {
  const hinweis = v.hinweis?.trim();
  return `${VERBINDUNGSMITTEL_LABEL[v.mittel]} ${v.wert}${hinweis ? ` (${hinweis})` : ''}`;
}

/** Gelesene Verbindungen als Eingabe der Ersatzliste (ohne id, leerer Hinweis entfällt). */
export function alsEingabe(
  verbindungen: readonly KommunikationsVerbindung[] | null | undefined,
): NeueVerbindung[] {
  return (verbindungen ?? []).map((v) => ({
    mittel: v.mittel,
    wert: v.wert,
    ...(v.hinweis?.trim() ? { hinweis: v.hinweis.trim() } : {}),
  }));
}

/** Gleichheit zweier Ersatzlisten nach Inhalt und Folge (für `InlineAngabe.gleich`). */
export function gleicheVerbindungen(
  a: readonly NeueVerbindung[],
  b: readonly NeueVerbindung[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.mittel === b[i].mittel &&
        x.wert.trim() === b[i].wert.trim() &&
        (x.hinweis?.trim() ?? '') === (b[i].hinweis?.trim() ?? ''),
    )
  );
}

/**
 * Eine Liste zum Senden: getrimmt, ganz leere Zeilen fallen weg, ein leerer Hinweis entfällt. Eine
 * Zeile mit Hinweis, aber ohne Wert bleibt stehen — sie ist eine Änderung, die die Prüfung der
 * Eingabe ablehnt, kein stilles Verwerfen.
 */
export function bereinigeVerbindungen(liste: readonly NeueVerbindung[]): NeueVerbindung[] {
  return liste
    .map((v) => ({ mittel: v.mittel, wert: v.wert.trim(), hinweis: v.hinweis?.trim() }))
    .filter((v) => v.wert !== '' || !!v.hinweis)
    .map((v) => (v.hinweis ? v : { mittel: v.mittel, wert: v.wert }));
}
