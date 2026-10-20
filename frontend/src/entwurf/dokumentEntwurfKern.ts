/**
 * Reiner Kern des Bausteins `DokumentEntwurf` (`entwurf/AGENTS.md`, „Gegliederte Dokumente“):
 * was ohne Render prüfbar ist.
 */

/**
 * Ein Abschnitt eines gegliederten Dokuments, wie ihn die Vorlagen der Arten liefern
 * (`lageberichte/vorlagen.ts`, `befehle/vorlagen.ts`, `presse/vorlagen.ts`). Der Hilfetext ist
 * eine reine Eingabehilfe des Befehls (SKK-Unterpunkte).
 */
export interface DokumentAbschnitt {
  schluessel: string;
  label: string;
  hilfetext?: string;
}

/**
 * Höhe des Editors: leer einzeilig, er wächst mit dem Inhalt bis zur Obergrenze, danach rollt das
 * Feld. Eine Modulkonstante, damit die Prop identitätsstabil bleibt (Render-Zähler-Gate). Die
 * Höhenfrage aus LFH-348 (acht feste Editoren > 1200 px) löst das Mitwachsen, nicht das Verstecken.
 */
export const EDITOR_ZEILEN = { minRows: 1, maxRows: 15 } as const;

/**
 * Welche Abschnitte tragen Text? Leerraum zählt nicht — ein Abschnitt aus drei Leerzeichen ist
 * leer (wie `einstiegsAbschnitt` und der Füllstand der Übersicht).
 */
export function befuellteAbschnitte(
  werte: Record<string, unknown> | undefined,
  abschnitte: readonly DokumentAbschnitt[],
): Set<string> {
  const voll = new Set<string>();
  for (const a of abschnitte) {
    const t = werte?.[a.schluessel];
    if (typeof t === 'string' && t.trim()) voll.add(a.schluessel);
  }
  return voll;
}

/**
 * Dieselbe Aussage als ZEICHENKETTE, ein Zeichen je Abschnitt („1“ befüllt, „0“ leer). Ein
 * Primitiv, das sich nur ändert, wenn ein Abschnitt kippt: der Baustein beobachtet das Formular
 * über diese Kette (`Form.useWatch` mit Selektor) und rendert deshalb nicht je Anschlag.
 * Abgeleitet aus `befuellteAbschnitte`, damit „befüllt“ eine Definition hat.
 */
export function befuellungsKette(
  werte: Record<string, unknown> | undefined,
  abschnitte: readonly DokumentAbschnitt[],
): string {
  const voll = befuellteAbschnitte(werte, abschnitte);
  return abschnitte.map((a) => (voll.has(a.schluessel) ? '1' : '0')).join('');
}

/** Ob der Abschnitt an Stelle `index` laut Kette leer ist. */
export function istLeer(kette: string, index: number): boolean {
  return kette[index] !== '1';
}

/** Füllstand aus der Kette („5/8 Abschnitte“, wie die Übersicht der Lageberichte). */
export function fuellstandText(kette: string): string {
  const gefuellt = [...kette].filter((z) => z === '1').length;
  return `${gefuellt}/${kette.length} Abschnitte`;
}
