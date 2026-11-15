import { useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';
import { isUebung } from './einsatzart';
import { leseLetztenOrt, type LetzterOrt } from './letzterOrt';

export interface EinsatzRueckweg {
  label: string;
  pfad: string;
  /** Der Einsatz ist eine Übung: der Knopf trägt die Übungsmarke (LLH-1725). */
  uebung?: boolean;
}

/**
 * Der Rückweg „Zurück zu <Einsatz>“ an die zuletzt geöffnete Stelle (LFH-954, Spec
 * `seiten-orientierung`; LLH-1731 D1). Eine Quelle für die Seiten der Ebene 1 (`AppLayout`) und
 * die Hilfe, damit die Bedingung an einer Stelle steht: nur, wenn der zuletzt offene Einsatz der
 * Person in ihrer Liste steht und aktiv ist. Der Name kommt aus der Liste, nicht aus dem Speicher.
 *
 * `isAktiv` sagt, ob die Seite überhaupt einen Rückweg trägt; ohne ihn, ohne Person und ohne
 * gemerkten Ort wird die Liste nicht abgerufen (derselbe Key wie im Einsatzwechsler).
 *
 * `isJeBesuchFest` (die Hilfe, Review B5 zu LLH-1731): der Ort wird einmal je Besuch gelesen und
 * bleibt, auch wenn ein anderer Tab inzwischen einen neuen merkt. Ohne die Option wird er je
 * Adresse neu gelesen, wie auf den Seiten der Ebene 1.
 */
export function useEinsatzRueckweg(
  benutzerId: number | undefined,
  isAktiv: boolean,
  { isJeBesuchFest = false }: { isJeBesuchFest?: boolean } = {},
): EinsatzRueckweg | undefined {
  const { pathname } = useLocation();
  // Der feste Ort je Person; ein Personenwechsel liest neu (Spec: kein Rückweg der vorigen Person).
  const fest = useRef<{ benutzerId: number; ort: LetzterOrt | null } | null>(null);
  // Je Adresse neu gelesen: die Person kann zwischendurch in einem anderen Tab im Einsatz sein.
  const letzter = useMemo(() => {
    if (benutzerId == null || !isAktiv) return null;
    if (isJeBesuchFest && fest.current?.benutzerId === benutzerId) return fest.current.ort;
    const ort = leseLetztenOrt(benutzerId);
    if (isJeBesuchFest) fest.current = { benutzerId, ort };
    return ort;
    // `pathname` ist der Anlass zum Neulesen, kein Eingang der Rechnung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benutzerId, isAktiv, isJeBesuchFest, pathname]);
  const { data: einsaetze } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
    enabled: letzter != null,
  });
  if (!letzter) return undefined;
  const einsatz = einsaetze?.find((e) => e.id === letzter.einsatzId);
  return einsatz && einsatz.status === 'aktiv'
    ? {
        label: `Zurück zu ${einsatz.bezeichnung}`,
        pfad: letzter.pfad,
        ...(isUebung(einsatz) ? { uebung: true } : {}),
      }
    : undefined;
}
