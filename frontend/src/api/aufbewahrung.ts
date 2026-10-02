import type {
  ArchivAkte,
  ArchivEtbEintrag,
  AufbewahrungEintrag,
  EinsatzAnzeige,
  EtbTyp,
  FristSetzenBody,
  NeuerSchwaerzungsantrag,
  PersonTreffer,
  Schwaerzungsantrag,
  WiederherstellenBody,
} from './types';
import { apiGet, apiSend, mitParametern } from './client';

/**
 * Aufbewahrung abgeschlossener Einsätze (LFH-23).
 *
 * Der Archiv-Namensraum `/api/aufbewahrung` steht NEBEN der Lesesperre der regulären Routen: nur
 * der System-Admin der eigenen Organisation kommt hinein (sonst 403), ein unbekannter Einsatz ist
 * 404, ein aktiver 409. Bis auf Wiederherstellen und Löschersuchen (Antrag, Rücknahme; LFH-751)
 * liest er nur. Die Frist ändert man am
 * Einsatz (`PUT …/aufbewahrungsfrist`); an einem vorgemerkten Einsatz ist das 422 (erst
 * wiederherstellen), an einem geschwärzten 409.
 */

const BASIS = '/api/aufbewahrung';

/** `GET /api/aufbewahrung` — abgeschlossene Einsätze der eigenen Organisation. */
export function ladeAufbewahrung(): Promise<AufbewahrungEintrag[]> {
  return apiGet<AufbewahrungEintrag[]>(BASIS);
}

/** `GET /api/aufbewahrung/einsaetze/{id}` — pseudonyme Archivakte. */
export function ladeArchivAkte(einsatzId: number): Promise<ArchivAkte> {
  return apiGet<ArchivAkte>(`${BASIS}/einsaetze/${einsatzId}`);
}

interface ArchivEtbFilter {
  typ?: EtbTyp;
  /** Cursor: nur Einträge mit kleinerer laufender Nummer (ältere). */
  beforeLfdNr?: number;
  limit?: number;
}

/** `GET /api/aufbewahrung/einsaetze/{id}/etb` — Archiv-ETB, neueste zuerst. */
export function ladeArchivEtb(
  einsatzId: number,
  filter: ArchivEtbFilter = {},
): Promise<ArchivEtbEintrag[]> {
  return apiGet<ArchivEtbEintrag[]>(
    mitParametern(`${BASIS}/einsaetze/${einsatzId}/etb`, {
      typ: filter.typ,
      before_lfd_nr: filter.beforeLfdNr,
      limit: filter.limit,
    }),
  );
}

/** `POST …/wiederherstellen` — Vormerkung aufheben, neue Frist setzen (Pflicht). */
export function stelleWiederHer(
  einsatzId: number,
  body: WiederherstellenBody,
): Promise<ArchivAkte> {
  return apiSend<ArchivAkte>(`${BASIS}/einsaetze/${einsatzId}/wiederherstellen`, 'POST', body);
}

/** `PUT /api/einsaetze/{id}/aufbewahrungsfrist` — Frist setzen, ändern oder aufheben. */
export function setzeAufbewahrungsfrist(
  einsatzId: number,
  body: FristSetzenBody,
): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${einsatzId}/aufbewahrungsfrist`, 'PUT', body);
}

/** `GET …/schwaerzungsantraege` — Löschersuchen nach Art. 17 des Einsatzes, neueste zuerst. */
export function ladeSchwaerzungsantraege(einsatzId: number): Promise<Schwaerzungsantrag[]> {
  return apiGet<Schwaerzungsantrag[]>(`${BASIS}/einsaetze/${einsatzId}/schwaerzungsantraege`);
}

/**
 * `POST …/schwaerzungsantraege` — Löschersuchen stellen (201). Schwärzt nicht sofort: der
 * Purge-Lauf vollzieht 24 Stunden später, bis dahin ist der Antrag zurücknehmbar.
 */
export function stelleSchwaerzungsantrag(
  einsatzId: number,
  body: NeuerSchwaerzungsantrag,
): Promise<Schwaerzungsantrag> {
  return apiSend<Schwaerzungsantrag>(
    `${BASIS}/einsaetze/${einsatzId}/schwaerzungsantraege`,
    'POST',
    body,
  );
}

/** `POST …/schwaerzungsantraege/{aid}/zuruecknehmen` — liefert die aktualisierte Liste. */
export function nimmSchwaerzungsantragZurueck(
  einsatzId: number,
  antragId: number,
): Promise<Schwaerzungsantrag[]> {
  return apiSend<Schwaerzungsantrag[]>(
    `${BASIS}/einsaetze/${einsatzId}/schwaerzungsantraege/${antragId}/zuruecknehmen`,
    'POST',
  );
}

/**
 * `POST …/personensuche` — pseudonyme Suche nach Name oder Rufnummer. POST, damit der Suchtext
 * im Body steht und in keinem Protokoll; die Antwort trägt nie Namen oder Kontakte.
 */
export function suchePersonen(einsatzId: number, suchtext: string): Promise<PersonTreffer[]> {
  return apiSend<PersonTreffer[]>(`${BASIS}/einsaetze/${einsatzId}/personensuche`, 'POST', {
    suchtext,
  });
}
