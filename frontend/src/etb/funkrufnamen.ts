import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys } from '../api/queryKeys';

/**
 * Funkrufnamen-Vorschläge für die ETB-Absender/Empfänger-Auswahl: im aktuellen
 * Einsatz disponierte Fahrzeuge (Funkrufname, OPTA in Klammern) + Einheiten (Name).
 * Reine Eingabehilfe — Freitext bleibt erlaubt (AC#1).
 */
export function useFunkrufnamen(einsatzId: number): string[] {
  const fahrzeuge = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const einheiten = useQuery({
    queryKey: ['einheiten', einsatzId],
    queryFn: () => listeEinheiten(einsatzId),
  });

  return useMemo(() => {
    const namen = new Set<string>();
    for (const f of fahrzeuge.data ?? []) {
      namen.add(f.opta ? `${f.funkrufname} (${f.opta})` : f.funkrufname);
    }
    for (const e of einheiten.data ?? []) {
      namen.add(e.name);
    }
    return [...namen].sort((a, b) => a.localeCompare(b, 'de'));
  }, [fahrzeuge.data, einheiten.data]);
}
