import type { GlobalToken } from 'antd';
import { rollenFarbe } from '../../theme/statusFarben';
import type {
  Betreuungsstelle,
  Einheit,
  Einsatzabschnitt,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  FreiesZeichen,
  FuehrungskraftKarte,
  LageMeldung,
  Schaden,
  Sichtungskategorie,
  Uhs,
} from '../../api/types';
import {
  baueTzProps,
  einsatzortTz,
  grundzeichenAkzeptiert,
  schadenTz,
  uhsTz,
  betreuungsstelleTz,
  type TzProps,
} from './taktischesZeichen';
import type { GeoJsonGeometry, GeoJsonPolygon } from './geo';

export type MarkerTyp =
  | 'einsatzort'
  | 'uhs'
  | 'schaden'
  | 'einheit'
  | 'fahrzeug'
  | 'fuehrung'
  | 'abschnitt'
  | 'lagemeldung'
  | 'freies_zeichen'
  /**
   * Betreuungsstelle (`baueBetreuungMarker`): läuft wie die UHS in `alleVerortet` und „Nicht
   * verortet", aber nur bei Lesezugriff auf das Modul Betreuung (`betreuungEbene.ts`).
   */
  | 'betreuungsstelle'
  /**
   * Betroffene, nur aus `personenMarker` — auf der Betroffenen-Seite und als Ebene „Betroffene" der
   * Lagekarte. Dort laufen sie als eigene Liste `personenVerortet` neben `alleVerortet` und
   * clustern in eigener Quelle (`PERSONEN_CLUSTER_QUELLE`).
   */
  | 'person';

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
  /**
   * Flächen-/Linien-Geometrie des Markers (z. B. Abschnittsfläche) → Kennzahlen im Inspector.
   * FE-lokal, nicht Teil des Response-DTO.
   */
  geometrie?: GeoJsonGeometry;
  /**
   * Kurzzeichen im Kreis, unabhängig vom Zoom sichtbar (Betroffene: Sichtung „II"). Nur ohne
   * taktisches Zeichen — sonst läge es auf dem Symbol.
   */
  kurzzeichen?: string;
  /**
   * Durchmesser der unsichtbaren Trefferzone in px. Das gezeichnete Zeichen bleibt, wie es ist; die
   * Zone macht die Trefffläche so groß, wie die Dichtestufe verlangt (`token.controlHeight`). Jeder
   * Builder hier und `personenMarker` setzen sie.
   */
  trefferDurchmesser?: number;
  /**
   * Sichtungskategorie eines Personen-Markers — speist die Cluster-Aggregation (`clusterDonut.ts`).
   * `'ohne'` = noch nicht gesichtet.
   */
  sichtung?: Sichtungskategorie | 'ohne';
  /**
   * Eigene Cluster-Quelle, nur auf der Lagekarte für die Ebene „Betroffene": Personen clustern dort
   * getrennt von den Kräften und liegen unter ihnen. Die Betroffenen-Karte setzt es nicht — ihre
   * Personen bleiben in `marker-cluster` mit den Sichtungs-Donuts.
   */
  clusterQuelle?: 'personen';
  /** FMS-Status-Ring, nur für Fahrzeuge. */
  statusFarbe?: string | null;
  /**
   * Lagemeldungs-Herkunft für den Inspector-Backlink (nur typ='lagemeldung'). `meldungId` = id der
   * Quell-Meldung (Deeplink ?meldung=), `meldungLfdNr` = Anzeigenummer.
   */
  lageMeldung?: { meldungId: number; meldungLfdNr: number; absender: string; inhalt: string };
}

export interface NichtVerortet {
  typ: 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt' | 'betreuungsstelle';
  id: number;
  label: string;
}

