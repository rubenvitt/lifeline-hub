import type { Einheit, EinsatzAnzeige, EinsatzFahrzeug, FuehrungskraftKarte, Schaden, Uhs } from '../../api/types';
import { baueTzProps, type TzProps } from './taktischesZeichen';

export type MarkerTyp =
  | 'einsatzort' | 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt';

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
  /** Wenn gesetzt → DV-102-SVG (taktisches Zeichen) statt einfachem Kreis. */
  tz?: TzProps;
  /** FMS-Status-Ring, nur für Fahrzeuge. */
  statusFarbe?: string | null;
}

export interface NichtVerortet {
  typ: 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt';
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

export interface TaktischeQuelle {
  einheiten: Einheit[];
  fahrzeuge: EinsatzFahrzeug[];
  fuehrungskraefte: FuehrungskraftKarte[];
  orgDefault: string | null;
}

/** Leitet taktische Marker (Einheit/Fahrzeug/Führung) + Nicht-verortet-Liste ab. */
export function baueTaktischeMarker(
  q: TaktischeQuelle,
): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];
  const add = (
    typ: 'einheit' | 'fahrzeug' | 'fuehrung', id: number, label: string,
    lat: number | null, lon: number | null, tz: TzProps, statusFarbe?: string | null,
  ) => {
    if (lat != null && lon != null) {
      verortet.push({ schluessel: `${typ}-${id}`, typ, id, lat, lon, label, farbe: '#555', tz, statusFarbe });
    } else {
      nichtVerortet.push({ typ, id, label });
    }
  };
  for (const e of q.einheiten) {
    add('einheit', e.id, e.name, e.lat, e.lon,
      baueTzProps({ objekttyp: 'einheit', einheitTypLabel: e.typ_label, fachaufgabe: e.tz_fachaufgabe,
        organisation: e.tz_organisation, orgDefault: q.orgDefault }));
  }
  for (const f of q.fahrzeuge) {
    add('fahrzeug', f.id, f.funkrufname, f.lat, f.lon,
      baueTzProps({ objekttyp: 'fahrzeug', fachaufgabe: f.tz_fachaufgabe, organisation: f.tz_organisation, orgDefault: q.orgDefault }),
      f.status_farbe);
  }
  for (const p of q.fuehrungskraefte) {
    add('fuehrung', p.id, p.name, p.lat, p.lon,
      baueTzProps({ objekttyp: 'fuehrung', fachaufgabe: p.tz_fachaufgabe, organisation: p.tz_organisation, orgDefault: q.orgDefault }));
  }
  return { verortet, nichtVerortet };
}
