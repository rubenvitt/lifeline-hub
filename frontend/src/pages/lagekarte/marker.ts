import type { GlobalToken } from 'antd';
import { rollenFarbe } from '../../theme/statusFarben';
import type {
  Betreuungsstelle,
  BrListenEintrag,
  Einheit,
  Einsatzabschnitt,
  EinsatzAnzeige,
  EinsatzFahrzeug,
  FreiesZeichen,
  FuehrungskraftKarte,
  Fuehrungsstelle,
  LageMeldung,
  SchadenMarker,
  Sichtungskategorie,
  Uhs,
} from '../../api/types';
import {
  baueTzProps,
  einsatzortTz,
  fuehrungsstelleTz,
  schadenTz,
  uhsTz,
  betreuungsstelleTz,
  type TzProps,
} from './taktischesZeichen';
import type { GeoJsonGeometry, GeoJsonPolygon } from './geo';
import { registrierNummer } from '../../anzeige/registrierNummer';
import { staerkeText, type StaerkeTraeger } from '../../anzeige/staerke';
import { staerkeImRaum } from '../../bereitstellungsraum/brZahlen';
import {
  freiesZeichen as freiesZeichenBild,
  fuellfarbe,
  type FreiesZeichenEingabe,
} from '../../zeichen/freiesZeichen';

export type MarkerTyp =
  | 'einsatzort'
  /**
   * Eigene Führungsstelle (LFH-1181, `baueFuehrungsstelleMarker`): nur lesend wie der Einsatzort,
   * in dessen fester Quelle, ohne Cluster, ohne Ziehen und Platzieren.
   */
  | 'fuehrungsstelle'
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
   * Bereitstellungsraum (`buildBrMarker`, LLH-1107): läuft wie die Betreuungsstelle in
   * `alleVerortet` und „Nicht verortet", nur bei Lesezugriff auf das Modul Bereitstellungsräume
   * (`brEbene.ts`). Zeichen D.2.1 über `bereitstellungsraumZeichen`, nicht über `tz`.
   */
  | 'bereitstellungsraum'
  /**
   * Tier (`buildTierMarker` in `tierMarker.ts`, LLH-1123): läuft wie der Bereitstellungsraum in
   * `alleVerortet` und „Nicht verortet", nur bei Lesezugriff auf das Modul Tiere (`tierEbene.ts`).
   * Kreis mit Kurzzeichen „T", kein `tz`.
   */
  | 'tier'
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
  /** Fachobjekt: wenn gesetzt → taktisches Zeichen (`fachobjektZeichen`) statt einfachem Kreis. */
  tz?: TzProps;
  /**
   * Freies Zeichen (nur `typ: 'freies_zeichen'`): das gespeicherte Zeichen, wie es aus DB-Zeile,
   * Snapshot oder Offline-Stand kommt. Gezeichnet über den Leseadapter `zeichen/freiesZeichen.ts`
   * (LFH-836, design.md D8); ein freies Zeichen trägt kein `tz`.
   */
  freiesZeichen?: FreiesZeichenEingabe;
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
   * Zusatz der Kartenplakette hinter dem Namen (Bereitstellungsraum: „0/2/9//11 · 3 Fz" oder
   * „geplant"). Der Name bleibt `label`: Inspector, Suche und „Nicht verortet" lesen ihn allein.
   */
  beschriftungZusatz?: string;
  /**
   * Geplant nach DV 102 (Bereitstellungsraum im Status „geplant"): die Karte legt einen
   * gestrichelten Ring um das Zeichen (`geplantRing.ts`). Nur gesetzt, wenn wahr.
   */
  isGeplant?: true;
  /**
   * Lagemeldungs-Herkunft für den Inspector-Backlink (nur typ='lagemeldung'). `meldungId` = id der
   * Quell-Meldung (Deeplink ?meldung=), `meldungLfdNr` = Anzeigenummer.
   */
  lageMeldung?: { meldungId: number; meldungLfdNr: number; absender: string; inhalt: string };
}

export interface NichtVerortet {
  typ:
    | 'uhs'
    | 'schaden'
    | 'einheit'
    | 'fahrzeug'
    | 'fuehrung'
    | 'abschnitt'
    | 'betreuungsstelle'
    | 'bereitstellungsraum'
    | 'tier';
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

/**
 * Die eigene Führungsstelle als lesender Marker (LFH-1181, design.md D7): nur mit Koordinate,
 * beschriftet mit ihrer Bezeichnung, sonst „Führungsstelle“. Farbe wie der Einsatzort (`marke`):
 * ein Ankerpunkt des eigenen Einsatzes. Bearbeitet wird im Paneel der Einsatzdaten.
 */
export function baueFuehrungsstelleMarker(
  fs: Fuehrungsstelle | undefined | null,
  token: GlobalToken,
): KarteMarker | null {
  if (fs?.standort_lat == null || fs.standort_lon == null) return null;
  return {
    schluessel: 'fuehrungsstelle',
    typ: 'fuehrungsstelle',
    id: 0,
    lat: fs.standort_lat,
    lon: fs.standort_lon,
    label: fs.bezeichnung?.trim() || 'Führungsstelle',
    farbe: rollenFarbe(EINSATZORT_ROLLE, token),
    tz: fuehrungsstelleTz(),
    trefferDurchmesser: token.controlHeight,
  };
}

/** Leitet verortete Marker + Nicht-verortet-Liste aus den geladenen Objekten ab. */
export function baueMarker(
  einsatz: EinsatzAnzeige | undefined,
  uhsListe: Uhs[],
  schaeden: readonly SchadenMarker[],
  token: GlobalToken,
  orgDefault: string | null = null,
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
        tz: uhsTz(u.typ, orgDefault),
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
        label: registrierNummer('S', s.registrier_nr),
        farbe: tz.farbe,
        tz,
        trefferDurchmesser: token.controlHeight,
      });
    } else {
      nichtVerortet.push({
        typ: 'schaden',
        id: s.id,
        label: registrierNummer('S', s.registrier_nr),
      });
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
  orgDefault: string | null = null,
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
        tz: betreuungsstelleTz(orgDefault),
        trefferDurchmesser: token.controlHeight,
      });
    } else {
      nichtVerortet.push({ typ: 'betreuungsstelle', id: s.id, label: s.bezeichnung });
    }
  }
  return { verortet, nichtVerortet };
}