/**
 * Farbrollen der Einsatzort- und UHS-Signatur:
 * - Einsatzort → `marke`: der Ankerpunkt des eigenen Einsatzes, kein Gefahrenobjekt. Mit `alarm`
 *   trüge eine Farbe Gefahrengebiet und Ortssignatur.
 * - UHS → `bedien`.
 *
 * Dieses Modul erzeugt MapLibre-`paint`-Werte, keine DOM-Styles — es hat keinen
 * `useToken()`-Zugang. Der Token kommt von der aufrufenden Ebene (`useLagekarteDaten`).
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
      trefferDurchmesser: token.controlHeight,
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
        trefferDurchmesser: token.controlHeight,
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
        trefferDurchmesser: token.controlHeight,
      });
    } else {
      nichtVerortet.push({ typ: 'schaden', id: s.id, label: schadenLabel(s.registrier_nr) });
    }
  }

  return { verortet, nichtVerortet };
}

/**
 * Betreuungsstellen: verortete als Marker, unverortete in „Nicht verortet". Stornierte fallen
 * heraus (auch aus einem eingefrorenen Stand). Rolle `bedien` wie die UHS — Rot bedient nichts, und
 * eine neue Rolle wird nicht erfunden; Zeichen und eigene Ebene unterscheiden die Stelle von der
 * UHS.
 */
export function baueBetreuungMarker(
  stellen: readonly Betreuungsstelle[],
  token: GlobalToken,
): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];
  for (const s of stellen) {
    if (s.storniert_at) continue;
    if (s.lat != null && s.lon != null) {
      verortet.push({
        schluessel: `betreuungsstelle-${s.id}`,
        typ: 'betreuungsstelle',
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        label: s.bezeichnung,
        farbe: rollenFarbe(UHS_ROLLE, token),
        tz: betreuungsstelleTz(),
        trefferDurchmesser: token.controlHeight,
      });
    } else {
      nichtVerortet.push({ typ: 'betreuungsstelle', id: s.id, label: s.bezeichnung });
    }
  }
  return { verortet, nichtVerortet };
}

const LAGEMELDUNG_FARBE = '#d48806';

/**
 * Marker für verortete Lagemeldungen. Unverortete bleiben außen vor — verortet wird beim Übergeben,
 * nicht auf der Karte.
 */
export function baueLageMeldungMarker(
  lagemeldungen: LageMeldung[],
  token: Pick<GlobalToken, 'controlHeight'>,
): KarteMarker[] {
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
      trefferDurchmesser: token.controlHeight,
      lageMeldung: {
        meldungId: l.meldung_id,
        meldungLfdNr: l.meldung_lfd_nr,
        absender: l.meldung_absender,
        inhalt: l.text,
      },
    });
  }
  return verortet;
}

// Neutrale DV-102-Tinte, wenn das freie Zeichen keine eigene Farbe trägt.
const FREIES_ZEICHEN_FARBE = '#333333';

/**
 * Baut die DV-102-Spec eines freien Zeichens und strippt jedes Overlay (auch die Farbe), das das
 * Grundzeichen laut `accepts`-Katalog nicht rendert ({@link grundzeichenAkzeptiert}) — sonst
 * divergierte der Icon-Dedup-Key und ein Phantom-Overlay entstünde.
 */
