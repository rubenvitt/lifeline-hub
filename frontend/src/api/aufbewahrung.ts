import type {
  ArchivAkte,
  ArchivEtbEintrag,
  AufbewahrungEintrag,
  EinsatzAnzeige,
  EtbTyp,
  FristSetzenBody,
  WiederherstellenBody,
} from './types';
import { apiGet, apiSend } from './client';

/**
 * Aufbewahrung abgeschlossener Einsätze (LFH-23, design.md D2).
 *
 * Der Archiv-Namensraum `/api/aufbewahrung` steht NEBEN der Lesesperre der regulären
 * Einsatz-Routen: nur der System-Admin der eigenen Organisation kommt hinein (sonst 403),
 * ein unbekannter Einsatz ist 404, ein aktiver 409. Bis auf das Wiederherstellen liest er
 * nur. Die Frist selbst ändert man dagegen am Einsatz (`PUT …/aufbewahrungsfrist`,
 * Einsatzleitung oder System-Admin) — an einem vorgemerkten Einsatz ist das 422 (erst
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

export interface ArchivEtbFilter {
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
  const q = new URLSearchParams();
  if (filter.typ) q.set('typ', filter.typ);
  if (filter.beforeLfdNr != null) q.set('before_lfd_nr', String(filter.beforeLfdNr));
  if (filter.limit != null) q.set('limit', String(filter.limit));
  const s = q.toString();
  return apiGet<ArchivEtbEintrag[]>(`${BASIS}/einsaetze/${einsatzId}/etb${s ? `?${s}` : ''}`);
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
