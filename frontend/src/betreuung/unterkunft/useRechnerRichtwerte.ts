import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { einsatzKeys } from '../../api/queryKeys';
import type { UnterkunftRichtwerte } from '../../api/types';
import { ladeEinsatzUnterkunftRichtwerte } from '../../api/unterkunftRichtwerte';
import { basisRichtwerte, type Richtwerte } from './richtwerte';

export interface RechnerRichtwerte {
  /** Wirksame Werte, Schlüssel → Zahl; ohne geladene Einsatz-Werte die Basis. */
  richtwerte: Richtwerte;
  /** Alle Ebenen je Schlüssel, sobald geladen (auch aus dem Lagebild ohne Netz). */
  ebenen: UnterkunftRichtwerte | undefined;
  /** `basis`, solange keine Einsatz-Werte vorliegen: die Seite rechnet dann mit der Basis. */
  quelle: 'einsatz' | 'basis';
  laedt: boolean;
}

/** Wirksame Werte aus der Antwort der Einsatz-Route. */
export function wirksameRichtwerte(antwort: UnterkunftRichtwerte | undefined): Richtwerte {
  const rw = basisRichtwerte();
  for (const w of antwort?.werte ?? []) {
    if (w.schluessel in rw) rw[w.schluessel] = w.wert;
  }
  return rw;
}

/**
 * Richtwerte des Rechners im Einsatz (LLH-1520, design.md D2): die Einsatz-Fassung trägt Basis,
 * Organisation und Einsatz. Der Key liegt unter den Einstellungen und damit im Lagebild ohne Netz;
 * ohne je geladene Werte rechnet die Seite mit der Basis aus dem Bundle.
 */
export function useRechnerRichtwerte(einsatzId: number): RechnerRichtwerte {
  const query = useQuery({
    queryKey: einsatzKeys.unterkunftRichtwerte(einsatzId),
    queryFn: () => ladeEinsatzUnterkunftRichtwerte(einsatzId),
  });
  const richtwerte = useMemo(() => wirksameRichtwerte(query.data), [query.data]);
  return {
    richtwerte,
    ebenen: query.data,
    quelle: query.data ? 'einsatz' : 'basis',
    laedt: query.isLoading,
  };
}