export function baueFreiesZeichenTz(
  z: Pick<
    FreiesZeichen,
    'grundzeichen' | 'organisation' | 'fachaufgabe' | 'symbol' | 'einheit' | 'funktion' | 'farbe'
  >,
): TzProps {
  const gz = z.grundzeichen;
  const nimm = (
    overlay: Parameters<typeof grundzeichenAkzeptiert>[1],
    wert: string | null | undefined,
  ) => (wert != null && grundzeichenAkzeptiert(gz, overlay) ? wert : undefined);
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

/**
 * Ersatztext eines freien Zeichens ohne eigenen Namen. Inspector und Leiste zeigen ihn, die
 * Kartenplakette nicht — ein Platzhalter ist kein Name.
 */
export const FREIES_ZEICHEN_ERSATZLABEL = '(freies Zeichen)';

/** Karten-Marker für freie taktische Zeichen (immer verortet). */
export function baueFreieZeichenMarker(
  zeichen: FreiesZeichen[],
  token: Pick<GlobalToken, 'controlHeight'>,
): KarteMarker[] {
  return zeichen.map((z) => ({
    schluessel: `freies_zeichen-${z.id}`,
    typ: 'freies_zeichen' as const,
    id: z.id,
    lat: z.lat,
    lon: z.lon,
    label: z.label ?? FREIES_ZEICHEN_ERSATZLABEL,
    farbe: z.farbe ?? FREIES_ZEICHEN_FARBE,
    tz: baueFreiesZeichenTz(z),
    trefferDurchmesser: token.controlHeight,
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
  token: Pick<GlobalToken, 'controlHeight'>,
): {
  verortet: KarteMarker[];
  nichtVerortet: NichtVerortet[];
} {
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];
  const add = (
    typ: 'einheit' | 'fahrzeug' | 'fuehrung',
    id: number,
    label: string,
    lat: number | null | undefined,
    lon: number | null | undefined,
    tz: TzProps,
    statusFarbe?: string | null,
  ) => {
    if (lat != null && lon != null) {
      verortet.push({
        schluessel: `${typ}-${id}`,
        typ,
        id,
        lat,
        lon,
        label,
        farbe: '#555',
        tz,
        statusFarbe,
        trefferDurchmesser: token.controlHeight,
      });
    } else {
      nichtVerortet.push({ typ, id, label });
    }
  };
  for (const e of q.einheiten) {
    add(
      'einheit',
      e.id,
      e.name,
      e.lat,
      e.lon,
      baueTzProps({
        objekttyp: 'einheit',
        einheitTypLabel: e.typ_label,
        fachaufgabe: e.tz_fachaufgabe,
        organisation: e.tz_organisation,
        orgDefault: q.orgDefault,
      }),
    );
  }
  for (const f of q.fahrzeuge) {
    add(
      'fahrzeug',
      f.id,
      f.funkrufname,
      f.lat,
      f.lon,
      baueTzProps({
        objekttyp: 'fahrzeug',
        fachaufgabe: f.tz_fachaufgabe,
        organisation: f.tz_organisation,
        orgDefault: q.orgDefault,
        fahrzeugtyp: f.fahrzeugtyp,
        opta: f.opta,
        traegerorganisation: f.traegerorganisation,
      }),
      f.status_farbe,
    );
  }
  for (const p of q.fuehrungskraefte) {
    add(
      'fuehrung',
      p.id,
      p.name,
      p.lat,
      p.lon,
      baueTzProps({
        objekttyp: 'fuehrung',
        fachaufgabe: p.tz_fachaufgabe,
        organisation: p.tz_organisation,
        orgDefault: q.orgDefault,
        funktion: p.funktion,
        istFuehrungskraft: p.ist_einheitsfuehrer || p.ist_abschnittsleiter,
      }),
    );
  }
  return { verortet, nichtVerortet };
}

const ABSCHNITT_FARBE = '#722ed1';

/**
 * Taktisches Zeichen eines Einsatzabschnitts am Zentroid seiner Fläche; `polygon` trägt die
 * Kennzahlen in den Inspector. Eigener Builder, damit die Trefferzone hier geprüft wird wie an
 * jedem Marker.
 */
export function baueAbschnittMarker(
  a: Pick<Einsatzabschnitt, 'id' | 'name' | 'tz_fachaufgabe' | 'tz_organisation'>,
  polygon: GeoJsonPolygon,
  zentroid: [number, number],
  orgDefault: string | null,
  token: Pick<GlobalToken, 'controlHeight'>,
): KarteMarker {
  return {
    schluessel: `abschnitt-${a.id}`,
    typ: 'abschnitt',
    id: a.id,
    lon: zentroid[0],
    lat: zentroid[1],
    label: a.name,
    farbe: ABSCHNITT_FARBE,
    tz: baueTzProps({
      objekttyp: 'abschnitt',
      fachaufgabe: a.tz_fachaufgabe,
      organisation: a.tz_organisation,
      orgDefault,
    }),
    geometrie: polygon,
    trefferDurchmesser: token.controlHeight,
  };
}
