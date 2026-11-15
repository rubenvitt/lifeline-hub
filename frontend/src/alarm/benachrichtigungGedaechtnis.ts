/**
 * Was ein Tab über Benachrichtigungen weiß, modulweit statt je Zentrale: beim Wechsel zwischen
 * Org-Layout und Einsatz, zwischen zwei Einsätzen und bei einem Replay des Stroms bleibt so jede
 * Benachrichtigung eine. Ohne Abhängigkeiten, damit `test/setup.ts` es zurücksetzen kann, ohne
 * Module zu laden, die Tests mocken.
 */

/** Quittiert in diesem Tab (selbst oder über das Quittier-Ereignis): erscheint nicht wieder. */
export const quittiert = new Set<number>();
/** Text wird gerade geholt: ein zweites Ereignis derselben ID wartet nicht noch einmal. */
export const inArbeit = new Set<number>();
/** Schon einmal gezeigt: kommt sie nach einem Layoutwechsel wieder, dann ohne Ton. */
export const gezeigt = new Set<number>();

/** Was der Verlauf „Eingänge“ zu einer Benachrichtigung zeigt (LLH-1737). */
export type VerlaufInhalt = { titel: string; detail?: string | null };
/**
 * Inhalt je Benachrichtigung für den Verlauf (`EingaengeKnopf.tsx`): ein erneutes Öffnen holt ihn
 * nicht noch einmal. `null`: geholt, aber ohne Inhalt.
 */
export const verlaufInhalt = new Map<number, VerlaufInhalt | null>();

/**
 * Speicherort der ausgeblendeten Benachrichtigungen (`GERAETESPEICHER`, `jeder-ausgang`). Je Tab
 * und bis der Tab schließt: `sessionStorage` überlebt das Neuladen, nicht den nächsten Tab.
 */
export const AUSGEBLENDET_SCHLUESSEL = 'lfh:alarm:ausgeblendet';

function ausgeblendetLesen(): Set<number> {
  try {
    const roh = globalThis.sessionStorage?.getItem(AUSGEBLENDET_SCHLUESSEL);
    if (!roh) return new Set();
    const werte: unknown = JSON.parse(roh);
    return new Set(
      Array.isArray(werte) ? werte.filter((w): w is number => Number.isInteger(w)) : [],
    );
  } catch {
    // Kein Speicher oder kaputter Wert: dann ist nichts ausgeblendet.
    return new Set();
  }
}

/**
 * Mit ✕ weggeräumt, ohne zu quittieren (LLH-1736, Spec `benachrichtigungen`, „Ausblenden quittiert
 * nicht“, design.md D4): erscheint in diesem Tab nicht wieder, auch nicht beim Nachreichen oder
 * nach dem Neuladen. Andere Tabs und Geräte zeigen sie weiter; der Verlauf nennt sie unter „Neu“.
 */
const ausgeblendet = ausgeblendetLesen();

function ausgeblendetSchreiben(): void {
  try {
    if (ausgeblendet.size === 0) globalThis.sessionStorage?.removeItem(AUSGEBLENDET_SCHLUESSEL);
    else
      globalThis.sessionStorage?.setItem(
        AUSGEBLENDET_SCHLUESSEL,
        JSON.stringify([...ausgeblendet]),
      );
  } catch {
    /* sessionStorage nicht verfügbar — dann gilt es bis zum Neuladen */
  }
}

/** Blendet eine Benachrichtigung in diesem Tab aus. Erst merken, dann schreiben. */
export function blendeAus(id: number): void {
  if (ausgeblendet.has(id)) return;
  ausgeblendet.add(id);
  ausgeblendetSchreiben();
}

export function istAusgeblendet(id: number): boolean {
  return ausgeblendet.has(id);
}

/** Quittiert: das Merken ist erledigt, die Benachrichtigung kommt ohnehin nicht wieder. */
export function vergissAusgeblendet(id: number): void {
  if (!ausgeblendet.delete(id)) return;
  ausgeblendetSchreiben();
}

/** Ausgang (`offline/geraetRaeumung.ts`): der nächste Benutzer im Tab beginnt ohne. */
export function ausgeblendetRaeumen(): void {
  ausgeblendet.clear();
  try {
    globalThis.sessionStorage?.removeItem(AUSGEBLENDET_SCHLUESSEL);
  } catch {
    /* sessionStorage nicht verfügbar — dann liegt dort auch nichts */
  }
}

export function benachrichtigungenZuruecksetzenFuerTests(): void {
  quittiert.clear();
  inArbeit.clear();
  gezeigt.clear();
  verlaufInhalt.clear();
  ausgeblendetRaeumen();
}
