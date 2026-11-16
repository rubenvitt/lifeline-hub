import type { GlobalToken } from 'antd';
import type { LagemonitorAbschnitt, LagemonitorUhs, LagemonitorZone } from '../api/types';
import { UNBESTAETIGT } from '../pages/gefahren/beurteilung';
import {
  parseGeometry,
  parsePolygon,
  polygonZentroid,
  type GeoJsonGeometry,
  type GeoJsonPolygon,
} from '../pages/lagekarte/geo';
import {
  baueFlaechenFc,
  baueZonenFc,
  type FlaechenFeatureCollection,
  type ZonenFeatureCollection,
} from '../pages/lagekarte/kartenLayer';
import {
  gefahrengebietStil,
  stufenWort,
  zoneStil,
  zoneTypLabel,
} from '../pages/lagekarte/zonenStil';
import { warnstufeKarte, type Statusrolle } from '../theme/statusFarben';

/** Beschriftung einer Abschnittsfläche auf dem Monitor, am Schwerpunkt der Fläche. */
export interface MonitorAbschnittMarke {
  id: number;
  text: string;
  lat: number;
  lon: number;
}

/**
 * Beschriftung einer Gefahrenzone auf dem Monitor (LLH-1746): Text nach {@link zonenMarkenText},
 * `rolle` die Rolle ihrer Warnstufe (Rand der Marke), ohne Gebiet `null`.
 */
export interface MonitorZonenMarke {
  id: number;
  text: string;
  /** Name und Stufe getrennt ({@link zonenMarkenTeile}). */
  name: string;
  stufe: string | null;
  rolle: Statusrolle | null;
  lat: number;
  lon: number;
}

export interface MonitorFlaechen {
  zonen: ZonenFeatureCollection;
  abschnitte: FlaechenFeatureCollection;
  marken: MonitorAbschnittMarke[];
  zonenMarken: MonitorZonenMarke[];
  /** Jeder Stützpunkt, damit der Ausschnitt die Flächen ganz zeigt. */
  stuetzpunkte: { lat: number; lon: number }[];
}

/**
 * Teile der Marke einer Gefahrenzone (LLH-1746, Spec `lagemonitor`, „Gefahrenzonen mit Name und
 * Warnstufe“): `name` ist bei einem Gefahrengebiet die Bezeichnung seines Gebiets (sonst
 * „Gefahrengebiet“), `stufe` die Stufe im Wort der Lagekarte (`stufenWort`: „keine Stufe“, nie
 * „keine“, das läse sich als „keine Gefahr“) und „unbestätigt“, solange niemand die Beurteilung
 * bestätigt hat. Ohne Gebiet ist `stufe` `null` wie auf der Lagekarte. Absperrungen und
 * Sperrgebiete tragen ihr Artwort; den Freitext einer Zone kennt der Monitor nicht. Getrennt, damit
 * die Karte einen langen Namen kürzen kann, ohne die Stufe zu verlieren.
 */
export function zonenMarkenTeile(zone: LagemonitorZone): { name: string; stufe: string | null } {
  const gebiet = zone.gebiet;
  if (zone.typ !== 'gefahrengebiet' || !gebiet)
    return { name: zoneTypLabel(zone.typ), stufe: null };
  const name = gebiet.bezeichnung?.trim() || zoneTypLabel('gefahrengebiet');
  const stufe = [stufenWort(gebiet.warnstufe)];
  if (!gebiet.bestaetigt) stufe.push(UNBESTAETIGT);
  return { name, stufe: stufe.join(' · ') };
}

/** Die ganze Marke als ein Text: „Hangrutsch Kirchberg · hoch · unbestätigt“. */
export function zonenMarkenText(zone: LagemonitorZone): string {
  const { name, stufe } = zonenMarkenTeile(zone);
  return stufe ? `${name} · ${stufe}` : name;
}

/**
 * Überbelegt (LLH-1746, Spec `lagemonitor`, „Überbelegte Unfallhilfsstelle in Alarmrolle“): mehr
 * Belegte als Plätze. Eine UHS ohne Plätze (nur Wartebereich oder keine erfasst) ist es nie, eine
 * volle (5/5) auch nicht.
 */
