/**
 * Zentrale, typsichere Deeplink-/URL-Builder für den Einsatz-Workspace (LFH-25) — Routen,
 * Param-Namen und Query-Konventionen an EINER Stelle, statt inline Template-Literals.
 *
 * Bare `/einsaetze/:id`-Breadcrumbs und dynamische Modul-Navigation (`modulZielRoute`) bleiben
 * inline; bei Routenänderungen auch nach Inline-Literalen suchen.
 *
 * Muster:
 *  - **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` → Vollseiten-Detail.
 *  - **Query-Param** `?<modul>=<id>` → Selektion auf der Listenseite, wenn es keine
 *    Detail-Route gibt bzw. ein Eintrag einer Liste adressiert wird (etb).
 *  - **`?neu=1`** → Schnellerfassung auf der Listenseite fokussieren.
 *
 * Die Builder gehen von gültigen, positiven Integer-IDs aus; URL-Parameter validiert
 * `parseRouteId`, Render-Stellen mit möglicherweise fehlender ID guarden vor dem Aufruf.
 */
import type { EtbFilterWerte } from '../api/etb';
import {
  AUSWAHL_PARAM,
  auswahlParam,
  parseBerichtAuswahl,
  type BlockSchluessel,
} from '../druck/einsatzbericht/auswahl';
import type { EtbTyp, SchadenStatus, Spezies, ZoneTyp } from '../api/types';
import type { PersonenAnsicht, PersonenFilter } from '../personen/personenFilter';
import type { TiereSicht } from '../pages/tiere/tierHelfer';
import type { SchaedenSicht } from '../pages/schaeden/schadenHelfer';

/** Zentrale Route zur Einsatzliste. */
export function einsaetzePfad(): string {
  return '/einsaetze';
}

/** Zentrale Route zum Einsatz-Workspace. */
export function einsatzPfad(einsatzId: number): string {
  return `/einsaetze/${einsatzId}`;
}

/** Basis-Pfad eines Einsatz-Moduls: `/einsaetze/<einsatzId>/<modulRoute>`. */
export function einsatzModulPfad(einsatzId: number, modulRoute: string): string {
  return `/einsaetze/${einsatzId}/${modulRoute}`;
}

function mitQuery(pfad: string, params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    // Leere Strings fallen heraus: `?q=` wäre ein gesetzter Filter auf nichts.
    .filter(([, v]) => v !== undefined && v !== '')
    /*
     * Kodiert, weil der ETB-Suchbegriff Freitext mit `&`, `=` und Leerzeichen sein darf. Für
     * Zahlen und Schlüssel ist die Kodierung die Identität.
     */
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${pfad}?${qs}` : pfad;
}

// ── Item-Routes (Vollseiten-Detail) ──────────────────────────────────────────

export function uhsDetailPfad(einsatzId: number, uhsId: number): string {
  return `${einsatzModulPfad(einsatzId, 'unfallhilfsstellen')}/${uhsId}`;
}

export function bereitstellungsraumDetailPfad(einsatzId: number, brId: number): string {
  return `${einsatzModulPfad(einsatzId, 'bereitstellungsraeume')}/${brId}`;
}

export function lageberichtDetailPfad(einsatzId: number, lageberichtId: number): string {
  return `${einsatzModulPfad(einsatzId, 'lageberichte')}/${lageberichtId}`;
}

export function befehlDetailPfad(einsatzId: number, befehlId: number): string {
  return `${einsatzModulPfad(einsatzId, 'auftraege')}/befehle/${befehlId}`;
}

export function personDetailPfad(einsatzId: number, personId: number): string {
  return `${einsatzModulPfad(einsatzId, 'personen')}/${personId}`;
}

export function tiereDetailPfad(einsatzId: number, tierId: number): string {
  return `${einsatzModulPfad(einsatzId, 'tiere')}/${tierId}`;
}

export function schadenDetailPfad(einsatzId: number, schadenId: number): string {
  return `${einsatzModulPfad(einsatzId, 'schaeden')}/${schadenId}`;
}

// ── Listen-Routes (auch NaN-Redirect-Ziele) ──────────────────────────────────

/**
 * Die UHS-Listenroute; `UnfallhilfsstellenPage` liest `?neu=1`.
 * Die Liste liegt unter `/unfallhilfsstellen/liste`; der bare Modulpfad zeigt auf
 * `UnfallhilfsstellenDefault`, das `?neu=1` nicht liest.
 */
export function unfallhilfsstellenListePfad(
  einsatzId: number,
  opts: { neu?: boolean } = {},
): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'unfallhilfsstellen')}/liste`, {
    neu: opts.neu ? 1 : undefined,
  });
}

export function bereitstellungsraeumePfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'bereitstellungsraeume');
}

/**
 * Tabellenansicht aller Bereitstellungsräume; der Modul-Index springt direkt in den zuletzt
 * gewählten BR (wie `unfallhilfsstellen/liste`). `BereitstellungsraeumePage` liest `?neu=1` —
 * die Schnellerfassung zeigt deshalb hierher, nicht auf {@link bereitstellungsraeumePfad}
 * (`BereitstellungsraeumeDefault` liest den Parameter nicht, LFH-506).
 */
