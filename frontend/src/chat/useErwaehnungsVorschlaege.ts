import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import { globalKeys } from '../api/queryKeys';
import type { EinsatzAnzeige } from '../api/types';
import { mitgliederAbfrage } from '../fuehrung/besetzungAusMitgliedern';
import { besetzteFunktionen, erwaehnungsVorschlaege, type ErwaehnungVorschlag } from './erwaehnung';

/**
 * Vorschläge für `@` in der Chat-Eingabe (LLH-1220): Mitglieder und besetzte Funktionen, beide aus
 * der Mitgliederliste (i6k6mzed D2) und dem Einsatzleiter der Führungsstelle.
 */
export function useErwaehnungsVorschlaege(
  einsatzId: number,
  einsatz: EinsatzAnzeige | undefined,
  eigeneId: number | undefined,
): ErwaehnungVorschlag[] {
  const katalog = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
    staleTime: 5 * 60_000,
  });
  const mitglieder = useQuery(mitgliederAbfrage(einsatzId));
  return useMemo(() => {
    const liste = mitglieder.data ?? [];
    return erwaehnungsVorschlaege(
      katalog.data ?? [],
      besetzteFunktionen(liste, einsatz),
      liste,
      eigeneId,
    );
  }, [katalog.data, mitglieder.data, einsatz, eigeneId]);
}
