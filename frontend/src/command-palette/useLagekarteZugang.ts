import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinstellungen, ladeModulOverrides } from '../api/einsaetze';
import { istModulFreigegeben, modulRegistry } from '../einsatz/modulRegistry';
import type { Koordinatenformat } from '../api/types';

/** Frische wie beim Datensatz-Finder: die Fächer hängen am SSE-Fan-out. */
const FRISCH_MS = 60_000;

/**
 * Darf die Palette auf die Lagekarte springen? Geteilt von Koordinatensprung und Adresssuche
 * (LFH-638), damit beide dieselbe Rechteprüfung tragen.
 *
 * LAZY wie `useDatensaetze`: abgefragt wird erst, wenn `aktiv` (der Aufrufer weiß, ob die Eingabe
 * eine Zeile verlangt). Die Einsatz-Einstellungen holt der Hook selbst, weil die Palette außerhalb
 * des `EinsatzAnzeigeProvider` hängt; das Fach füllt `EinsatzLayout` ohnehin.
 */
export function useLagekarteZugang(
  einsatzId: number | null,
  aktiv: boolean,
): {
  /** `null`, solange die Rechte nicht bekannt sind — dann bietet die Palette nichts an. */
  frei: boolean | null;
  einsatzFormat: Koordinatenformat | null | undefined;
  orgFormat: Koordinatenformat | null | undefined;
} {
  const { benutzer } = useAuth();
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: aktiv && einsatzId != null,
    staleTime: FRISCH_MS,
  });
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId ?? 0),
    queryFn: () => ladeEinstellungen(einsatzId!),
    enabled: aktiv && einsatzId != null,
    staleTime: FRISCH_MS,
  });

  // `isFetched` statt `isSuccess`, wie beim Datensatz-Finder: ein Fehlschlag legt den Sprung
  // nicht dauerhaft still, dann gilt der Registry-Default.
  let frei: boolean | null = null;
  if (overridesQuery.isFetched) {
    const lagekarte = modulRegistry.find((m) => m.key === 'lagekarte');
    frei = !!lagekarte && istModulFreigegeben(lagekarte, benutzer, overridesQuery.data);
  }
  return {
    frei,
    einsatzFormat: einstellungenQuery.data?.koordinatenformat,
    orgFormat: einstellungenQuery.data?.org_defaults?.koordinatenformat,
  };
}
