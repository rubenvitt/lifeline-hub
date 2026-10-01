import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinstellungen, ladeModulFreigaben } from '../api/einsaetze';
import { effektivesKoordinatenformat } from '../anzeige/format';
import { useKoordinatenSystemOverride } from '../anzeige/koordinatenSystemStore';
import { istModulFreigegeben, modulRegistry } from '../einsatz/modulRegistry';
import { erkenneKoordinate, koordinatenBefehl } from './koordinatenSprung';
import type { Befehl, Oeffnung, PaletteModus } from './typen';

/** Frische wie beim Datensatz-Finder: die Fächer hängen am SSE-Fan-out. */
const FRISCH_MS = 60_000;

/**
 * Beschaffung für den Koordinatensprung: Rechte und eingestelltes Format.
 *
 * LAZY wie `useDatensaetze`: abgefragt wird erst, wenn der ENTPRELLTE Rest die Form einer
 * Koordinate hat. Die Einsatz-Einstellungen holt der Hook selbst, weil die Palette außerhalb des
 * `EinsatzAnzeigeProvider` hängt; das Fach füllt `EinsatzLayout` ohnehin.
 *
 * Rückgabe ist eine FUNKTION über den lebenden Rest, damit nach dem Löschen einer Ziffer nicht
 * 300 ms lang ein veralteter Punkt dasteht.
 */
export function useKoordinatenSprung({
  einsatzId,
  modus,
  suche,
  navigate,
}: {
  einsatzId: number | null;
  modus: PaletteModus;
  /** Der ENTPRELLTE Rest hinter dem Präfix. */
  suche: string;
  navigate: (pfad: string, oeffnung?: Oeffnung) => void;
}): (rest: string) => Befehl | null {
  const override = useKoordinatenSystemOverride();
  const aktiv = einsatzId != null && modus === 'alles' && erkenneKoordinate(suche) !== null;

  const { data: freigaben } = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId!),
    enabled: aktiv,
    staleTime: FRISCH_MS,
  });
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId ?? 0),
    queryFn: () => ladeEinstellungen(einsatzId!),
    enabled: aktiv,
    staleTime: FRISCH_MS,
  });

  // Ohne Freigaben (laden, Fehler) kein Sprung: `istModulFreigegeben` gibt Unbekanntes nicht frei
  // (LFH-669, Spec `modul-freigabe`).
  const einsatzFormat = einstellungenQuery.data?.koordinatenformat;
  const orgFormat = einstellungenQuery.data?.org_defaults?.koordinatenformat;

  return useCallback(
    (rest: string) => {
      if (einsatzId == null || modus !== 'alles') return null;
      const lagekarte = modulRegistry.find((m) => m.key === 'lagekarte');
      if (!lagekarte || !istModulFreigegeben(lagekarte, freigaben)) return null;
      const punkt = erkenneKoordinate(rest);
      if (!punkt) return null;
      const format = effektivesKoordinatenformat(override, einsatzFormat, orgFormat) ?? 'wgs84';
      return koordinatenBefehl({ einsatzId, punkt, format, navigate });
    },
    [einsatzId, modus, freigaben, einsatzFormat, orgFormat, override, navigate],
  );
}
