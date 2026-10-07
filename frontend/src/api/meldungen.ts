import { apiGet, apiSend, type ApiSendOptionen, mitParametern } from './client';
import type {
  LageMeldung,
  Meldung,
  MeldungKennzahlen,
  MeldungStatus,
  NeueMeldung,
  NeuerAuftrag,
  Rueckmeldungen,
} from './types';

interface MeldungFilter {
  status?: string;
  richtung?: string;
}

/** Vollliste ohne Phase (Sprungpalette, Chat-Bezug, Geräteseite, Übernahme); die Meldungsseite
 *  liest getrennt nach Phase. */
export function listeMeldungen(einsatzId: number, filter: MeldungFilter = {}): Promise<Meldung[]> {
  return apiGet<Meldung[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/meldungen`, {
      status: filter.status,
      richtung: filter.richtung,
    }),
  );
}

/** Seitengröße der abgeschlossenen Meldungen; der Server klemmt auf `[1, 500]` (LFH-940). */
export const MELDUNGEN_SEITE = 100;

/** Position hinter dem letzten geladenen abgeschlossenen Eintrag (`vor_zeit`, `vor_id`);
 *  Meldungen und Erinnerungen blättern gleich (LFH-940). */
export interface AbschlussCursor {
  zeit: string;
  id: number;
}

/** Cursor aus einer Meldung: dieselbe Ordnungszeit wie am Server,
 *  `COALESCE(erledigt_at, ereigniszeit)` (Altbestand ohne Stempel). */
export function abschlussCursor(m: Meldung): AbschlussCursor {
  return { zeit: m.erledigt_at ?? m.ereigniszeit, id: m.id };
}

/** Alle offenen Meldungen in der Triage-Ordnung des Servers, ungeblättert (LFH-940). */
export function listeOffeneMeldungen(einsatzId: number, richtung?: string): Promise<Meldung[]> {
  return apiGet<Meldung[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/meldungen`, { phase: 'offen', richtung }),
  );
}

/** Eine Seite abgeschlossener Meldungen, zuletzt erledigte zuerst (LFH-940). */
export function listeAbgeschlosseneMeldungen(
  einsatzId: number,
  richtung?: string,
  vor?: AbschlussCursor,
  limit: number = MELDUNGEN_SEITE,
): Promise<Meldung[]> {
  return apiGet<Meldung[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/meldungen`, {
      phase: 'abgeschlossen',
      richtung,
      vor_zeit: vor?.zeit,
      vor_id: vor?.id,
      limit,
    }),
  );
}

/** Zahlen der Meldungsseite über den ganzen Bestand (LFH-940): ein Abruf statt der Vollliste. */
export function ladeMeldungKennzahlen(
  einsatzId: number,
  richtung?: string,
): Promise<MeldungKennzahlen> {
  return apiGet<MeldungKennzahlen>(
    mitParametern(`/api/einsaetze/${einsatzId}/meldungen/kennzahlen`, { richtung }),
  );
}

/** Eine Meldung einzeln, etwa für einen Deeplink auf eine nicht geladene Seite (LFH-940). */
export function ladeMeldung(einsatzId: number, meldungId: number): Promise<Meldung> {
  return apiGet<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}`);
}

/** Letzte Rückmeldung je Einheit/Abschnitt samt Frist (LFH-610). Lesezugriff Meldungen. */
export function holeRueckmeldungen(einsatzId: number): Promise<Rueckmeldungen> {
  return apiGet<Rueckmeldungen>(`/api/einsaetze/${einsatzId}/meldungen/rueckmeldungen`);
}

export function legeMeldungAn(
  einsatzId: number,
  daten: NeueMeldung,
  optionen?: ApiSendOptionen,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen`, 'POST', daten, optionen);
}

/** Triage-Status setzen (sichten/in Bearbeitung/erledigt) (LFH-94). */
export function setzeMeldungStatus(
  einsatzId: number,
  meldungId: number,
  status: MeldungStatus,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/status`, 'POST', {
    status,
  });
}

/** Bearbeiter zuweisen (Mitglied-id) oder freigeben (null) (LFH-94). */
export function weiseBearbeiterZu(
  einsatzId: number,
  meldungId: number,
  bearbeiterId: number | null,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/zuweisen`, 'POST', {
    bearbeiter_id: bearbeiterId,
  });
}

/** Sofortmeldung aktiv bestätigen (Quittung mit Zeitstempel + Person) (LFH-97). */
export function bestaetigeMeldung(einsatzId: number, meldungId: number): Promise<Meldung> {
  return apiSend<Meldung>(
    `/api/einsaetze/${einsatzId}/meldungen/${meldungId}/bestaetigen`,
    'POST',
    {},
  );
}

/** Als lagerelevant an die Lage übergeben (LFH-95).
 *  Optional direkt verorten (LFH-113): lat/lon nur gemeinsam — das Backend persistiert die
 *  Koordinate beim erstmaligen Übergeben (INSERT). Re-Verorten bestehender Lageobjekte ist
 *  bewusst kein Pfad (Übergabe-Aktion ist einmalig, siehe MeldungListe). */
export function markiereLagerelevant(
  einsatzId: number,
  meldungId: number,
  daten: { text?: string; lat?: number; lon?: number } = {},
): Promise<Meldung> {
  return apiSend<Meldung>(
    `/api/einsaetze/${einsatzId}/meldungen/${meldungId}/lagerelevant`,
    'POST',
    daten,
  );
}

/** Aus einer eingegangenen Meldung direkt einen Auftrag erteilen (Meldung→Auftrag, LFH-113).
 *  Legt den Auftrag an und setzt `meldung.auftrag_id`; liefert die markierte Meldung zurück. */
export function erteileAuftragAusMeldung(
  einsatzId: number,
  meldungId: number,
  daten: NeuerAuftrag,
): Promise<Meldung> {
  return apiSend<Meldung>(
    `/api/einsaetze/${einsatzId}/meldungen/${meldungId}/auftrag`,
    'POST',
    daten,
  );
}

/** Lageobjekte (aus lagerelevanten Meldungen) listen (LFH-95, Lage-Kategorie). */
export function listeLageMeldungen(einsatzId: number): Promise<LageMeldung[]> {
  return apiGet<LageMeldung[]>(`/api/einsaetze/${einsatzId}/lage/meldungen`);
}
