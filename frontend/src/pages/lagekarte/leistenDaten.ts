import type {
  Einheit,
  Einsatzabschnitt,
  EinsatzFahrzeug,
  FuehrungskraftKarte,
  Rueckmeldungen,
  Schaden,
  Staerke,
  Uhs,
} from '../../api/types';
import type { OnlineStyle } from '../../api/karte';
import type { Farbrollen } from '../../theme/tokens';
import {
  schadenAusmass,
  schadenStatus,
  statusKategorie,
  uhsStatus,
  uhsTyp,
  type Statusrolle,
} from '../../theme/statusFarben';
import { MELDEWEG_WORT, rueckmeldungJeEinheit } from '../../meldungen/rueckmeldung';
import { einheitStatusAnzeige } from '../../kraefte/meldebildRaster';
import type { KarteMarker, MarkerTyp } from './marker';
import type { BasemapModus } from './basemapStil';
import type { LayerSichtbar } from './Sidebar';

/**
 * Reine Ableitungen der rechten Kartenleiste (Neuentwurf S5 „Karte führt, Daten folgen").
 *
 * Getrennt von `Sidebar.tsx`, damit Zähler, Datenraster und Kartengrundlage ohne Rendern
 * prüfbar sind. Der Basename kollidiert mit keiner `.tsx` (CLAUDE.md, `direkteinstiegKern`).
 */

// ── Ebenen ─────────────────────────────────────────────────────────────────────────────

/** Reihenfolge und Wortlaut der Ebenen-Zeilen — die zehn Schalter von vor LFH-648 plus
 *  „Betroffene" (LFH-648) am Ende: die einzige Ebene mit Vorgabe aus und Zugriffsgrenze. */
export const EBENEN: readonly { key: keyof LayerSichtbar; name: string }[] = [
  { key: 'einsatzort', name: 'Einsatzort' },
  { key: 'einheit', name: 'Einheiten' },
  { key: 'fahrzeug', name: 'Fahrzeuge' },
  { key: 'fuehrung', name: 'Personal' },
  { key: 'abschnitt', name: 'Abschnitte' },
  { key: 'zone', name: 'Zonen' },
  { key: 'uhs', name: 'UHS' },
  { key: 'schaden', name: 'Schäden' },
  { key: 'lagemeldung', name: 'Lagemeldungen' },
  { key: 'freies_zeichen', name: 'Taktische Zeichen' },
  { key: 'person', name: 'Betroffene' },
];

/**
 * Signaturfarbe je Ebene für das 14-px-Farbfeld — aus den Rollen, nicht aus einer eigenen
 * Palette. Wo die Karte eine Rollenfarbe zeichnet (Einsatzort `marke`, UHS `bedien`), ist es
 * dieselbe; wo sie eine Kartensignatur ohne Rolle trägt (Abschnitte, Lagemeldungen,
 * DV-102-Zeichen), steht die nächste Rolle — das Feld ist ein Wiedererkennungszeichen, keine
 * Legende der Marker-Tinte. Der zweite Kanal ist der Name der Zeile.
 */
export function ebenenFarbe(key: keyof LayerSichtbar, rollen: Farbrollen): string {
  switch (key) {
    case 'einsatzort':
      return rollen.marke;
    case 'zone':
    case 'schaden':
      return rollen.alarm;
    case 'abschnitt':
      return rollen.normal;
    case 'lagemeldung':
      return rollen.achtung;
    case 'freies_zeichen':
      return rollen.gedaempft;
    // Betroffene (LFH-648): die Marker tragen Sichtungsfarben, die ein einzelnes Farbfeld
    // nicht erklären kann — das tut die Sichtungslegende. Hier steht deshalb eine
    // neutrale Textstufe, und ausdrücklich NICHT der Default: Blau ist Bedienung.
    case 'person':
      return rollen.text2;
    default:
      return rollen.bedien;
  }
}

export interface EbenenZeile {
  key: keyof LayerSichtbar;
  name: string;
  /** Zahl der Objekte — oder „—", wenn die Lagebild-Quellen nicht vollständig geladen sind. */
  anzahl: number | '—';
  sichtbar: boolean;
}

/**
 * Die Zeilen des Paneels „Ebenen".
 *
 * `zonenAnzahl` ist die UNGEGATTERTE Zonenliste (`useLagekarteDaten().zonen`), nicht
 * `zonenFeatures` — die sind an den Zonen-Schalter gebunden, eine abgeschaltete Ebene
 * zeigte sonst „0" für Zonen, die es gibt. Die übrigen Zählungen kommen aus `alleVerortet`,
 * das jeden verorteten Marker mit seinem Ebenen-`typ` trägt (Abschnitte über ihre Fläche).
 *
 * Im Fehlerfall steht „—" statt einer Zahl: „UHS 0" ist eine Aussage über die Lage, und die
 * hat bei gescheitertem Abruf niemand geprüft (dieselbe Regel wie bisher an „Verortet").
 */