export function bereitstellungsraeumeListePfad(
  einsatzId: number,
  opts: { neu?: boolean } = {},
): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'bereitstellungsraeume')}/liste`, {
    neu: opts.neu ? 1 : undefined,
  });
}

export function lageberichtePfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'lageberichte');
}

/**
 * Führungsüberblick eines Einsatzes — die Startseite, auf die `/einsaetze/:id` umleitet
 * (`redirectZiel` in `einsatz/modulRegistry.ts`).
 */
export function ueberblickPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'ueberblick');
}

/**
 * Aggregierende Kräfteübersicht, in der Navigation „Meldebild". Der Routenschlüssel
 * `kraefteuebersicht` bleibt, damit bestehende Deeplinks tragen.
 */
export function kraefteuebersichtPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'kraefteuebersicht');
}

/** Tier-Liste; `?neu=1` öffnet die Schnellerfassung (`TierePage`). */
export function tierePfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'tiere'), { neu: opts.neu ? 1 : undefined });
}

export function einsatzdatenPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'einsatzdaten');
}

/**
 * Druckansicht des Einsatzberichts (LFH-726): Unterroute der Einsatzdaten, erbt deren Freigabe.
 * Die Auswahl der Blöcke reist als `?bloecke=` (LFH-902); der Standardumfang schreibt nichts.
 */
export function einsatzberichtPfad(
  einsatzId: number,
  auswahl?: readonly BlockSchluessel[],
): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'einsatzdaten')}/bericht`, {
    [AUSWAHL_PARAM]: auswahl ? auswahlParam(auswahl) : undefined,
  });
}

/** Umkehr von {@link einsatzberichtPfad}: unbekannte Schlüssel fallen weg, leer = Standardumfang. */
export { parseBerichtAuswahl };

export function erinnerungenPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'erinnerungen');
}

// ── Listen mit Query-Selektion / Schnellerfassung ────────────────────────────

export function personenPfad(
  einsatzId: number,
  opts: {
    person?: number;
    neu?: boolean;
    /**
     * Sichtvorgabe: die Seite übernimmt sie beim Ankommen und räumt die Parameter
     * (apply-then-clean). Die URL trägt einen AUFTRAG, keinen gespiegelten Filter. Anspringer
     * sind die Sprungmarken „Patienten" und „Vermisste" (`einsatz/sprungmarken.ts`).
     */
    filter?: PersonenFilter;
    ansicht?: PersonenAnsicht;
  } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'personen'), {
    person: opts.person,
    neu: opts.neu ? 1 : undefined,
    filter: opts.filter,
    ansicht: opts.ansicht,
  });
}

/**
 * Erlaubte Werte der Personen-Sichtvorgabe — exhaustive Records wie {@link ETB_TYP_ERLAUBT}.
 * Bewusst KEIN `'patienten'`: „Patient" ist eine Darstellung (`ansicht: 'raster'`), kein Status.
 */
const PERSONEN_FILTER_ERLAUBT: Record<PersonenFilter, true> = {
  alle: true,
  erfasst: true,
  vermisst: true,
  betroffen: true,
  verstorben: true,
};
const PERSONEN_ANSICHT_ERLAUBT: Record<PersonenAnsicht, true> = {
  zeilen: true,
  raster: true,
  karte: true,
};

/**
 * Umkehr der Sichtvorgabe von {@link personenPfad}. Je Achse wird ein unbekannter Wert GANZ
 * verworfen; die andere Achse bleibt unberührt.
 */
export function parsePersonenSicht(params: URLSearchParams): {
  filter?: PersonenFilter;
  ansicht?: PersonenAnsicht;
} {
  const werte: { filter?: PersonenFilter; ansicht?: PersonenAnsicht } = {};
  const filter = params.get('filter');
  if (filter && Object.prototype.hasOwnProperty.call(PERSONEN_FILTER_ERLAUBT, filter)) {
    werte.filter = filter as PersonenFilter;
  }
  const ansicht = params.get('ansicht');
  if (ansicht && Object.prototype.hasOwnProperty.call(PERSONEN_ANSICHT_ERLAUBT, ansicht)) {
    werte.ansicht = ansicht as PersonenAnsicht;
  }
  return werte;
}

/**
 * Vollseiten-Aufnahme für Personen — die ANSPRING-Adresse für andere Module (ein Modal hat
 * keine); beide Wege tragen dasselbe Bauteil `personen/AufnahmeFelder`.
 * Der optionale `uhs`-Auftrag (von der UHS-Kopfzeile) reist im Query-Param und überlebt damit
 * einen Neuladen; die Aufnahmeseite bucht nach dem Anlegen den Eintritt in den Wartebereich.
 */
