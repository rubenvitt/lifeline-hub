import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, apiSend } from './client';
import { einsatzKeys } from './queryKeys';
import type { AusgangFehler, KanalArt, QuelleArt, SendenAnfrage, Versand } from './types';

/**
 * Ausgang per E-Mail (LLH-2093), Fax (LLH-2095), Matrix (LLH-2094) und Threema (LLH-2096): Versand eines freigegebenen
 * Lageberichts, Befehls oder einer Nachforderung. Die Routen hängen am Dokument, die Liste und das
 * Wiederholen am Einsatz.
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

/** Kanäle, die der Ausgang bedient. */
export type AusgangKanal = 'email' | 'fax' | 'matrix' | 'threema';

/** Ein Kanal der Wire-Art; ohne Angabe spricht der Wortlaut der E-Mail. */
export function ausgangKanal(kanal: KanalArt | null | undefined): AusgangKanal {
  return kanal ?? 'email';
}

/**
 * Wortlaut je `AusgangFehler` und Kanal (Code in `Versand.error` und im `grund` einer
 * 422-Antwort). Die `anbindung_*`-Texte der Matrix entsprechen den Meldungen des Servers
 * (`src/routes/ausgang.rs`, `meldung_anbindung`); beim Fax nennt der Wortlaut sipgate (LLH-2095).
 */
export const AUSGANG_FEHLER_TEXT: Record<AusgangKanal, Record<AusgangFehler, string>> = {
  email: {
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
    kein_zutritt: 'Kein Zutritt zum Raum',
    verschluesselung: 'Verschlüsseln nicht möglich',
  },
  fax: {
    voruebergehend: 'sipgate vorübergehend nicht erreichbar',
    abgelehnt: 'Von sipgate abgelehnt',
    ungewiss: 'Zustellung nicht bestätigt',
    ueberholt: 'Neuere Fassung freigegeben',
    anbindung_fehlt: 'Kein Faxzugang eingerichtet',
    anbindung_angehalten: 'Faxzugang angehalten',
    anbindung_fehler: 'Faxzugang fehlerhaft eingerichtet',
    zu_gross: 'Fax zu lang (höchstens 30 Seiten)',
    spiegel: 'Einsatz wird von einer anderen Instanz geführt',
    nicht_zugestellt: 'Fax nicht zugestellt',
    kein_zutritt: 'Kein Zutritt zum Raum',
    verschluesselung: 'Verschlüsseln nicht möglich',
  },
  matrix: {
    voruebergehend: 'Matrix-Server vorübergehend nicht erreichbar',
    abgelehnt: 'Vom Matrix-Server abgelehnt',
    ungewiss: 'Zustellung unklar',
    ueberholt: 'Neuere Fassung freigegeben',
    anbindung_fehlt: 'Kein Matrix-Konto eingerichtet',
    anbindung_angehalten: 'Das Matrix-Konto ist angehalten',
    anbindung_fehler: 'Das Matrix-Konto ist nicht nutzbar; Einstellungen prüfen',
    zu_gross: 'Anhänge zu groß für den Matrix-Server',
    spiegel: 'Einsatz wird von einer anderen Instanz geführt',
    nicht_zugestellt: 'Nicht zugestellt',
    kein_zutritt: 'Kein Zutritt zum Raum',
    verschluesselung: 'Verschlüsseln nicht möglich',
  },
  threema: {
    voruebergehend: 'Threema vorübergehend nicht erreichbar',
    abgelehnt: 'Von Threema abgelehnt',
    ungewiss: 'Zustellung unklar',
    ueberholt: 'Neuere Fassung freigegeben',
    anbindung_fehlt: 'Kein Threema-Gateway eingerichtet',
    anbindung_angehalten: 'Das Threema-Gateway ist angehalten',
    anbindung_fehler: 'Das Threema-Gateway ist nicht nutzbar; Einstellungen prüfen',
    zu_gross: 'Anlage zu groß für Threema',
    spiegel: 'Einsatz wird von einer anderen Instanz geführt',
    nicht_zugestellt: 'Nicht zugestellt',
    kein_zutritt: 'Kein Zutritt zum Raum',
    verschluesselung: 'Verschlüsseln nicht möglich',
  },
};

/** Text zu einem Code; ein unbekannter Code (neuerer Server) bleibt sichtbar statt zu verschwinden. */
export function ausgangFehlerText(
  code: string | null | undefined,
  kanal: AusgangKanal,
): string | null {
  if (!code) return null;
  return (AUSGANG_FEHLER_TEXT[kanal] as Record<string, string>)[code] ?? code;
}

/** Gründe, die auf ein fehlendes, angehaltenes oder gestörtes Konto des Kanals deuten. */
export const ANBINDUNG_GRUENDE: ReadonlySet<string> = new Set([
  'anbindung_fehlt',
  'anbindung_angehalten',
  'anbindung_fehler',
]);

/**
 * Die Kanäle, auf die sich eine 422 mit `anbindung_*` bezieht. Sie folgen den gesendeten
 * Adressen: nur ein Kanal → dieser. Sonst nennt der Server in einer Ablehnung jeden Kanal ohne
 * nutzbare Anbindung (`src/routes/ausgang.rs`, `meldung_anbindung`, mit „; “ verbunden, LLH-2096);
 * ohne Hinweis auf Matrix, Threema oder Fax gilt die E-Mail.
 */
export function anbindungKanaele(
  fehler: unknown,
  gesendet?: readonly KanalArt[],
): AusgangKanal[] {
  const arten = new Set((gesendet ?? []).map(ausgangKanal));
  if (arten.size === 1) return [...arten];
  if (!(fehler instanceof ApiError)) return ['email'];
  const genannt: AusgangKanal[] = [];
  if (/Matrix/.test(fehler.message)) genannt.push('matrix');
  if (/Threema/.test(fehler.message)) genannt.push('threema');
  if (/Fax/.test(fehler.message)) genannt.push('fax');
  if (/Mailserver/.test(fehler.message)) genannt.push('email');
  return genannt.length > 0 ? genannt : ['email'];
}

/**
 * Eine Ablehnung des Servers mit bekanntem `grund` trägt den Wortlaut der Oberfläche statt des
 * Servertextes („Kein Mailserver eingerichtet“); alles andere bleibt, wie es ist. Der Kanal
 * einer `anbindung_*` folgt den gesendeten Adressen (`anbindungKanaele`), sonst gilt die E-Mail.
 * Bei „zu groß“ bleibt der Text des Servers, denn nur er weiß, ob Mail oder Fax es auslöste
 * (LLH-2095).
 */
export function versandFehler(fehler: unknown, gesendet?: readonly KanalArt[]): unknown {
  if (
    fehler instanceof ApiError &&
    fehler.grund === 'zu_gross' &&
    fehler.vomAnwendungsserver &&
    fehler.message
  ) {
    return fehler;
  }
  if (fehler instanceof ApiError && fehler.grund && fehler.grund in AUSGANG_FEHLER_TEXT.email) {
    const kanaele = ANBINDUNG_GRUENDE.has(fehler.grund)
      ? anbindungKanaele(fehler, gesendet)
      : (['email'] as AusgangKanal[]);
    const text = kanaele
      .map((k) => AUSGANG_FEHLER_TEXT[k][fehler.grund as AusgangFehler])
      .join('; ');
    return new ApiError(fehler.status, text, {
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
