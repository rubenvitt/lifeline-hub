import type {
  GeoJsonFeatureCollection,
  LagemonitorAbschnitt,
  LagemonitorUhs,
  LagemonitorZone,
  UhsTyp,
  ZoneTyp,
} from '../api/types';

import type { MonitorPunkt } from '../geraet/LagemonitorKarte';

/** Was die Monitorkarte aus der Karte der Antwort zeichnet. */
export interface LagebildKartenDaten {
  einsatzort: MonitorPunkt | null;
  uhs: LagemonitorUhs[];
  zonen: LagemonitorZone[];
  abschnitte: LagemonitorAbschnitt[];
}

function punktAus(geometry: unknown): MonitorPunkt | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null | undefined;
  if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates as unknown[];
  return typeof lon === 'number' && typeof lat === 'number' ? { lat, lon } : null;
}

const zahl = (wert: unknown): number => (typeof wert === 'number' ? wert : 0);
const text = (wert: unknown): string | null => (typeof wert === 'string' ? wert : null);

/**
 * Die Karte der Seite `/extern` (LLH-1496) als Eingaben der Monitorkarte
 * (`geraet/LagemonitorKarte.tsx`): Einsatzort, UHS mit Belegung, Gefahrenzonen und
 * Abschnittsflächen. Freie Zeichen zeichnet die Monitorkarte nicht; unbekannte Arten und
 * unlesbare Geometrien fallen still weg.
 */
export function lagebildKartenDaten(
  karte: GeoJsonFeatureCollection | null | undefined,
): LagebildKartenDaten {
  const daten: LagebildKartenDaten = { einsatzort: null, uhs: [], zonen: [], abschnitte: [] };
  for (const f of karte?.features ?? []) {
    const p = f.properties ?? {};
    const id = zahl(p.id);
    switch (p.kind) {
      case 'einsatzort':
        daten.einsatzort = punktAus(f.geometry);
        break;
      case 'zone':
        if (f.geometry && typeof p.typ === 'string') {
          daten.zonen.push({ id, typ: p.typ as ZoneTyp, geometrie: JSON.stringify(f.geometry) });
        }
        break;
      case 'abschnitt':
        if (f.geometry) {
          daten.abschnitte.push({
            id,
            bezeichnung: text(p.bezeichnung) ?? '',
            kurzbezeichnung: text(p.kurzbezeichnung),
            flaeche_geojson: JSON.stringify(f.geometry),
          });
        }
        break;
      case 'uhs': {
        const ort = punktAus(f.geometry);
        if (ort) {
          daten.uhs.push({
            id,
            bezeichnung: text(p.bezeichnung) ?? '',
            belegt: zahl(p.belegt),
            plaetze: zahl(p.plaetze),
            // Die Monitorkarte zeigt nur Bezeichnung und Belegung; Kräfte, Art und Zustand
            // trägt die Karte nicht.
            kraefte: 0,
            typ: (text(p.typ) ?? 'sonstige') as UhsTyp,
            status: 'aktiv',
            lat: ort.lat,
            lon: ort.lon,
          });
        }
        break;
      }
    }
  }
  return daten;
}
