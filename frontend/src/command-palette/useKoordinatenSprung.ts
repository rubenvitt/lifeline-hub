// frontend/src/command-palette/useKoordinatenSprung.ts
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinstellungen, ladeModulOverrides } from '../api/einsaetze';
import { effektivesKoordinatenformat } from '../anzeige/format';
import { useKoordinatenSystemOverride } from '../anzeige/koordinatenSystemStore';
import { istModulFreigegeben, modulRegistry } from '../einsatz/modulRegistry';
import { erkenneKoordinate, koordinatenBefehl } from './koordinatenSprung';
import type { Befehl, Oeffnung, PaletteModus } from './typen';

/** Frische wie beim Datensatz-Finder: die Fächer hängen am SSE-Fan-out. */
const FRISCH_MS = 60_000;

/**
 * Beschaffung für den Koordinatensprung (LFH-619): Rechte und eingestelltes Format.
 *
 * LAZY WIE `useDatensaetze`: abgefragt wird erst, wenn der ENTPRELLTE Rest die Form einer
 * Koordinate hat. Die Palette hängt auf App-Ebene und rendert erst beim Öffnen; ein eager
 * Abruf feuerte bei jedem `Strg/⌘+K`.
 *
 * Die Einsatz-Einstellungen holt der Hook selbst, weil die Palette AUSSERHALB des
 * `EinsatzAnzeigeProvider` hängt — dessen Hook lieferte hier nur die Defaults. Das Fach ist
 * dasselbe, das `EinsatzLayout` ohnehin füllt; auf einer Einsatzseite kostet das keinen Request.
 *
 * Rückgabe ist eine FUNKTION über den lebenden Rest, keine fertige Zeile: der Rest, aus dem
 * die Rechte angefragt wurden, hinkt der Eingabe um die Entprellung hinterher. Die Palette
 * fragt mit dem, was gerade im Feld steht — sonst stünde nach dem Löschen einer Ziffer noch
 * 300 ms lang ein Punkt da, den niemand mehr gemeint hat.
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
  const { benutzer } = useAuth();
  const override = useKoordinatenSystemOverride();
  const aktiv = einsatzId != null && modus === 'alles' && erkenneKoordinate(suche) !== null;

  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: aktiv,
    staleTime: FRISCH_MS,
  });
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId ?? 0),
    queryFn: () => ladeEinstellungen(einsatzId!),
    enabled: aktiv,
    staleTime: FRISCH_MS,
  });

  // `isFetched` statt `isSuccess`, wie beim Datensatz-Finder: ein Fehlschlag legt den Sprung
  // nicht dauerhaft still, dann gilt der Registry-Default.
  const rechteBekannt = overridesQuery.isFetched;
  const overrides = overridesQuery.data;
  const einsatzFormat = einstellungenQuery.data?.koordinatenformat;
  const orgFormat = einstellungenQuery.data?.org_defaults?.koordinatenformat;

  return useCallback(
    (rest: string) => {
      if (einsatzId == null || modus !== 'alles' || !rechteBekannt) return null;
      const lagekarte = modulRegistry.find((m) => m.key === 'lagekarte');
      if (!lagekarte || !istModulFreigegeben(lagekarte, benutzer, overrides)) return null;
      const punkt = erkenneKoordinate(rest);
      if (!punkt) return null;
      const format = effektivesKoordinatenformat(override, einsatzFormat, orgFormat) ?? 'wgs84';
      return koordinatenBefehl({ einsatzId, punkt, format, navigate });
    },
    [
      einsatzId,
      modus,
      rechteBekannt,
      benutzer,
      overrides,
      einsatzFormat,
      orgFormat,
      override,
      navigate,
    ],
  );
}
