import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAuthOptional } from '../auth/AuthContext';
import { darfOriginalLaden } from './schreibrecht';

/**
 * Ob der angemeldete Benutzer in diesem Einsatz Originale von Bild-Anhängen laden darf (LFH-747).
 *
 * Liest den Einsatz nur aus dem Cache (`enabled: false` schaltet das Nachladen ab, nicht die
 * Auslieferung): `EinsatzLayout` hält ihn auf jeder Einsatzseite geladen. Fehlt er doch, ist die
 * Antwort `false` — dann steht nur der bereinigte Download da, nie ein Verweis, der mit 403
 * endet. Ohne `AuthProvider` (Testflächen) ebenso `false`.
 */
export function useDarfOriginalLaden(einsatzId: number): boolean {
  const auth = useAuthOptional();
  const { data } = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: false,
  });
  return darfOriginalLaden(data, auth?.benutzer);
}
