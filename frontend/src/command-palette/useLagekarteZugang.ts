import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinstellungen, ladeModulFreigaben } from '../api/einsaetze';
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
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId!),
    enabled: aktiv && einsatzId != null,
    staleTime: FRISCH_MS,
  });
  const einstellungenQuery = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId ?? 0),
    queryFn: () => ladeEinstellungen(einsatzId!),
    enabled: aktiv && einsatzId != null,
    staleTime: FRISCH_MS,
  });

  // Die Freigaben des Servers entscheiden (LFH-669, Spec `modul-freigabe`). Nach einem
  // Fehlschlag sind sie unbekannt, und `istModulFreigegeben` gibt Unbekanntes nicht frei: kein
  // Sprung, bis ein Neuabruf gelingt.
  let frei: boolean | null = null;
  if (freigabenQuery.isFetched) {
    const lagekarte = modulRegistry.find((m) => m.key === 'lagekarte');
    frei = !!lagekarte && istModulFreigegeben(lagekarte, freigabenQuery.data);
  }
  return {
    frei,
    einsatzFormat: einstellungenQuery.data?.koordinatenformat,
    orgFormat: einstellungenQuery.data?.org_defaults?.koordinatenformat,
  };
}