export function personenAufnahmePfad(einsatzId: number, opts: { uhs?: number } = {}): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'personen')}/aufnahme`, { uhs: opts.uhs });
}

export function schaedenPfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'schaeden'), {
    neu: opts.neu ? 1 : undefined,
  });
}

/** Dokumentenablage: Listenseite, `?neu=1` fokussiert die Ablage-Erfassung. */
export function dokumentePfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'dokumente'), {
    neu: opts.neu ? 1 : undefined,
  });
}

/** Ablösungs-Modul: Schichten und fällige Ablösungen je Einheit. */
export function abloesungPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'abloesung');
}

/** Verpflegungs-Modul: Zeitfenster mit Bedarf, Ausgaben und Deckung. */
export function verpflegungPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'verpflegung');
}

/** Fachmodul „Wetter & Pegel": Pegel mit Verlauf, DWD-Warnungen, Vorhersage. */
export function wetterPegelPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'wetter-pegel');
}

/**
 * Ziel eines Pegel-Verweises: die Modulseite, wenn sie für die Person frei ist, sonst
 * Einstellungen › Pegel. „Frei?" beantwortet der Aufrufer (`istKeyFreigegeben`).
 */
export function pegelZielPfad(einsatzId: number, modulFrei: boolean): string {
  return modulFrei ? wetterPegelPfad(einsatzId) : einsatzEinstellungenPfad(einsatzId, 'pegel');
}

/**
 * Betreuungs-Modul. Keine Detailroute — Bezirk bzw. Stelle per Query-Param (`?bezirk=<id>` /
 * `?stelle=<id>`), die Seite scrollt auf die Zeile.
 */
export function betreuungPfad(
  einsatzId: number,
  opts: { bezirk?: number; stelle?: number } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'betreuung'), {
    bezirk: opts.bezirk,
    stelle: opts.stelle,
  });
}

/** Stab-Modul. `?neu=1` liest und räumt die Seite (Abschluss der Lagebesprechung). */
export function stabPfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'stab'), {
    neu: opts.neu ? 1 : undefined,
  });
}

/**
 * Funkplan des Sachgebiets S6 (LFH-548): eine Unterroute des Stabs, kein eigenes Modul. Die
 * Navigation markiert den Stab (`modulAusPfad` liest das Segment nach der Einsatz-ID), Sperre und
 * Sichtbarkeit erbt die Seite vom Stab.
 */
export function funkplanPfad(einsatzId: number, opts: { ansicht?: FunkplanAnsicht } = {}): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'stab')}/funkplan`, { ansicht: opts.ansicht });
}

/**
 * Darstellung des Funkplans: Tabelle, Fernmeldeskizze (LFH-625) oder Kanalbelegung je
 * Sprechgruppe (LFH-848 D8). `ansicht` ist ein AUFTRAG wie bei {@link einsatzabschnittePfad}
 * (apply-then-clean); als Lesezeichen taugt die Adresse ohne.
 */
export type FunkplanAnsicht = 'tabelle' | 'skizze' | 'sprechgruppen';

const FUNKPLAN_ANSICHT_ERLAUBT: Record<FunkplanAnsicht, true> = {
  tabelle: true,
  skizze: true,
  sprechgruppen: true,
};

/** Umkehr von {@link funkplanPfad}: ein unbekannter Wert wird GANZ verworfen. */
export function parseFunkplanAnsicht(params: URLSearchParams): FunkplanAnsicht | undefined {
  const ansicht = params.get('ansicht');
  return ansicht && Object.prototype.hasOwnProperty.call(FUNKPLAN_ANSICHT_ERLAUBT, ansicht)
    ? (ansicht as FunkplanAnsicht)
    : undefined;
}

/**
 * Kommunikationsplan des Sachgebiets S6 (LFH-848): Verbindungen außerhalb des Funks je Stelle.
 * Unterroute des Stabs wie der Funkplan.
 */
export function kommunikationsplanPfad(einsatzId: number): string {
  return `${einsatzModulPfad(einsatzId, 'stab')}/kommunikationsplan`;
}

/**
 * Pressearbeit des Sachgebiets S5 (LFH-554): Presse-Log, Pressemitteilungen und Medienlage. Wie
 * der Funkplan eine Unterroute des Stabs, kein eigenes Modul. `?kontakt=<id>` rollt zu einem
 * Medienkontakt (Auslesen über `parseRouteId`).
 */
export function pressePfad(einsatzId: number, opts: { kontakt?: number } = {}): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'stab')}/presse`, { kontakt: opts.kontakt });
}

/** Detailseite einer Pressemitteilung (Item-Route unter der Presseseite). */
export function pressemitteilungPfad(einsatzId: number, mitteilungId: number): string {
  return `${pressePfad(einsatzId)}/mitteilungen/${mitteilungId}`;
}

/**
 * Anrufprotokoll des Informationstelefons (S5, LFH-554), Unterroute des Stabs. `?anruf=<id>`
 * rollt zu einem Anruf.
 */
export function infotelefonPfad(einsatzId: number, opts: { anruf?: number } = {}): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'stab')}/infotelefon`, { anruf: opts.anruf });
}

/**
 * Erlaubte Werte des ETB-Typfilters.
 *
 * Ein **exhaustiver Record**, kein Array: fehlt eine Variante von `EtbTyp`, bricht der
 * Typcheck, statt dass `parseEtbFilter` sie still verwirft. Bewusst nicht aus
 * `theme/statusFarben` abgeleitet: das zöge die Theme-Schicht in ein reines String-Modul.
 */
const ETB_TYP_ERLAUBT: Record<EtbTyp, true> = {
  meldung: true,
  anordnung: true,
  lage: true,
  entscheidung: true,
  system: true,
  berichtigung: true,
};