export function ebenenZeilen(
  verortet: readonly Pick<KarteMarker, 'typ'>[],
  zonenAnzahl: number,
  layer: LayerSichtbar,
  quellenFehler: boolean,
): EbenenZeile[] {
  const zaehlung = new Map<MarkerTyp, number>();
  for (const m of verortet) zaehlung.set(m.typ, (zaehlung.get(m.typ) ?? 0) + 1);
  return EBENEN.map(({ key, name }) => {
    const n = key === 'zone' ? zonenAnzahl : (zaehlung.get(key) ?? 0);
    return { key, name, anzahl: quellenFehler ? '—' : n, sichtbar: layer[key] };
  });
}

/** Zahl der verorteten Objekte für den Seitenkopf (ohne den Einsatzort-Anker). */
export function verortetAnzahl(verortet: readonly Pick<KarteMarker, 'typ'>[]): number {
  return verortet.filter((m) => m.typ !== 'einsatzort').length;
}

// ── Ausgewählt ────────────────────────────────────────────────────────────────────────

export interface AuswahlRoh {
  einheiten: readonly Einheit[];
  fahrzeuge: readonly EinsatzFahrzeug[];
  fuehrungskraefte: readonly FuehrungskraftKarte[];
  uhs: readonly Uhs[];
  schaeden: readonly Schaden[];
  abschnitte: readonly Einsatzabschnitt[];
  /**
   * Letzte Rückmeldung je Einheit (LFH-610). Optional und bewusst ohne Leerwert: fehlt sie
   * (lädt, 403 ohne Leserecht auf „Meldungen", Fehler, Historien-Modus), zeigt das Paneel
   * den Block „Letzte Meldung" gar nicht — eine leere Menge hieße dagegen „nie gemeldet".
   */
  rueckmeldungen?: Rueckmeldungen;
}

export const LEERE_ROHDATEN: AuswahlRoh = {
  einheiten: [],
  fahrzeuge: [],
  fuehrungskraefte: [],
  uhs: [],
  schaeden: [],
  abschnitte: [],
};

/** Ein Feld des Datenrasters: Augenbraue + Wert, optional mit Statusrolle (getönter Chip). */
export interface RasterFeld {
  label: string;
  wert: string;
  rolle?: Statusrolle;
  /** Wert in Mono (Zahlen, Zeiten, Kennungen) — Vorgabe ja. */
  mono?: boolean;
}

export const OBJEKTART: Record<MarkerTyp, string> = {
  uhs: 'Unfallhilfsstelle',
  schaden: 'Schaden',
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  fuehrung: 'Personal',
  abschnitt: 'Einsatzabschnitt',
  einsatzort: 'Einsatzort',
  lagemeldung: 'Lagemeldung',
  freies_zeichen: 'Taktisches Zeichen',
  // Nur auf der Betroffenen-Karte (LFH-613); die Lagekarte führt Personen nicht als Ebene.
  person: 'Person',
};

/** Stärke in BOS-Schreibweise `F/UF/M//Σ` (wie `StaerkeAnzeige`), „—" ohne Angabe. */
export function staerkeText(s: Staerke | null | undefined): string {
  if (!s) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = s;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}//${fuehrer + unterfuehrer + mannschaft}`;
}

const text = (w: string | null | undefined): string => (w && w.trim() ? w : '—');

/**
 * Mono-Unterzeile unter dem Namen: Objektart plus, wo die Daten es tragen, die Art im
 * Einzelnen (Einheitstyp, Fahrzeugtyp, Funktion).
 */
export function auswahlUnterzeile(marker: KarteMarker, roh: AuswahlRoh): string {
  const art = OBJEKTART[marker.typ];
  const zusatz = (() => {
    switch (marker.typ) {
      case 'einheit':
        return roh.einheiten.find((e) => e.id === marker.id)?.typ_label;
      case 'fahrzeug':
        return roh.fahrzeuge.find((f) => f.id === marker.id)?.fahrzeugtyp;
      case 'fuehrung':
        return roh.fuehrungskraefte.find((p) => p.id === marker.id)?.funktion;
      case 'uhs': {
        const u = roh.uhs.find((x) => x.id === marker.id);
        return u ? uhsTyp[u.typ]?.label : undefined;
      }
      default:
        return undefined;
    }
  })();
  return zusatz && zusatz.trim() ? `${art} · ${zusatz}` : art;
}

