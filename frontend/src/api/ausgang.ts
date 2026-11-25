import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiSend } from './client';
import { einsatzKeys } from './queryKeys';
import type { AusgangFehler, QuelleArt, SendenAnfrage, Versand } from './types';

/**
 * Ausgang per E-Mail (LLH-2093): Versand eines freigegebenen Lageberichts, Befehls oder einer
 * Nachforderung. Die Routen hängen am Dokument, die Liste und das Wiederholen am Einsatz.
 */

const QUELLE_SEGMENT: Record<QuelleArt, string> = {
  lagebericht: 'situation-reports',
  befehl: 'orders',
  nachforderung: 'resource-requests',
};

export interface QuelleFilter {
  kind: QuelleArt;
  id: number;
}

/** Wortlaut je `AusgangFehler` (Code in `Versand.error` und im `grund` einer 422-Antwort). */
export const AUSGANG_FEHLER_TEXT: Record<AusgangFehler, string> = {
  voruebergehend: 'Mailserver vorübergehend nicht erreichbar',
  abgelehnt: 'Vom Mailserver abgelehnt',
  ungewiss: 'Zustellung unklar',
  ueberholt: 'Neuere Fassung freigegeben',
  anbindung_fehlt: 'Kein Mailserver eingerichtet',
  anbindung_angehalten: 'Mailanbindung angehalten',
  anbindung_fehler: 'Mailanbindung fehlerhaft eingerichtet',
  zu_gross: 'Anhänge zu groß für eine Mail',
  spiegel: 'Einsatz wird von einer anderen Instanz geführt',
  nicht_zugestellt: 'Fax nicht zugestellt',
};

/** Text zu einem Code; ein unbekannter Code (neuerer Server) bleibt sichtbar statt zu verschwinden. */
export function ausgangFehlerText(code: string | null | undefined): string | null {
  if (!code) return null;
  return (AUSGANG_FEHLER_TEXT as Record<string, string>)[code] ?? code;
}

/**
 * Eine Ablehnung des Servers mit bekanntem `grund` trägt den Wortlaut der Oberfläche statt des
 * Servertextes („Kein Mailserver eingerichtet“); alles andere bleibt, wie es ist.
 */
export function versandFehler(fehler: unknown): unknown {
  if (fehler instanceof ApiError && fehler.grund && fehler.grund in AUSGANG_FEHLER_TEXT) {
    return new ApiError(fehler.status, AUSGANG_FEHLER_TEXT[fehler.grund as AusgangFehler], {
      grund: fehler.grund,
      vomAnwendungsserver: fehler.vomAnwendungsserver,
    });
  }
  return fehler;
}

export function fetchVersaende(einsatzId: number, quelle: QuelleFilter): Promise<Versand[]> {
  return apiGet<Versand[]>(
    `/api/incidents/${einsatzId}/deliveries?source_kind=${quelle.kind}&source_id=${quelle.id}`,
  );
}

/** Alle Versände einer Quellart im Einsatz: ein Abruf für ein ganzes Board. */
export function fetchVersaendeArt(einsatzId: number, kind: QuelleArt): Promise<Versand[]> {
  return apiGet<Versand[]>(`/api/incidents/${einsatzId}/deliveries?source_kind=${kind}`);
}

export function createVersaende(
  einsatzId: number,
  quelle: QuelleFilter,
  body: SendenAnfrage,
): Promise<Versand[]> {
  return apiSend<Versand[]>(
    `/api/incidents/${einsatzId}/${QUELLE_SEGMENT[quelle.kind]}/${quelle.id}/deliveries`,
    'POST',
    body,
  );
}

export function retryVersand(einsatzId: number, versandId: string): Promise<Versand> {
  return apiSend<Versand>(`/api/incidents/${einsatzId}/deliveries/${versandId}/retry`, 'POST');
}

/**
 * Schreiben nur mit Netz, ohne Warteschlange (`frontend/src/offline/AGENTS.md`, „Schreiben ohne
 * Netz“): eine Mail wird nie vorgemerkt, die Maske sperrt den Knopf ohne Netz.
 */
const SOFORT_ODER_NIE = { networkMode: 'always' } as const;

/**
 * Versände einer Quelle; live über das Ereignis `ausgang`. Nicht in `LAGEBILD_OFFLINE`.
 * Nachforderungen stehen als Karten im Board: dort holt ein Abruf je Einsatz alle Versände der Art
 * und jede Karte filtert ihre heraus (statt eines Abrufs je Karte).
 */
export function useVersaende(einsatzId: number, quelle: QuelleFilter) {
  const proArt = quelle.kind === 'nachforderung';
  return useQuery({
    queryKey: proArt
      ? einsatzKeys.deliveriesArt(einsatzId, quelle.kind)
      : einsatzKeys.deliveries(einsatzId, quelle.kind, quelle.id),
    queryFn: () =>
      proArt ? fetchVersaendeArt(einsatzId, quelle.kind) : fetchVersaende(einsatzId, quelle),
    select: proArt ? (alle: Versand[]) => alle.filter((v) => v.source_id === quelle.id) : undefined,
    // Ohne Leserecht am Quellmodul antwortet der Server 403; die Liste bleibt dann weg.
    retry: false,
  });
}

export function useSendeVersaende(einsatzId: number, quelle: QuelleFilter) {
  const qc = useQueryClient();
  return useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (body: SendenAnfrage) => createVersaende(einsatzId, quelle, body),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: einsatzKeys.deliveriesArt(einsatzId, quelle.kind),
      }),
  });
}

export function useWiederholeVersand(einsatzId: number, quelle: QuelleFilter) {
  const qc = useQueryClient();
  return useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (versandId: string) => retryVersand(einsatzId, versandId),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: einsatzKeys.deliveriesArt(einsatzId, quelle.kind),
      }),
  });
}