export function etbPfad(
  einsatzId: number,
  opts: {
    eintrag?: number;
    neu?: boolean;
    /** Filterachse. Leere Werte fallen in `mitQuery` heraus. */
    q?: string;
    typ?: EtbTyp;
    von?: string;
    bis?: string;
    /** „Betrifft Einheit" — der Knopf „ETB ↗" an der Einheit auf der Lagekarte. */
    einheit_id?: number;
  } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'etb'), {
    eintrag: opts.eintrag,
    neu: opts.neu ? 1 : undefined,
    q: opts.q,
    typ: opts.typ,
    von: opts.von,
    bis: opts.bis,
    einheit_id: opts.einheit_id,
  });
}

/**
 * Druckansicht des Tagebuchs mit derselben Filterachse wie {@link etbPfad}; eine Umkehr
 * ({@link parseEtbFilter}) für beide Adressen, damit genau die gezeigte Auswahl gedruckt wird.
 */
export function etbDruckPfad(
  einsatzId: number,
  filter: Pick<EtbFilterWerte, 'q' | 'typ' | 'von' | 'bis' | 'einheit_id'>,
): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'etb')}/druck`, {
    q: filter.q,
    typ: filter.typ,
    von: filter.von,
    bis: filter.bis,
    einheit_id: filter.einheit_id,
  });
}

/**
 * Umkehr der Filterachse von {@link etbPfad}.
 *
 * Verwirft Unbrauchbares GANZ: ein unbekannter Typ ergibt gar keinen Filter, sonst entstünde
 * ein Query-Key, den der Server mit 400 quittiert, während die Leiste einen gültigen Stand
 * zeigt. Die Zeitwerte gehen ungeprüft durch; ihre Umkehr macht `anzeige/zeitEingabe.ts`.
 */
export function parseEtbFilter(params: URLSearchParams): EtbFilterWerte {
  const werte: EtbFilterWerte = {};
  const q = params.get('q');
  if (q) werte.q = q;
  const typ = params.get('typ');
  if (typ && Object.prototype.hasOwnProperty.call(ETB_TYP_ERLAUBT, typ)) {
    werte.typ = typ as EtbTyp;
  }
  const von = params.get('von');
  if (von) werte.von = von;
  const bis = params.get('bis');
  if (bis) werte.bis = bis;
  // Wie `parseRouteId`: `abc` oder `0` ergäben am Server 400 bzw. einen Filter auf nichts.
  const einheit = parseRouteId(params.get('einheit_id') ?? undefined);
  if (einheit != null) werte.einheit_id = einheit;
  return werte;
}

// ── Druckansichten der Modul-Listen (LFH-727, design.md D5) ──────────────────────────
//
// Die Adresse trägt den Seitenfilter der Liste, damit genau die gezeigte Auswahl gedruckt wird
// und ein Neuladen sie behält. Ein fehlender Wert heißt „alle“, NICHT die Vorgabe der Liste —
// die Liste übergibt ihre Sicht deshalb immer ausdrücklich. Ein unbekannter Wert fällt je Achse
// ganz weg (exhaustive Records wie {@link ETB_TYP_ERLAUBT}).

/** Auswahl der Personen-Druckansicht: Statusfilter und Schalter „nur offene Felder“. */
export interface PersonenDruckAuswahl {
  filter: PersonenFilter;
  nurLuecken: boolean;
}

export function personenDruckPfad(einsatzId: number, auswahl: PersonenDruckAuswahl): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'personen')}/druck`, {
    filter: auswahl.filter === 'alle' ? undefined : auswahl.filter,
    luecken: auswahl.nurLuecken ? 1 : undefined,
  });
}

/** Umkehr von {@link personenDruckPfad}. */
export function parsePersonenDruckAuswahl(params: URLSearchParams): PersonenDruckAuswahl {
  const filter = params.get('filter');
  return {
    filter:
      filter && Object.prototype.hasOwnProperty.call(PERSONEN_FILTER_ERLAUBT, filter)
        ? (filter as PersonenFilter)
        : 'alle',
    nurLuecken: params.get('luecken') === '1',
  };
}

/** Auswahl der Tiere-Druckansicht: Statussicht und optional eine Spezies. */
export interface TiereDruckAuswahl {
  sicht: TiereSicht;
  spezies?: Spezies;
}

const TIERE_SICHT_ERLAUBT: Record<TiereSicht, true> = {
  aktiv: true,
  vermisst: true,
  abgeschlossen: true,
  alle: true,
};
const SPEZIES_ERLAUBT: Record<Spezies, true> = {
  hund: true,
  katze: true,
  grosstier: true,
  nutzgefluegel: true,
  kleintier: true,
  wildtier: true,
  sonstige: true,
};

