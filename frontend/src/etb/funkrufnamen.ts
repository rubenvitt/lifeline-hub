import { useQuery } from '@tanstack/react-query';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinheiten } from '../api/einheiten';

/**
 * Funkrufnamen-Vorschläge für die ETB-Absender/Empfänger-Auswahl: im aktuellen
 * Einsatz disponierte Fahrzeuge (Funkrufname, OPTA in Klammern) + Einheiten (Name).
 * Reine Eingabehilfe — Freitext bleibt erlaubt (AC#1).
 */
export function useFunkrufnamen(einsatzId: number): string[] {
  const fahrzeuge = useQuery({
    queryKey: ['einsatz-fahrzeuge', einsatzId],
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const einheiten = useQuery({
    queryKey: ['einheiten', einsatzId],
    queryFn: () => listeEinheiten(einsatzId),
  });

  const namen = new Set<string>();
  for (const f of fahrzeuge.data ?? []) {
    namen.add(f.opta ? `${f.funkrufname} (${f.opta})` : f.funkrufname);
  }
  for (const e of einheiten.data ?? []) {
    if (e.name) namen.add(e.name);
  }
  return [...namen].sort((a, b) => a.localeCompare(b, 'de'));
}
