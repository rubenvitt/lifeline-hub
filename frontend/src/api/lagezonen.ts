import type { LageZone, ZoneTyp } from './types';
import { apiGet, apiSend } from './client';

export interface ZoneNeu {
  typ: ZoneTyp;
  geometrie_typ: 'Polygon' | 'LineString';
  geometrie: string;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
}

export interface ZonePatch {
  typ?: ZoneTyp;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  /** Merge-Ziel (bestehende Gruppe) oder `null` = in neue eigene Gruppe abspalten. */
  gefahrengebiet_id?: number | null;
}

export function listeZonen(einsatzId: number): Promise<LageZone[]> {
  return apiGet<LageZone[]>(`/api/einsaetze/${einsatzId}/zonen`);
}

export function legeZoneAn(einsatzId: number, daten: ZoneNeu): Promise<LageZone> {
  return apiSend<LageZone>(`/api/einsaetze/${einsatzId}/zonen`, 'POST', daten);
}

export function aktualisiereZone(einsatzId: number, zid: number, daten: ZonePatch): Promise<LageZone> {
  return apiSend<LageZone>(`/api/einsaetze/${einsatzId}/zonen/${zid}`, 'PATCH', daten);
}

export function loescheZone(einsatzId: number, zid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/zonen/${zid}`, 'DELETE');
}
