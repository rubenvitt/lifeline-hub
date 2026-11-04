import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { istSprungGesperrt } from './modulRegistry';

/**
 * Die Modulfreigaben aus dem Cache, den der Einsatzrahmen ohnehin füllt — kein zweiter Abruf.
 * `undefined`, solange sie laden oder gescheitert sind. Für Stellen, die ein Ziel erst aus Daten
 * bauen (`istPfadGesperrt`); sonst {@link useSprungSperre}.
 */
export function useModulFreigaben(einsatzId: number): ModulFreigaben | undefined {
  return useModulFreigabenStand(einsatzId).freigaben;
}

/**
 * {@link useModulFreigaben} samt Fehlerzweig (LLH-1462): Eine Seite, die ihre Nachbarlisten erst
 * mit bekannter Freigabe abfragt, stünde sonst bei gescheiterten Freigaben für immer im Laden.
 * `gescheitert` gilt nur ohne Daten; ein alter Stand im Cache bleibt maßgeblich.
 */
export function useModulFreigabenStand(einsatzId: number): {
  freigaben: ModulFreigaben | undefined;
  gescheitert: boolean;
  wiederholen: () => void;
} {
  const query = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
    // Eine verbogene Routen-ID (LFH-438) fragt nichts ab: die Seite leitet ohnehin um, und ein
    // Abruf gegen `/api/einsaetze/NaN/…` wäre Rauschen.
    enabled: Number.isInteger(einsatzId) && einsatzId > 0,
  });
  const { refetch } = query;
  const wiederholen = useCallback(() => void refetch(), [refetch]);
  return {
    freigaben: query.data,
    gescheitert: query.isError && query.data === undefined,
    wiederholen,
  };
}

/**
 * Sprung-Sperre einer Seite (LFH-888, Spec `modul-freigabe`): `(key) => boolean`, ob ein
 * Bedienelement in das Modul `key` gesperrt steht. Lesart {@link istSprungGesperrt}: unbekannt
 * heißt offen. Seiten, die die Freigaben schon selbst laden, nehmen `istSprungGesperrt` direkt.
 */
export function useSprungSperre(einsatzId: number): (key: string) => boolean {
  const freigaben = useModulFreigaben(einsatzId);
  return useCallback((key: string) => istSprungGesperrt(key, freigaben), [freigaben]);
}