/**
 * Das Datenraster des Paneels „Ausgewählt" — nur Felder, die eine Datenquelle haben.
 *
 * Status und „Seit" einer EINHEIT und „Seit" eines Fahrzeugs kommen seit LFH-609 aus dem
 * DTO: der Einheitenstatus ist aus den Fahrzeugen abgeleitet (gemeinsam oder „gemischt")
 * oder von Hand gesetzt; ein unbekannter Zeitpunkt bleibt „—". „Letzte Meldung" (LFH-610)
 * steht nicht im Raster, sondern als eigener Block darunter — {@link letzteMeldungBlock}.
 *
 * `zeit` formatiert einen UTC-Zeitstempel nach den Anzeigekonventionen des Einsatzes.
 */
export function auswahlRaster(
  marker: KarteMarker,
  roh: AuswahlRoh,
  zeit: (utc: string | null | undefined) => string,
): RasterFeld[] {
  const abschnittName = (id: number | null | undefined) =>
    id == null ? '—' : text(roh.abschnitte.find((a) => a.id === id)?.name);
  switch (marker.typ) {
    case 'einheit': {
      const e = roh.einheiten.find((x) => x.id === marker.id);
      if (!e) return [];
      const st = einheitStatusAnzeige(e.status);
      const statusText = st.code ? `${st.code} · ${st.wort}` : st.wort;
      return [
        { label: 'Stärke', wert: staerkeText(e.ist) },
        {
          label: 'Status',
          wert: st.verteilung ? `${statusText} (${st.verteilung})` : statusText,
          rolle: e.status.kategorie ? statusKategorie[e.status.kategorie]?.rolle : undefined,
          mono: false,
        },
        { label: 'Seit', wert: e.status.seit ? zeit(e.status.seit) : '—' },
        { label: 'Abschnitt', wert: text(e.abschnitt_name), mono: false },
        { label: 'Führer', wert: text(e.fuehrer_name), mono: false },
      ];
    }
    case 'fahrzeug': {
      const f = roh.fahrzeuge.find((x) => x.id === marker.id);
      if (!f) return [];
      const einheit =
        f.einheit_id != null ? roh.einheiten.find((e) => e.id === f.einheit_id) : null;
      const felder: RasterFeld[] = [
        {
          label: 'Status',
          wert: text(f.status_label),
          rolle: f.status_kategorie ? statusKategorie[f.status_kategorie]?.rolle : undefined,
          mono: false,
        },
        { label: 'Seit', wert: f.status_seit ? zeit(f.status_seit) : '—' },
        { label: 'Disponiert', wert: f.disponiert_at ? zeit(f.disponiert_at) : '—' },
        { label: 'Einheit', wert: text(einheit?.name), mono: false },
      ];
      if (f.kennzeichen) felder.push({ label: 'Kennzeichen', wert: f.kennzeichen });
      return felder;
    }
    case 'fuehrung': {
      const p = roh.fuehrungskraefte.find((x) => x.id === marker.id);
      if (!p) return [];
      return [{ label: 'Funktion', wert: text(p.funktion), mono: false }];
    }
    case 'uhs': {
      const u = roh.uhs.find((x) => x.id === marker.id);
      if (!u) return [];
      const st = uhsStatus[u.status];
      return [
        { label: 'Status', wert: st?.label ?? u.status, rolle: st?.rolle, mono: false },
        { label: 'Abschnitt', wert: abschnittName(u.abschnitt_id), mono: false },
      ];
    }
    case 'schaden': {
      const s = roh.schaeden.find((x) => x.id === marker.id);
      if (!s) return [];
      const st = schadenStatus[s.status];
      const am = s.ausmass ? schadenAusmass[s.ausmass] : undefined;
      return [
        { label: 'Status', wert: st?.label ?? s.status, rolle: st?.rolle, mono: false },
        {
          label: 'Ausmaß',
          wert: am?.label ?? text(s.ausmass),
          rolle: am?.rolle,
          mono: false,
        },
      ];
    }
    case 'abschnitt': {
      const a = roh.abschnitte.find((x) => x.id === marker.id);
      if (!a) return [];
      const einheiten = roh.einheiten.filter((e) => e.abschnitt_id === a.id).length;
      return [
        { label: 'Leiter', wert: text(a.leiter_name), mono: false },
        { label: 'Einheiten', wert: String(einheiten) },
      ];
    }
    case 'lagemeldung':
      return marker.lageMeldung
        ? [{ label: 'Absender', wert: text(marker.lageMeldung.absender), mono: false }]
        : [];
    default:
      return [];
  }
}

