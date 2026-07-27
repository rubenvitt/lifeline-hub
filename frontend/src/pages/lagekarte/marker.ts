import type { GlobalToken } from 'antd';
import { rollenFarbe } from '../../theme/statusFarben';
import type { Einheit, EinsatzAnzeige, EinsatzFahrzeug, FreiesZeichen, FuehrungskraftKarte, LageMeldung, Schaden, Uhs } from '../../api/types';
import { baueTzProps, einsatzortTz, grundzeichenAkzeptiert, schadenTz, uhsTz, type TzProps } from './taktischesZeichen';
import type { GeoJsonGeometry } from './geo';

export type MarkerTyp =
  | 'einsatzort' | 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt' | 'lagemeldung' | 'freies_zeichen';

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
  /** Flächen-/Linien-Geometrie des Markers (z. B. Abschnittsfläche) → Kennzahlen im
   *  Inspector (Fläche/Umfang/Länge, LFH-146). FE-lokal, nicht Teil des Response-DTO. */
  geometrie?: GeoJsonGeometry;
  /** FMS-Status-Ring, nur für Fahrzeuge. */
  statusFarbe?: string | null;
  /** Lagemeldungs-Herkunft für den Inspector-Backlink (nur typ='lagemeldung').
   *  `meldungId` = id der QUELL-Meldung (Deeplink-Ziel ?meldung=), `meldungLfdNr` = Anzeigenr. */
  lageMeldung?: { meldungId: number; meldungLfdNr: number; absender: string; inhalt: string };
}

export interface NichtVerortet {
  typ: 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt';
  id: number;
  label: string;
}

/**
 * Farbrollen der beiden Signaturen, die A2 (LFH-328) aus harten Hex-Werten gelöst hat.
 *
 * - **Einsatzort → `marke`.** Der Einsatzort ist der Ankerpunkt des EIGENEN Einsatzes, kein
 *   Gefahrenobjekt. Auf `alarm` gezogen läse er sich als Gefahr, und „eine Farbe = eine
 *   Bedeutung" (A1 Festlegung 5) wäre verletzt: `alarm` trüge dann Gefahrengebiet UND
 *   Ortssignatur. Vorher: der Marken-Hexwert, aus `tokens.ts` herauskopiert.
 * - **UHS → `bedien`.** Vorher `#1677ff` — antd-v5-Default-Blau und damit nicht einmal der
 *   A0-Bedienwert; die Signatur wich still vom Rest der Anwendung ab.
 *
 * DIESES MODUL ERZEUGT MapLibre-`paint`-WERTE, keine DOM-Styles — kein `useToken()`-Zugang.
 * Der Token kommt von der aufrufenden Ebene (`useLagekarteDaten`).
 */
const EINSATZORT_ROLLE = 'marke' as const;
const UHS_ROLLE = 'bedien' as const;

function schadenLabel(registrierNr: number): string {
  return `S-${String(registrierNr).padStart(3, '0')}`;
}

/** Leitet verortete Marker + Nicht-verortet-Liste aus den geladenen Objekten ab. */
export function baueMarker(
  einsatz: EinsatzAnzeige | undefined,
  uhsListe: Uhs[],
  schaeden: Schaden[],
  token: GlobalToken,
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
      farbe: rollenFarbe(EINSATZORT_ROLLE, token),
      tz: einsatzortTz(),
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
        farbe: rollenFarbe(UHS_ROLLE, token),
        tz: uhsTz(u.typ),
      });
    } else {
      nichtVerortet.push({ typ: 'uhs', id: u.id, label: u.bezeichnung });
    }
  }

  for (const s of schaeden) {
    if (s.lat != null && s.lon != null) {
      const tz = schadenTz(s.ausmass);
      verortet.push({
        schluessel: `schaden-${s.id}`,
        typ: 'schaden',
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        label: schadenLabel(s.registrier_nr),
        farbe: tz.farbe,
        tz,
      });
    } else {
      nichtVerortet.push({ typ: 'schaden', id: s.id, label: schadenLabel(s.registrier_nr) });
    }
  }

  return { verortet, nichtVerortet };
}

const LAGEMELDUNG_FARBE = '#d48806';