export function tiereDruckPfad(einsatzId: number, auswahl: TiereDruckAuswahl): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'tiere')}/druck`, {
    sicht: auswahl.sicht === 'alle' ? undefined : auswahl.sicht,
    spezies: auswahl.spezies,
  });
}

/** Umkehr von {@link tiereDruckPfad}. */
export function parseTiereDruckAuswahl(params: URLSearchParams): TiereDruckAuswahl {
  const sicht = params.get('sicht');
  const spezies = params.get('spezies');
  const auswahl: TiereDruckAuswahl = {
    sicht:
      sicht && Object.prototype.hasOwnProperty.call(TIERE_SICHT_ERLAUBT, sicht)
        ? (sicht as TiereSicht)
        : 'alle',
  };
  if (spezies && Object.prototype.hasOwnProperty.call(SPEZIES_ERLAUBT, spezies)) {
    auswahl.spezies = spezies as Spezies;
  }
  return auswahl;
}

/** Auswahl der Schäden-Druckansicht: die Statussicht der Liste. */
export interface SchaedenDruckAuswahl {
  sicht: SchaedenSicht;
}

const SCHAEDEN_SICHT_ERLAUBT: Record<SchadenStatus | 'alle', true> = {
  offen: true,
  uebergeben: true,
  abgeschlossen: true,
  alle: true,
};

export function schaedenDruckPfad(einsatzId: number, auswahl: SchaedenDruckAuswahl): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'schaeden')}/druck`, {
    sicht: auswahl.sicht === 'alle' ? undefined : auswahl.sicht,
  });
}

/** Umkehr von {@link schaedenDruckPfad}. */
export function parseSchaedenDruckAuswahl(params: URLSearchParams): SchaedenDruckAuswahl {
  const sicht = params.get('sicht');
  return {
    sicht:
      sicht && Object.prototype.hasOwnProperty.call(SCHAEDEN_SICHT_ERLAUBT, sicht)
        ? (sicht as SchaedenSicht)
        : 'alle',
  };
}

export function personalPfad(einsatzId: number, opts: { personal?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'personal'), { personal: opts.personal });
}

export function einheitenPfad(einsatzId: number, opts: { einheit?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'einheiten'), { einheit: opts.einheit });
}

/**
 * Vollseiten-Detail je Einheit (Kopfdaten plus drei Zuordnungslisten, zu viel für eine
 * Listenhälfte). `einheitenPfad(id, { einheit })` bleibt für Bestands-Deeplinks; die
 * Listenseite leitet sie hierher weiter.
 */
export function einheitDetailPfad(einsatzId: number, einheitId: number): string {
  return `${einsatzModulPfad(einsatzId, 'einheiten')}/${einheitId}`;
}

/**
 * Darstellung der Fahrzeugseite: Tabelle oder FMS-Tableau. Das Tableau ist eine ANSICHT dieses
 * Moduls, kein eigenes: Endpunkte und Live-Ereignis hängen am Schlüssel `fahrzeuge`, ein eigener
 * Schlüssel endete in 403 ohne Live-Updates. Anspringer ist die Sprungmarke „FMS-Tableau".
 */
export type FahrzeugeAnsicht = 'liste' | 'tableau';

/** `ansicht` ist ein AUFTRAG wie bei {@link personenPfad} (apply-then-clean). */
export function fahrzeugePfad(
  einsatzId: number,
  opts: { fahrzeug?: number; ansicht?: FahrzeugeAnsicht } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'fahrzeuge'), {
    fahrzeug: opts.fahrzeug,
    ansicht: opts.ansicht,
  });
}

/** Exhaustiver Record aus demselben Grund wie {@link ETB_TYP_ERLAUBT}. */
const FAHRZEUGE_ANSICHT_ERLAUBT: Record<FahrzeugeAnsicht, true> = {
  liste: true,
  tableau: true,
};

/** Umkehr von {@link fahrzeugePfad}: ein unbekannter Wert wird GANZ verworfen. */
export function parseFahrzeugeAnsicht(params: URLSearchParams): FahrzeugeAnsicht | undefined {
  const ansicht = params.get('ansicht');
  return ansicht && Object.prototype.hasOwnProperty.call(FAHRZEUGE_ANSICHT_ERLAUBT, ansicht)
    ? (ansicht as FahrzeugeAnsicht)
    : undefined;
}

/**
 * Darstellung der Seite Einsatzabschnitte: Gliederung (Baum + Detail) oder Organigramm der
 * Führungsorganisation (LFH-626). Das Organigramm ist eine ANSICHT dieses Moduls, kein eigenes —
 * Daten, Freigabe und Live-Ereignis hängen am Schlüssel `einsatzabschnitte` (Muster FMS-Tableau).
 */
export type AbschnitteAnsicht = 'gliederung' | 'organigramm';

/**
 * Einsatzabschnitte; `?abschnitt=` selektiert, `?neu=1` öffnet den Entwurf eines neuen.
 * `ansicht` ist ein AUFTRAG wie bei {@link fahrzeugePfad} (apply-then-clean).
 */
export function einsatzabschnittePfad(
  einsatzId: number,
  opts: { abschnitt?: number; neu?: boolean; ansicht?: AbschnitteAnsicht } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'einsatzabschnitte'), {
    abschnitt: opts.abschnitt,
    neu: opts.neu ? 1 : undefined,
    ansicht: opts.ansicht,
  });
}

/** Exhaustiver Record aus demselben Grund wie {@link ETB_TYP_ERLAUBT}. */
const ABSCHNITTE_ANSICHT_ERLAUBT: Record<AbschnitteAnsicht, true> = {
  gliederung: true,
  organigramm: true,
};