export interface LetzteMeldungBlock {
  /** Wortlaut der Meldung. */
  text: string;
  /** Mono-Zeile „14:11 · Funk" — Zeit nach Anzeigekonvention · Meldeweg. */
  meta: string;
}

/**
 * Block „Letzte Meldung" einer ausgewählten EINHEIT (Neuentwurf S5, LFH-610): die jüngste an
 * die Einheit gebundene Meldung, gleich welcher Meldungsart. `null` — und damit KEIN Block —,
 * wenn der Marker keine Einheit ist, die Rückmeldungen nicht vorliegen oder die Einheit noch
 * nie gemeldet hat. Ein Platzhalter wie „—" stünde im Paneel als Aussage, die für die ersten
 * beiden Fälle nicht belegt ist; der dritte zeigt sich im Meldebild (S6), nicht hier.
 */
export function letzteMeldungBlock(
  marker: Pick<KarteMarker, 'typ' | 'id'>,
  roh: AuswahlRoh,
  zeit: (utc: string | null | undefined) => string,
): LetzteMeldungBlock | null {
  if (marker.typ !== 'einheit' || !roh.rueckmeldungen) return null;
  const r = rueckmeldungJeEinheit(roh.rueckmeldungen).get(marker.id);
  if (!r) return null;
  return { text: r.inhalt, meta: `${zeit(r.ereigniszeit)} · ${MELDEWEG_WORT[r.meldeweg]}` };
}

// ── Kartengrundlage ───────────────────────────────────────────────────────────────────

/** Wert eines Segments: `online:<Stilname>` · `offline` · `blind`. */
export type GrundlageWert = string;

export interface GrundlageOption {
  wert: GrundlageWert;
  label: string;
  /** Gesetzt = nicht wählbar, mit Grund (Tooltip/Name) — statt still zu fehlen. */
  gesperrt?: string;
}

/**
 * Die Segmente der Kartengrundlage — was es gibt, sonst nichts.
 *
 * Je Online-Stil aus `config.online_styles` ein Segment (die Stilnamen sind die Wahl, die
 * vorher im Unter-Select stand); ist keiner konfiguriert, steht EIN gesperrtes „Online" da.
 * „Lage / Gelände / Satellit" aus dem Entwurf S5 sind deshalb KEINE festen Rollen, sondern
 * die Namen der übernommenen Quellen (LFH-616): der Katalog bietet „TopPlusOpen" als Gelände
 * und „Satellit (Esri)" als Luftbild an, Offline hat kein Luftbild.
 * Offline ist gesperrt, wenn es nicht verfügbar ist. Gesperrt statt ausgeblendet: dass eine
 * Grundlage fehlt, ist eine Aussage über die Installation, die die Einsatzkraft braucht.
 */
export function grundlageOptionen(
  onlineStyles: readonly OnlineStyle[],
  offlineVerfuegbar: boolean,
): GrundlageOption[] {
  const online: GrundlageOption[] =
    onlineStyles.length > 0
      ? onlineStyles.map((s) => ({ wert: `online:${s.name}`, label: s.name }))
      : [{ wert: 'online:', label: 'Online', gesperrt: 'Online-Karte nicht konfiguriert' }];
  return [
    ...online,
    {
      wert: 'offline',
      label: 'Offline',
      gesperrt: offlineVerfuegbar ? undefined : 'Offline-Karte nicht konfiguriert',
    },
    { wert: 'blind', label: 'Blind' },
  ];
}

/** Der aktive Segmentwert aus Modus und Online-Stil (ohne gewählten Stil: der erste). */
export function grundlageWert(
  basemap: BasemapModus,
  onlineStilName: string | null,
  onlineStyles: readonly OnlineStyle[],
): GrundlageWert {
  if (basemap !== 'online') return basemap;
  return `online:${onlineStilName ?? onlineStyles[0]?.name ?? ''}`;
}

/** Segmentwert → Modus und (bei Online) Stilname. */
export function grundlageAufloesen(wert: GrundlageWert): {
  basemap: BasemapModus;
  stilName: string | null;
} {
  if (wert.startsWith('online:')) {
    const name = wert.slice('online:'.length);
    return { basemap: 'online', stilName: name || null };
  }
  return { basemap: wert === 'offline' ? 'offline' : 'blind', stilName: null };
}