/** Leitet Marker für verortete Lagemeldungen ab (LFH-113). Unverortete bleiben außen vor —
 *  Lagemeldungen werden NICHT auf der Karte platziert (Verorten erfolgt beim Übergeben). */
export function baueLageMeldungMarker(lagemeldungen: LageMeldung[]): KarteMarker[] {
  const verortet: KarteMarker[] = [];
  for (const l of lagemeldungen) {
    if (l.lat == null || l.lon == null) continue;
    verortet.push({
      schluessel: `lagemeldung-${l.id}`,
      typ: 'lagemeldung',
      id: l.id,
      lat: l.lat,
      lon: l.lon,
      label: `Meldung #${l.meldung_lfd_nr}`,
      farbe: LAGEMELDUNG_FARBE,
      lageMeldung: { meldungId: l.meldung_id, meldungLfdNr: l.meldung_lfd_nr, absender: l.meldung_absender, inhalt: l.text },
    });
  }
  return verortet;
}

// Neutrale DV-102-Tinte, wenn das freie Zeichen keine eigene Farbe trägt.
const FREIES_ZEICHEN_FARBE = '#333333';

/** Baut die DV-102-Spec eines freien Zeichens aus grundzeichen + Overlays des Records und
 *  STRIPPT dabei jedes Overlay, das das gewählte Grundzeichen laut `accepts`-Katalog nicht
 *  rendert (via {@link grundzeichenAkzeptiert}) — sonst divergierte der Icon-Dedup-Key und ein
 *  Phantom-Overlay entstünde. Gilt auch für die Farbe (nur farb-akzeptierende Grundzeichen). */
export function baueFreiesZeichenTz(
  z: Pick<FreiesZeichen, 'grundzeichen' | 'organisation' | 'fachaufgabe' | 'symbol' | 'einheit' | 'funktion' | 'farbe'>,
): TzProps {
  const gz = z.grundzeichen;
  const nimm = (overlay: Parameters<typeof grundzeichenAkzeptiert>[1], wert: string | null | undefined) =>
    wert != null && grundzeichenAkzeptiert(gz, overlay) ? wert : undefined;
  return {
    grundzeichen: gz,
    organisation: nimm('organisation', z.organisation),
    fachaufgabe: nimm('fachaufgabe', z.fachaufgabe),
    symbol: nimm('symbol', z.symbol),
    einheit: nimm('einheit', z.einheit),
    funktion: nimm('funktion', z.funktion),
    farbe: nimm('farbe', z.farbe),
  } as TzProps;
}

/** Leitet Karten-Marker für freie taktische Zeichen ab (immer verortet, LFH-170). */
export function baueFreieZeichenMarker(zeichen: FreiesZeichen[]): KarteMarker[] {
  return zeichen.map((z) => ({
    schluessel: `freies_zeichen-${z.id}`,
    typ: 'freies_zeichen' as const,
    id: z.id,
    lat: z.lat,
    lon: z.lon,
    label: z.label ?? '(freies Zeichen)',
    farbe: z.farbe ?? FREIES_ZEICHEN_FARBE,
    tz: baueFreiesZeichenTz(z),
  }));
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
    lat: number | null | undefined, lon: number | null | undefined, tz: TzProps, statusFarbe?: string | null,
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
      baueTzProps({
        objekttyp: 'fahrzeug', fachaufgabe: f.tz_fachaufgabe, organisation: f.tz_organisation,
        orgDefault: q.orgDefault, fahrzeugtyp: f.fahrzeugtyp, opta: f.opta,
        traegerorganisation: f.traegerorganisation,
      }),
      f.status_farbe);
  }
  for (const p of q.fuehrungskraefte) {
    add('fuehrung', p.id, p.name, p.lat, p.lon,
      baueTzProps({
        objekttyp: 'fuehrung', fachaufgabe: p.tz_fachaufgabe, organisation: p.tz_organisation,
        orgDefault: q.orgDefault, funktion: p.funktion,
        istFuehrungskraft: p.ist_einheitsfuehrer || p.ist_abschnittsleiter,
      }));
  }
  return { verortet, nichtVerortet };
}
