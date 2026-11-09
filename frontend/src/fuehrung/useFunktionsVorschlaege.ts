import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import { globalKeys } from '../api/queryKeys';
import { besetzungJeSachgebiet, mitgliederAbfrage } from './besetzungAusMitgliedern';
import type { FunktionsVorschlaege } from './funktionsOptionenKern';

/**
 * Katalog der Führungsfunktionen plus lesbare Besetzung für die Empfängerfelder (LFH-549).
 *
 * Die Besetzung kommt aus den Mitgliedern des Einsatzes (i6k6mzed, design.md D2), die jedes
 * Mitglied ohne Modulrecht lesen darf. Scheitert der Abruf, tragen die Vorschläge keine Namen
 * (kein erneuter Versuch, keine erfundene Angabe).
 */
export function useFunktionsVorschlaege(einsatzId: number | undefined): FunktionsVorschlaege {
  // Ohne Einsatz (z. B. isoliert gerenderte Masken) wird nichts geladen: nur Freitext.
  const katalog = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
    enabled: einsatzId != null,
    staleTime: 5 * 60_000,
  });
  const mitglieder = useQuery({
    ...mitgliederAbfrage(einsatzId ?? 0),
    enabled: einsatzId != null,
    retry: false,
    staleTime: 60_000,
  });
  return useMemo(
    () => ({ katalog: katalog.data ?? [], besetzung: besetzungJeSachgebiet(mitglieder.data) }),
    [katalog.data, mitglieder.data],
  );
}
