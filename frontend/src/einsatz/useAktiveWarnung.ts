import { useQuery } from '@tanstack/react-query';
import { ladeGefahrengebiete } from '../api/gefahren';
import { ladeModulZaehler } from '../api/modulZaehler';
import { einsatzKeys } from '../api/queryKeys';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { verdichteGefahrengebiete } from '../pages/lage-dashboard/lageVerdichtung';
import { aktiveWarnung } from './aktiveWarnung';
import { istModulFreigegeben, modulRegistry } from './modulRegistry';

interface Args {
  einsatzId: number;
  benutzer: BenutzerAnzeige | null;
  overrides?: ModulOverrides;
}

const GEFAHREN_MODUL = modulRegistry.find((m) => m.key === 'gefahrenzonen');

/**
 * Die Warnquelle des Helligkeitsreglers im geöffneten Einsatz (LFH-397, design.md D3).
 * `EinsatzLayout` reicht das Ergebnis an `useWarnsperre` — dort und nur dort, weil nur das
 * Layout für den ganzen Einsatz steht.
 *
 * KEIN ZUSATZABRUF, WO ES EINEN GIBT: beide Abfragen teilen Schlüssel und Abruffunktion
 * mit ihren bestehenden Lesern (Modulzähler des Rahmens; Lagekarte, Lage-Dashboard,
 * Gefahrenseite) und sind live über `EINSATZ_STREAM_EVENTS` (`meldung`, `gefahr`,
 * `lage_zone`). `select` zieht nur das eine Merkmal heraus.
 *
 * Das Gefahrenmodul wird ohne Freigabe NICHT abgefragt — dieselbe Frage wie die
 * Navigation (`istModulFreigegeben`). Die Meldungs-Hälfte filtert der Server selbst: ohne
 * Meldungsrecht fehlt das Feld.
 */
export function useAktiveWarnung({ einsatzId, benutzer, overrides }: Args): boolean {
  const gueltig = Number.isFinite(einsatzId);
  const gefahrenFrei =
    gueltig &&
    GEFAHREN_MODUL !== undefined &&
    istModulFreigegeben(GEFAHREN_MODUL, benutzer, overrides);

  const hoechsteWarnstufe = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
    enabled: gefahrenFrei,
    select: (gebiete) => verdichteGefahrengebiete(gebiete).hoechste,
  }).data;

  const bestaetigungUeberfaellig = useQuery({
    queryKey: einsatzKeys.modulZaehler(einsatzId),
    queryFn: () => ladeModulZaehler(einsatzId),
    enabled: gueltig,
    select: (z) => z.meldungen?.bestaetigung_ueberfaellig,
  }).data;

  return aktiveWarnung({
    // Wird das Modul während der Sitzung ausgeblendet, bliebe der Cache stehen — ohne
    // Freigabe zählt er nicht.
    hoechsteWarnstufe: gefahrenFrei ? hoechsteWarnstufe : undefined,
    bestaetigungUeberfaellig,
  });
}
