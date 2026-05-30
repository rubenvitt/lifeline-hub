import type { EinsatzAnzeige, Schaden, Uhs } from '../../api/types';

export type MarkerTyp = 'einsatzort' | 'uhs' | 'schaden';

export interface KarteMarker {
  /** Stabil & eindeutig über alle Typen: 'einsatzort' | 'uhs-<id>' | 'schaden-<id>'. */
  schluessel: string;
  typ: MarkerTyp;
  /** Objekt-id im Fach-Modul (0 für den Einsatzort). */
  id: number;
  lat: number;
  lon: number;
  label: string;
  farbe: string;
}

export interface NichtVerortet {
  typ: 'uhs' | 'schaden';
  id: number;
  label: string;
}

const EINSATZORT_FARBE = '#a8071a';
const UHS_FARBE = '#1677ff';
const AUSMASS_FARBE: Record<string, string> = {
  gering: '#52c41a',
  mittel: '#faad14',
  gross: '#fa8c16',
  katastrophal: '#f5222d',
};

function schadenLabel(registrierNr: number): string {
  return `S-${String(registrierNr).padStart(3, '0')}`;
}

/** Leitet verortete Marker + Nicht-verortet-Liste aus den geladenen Objekten ab. */
export function baueMarker(
  einsatz: EinsatzAnzeige | undefined,
  uhsListe: Uhs[],
  schaeden: Schaden[],
): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];

  if (einsatz && einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null) {
    verortet.push({
      schluessel: 'einsatzort',
      typ: 'einsatzort',
      id: 0,
      lat: einsatz.einsatzort_lat,
      lon: einsatz.einsatzort_lon,
      label: einsatz.einsatzort ?? 'Einsatzort',
      farbe: EINSATZORT_FARBE,
    });
  }

  for (const u of uhsListe) {
    if (u.lat != null && u.lon != null) {
      verortet.push({
        schluessel: `uhs-${u.id}`,
        typ: 'uhs',
        id: u.id,
        lat: u.lat,
        lon: u.lon,
        label: u.bezeichnung,
        farbe: UHS_FARBE,
      });
    } else {
      nichtVerortet.push({ typ: 'uhs', id: u.id, label: u.bezeichnung });
    }
  }

  for (const s of schaeden) {
    if (s.lat != null && s.lon != null) {
      verortet.push({
        schluessel: `schaden-${s.id}`,
        typ: 'schaden',
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        label: schadenLabel(s.registrier_nr),
        farbe: AUSMASS_FARBE[s.ausmass] ?? '#8c8c8c',
      });
    } else {
      nichtVerortet.push({ typ: 'schaden', id: s.id, label: schadenLabel(s.registrier_nr) });
    }
  }

  return { verortet, nichtVerortet };
}
