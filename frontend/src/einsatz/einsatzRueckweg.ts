import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';
import { leseLetztenOrt } from './letzterOrt';

export interface EinsatzRueckweg {
  label: string;
  pfad: string;
}

/**
 * Der Rückweg „Zurück zu <Einsatz>“ an die zuletzt geöffnete Stelle (LFH-954, Spec
 * `seiten-orientierung`; LLH-1731 D1). Eine Quelle für die Seiten der Ebene 1 (`AppLayout`) und
 * die Hilfe, damit die Bedingung an einer Stelle steht: nur, wenn der zuletzt offene Einsatz der
 * Person in ihrer Liste steht und aktiv ist. Der Name kommt aus der Liste, nicht aus dem Speicher.
 *
 * `isAktiv` sagt, ob die Seite überhaupt einen Rückweg trägt; ohne ihn, ohne Person und ohne
 * gemerkten Ort wird die Liste nicht abgerufen (derselbe Key wie im Einsatzwechsler).
 */
export function useEinsatzRueckweg(
  benutzerId: number | undefined,
  isAktiv: boolean,
): EinsatzRueckweg | undefined {
  const { pathname } = useLocation();
  // Je Adresse neu gelesen: die Person kann zwischendurch in einem anderen Tab im Einsatz sein.
  const letzter = useMemo(
    () => (benutzerId == null || !isAktiv ? null : leseLetztenOrt(benutzerId)),
    // `pathname` ist der Anlass zum Neulesen, kein Eingang der Rechnung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [benutzerId, isAktiv, pathname],
  );
  const { data: einsaetze } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
    enabled: letzter != null,
  });
  if (!letzter) return undefined;
  const einsatz = einsaetze?.find((e) => e.id === letzter.einsatzId);
  return einsatz && einsatz.status === 'aktiv'
    ? { label: `Zurück zu ${einsatz.bezeichnung}`, pfad: letzter.pfad }
    : undefined;
}
