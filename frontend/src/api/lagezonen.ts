import type { LageZone, ZoneTyp } from './types';
import { apiGet, apiSend } from './client';

/** Kreis um einen Punkt beim Anlegen (LLH-1043): das Polygon rechnet der Server. */
export interface ZoneKreisEingabe {
  mitte_lat: number;
  mitte_lon: number;
  radius_m: number;
}

/**
 * Body des Anlegens. Entweder `geometrie_typ` + `geometrie` (gezeichnet) oder `kreis` (LLH-1043);
 * beides zugleich lehnt der Server ab (422), keins von beiden ebenso (400).
 */
export interface ZoneNeu {
  typ: ZoneTyp;
  geometrie_typ?: 'Polygon' | 'LineString';
  geometrie?: string;
  kreis?: ZoneKreisEingabe;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  /** Ansichts-Zugehörigkeit (LFH-320): aktive Ansicht beim Anlegen; `null` = auf allen. */
  ansicht_id?: number | null;
}

export interface ZonePatch {
  typ?: ZoneTyp;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  /** Merge-Ziel (bestehende Gruppe) oder `null` = in neue eigene Gruppe abspalten. */
  gefahrengebiet_id?: number | null;
  /** Verschieben/Freigeben (LFH-320): Ziel-Ansicht oder `null` = auf alle Ansichten. */
  ansicht_id?: number | null;
  /** Bezirks-Zuordnung (LFH-673), nur an Zonen vom Typ `evakuierungsbezirk`; `null` löst. */
  evakuierungsbezirk_id?: number | null;
  /** Neuer Radius einer Kreiszone in Metern (LLH-1043); der Server rechnet das Polygon neu. */
  kreis_radius_m?: number;
  /**
   * Neue Geometrie (GeoJSON-String, gleiche Klasse) — punktweise Bearbeitung; nimmt der Zone die
   * Kreisangaben (LLH-1043).
   */
  geometrie?: string;
}

export function listeZonen(einsatzId: number): Promise<LageZone[]> {
  return apiGet<LageZone[]>(`/api/einsaetze/${einsatzId}/zonen`);
}

export function legeZoneAn(einsatzId: number, daten: ZoneNeu): Promise<LageZone> {
  return apiSend<LageZone>(`/api/einsaetze/${einsatzId}/zonen`, 'POST', daten);
}

export function aktualisiereZone(
  einsatzId: number,
  zid: number,
  daten: ZonePatch,
): Promise<LageZone> {
  return apiSend<LageZone>(`/api/einsaetze/${einsatzId}/zonen/${zid}`, 'PATCH', daten);
}

export function loescheZone(einsatzId: number, zid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/zonen/${zid}`, 'DELETE');
}
