import { useQuery } from '@tanstack/react-query';
import { ladeModulFreigaben } from '../api/incidents';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { freiesRueckwegModul, modulZielRoute, redirectZiel } from './modulRegistry';

/**
 * Route des Rückwegs „in den Überblick“ aus einer Seite, die im Einsatz nicht steht: die
 * Auffangseite einer unbekannten Adresse (LLH-1729) und die Fehlergrenze (LLH-1822, Change
 * `a12ms7g9-seitenzustaende`, D2). Der Überblick, ist er gesperrt, das erste freie Modul
 * (`freiesRueckwegModul` ohne das Standardmodul des Einsatzes, anders als Modulwächter und
 * `ModulStub`: der Auftrag nennt den Überblick). Ohne Freigaben (Abruf gescheitert, offline) der
 * feste Einstieg: ein Rückweg ist besser als keiner, und die Zielseite meldet eine Sperre selbst.
 */
export function ueberblickRueckwegRoute(freigaben: ModulFreigaben | undefined): string {
  return freigaben ? modulZielRoute(freiesRueckwegModul(freigaben)) : redirectZiel();
}

/**
 * {@link ueberblickRueckwegRoute} über die Modulfreigaben des Einsatzes (derselbe Schlüssel wie
 * im Rahmen, also meist schon im Speicher). `null`, solange die Freigaben laden oder die Adresse
 * keine Einsatzkennung trägt.
 */
export function useUeberblickRueckweg(einsatzId: number | null): string | null {
  const freigabenQ = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId ?? 0),
    queryFn: () => ladeModulFreigaben(einsatzId!),
    enabled: einsatzId !== null,
  });
  if (einsatzId === null || freigabenQ.isLoading) return null;
  return ueberblickRueckwegRoute(freigabenQ.data);
}