/** Umkehr von {@link einsatzabschnittePfad}: ein unbekannter Wert wird GANZ verworfen. */
export function parseAbschnitteAnsicht(params: URLSearchParams): AbschnitteAnsicht | undefined {
  const ansicht = params.get('ansicht');
  return ansicht && Object.prototype.hasOwnProperty.call(ABSCHNITTE_ANSICHT_ERLAUBT, ansicht)
    ? (ansicht as AbschnitteAnsicht)
    : undefined;
}

export function meldungenPfad(einsatzId: number, opts: { meldung?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'meldungen'), { meldung: opts.meldung });
}

/**
 * Vorbelegung der Nachforderungs-Erfassung (z. B. „Nachfordern" aus der Verpflegung). Keine
 * Personenangaben: nur Bezeichnungen und Zahlen.
 */
export interface NachforderungVorbelegung {
  art: string;
  bezeichnung: string;
  /** Positive Ganzzahl. */
  anzahl: number;
  begruendung?: string;
}

/**
 * Nachforderungsseite. `?neu=1` öffnet die Erfassung; eine `vorbelegung` setzt `neu=1` selbst
 * und hängt `art`, `bezeichnung`, `anzahl` und `begruendung` kodiert an. Die Seite räumt alles
 * nach dem Lesen.
 */
export function nachforderungenPfad(
  einsatzId: number,
  opts: { neu?: boolean; vorbelegung?: NachforderungVorbelegung } = {},
): string {
  const v = opts.vorbelegung;
  return mitQuery(einsatzModulPfad(einsatzId, 'nachforderungen'), {
    neu: opts.neu || v ? 1 : undefined,
    art: v?.art,
    bezeichnung: v?.bezeichnung,
    anzahl: v?.anzahl,
    begruendung: v?.begruendung,
  });
}

/** Die Query-Schlüssel der Vorbelegung — die Seite räumt genau diese (plus `neu`). */
export const NACHFORDERUNG_VORBELEGUNG_PARAMS = [
  'art',
  'bezeichnung',
  'anzahl',
  'begruendung',
] as const;

/**
 * Liest die Vorbelegung aus `?art=…&bezeichnung=…&anzahl=…&begruendung=…` zurück.
 *
 * Unbrauchbares wird GANZ verworfen: eine vorbelegte Erfassung ohne Fehlmenge forderte das
 * Falsche nach. `anzahl` muss eine positive Ganzzahl in Dezimalschreibweise sein (`Number()`
 * nähme auch `1e2`), `art` und `bezeichnung` nicht leer; `begruendung` ist optional.
 *
 * `neu` liest dieser Parser bewusst NICHT: ein `get('neu')`-Leser in dieser Datei wäre für
 * `schnellaktionen.guard.test.ts` keinem Modul zuordenbar.
 */
export function parseNachforderungVorbelegung(
  params: URLSearchParams,
): NachforderungVorbelegung | null {
  const art = params.get('art')?.trim();
  const bezeichnung = params.get('bezeichnung')?.trim();
  const roheAnzahl = params.get('anzahl');
  if (!art || !bezeichnung || roheAnzahl == null || !/^[1-9]\d*$/.test(roheAnzahl)) return null;
  const anzahl = Number(roheAnzahl);
  if (!Number.isSafeInteger(anzahl)) return null;
  const begruendung = params.get('begruendung')?.trim();
  return begruendung ? { art, bezeichnung, anzahl, begruendung } : { art, bezeichnung, anzahl };
}

export function auftraegePfad(einsatzId: number, opts: { auftrag?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'auftraege'), { auftrag: opts.auftrag });
}

export function gefahrenPfad(einsatzId: number, opts: { gefahrengebiet?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'gefahren'), { gefahrengebiet: opts.gefahrengebiet });
}

/**
 * Lagekarte, optional mit vorselektiertem Gefahrengebiet: die Karte selektiert das Gebiet und
 * fliegt es an (keine Detailseite je Gebiet).
 */
export function lagekartePfad(
  einsatzId: number,
  opts: {
    gefahrengebiet?: number;
    ansicht?: number;
    snapshot?: number;
    platzieren?: { typ: PlatzierenZielTyp; id: number };
    zeichnen?: ZeichnenAuftrag;
    zentrum?: Kartenzentrum;
    /** Adresssuche (LFH-638): die Karte übernimmt den Text ins Suchfeld und sucht ihn. */
    ort?: string;
    evakuierungsbezirk?: number;
  } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'lagekarte'), {
    gefahrengebiet: opts.gefahrengebiet,
    // Bezirksfläche: die Karte wählt eine Zone des Bezirks, fliegt hin und räumt den Parameter.
    evakuierungsbezirk: opts.evakuierungsbezirk,
    ansicht: opts.ansicht,
    // Historien-Modus: ?snapshot=<id> zeigt den eingefrorenen Stand (schreibgeschützt).
    snapshot: opts.snapshot,
    // Platzier-Auftrag: der nächste Klick auf die Karte setzt die Koordinate dieses Objekts.
    platzieren: opts.platzieren ? `${opts.platzieren.typ}:${opts.platzieren.id}` : undefined,
    // Zeichnen-Auftrag (LFH-825): die Karte betritt den Zonen-Zeichenmodus dieses Typs und räumt.
    zeichnen: opts.zeichnen
      ? opts.zeichnen.form
        ? `${opts.zeichnen.typ}:${opts.zeichnen.form}`
        : opts.zeichnen.typ
      : undefined,
    // Kartenmittelpunkt (Koordinatensprung der Sprungpalette): die Karte fliegt hin und räumt den
    // Parameter. Fünf Nachkommastellen ≙ rund 1 m.
    zentrum: opts.zentrum ? `${runde5(opts.zentrum.lat)},${runde5(opts.zentrum.lon)}` : undefined,
    // Adresssuche der Sprungpalette (LFH-638): Suchfeld der Leiste vorbelegen, suchen, räumen.
    ort: opts.ort,
  });
}

