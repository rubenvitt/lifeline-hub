import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { istSprungGesperrt } from './modulRegistry';

/**
 * Sprung-Sperre einer Seite (LFH-888, Spec `modul-freigabe`): `(key) => boolean`, ob ein
 * Bedienelement in das Modul `key` gesperrt steht. Liest den Cache der Freigaben, den der
 * Einsatzrahmen ohnehin füllt — kein zweiter Abruf. Lesart {@link istSprungGesperrt}: unbekannt
 * heißt offen. Seiten, die die Freigaben schon selbst laden, nehmen `istSprungGesperrt` direkt.
 */
export function useSprungSperre(einsatzId: number): (key: string) => boolean {
  const { data: freigaben } = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  return useCallback((key: string) => istSprungGesperrt(key, freigaben), [freigaben]);
}
