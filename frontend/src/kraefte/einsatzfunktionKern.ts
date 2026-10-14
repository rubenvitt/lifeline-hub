/**
 * Einsatzfunktion einer Kraft (LLH-1067, Spec `personal-einsatzangaben`): was jemand im Einsatz
 * gerade tut (Sprechfunker, Melder), getrennt von dem, was er kann (`funktion`, Qualifikation).
 *
 * Wo eine Person mit nur einer Funktionsangabe steht (Meldebild, Lagebericht-Übernahme,
 * Druck-Anlage, Auswahllisten), gilt `funktionText`: die Einsatzfunktion, sonst die
 * Qualifikation. Spiegel von `EinsatzPersonalAnzeige::funktion_text` im Server (design.md D2).
 *
 * Die Vorschläge kommen aus einer festen Liste, den aktiven Qualifikationen und den im Einsatz
 * schon vergebenen Einsatzfunktionen (D1). Ein späterer Katalog (LFH-1284) tauscht nur die Quelle
 * `EINSATZFUNKTION_VORGABEN`.
 */

/** Was eine Person für die Funktionsangabe trägt; passt auf `EinsatzPersonal` und `UhsKraft`. */
export interface MitFunktion {
  einsatzfunktion?: string | null;
  funktion?: string | null;
}

/** Funktionen nach FwDV 3/100, die im Einsatz wechseln. */
export const EINSATZFUNKTION_VORGABEN = [
  'Einheitsführer',
  'Gruppenführer',
  'Truppführer',
  'Maschinist',
  'Melder',
  'Sprechfunker',
  'Fahrer',
] as const;

function gefuellt(text: string | null | undefined): string | null {
  const t = text?.trim();
  return t ? t : null;
}

/** Die eine Funktionsangabe: Einsatzfunktion vor Qualifikation, `null` ohne beides. */
export function funktionText(p: MitFunktion): string | null {
  return gefuellt(p.einsatzfunktion) ?? gefuellt(p.funktion);
}

/** Auswahl-Etikett „Name · Funktion“; gleichnamige Personen bleiben so unterscheidbar. */
export function personLabel(p: MitFunktion & { name: string }): string {
  const f = funktionText(p);
  return f ? `${p.name} · ${f}` : p.name;
}

/**
 * Vorschläge für die Einsatzfunktion: zuerst die im Einsatz vergebenen (alphabetisch), dann die
 * Vorgaben, dann die Qualifikationen. Entdoppelt ohne Rücksicht auf Groß- und Kleinschreibung;
 * das erste Vorkommen gewinnt.
 */
export function einsatzfunktionVorschlaege(quellen: {
  vergeben: readonly (string | null | undefined)[];
  qualifikationen: readonly string[];
}): string[] {
  const vergeben = quellen.vergeben
    .map(gefuellt)
    .filter((t): t is string => t !== null)
    .sort((a, b) => a.localeCompare(b, 'de'));
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];
  for (const kandidat of [...vergeben, ...EINSATZFUNKTION_VORGABEN, ...quellen.qualifikationen]) {
    const t = gefuellt(kandidat);
    if (t === null) continue;
    const schluessel = t.toLocaleLowerCase('de');
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    ergebnis.push(t);
  }
  return ergebnis;
}

/**
 * Vorschläge zur Eingabe: Teilwort ohne Rücksicht auf Groß- und Kleinschreibung. Der genau
 * eingegebene Wert fehlt, er steht schon im Feld.
 */
export function filterVorschlaege(vorschlaege: readonly string[], eingabe: string): string[] {
  const e = eingabe.trim().toLocaleLowerCase('de');
  if (!e) return [...vorschlaege];
  return vorschlaege.filter((v) => {
    const k = v.toLocaleLowerCase('de');
    return k !== e && k.includes(e);
  });
}