/**
 * Plakettenzusatz eines Raums: geplant das Wort (der zweite Kanal neben dem gestrichelten Ring),
 * sonst Stärke und Fahrzeuge der Belegung. Fahrzeuge nur aus `belegung` des Servers, Stärke nur
 * über `staerkeImRaum` (`frontend/AGENTS.md`, „Eine Heimat je Zahl"); eine unvollständige Stärke
 * fehlt, statt zu klein dazustehen. Leerer Raum: kein Zusatz.
 */
function brZusatz(
  r: BrListenEintrag,
  einheiten: readonly StaerkeTraeger[] | undefined,
): string | undefined {
  if (r.status === 'geplant') return 'geplant';
  const teile: string[] = [];
  const { staerke, unvollstaendig } = staerkeImRaum(r.einheit_ids, einheiten);
  if (staerke && !unvollstaendig) teile.push(staerkeText(staerke));
  if (r.belegung.fahrzeuge > 0) teile.push(`${r.belegung.fahrzeuge} Fz`);
  return teile.length > 0 ? teile.join(' · ') : undefined;
}

/**
 * Bereitstellungsräume (LLH-1107): verortete als Marker, unverortete in „Nicht verortet".
 * Aufgelöste und stornierte fallen heraus, auch aus einem eingefrorenen Stand. Rolle `bedien` wie
 * UHS und Betreuungsstelle; das Zeichen D.2.1 hängt am Typ (`markerZeichen`), nicht an `tz`.
 * `einheiten` ist die Einheitenliste des Einsatzes (für die Stärke im Raum), `undefined` ohne
 * Modul Einheiten.
 */
export function buildBrMarker(
  raeume: readonly BrListenEintrag[],
  einheiten: readonly StaerkeTraeger[] | undefined,
  token: GlobalToken,
): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];
  for (const r of raeume) {
    if (r.storniert_at || r.status === 'aufgeloest') continue;
    if (r.lat != null && r.lon != null) {
      const zusatz = brZusatz(r, einheiten);
      verortet.push({
        schluessel: `bereitstellungsraum-${r.id}`,
        typ: 'bereitstellungsraum',
        id: r.id,
        lat: r.lat,
        lon: r.lon,
        label: r.bezeichnung,
        farbe: rollenFarbe(UHS_ROLLE, token),
        trefferDurchmesser: token.controlHeight,
        ...(zusatz ? { beschriftungZusatz: zusatz } : {}),
        ...(r.status === 'geplant' ? { isGeplant: true as const } : {}),
      });
    } else {
      nichtVerortet.push({ typ: 'bereitstellungsraum', id: r.id, label: r.bezeichnung });
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

/**
 * Neutrale DV-102-Tinte, wenn das freie Zeichen keine Füllung aus der Palette trägt: Farbe des
 * Markers (LFH-797). Ein Datenwert für das Zeichen auf weißem Grundzeichen, keine UI-Farbe — die
 * Symbolkachel im Inspector nimmt ohne Füllung eine Textrolle (Spec `lagekarte-taktische-zeichen`).
 */
export const FREIES_ZEICHEN_TINTE = '#333333';

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
  return zeichen.map((z) => {
    // Nur die Felder des Zeichens, gepflückt: der Adapter cacht nach ihnen.
    const eingabe: FreiesZeichenEingabe = {
      zeichen_spec: z.zeichen_spec,
      grundzeichen: z.grundzeichen,
      organisation: z.organisation,
      fachaufgabe: z.fachaufgabe,
      symbol: z.symbol,
      einheit: z.einheit,
      funktion: z.funktion,
      farbe: z.farbe,
    };
    return {
      schluessel: `freies_zeichen-${z.id}`,
      typ: 'freies_zeichen' as const,
      id: z.id,
      lat: z.lat,
      lon: z.lon,
      label: z.label ?? FREIES_ZEICHEN_ERSATZLABEL,
      farbe: fuellfarbe(freiesZeichenBild(eingabe).spec) ?? FREIES_ZEICHEN_TINTE,
      freiesZeichen: eingabe,
      trefferDurchmesser: token.controlHeight,
    };
  });
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
        // Nur die Qualifikation, nie die Einsatzfunktion: ein Freitext wie „Sprechfunker“ lenkte
        // das Zeichen sonst auf IuK um (LLH-1239). Die Einsatzfunktion steht als Text in der Leiste.
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
