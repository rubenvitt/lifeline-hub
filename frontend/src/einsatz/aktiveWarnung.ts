/**
 * Was „aktive Warnung" für die Warnsperre des Helligkeitsreglers heißt (LFH-397,
 * `openspec/changes/archive/2026-09-29-lfh-397-helligkeitsregler-warnsperre/design.md` D3;
 * drittes Merkmal LFH-774, `openspec/changes/archive/2026-10-02-lfh-774-warnsperre-unwetter/design.md` D2/D3).
 *
 * DREI MERKMALE, alle im geöffneten Einsatz:
 *  (a) die höchste Warnstufe der Gefahrengebiete ist eine, die der Statusvertrag
 *      `warnstufeKennzahl` auf `alarm` legt (heute `hoch`/`akut`) — gelesen aus dem
 *      Vertrag, nicht aus einer zweiten Stufenliste: ändert sich der Vertrag, zieht die
 *      Sperre mit;
 *  (b) mindestens eine Meldung hat eine überfällige Bestätigungspflicht
 *      (`meldungen.bestaetigung_ueberfaellig` des Modulzählers, Regel `istAlarmiert`);
 *  (c) für den Einsatzort GILT JETZT eine DWD-Warnung, deren Stufe der Statusvertrag
 *      `dwdWarnstufe` auf `alarm` legt (heute `schwer`/`extrem`). Auch hier der Vertrag, nicht
 *      `UNWETTER_STUFEN` aus `wetter/unwetter.ts` — dass beide übereinstimmen, hält
 *      `aktiveWarnung.test.ts` fest. Angekündigte Warnungen sperren nicht: dafür gibt es
 *      Unwetterhinweis und Überblick-Marke (LFH-663).
 *
 * BEWUSST NICHT: „irgendeine Statusrolle `alarm`" (defektes Material, überfällige
 * Ablösung sind Arbeit auf einer Liste, keine Warnung, die man wegdimmen könnte).
 *
 * Eine fehlende Quelle — kein Modulrecht, lädt noch, Abruf gescheitert, Wetterdienst
 * ausgefallen — ist `undefined` und trägt nichts bei: eine Sperre ohne Beleg verböte das
 * Dimmen, ohne dass jemand sieht, warum.
 */
import type { Warnstufe, WetterWarnstufe } from '../api/types';
import { dwdWarnstufe, warnstufeKennzahl } from '../theme/statusFarben';
import { teilStand, teileWarnungen } from '../wetter/wetterStand';

export interface Warnmerkmale {
  hoechsteWarnstufe?: Warnstufe;
  bestaetigungUeberfaellig?: number;
  /** Stufen der DWD-Warnungen, die jetzt gelten ({@link dwdStufenJetzt}). */
  dwdStufenJetzt?: readonly WetterWarnstufe[];
}

export function aktiveWarnung({
  hoechsteWarnstufe,
  bestaetigungUeberfaellig,
  dwdStufenJetzt,
}: Warnmerkmale): boolean {
  const warnstufeSperrt =
    hoechsteWarnstufe !== undefined && warnstufeKennzahl[hoechsteWarnstufe].rolle === 'alarm';
  // Eine Liste statt „höchster Stufe": eine Rangfolge wäre eine zweite Stufenliste neben dem
  // Vertrag.
  const unwetterSperrt = (dwdStufenJetzt ?? []).some((s) => dwdWarnstufe[s].rolle === 'alarm');
  return warnstufeSperrt || (bestaetigungUeberfaellig ?? 0) > 0 || unwetterSperrt;
}

type WarnTeil = {
  zustand: string;
  abgerufen_at?: string | null;
  daten?:
    readonly { stufe: WetterWarnstufe; beginn?: string | null; ende?: string | null }[] | null;
};

/**
 * Die Stufen der DWD-Warnungen, die zu `jetzt` gelten (Beginn erreicht, Ende nicht
 * verstrichen). `undefined` ohne verwertbaren Stand — fehlt der Teil, ist die Quelle
 * ausgefallen, hat der Einsatz keinen Ort oder liegt der Abruf jenseits der Obergrenze. Dieselben
 * Bausteine wie `wetter/unwetter.ts:unwetterLage`, damit „gilt" und „verwertbar" nur einmal
 * definiert sind. Rein.
 */
export function dwdStufenJetzt(
  teil: WarnTeil | null | undefined,
  jetzt: number,
): WetterWarnstufe[] | undefined {
  if (!teil) return undefined;
  const art = teilStand(teil, 'warnungen', jetzt).art;
  if (art !== 'aktuell' && art !== 'veraltet') return undefined;
  return teileWarnungen(teil.daten ?? [], jetzt).giltJetzt.map((w) => w.stufe);
}
