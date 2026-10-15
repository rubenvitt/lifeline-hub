import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeMitglieder } from '../api/einsaetze';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { EinsatzAnzeige } from '../api/types';
import { besetzteFunktionen, erwaehnungsVorschlaege, type ErwaehnungVorschlag } from './erwaehnung';

/**
 * Vorschläge für `@` in der Chat-Eingabe (LLH-1220): Mitglieder und besetzte Funktionen. Die
 * Stab-Besetzung antwortet ohne Stab-Recht mit 403; dann zählen nur Führungsstelle und
 * Mitgliedschaften (kein erneuter Versuch, wie `fuehrung/useFunktionsVorschlaege.ts`).
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
  const stab = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
    retry: false,
    staleTime: 60_000,
  });
  const mitglieder = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  return useMemo(() => {
    const liste = mitglieder.data ?? [];
    return erwaehnungsVorschlaege(
      katalog.data ?? [],
      besetzteFunktionen(liste, stab.data, einsatz),
      liste,
      eigeneId,
    );
  }, [katalog.data, stab.data, mitglieder.data, einsatz, eigeneId]);
}
