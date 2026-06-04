import type { Gefahrentyp, LageZone, Schutzobjekt, ZoneTyp } from './types';
import { apiGet, apiSend } from './client';

export interface ZoneNeu {
  typ: ZoneTyp;
  geometrie_typ: 'Polygon' | 'LineString';
  geometrie: string; // JSON.stringify der Geometry
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  gefahrentyp?: Gefahrentyp | null;
  schutzobjekt?: Schutzobjekt | null;
}

export interface ZonePatch {
  typ?: ZoneTyp;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  gefahrentyp?: Gefahrentyp | null;
  schutzobjekt?: Schutzobjekt | null;
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
