// Drohnenquellen eines Einsatzes (LLH-2106): welche Quellen der Org es gibt, ob sie hier
// zugeschaltet sind und wer sie sonst hält. Die Lage selbst kommt als Fachebene
// (`loadDrohneFachebene` in `fachebenen.ts`). Response-Typen sind Re-Exporte der aus Rust
// generierten Schemas.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend } from './client';
import { globalKeys } from './queryKeys';
import type { components } from './types.generated';

type S = components['schemas'];

/** Rust: `DroneSourceView` — eine Drohnenquelle der Org, gesehen aus einem Einsatz. */
export type DroneSourceView = S['DroneSourceView'];

/** Wie oft die Zeile in der Leiste Zustand und Mission neu liest. */
const QUELLEN_TAKT_MS = 10_000;

const basis = (einsatzId: number, adapterId: string) =>
  `/api/incidents/${einsatzId}/drone/sources/${encodeURIComponent(adapterId)}`;

/** `GET /api/incidents/{id}/drone/sources` — die Drohnenquellen der Org. */
export function loadDrohnenQuellen(einsatzId: number): Promise<DroneSourceView[]> {
  return apiGet<DroneSourceView[]>(`/api/incidents/${einsatzId}/drone/sources`);
}

/** `PUT …/drone/sources/{aid}` — zuschalten oder die Lagemonitor-Wahl ändern (Einsatzleitung). */
export function schalteDrohnenQuelleZu(
  einsatzId: number,
  adapterId: string,
  lagemonitor: boolean,
): Promise<DroneSourceView> {
  return apiSend<DroneSourceView>(basis(einsatzId, adapterId), 'PUT', { lagemonitor });
}

/** `DELETE …/drone/sources/{aid}` — abschalten (Einsatzleitung). */
export function schalteDrohnenQuelleAb(einsatzId: number, adapterId: string): Promise<void> {
  return apiSend<void>(basis(einsatzId, adapterId), 'DELETE');
}

/** Die Drohnenquellen der Org mit Zustand je Einsatz; ein leiser Takt hält Mission und Halter frisch. */
export function useDrohnenQuellen(einsatzId: number) {
  return useQuery({
    queryKey: globalKeys.drohnenQuellen(einsatzId),
    queryFn: () => loadDrohnenQuellen(einsatzId),
    refetchInterval: QUELLEN_TAKT_MS,
  });
}

/** Nach jedem Schreiben (auch einem abgelehnten): Quellen und Ebene neu lesen. */
function useNachSchalten(einsatzId: number) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: globalKeys.drohnenQuellen(einsatzId) }),
      qc.invalidateQueries({ queryKey: globalKeys.fachebeneDrohne(einsatzId) }),
    ]);
}

/** Schaltet eine Quelle zu — `409`, wenn ein anderer laufender Einsatz sie hält. */
export function useZuschalten(einsatzId: number) {
  const nachher = useNachSchalten(einsatzId);
  return useMutation({
    mutationFn: ({ adapterId, lagemonitor }: { adapterId: string; lagemonitor: boolean }) =>
      schalteDrohnenQuelleZu(einsatzId, adapterId, lagemonitor),
    onSettled: nachher,
  });
}

/** Schaltet eine Quelle ab. */
export function useAbschalten(einsatzId: number) {
  const nachher = useNachSchalten(einsatzId);
  return useMutation({
    mutationFn: (adapterId: string) => schalteDrohnenQuelleAb(einsatzId, adapterId),
    onSettled: nachher,
  });
}
