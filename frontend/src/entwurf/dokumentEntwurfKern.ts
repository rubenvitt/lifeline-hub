/**
 * Reiner Kern des Bausteins `DokumentEntwurf` (`entwurf/AGENTS.md`, „Gegliederte Dokumente“):
 * was ohne Render prüfbar ist.
 */

/**
 * Ein Abschnitt eines gegliederten Dokuments, wie ihn die Vorlagen der Arten liefern
 * (`lageberichte/vorlagen.ts`, `befehle/vorlagen.ts`). Der Hilfetext ist
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

/** Ansicht des ganzen Dokuments: Textfelder oder gesetzte Lesefassung. */
export type DokumentAnsicht = 'bearbeiten' | 'lesen';

/** Schlüssel der Aktionen eines Abschnitts (LLH-1601). */
export type AbschnittAktionKey = 'springen' | 'kopieren' | 'lesefassung' | 'leeren';

/** Ein Eintrag im ⋮ oder Kontextmenü eines Abschnitts (Form von `MenueEintrag`). */
export interface AbschnittEintrag {
  key: AbschnittAktionKey;
  label: string;
  gefahr?: true;
  gesperrt?: true;
}

export interface AbschnittZustand {
  /** Laut Leer-Kette: nichts als Leerraum. */
  leer: boolean;
  /** Zwischenablage vorhanden (`navigator.clipboard.writeText`, nur im Secure Context). */
  kopierbar: boolean;
  ansicht: DokumentAnsicht;
}

/**
 * Die Aktionen eines Abschnitts, EINE Quelle für das ⋮ im Abschnittskopf und das Kontextmenü an
 * Kopf und Gliederung (LLH-1601, Spec `dokument-entwurf`; `frontend/AGENTS.md`, „Kontextmenü nur
 * über den Baustein“). „In der Lesefassung zeigen“ fehlt, wenn sie schon gewählt ist; ein leerer
 * Abschnitt hat nichts zu kopieren oder zu leeren.
 */
export function abschnittEintraege({
  leer,
  kopierbar,
  ansicht,
}: AbschnittZustand): AbschnittEintrag[] {
  return [
    {
      key: 'kopieren',
      label: 'Text kopieren',
      ...(leer || !kopierbar ? { gesperrt: true as const } : {}),
    },
    ...(ansicht === 'lesen'
      ? []
      : [{ key: 'lesefassung' as const, label: 'In der Lesefassung zeigen' }]),
    {
      key: 'leeren',
      label: 'Abschnitt leeren',
      gefahr: true,
      // Ein leerer Abschnitt meldete sonst eine Änderung, die keine ist (Autosave ohne Inhalt).
      ...(leer ? { gesperrt: true as const } : {}),
    },
  ];
}

/** Kontextmenü eines Gliederungseintrags: die Primäraktion (der Sprung) zuoberst. */
export function gliederungEintraege(zustand: AbschnittZustand): AbschnittEintrag[] {
  return [{ key: 'springen', label: 'Zum Abschnitt springen' }, ...abschnittEintraege(zustand)];
}
