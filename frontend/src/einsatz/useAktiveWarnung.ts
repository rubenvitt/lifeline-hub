import { useQuery } from '@tanstack/react-query';
import { ladeGefahrengebiete } from '../api/gefahren';
import { ladeModulZaehler } from '../api/modulZaehler';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { wetterAbfrage } from '../api/wetter';
import { verdichteGefahrengebiete } from '../pages/lage-dashboard/lageVerdichtung';
import { useUnwetterUhr } from '../wetter/useUnwetterUhr';
import { aktiveWarnung, dwdStufenJetzt } from './aktiveWarnung';
import { istModulFreigegeben, modulRegistry } from './modulRegistry';

interface Args {
  einsatzId: number;
  freigaben?: ModulFreigaben;
  /** Der Abruf der Freigaben ist gescheitert (nicht bloß: lädt noch). */
  freigabenGescheitert?: boolean;
}

const GEFAHREN_MODUL = modulRegistry.find((m) => m.key === 'gefahrenzonen');
const WETTER_MODUL = modulRegistry.find((m) => m.key === 'wetter-pegel');

/**
 * Die Warnquelle des Helligkeitsreglers im geöffneten Einsatz (LFH-397, design.md D3).
 * `EinsatzLayout` reicht das Ergebnis an `useWarnsperre` — dort und nur dort, weil nur das
 * Layout für den ganzen Einsatz steht.
 *
 * KEIN ZUSATZABRUF, WO ES EINEN GIBT: alle drei Abfragen teilen Schlüssel und Abruffunktion
 * mit ihren bestehenden Lesern (Modulzähler des Rahmens; Lagekarte, Lage-Dashboard,
 * Gefahrenseite; beim Wetter `wetterAbfrage` wie Modulzähler und Modulseite, LFH-774 D1).
 * Gefahren und Meldungen sind live über `EINSATZ_STREAM_EVENTS` (`meldung`, `gefahr`,
 * `lage_zone`); das Wetter kommt alle 5 min, Beginn und Ende einer Warnung weckt
 * `useUnwetterUhr` ohne neuen Abruf (D3). `select` zieht nur das eine Merkmal heraus.
 *
 * Gefahren- und Wettermodul werden ohne Freigabe NICHT abgefragt — dieselbe Frage wie die
 * Navigation (`istModulFreigegeben`). Die Meldungs-Hälfte filtert der Server selbst: ohne
 * Meldungsrecht fehlt das Feld.
 *
 * FAIL-SAFE ohne Freigaben (LFH-669): scheitert ihr Abruf, weiß niemand, ob ein Gebiet akut
 * ist. Abgefragt wird trotzdem nicht (Spec `modul-freigabe`); stattdessen meldet der Hook die
 * Warnung, und der Regler hält den Warnboden, bis die Freigaben wieder da sind.
 */
export function useAktiveWarnung({ einsatzId, freigaben, freigabenGescheitert }: Args): boolean {
  const gefahrenFrei =
    GEFAHREN_MODUL !== undefined && istModulFreigegeben(GEFAHREN_MODUL, freigaben);
  const wetterFrei = WETTER_MODUL !== undefined && istModulFreigegeben(WETTER_MODUL, freigaben);

  const hoechsteWarnstufe = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
    enabled: gefahrenFrei,
    select: (gebiete) => verdichteGefahrengebiete(gebiete).hoechste,
  }).data;

  const bestaetigungUeberfaellig = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
    select: (z) => z.meldungen?.bestaetigung_ueberfaellig,
  }).data;

  const dwdWarnungen = useQuery({
    ...wetterAbfrage(einsatzId),
    enabled: wetterFrei,
    select: (w) => w.warnungen,
  }).data;
  // Ohne Freigabe auch keine Uhr: sie weckte sonst an Wechseln eines Caches, der nicht zählt.
  const jetzt = useUnwetterUhr(wetterFrei ? dwdWarnungen : undefined);

  if (freigabenGescheitert && freigaben === undefined) return true;

  return aktiveWarnung({
    // Wird das Modul während der Sitzung ausgeblendet, bliebe der Cache stehen — ohne
    // Freigabe zählt er nicht.
    hoechsteWarnstufe: gefahrenFrei ? hoechsteWarnstufe : undefined,
    bestaetigungUeberfaellig,
    dwdStufenJetzt: wetterFrei ? dwdStufenJetzt(dwdWarnungen, jetzt) : undefined,
  });
}