export function istUeberbelegt(u: Pick<LagemonitorUhs, 'belegt' | 'plaetze'>): boolean {
  return u.plaetze > 0 && u.belegt > u.plaetze;
}

/** Belegung einer UHS als Wort der Anzeige: „8/5“, ohne Plätze nur die Belegten. */
export function belegungText(u: Pick<LagemonitorUhs, 'belegt' | 'plaetze'>): string {
  return u.plaetze > 0 ? `${u.belegt}/${u.plaetze}` : String(u.belegt);
}

/** Ort der Marke: Schwerpunkt einer Fläche, bei einer Linie die Mitte ihrer mittleren Stützpunkte. */
function markenOrt(geometrie: GeoJsonGeometry): [number, number] | null {
  if (geometrie.type === 'Polygon') return polygonZentroid(geometrie);
  const k = geometrie.coordinates;
  if (k.length === 0) return null;
  const a = k[Math.floor((k.length - 1) / 2)];
  const b = k[Math.floor(k.length / 2)];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Flächen der Monitorkarte (LLH-1153): Gefahrenzonen und Abschnittsflächen aus dem Lagebild, im
 * Stil der Lagekarte (`zoneStil`, ein Gefahrengebiet mit Gebiet nach seiner Warnstufe über
 * `gefahrengebietStil`, LLH-1746; Abschnitte über `baueFlaechenFc`). Beschriftet wird über Marken
 * in Großbild-Schrift (`marken`, `zonenMarken`), nicht über die 10-px-Ebene der Lagekarte.
 * Abschnitte tragen ihre Kurzbezeichnung, sonst die Bezeichnung. Unlesbare Geometrien fallen still
 * weg, wie auf der Lagekarte. `token` bestimmt die Farben des Modus (Tag/Nacht).
 */
export function baueMonitorFlaechen(
  zonen: readonly LagemonitorZone[],
  abschnitte: readonly LagemonitorAbschnitt[],
  token: GlobalToken,
): MonitorFlaechen {
  const stuetzpunkte: { lat: number; lon: number }[] = [];
  const merke = (koordinaten: number[][]) => {
    for (const [lon, lat] of koordinaten) stuetzpunkte.push({ lat, lon });
  };

  const zonenMarken: MonitorZonenMarke[] = [];
  const zonenFeatures = zonen.flatMap((z) => {
    const geometrie = parseGeometry(z.geometrie);
    if (!geometrie) return [];
    merke(geometrie.type === 'Polygon' ? (geometrie.coordinates[0] ?? []) : geometrie.coordinates);
    const stufe = z.typ === 'gefahrengebiet' ? z.gebiet?.warnstufe : undefined;
    const ort = markenOrt(geometrie);
    if (ort) {
      zonenMarken.push({
        id: z.id,
        text: zonenMarkenText(z),
        ...zonenMarkenTeile(z),
        rolle: stufe ? warnstufeKarte[stufe].rolle : null,
        lon: ort[0],
        lat: ort[1],
      });
    }
    return [
      {
        id: z.id,
        geometrie,
        label: null,
        typ: z.typ,
        stil: stufe ? gefahrengebietStil(stufe, token) : zoneStil(z.typ, null),
        gestrichelt: z.typ === 'gefahrengebiet',
      },
    ];
  });

  const flaechen: { id: number; label: string; polygon: GeoJsonPolygon }[] = [];
  const marken: MonitorAbschnittMarke[] = [];
  for (const a of abschnitte) {
    const polygon = parsePolygon(a.flaeche_geojson);
    if (!polygon) continue;
    merke(polygon.coordinates[0] ?? []);
    const text = a.kurzbezeichnung?.trim() || a.bezeichnung;
    flaechen.push({ id: a.id, label: text, polygon });
    const mitte = polygonZentroid(polygon);
    if (mitte) marken.push({ id: a.id, text, lon: mitte[0], lat: mitte[1] });
  }

  return {
    zonen: baueZonenFc(zonenFeatures),
    abschnitte: baueFlaechenFc(flaechen),
    marken,
    zonenMarken,
    stuetzpunkte,
  };
}