/** Ein WGS84-Punkt, auf den die Lagekarte springen soll. */
interface Kartenzentrum {
  lat: number;
  lon: number;
}

/** Rundet auf fünf Nachkommastellen, ohne abschliessende Nullen in die URL zu schreiben. */
function runde5(x: number): string {
  return String(Number(x.toFixed(5)));
}

/**
 * Liest den Kartenmittelpunkt aus `?zentrum=<lat>,<lon>` zurück.
 * Unbrauchbares wird GANZ verworfen — eine halbe Koordinate schickte die Karte auf den
 * Nullmeridian. Der Wertebereich wird mitgeprüft, weil der Parameter ein Fremd-Link sein kann.
 */
export function parseKartenzentrum(wert: string | null | undefined): Kartenzentrum | null {
  if (!wert) return null;
  const teile = wert.split(',');
  if (teile.length !== 2 || teile.some((t) => t.trim() === '')) return null;
  const [lat, lon] = teile.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Objekttypen, die von außen zum Verorten auf die Karte geschickt werden können — bewusst
 * enger als der karteninterne `PlatzierenPunktTyp`. Wer erweitert, prüft
 * `pages/LagekartePage.tsx` mit.
 */
type PlatzierenZielTyp = 'schaden' | 'uhs' | 'person' | 'betreuungsstelle';

/** Exhaustiv: ein neuer Zieltyp bricht den Typcheck, statt im Parser still zu fehlen. */
const PLATZIEREN_ZIEL_ERLAUBT: Record<PlatzierenZielTyp, true> = {
  schaden: true,
  uhs: true,
  // Fundort-Koordinate einer Person („Auf Lagekarte verorten" der Detailseite).
  person: true,
  // Betreuungsstelle („Auf Karte verorten" der Betreuungsseite).
  betreuungsstelle: true,
};

/**
 * Liest den Platzier-Auftrag aus `?platzieren=<typ>:<id>` zurück: ein unbekannter Typ oder eine
 * unbrauchbare Id liefern `null`, kein halb gefülltes Objekt. Der Aufrufer räumt den Parameter,
 * sonst ginge die Karte bei jedem Neuladen erneut in den Modus.
 */
export function parsePlatzierenAuftrag(
  wert: string | null | undefined,
): { typ: PlatzierenZielTyp; id: number } | null {
  if (!wert) return null;
  const [typ, roheId] = wert.split(':');
  if (!typ || !Object.prototype.hasOwnProperty.call(PLATZIEREN_ZIEL_ERLAUBT, typ)) return null;
  const id = parseRouteId(roheId);
  return id == null ? null : { typ: typ as PlatzierenZielTyp, id };
}

/**
 * Form eines Zeichnen-Auftrags. Deutsch und sprechend, weil der Link ein äußerer Vertrag ist; die
 * Übersetzung in den Kartenmodus steht in `pages/lagekarte/zeichenAuftrag.ts`.
 */
export type ZeichnenForm = 'flaeche' | 'linie';

/** Ein Zeichnen-Auftrag `?zeichnen=<zonentyp>[:flaeche|:linie]` (LFH-825). */
export interface ZeichnenAuftrag {
  typ: ZoneTyp;
  form?: ZeichnenForm;
}

/**
 * Exhaustiv über die Zonentypen der API: ein neuer Typ bricht den Typcheck, statt im Parser still
 * zu fehlen. Ob die Karte ihn zeichnen kann und in welcher Geometrie, entscheidet erst die
 * Lagekarte über `ZONE_TYPEN` — das Routing-Modul bleibt frei von Seitenbezügen.
 */
const ZEICHNEN_TYP_ERLAUBT: Record<ZoneTyp, true> = {
  gefahrengebiet: true,
  absperrbereich: true,
  absperrgrenze: true,
  sperrgebiet: true,
  freie_skizze: true,
  evakuierungsbezirk: true,
};

const ZEICHNEN_FORM_ERLAUBT: Record<ZeichnenForm, true> = { flaeche: true, linie: true };

const istEigenerSchluessel = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/**
 * Liest den Zeichnen-Auftrag aus `?zeichnen=<zonentyp>[:flaeche|:linie]` zurück (LFH-825):
 * unbekannter Typ, unbekannte Form oder überzählige Teile liefern `null`, kein halb gefülltes
 * Objekt. Ob die Form zur Geometrie des Typs passt, prüft die Lagekarte. Der Aufrufer räumt den
 * Parameter, sonst ginge die Karte bei jedem Neuladen erneut in den Modus.
 */
export function parseZeichnenAuftrag(wert: string | null | undefined): ZeichnenAuftrag | null {
  if (!wert) return null;
  const teile = wert.split(':');
  if (teile.length > 2) return null;
  const [typ, form] = teile;
  if (!typ || !istEigenerSchluessel(ZEICHNEN_TYP_ERLAUBT, typ)) return null;
  if (form === undefined) return { typ: typ as ZoneTyp };
  if (!istEigenerSchluessel(ZEICHNEN_FORM_ERLAUBT, form)) return null;
  return { typ: typ as ZoneTyp, form: form as ZeichnenForm };
}

// ── Route-Param-Robustheit ───────────────────────────────────────────────────

/**
 * Parst einen Route-Parameter zu einer gültigen Entitäts-ID oder `null`: nur positive
 * Ganzzahlen (`''`, Dezimal-, Negativ- und Nicht-Zahl-Werte fallen weg).
 */
export function parseRouteId(param: string | undefined): number | null {
  if (param == null || param.trim() === '') return null;
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Sektions-Routen der Einsatz-Einstellungen ────────────────────────────────

/** Die Sektionen von `/einsaetze/:id/einstellungen`. */
export type EinstellungenSektion =
  'allgemein' | 'verhalten' | 'aufbewahrung' | 'module' | 'pegel' | 'geraete';

/**
 * Sektionen in Bedienreihenfolge — EINE Wahrheit für Tab-Band, Routentabelle und das Ziel des
 * baren Modulpfades: ein Tab ohne Route wäre ein toter Klick, eine Route ohne Tab unerreichbar.
 * Die **erste** Sektion ist das Redirect-Ziel; die Reihenfolge ist deshalb gepinnt.
 */
export const EINSTELLUNGEN_SEKTIONEN: readonly { key: EinstellungenSektion; label: string }[] = [
  { key: 'allgemein', label: 'Allgemein' },
  { key: 'verhalten', label: 'Verhalten & Automatik' },
  { key: 'aufbewahrung', label: 'Aufbewahrung' },
  { key: 'module', label: 'Module' },
  // Hinten angehängt: die erste Sektion ist das Redirect-Ziel.
  { key: 'pegel', label: 'Pegel' },
  // Gerätekopplung (LFH-892): nur die Einsatzleitung koppelt, die Sektion erklärt das selbst.
  { key: 'geraete', label: 'Geräte' },
];

/**
 * Sektions-Route der Einsatz-Einstellungen. Ohne Sektion der bare Modulpfad, der auf die erste
 * Sektion umleitet.
 */
export function einsatzEinstellungenPfad(
  einsatzId: number,
  sektion: EinstellungenSektion = 'allgemein',
): string {
  return `${einsatzModulPfad(einsatzId, 'einstellungen')}/${sektion}`;
}

// ── Gerätekopplung (LFH-892) ─────────────────────────────────────────────────

/** Einlöseseite eines Kopplungscodes. Ohne Einsatz-Präfix: das Gerät kennt seinen Einsatz erst
 *  nach dem Einlösen. */
export const KOPPELN_PFAD = '/koppeln';

/**
 * Adresse im QR-Code einer Kopplung: der Code steht im **Fragment** (`#…`), das der Browser nie
 * an den Server schickt — so landet er in keinem Zugriffslog (design.md D3).
 */
export function koppelnAdresse(origin: string, code: string): string {
  return `${origin}${KOPPELN_PFAD}#${encodeURIComponent(code)}`;
}

/** Startseite eines gekoppelten Geräts; die Hülle wählt darunter die Ansicht. */
export const GERAET_START_PFAD = '/geraet';

/*
 * Pfade der Gerätehülle (LFH-892, design.md D9). Die Einsatz-ID steht wie unter `/einsaetze` als
 * Segment `:id`, die Detailkennungen tragen dieselben Namen (`:personId`, `:uhsId`): die geteilten
 * Seiten lesen sie unverändert über `useParams`.
 */

/** Patientenliste der UHS eines Geräts, Startseite von Tablet und Laptop. */
export function geraetPatientenPfad(einsatzId: number): string {
  return `${GERAET_START_PFAD}/${einsatzId}/patienten`;
}

export function geraetPersonPfad(einsatzId: number, personId: number): string {
  return `${geraetPatientenPfad(einsatzId)}/${personId}`;
}

export function geraetAufnahmePfad(einsatzId: number, opts: { uhs?: number } = {}): string {
  return mitQuery(`${GERAET_START_PFAD}/${einsatzId}/aufnahme`, { uhs: opts.uhs });
}

/** Grundriss der eigenen UHS. */
export function geraetUhsPfad(einsatzId: number, uhsId: number): string {
  return `${GERAET_START_PFAD}/${einsatzId}/uhs/${uhsId}`;
}

/** Großbild des Lagemonitors. */
export function geraetMonitorPfad(einsatzId: number): string {
  return `${GERAET_START_PFAD}/${einsatzId}/monitor`;
}

/** Bereich „UHS“ des UHS-Laptops: Plätze, Material, Meldungen, Dateien der eigenen UHS. */
export function geraetStellePfad(einsatzId: number): string {
  return `${GERAET_START_PFAD}/${einsatzId}/stelle`;
}

/** Seite nach dem Ende einer Kopplung (Widerruf, Ablauf, Einsatzabschluss): statt der Anmeldung. */
export const KOPPLUNG_BEENDET_PFAD = '/kopplung-beendet';
