import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAuthOptional } from '../auth/AuthContext';
import { darfOriginalLaden } from './schreibrecht';

/**
 * Ob der angemeldete Benutzer in diesem Einsatz Originale von Bild-Anhängen laden darf (LFH-747).
 *
 * Liest den Einsatz nur aus dem Cache (`enabled: false` schaltet das Nachladen ab, nicht die
 * Auslieferung): `EinsatzLayout` hält ihn auf jeder Einsatzseite geladen. Fehlt er, entscheidet
 * nur noch die System-Rolle: der System-Admin sieht den Verweis, alle anderen nicht. Ein Admin
 * einer fremden Org sieht ihn ebenfalls und bekommt beim Abruf 403 — die Org-Grenze zieht nur
 * der Server (design.md D8). Ohne `AuthProvider` (Testflächen) ist die Antwort `false`.
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
