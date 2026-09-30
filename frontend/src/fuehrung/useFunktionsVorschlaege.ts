import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import { besetzungAusStab, type FunktionsVorschlaege } from './funktionsOptionenKern';

/**
 * Katalog der Führungsfunktionen plus lesbare Besetzung für die Empfängerfelder (LFH-549).
 *
 * Die Besetzung kommt aus der bestehenden Stab-Abfrage. Ohne Stab-Recht antwortet sie mit 403;
 * dann tragen die Vorschläge keine Namen (kein erneuter Versuch, keine erfundene Angabe).
 */
export function useFunktionsVorschlaege(einsatzId: number | undefined): FunktionsVorschlaege {
  // Ohne Einsatz (z. B. isoliert gerenderte Masken) wird nichts geladen: nur Freitext.
  const katalog = useQuery({
    queryKey: globalKeys.fuehrungsfunktionen(),
    queryFn: ladeFuehrungsfunktionen,
    enabled: einsatzId != null,
    staleTime: 5 * 60_000,
  });
  const stab = useQuery({
    queryKey: einsatzKeys.stab(einsatzId ?? 0),
    queryFn: () => ladeStab(einsatzId ?? 0),
    enabled: einsatzId != null,
    retry: false,
    staleTime: 60_000,
  });
  return useMemo(
    () => ({ katalog: katalog.data ?? [], besetzung: besetzungAusStab(stab.data) }),
    [katalog.data, stab.data],
  );
}
