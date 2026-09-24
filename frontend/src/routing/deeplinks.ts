/**
 * Zentrale, typsichere Deeplink-/URL-Builder für den Einsatz-Workspace (LFH-25).
 *
 * Maßgebliche Quelle der Wahrheit für modulübergreifende Pfade und der Zielzustand für
 * alle Einsatz-Deeplinks: statt inline Template-Literals (`/einsaetze/${id}/...`) über die
 * Codebasis verstreut bauen Komponenten ihre Links hierüber — das hält Routen-Strings,
 * Param-Namen und Query-Konventionen an EINER Stelle und macht sie unit-testbar.
 *
 * Hinweis: Bare `/einsaetze/:id`-Breadcrumbs und dynamische Modul-Basis-Navigationen
 * (`modulZielRoute(...)`) bleiben bewusst inline (kein passender Builder). Bei Routen-/
 * Param-Änderungen daher auch nach Inline-Literalen suchen, nicht nur hier ändern.
 *
 * Muster (siehe docs/superpowers/specs/2026-06-23-deeplinks-vereinheitlichen-design.md
 * und die UI-Form-Leitlinie in CLAUDE.md):
 *  - **Item-Route** `/einsaetze/:id/<modul>/:<modul>Id` → Vollseiten-Detail (uhs, br,
 *    lagebericht, befehl, person, tier, schaden).
 *  - **Query-Param** `?<modul>=<id>` → Selektion auf der Modul-/Listenseite, wenn das
 *    Modul (noch) keine eigene Detail-Route hat (einheit, fahrzeug, personal,
 *    abschnitt, meldung, auftrag, gefahrengebiet) bzw. ein Eintrag in einer Liste
 *    adressiert wird (etb).
 *  - **`?neu=1`** → Schnellerfassung auf der Listenseite fokussieren.
 *
 * Die Builder sind reine String-Funktionen und gehen von gültigen, positiven
 * Integer-IDs aus. ID-Validierung von URL-Parametern macht `parseRouteId`; Link-Render-
 * Stellen mit potenziell fehlender ID guarden vor dem Aufruf (kein doppelter Guard im
 * Builder).
 */
import type { EtbFilterWerte } from '../api/etb';
import type { EtbTyp } from '../api/types';
import type { PersonenAnsicht, PersonenFilter } from '../personen/personenFilter';

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
    // Der leere String fällt seit LFH-342 mit heraus: die ETB-Filterachse leert ihre
    // Felder auf `''`, und `?q=` wäre ein gesetzter Filter auf nichts — `parseEtbFilter`
    // müsste ihn wieder wegwerfen, und die URL zeigte einen Filter, den es nicht gibt.
    .filter(([, v]) => v !== undefined && v !== '')
    /*
     * Kodiert seit LFH-342 · C7. Der ETB-Suchbegriff ist Freitext und darf `&`, `=` und
     * Leerzeichen tragen; unkodiert machte ein `&` aus einem Suchbegriff zwei Parameter.
     * Für alle Bestandswerte (Zahlen, `1`, Modulschlüssel) ist die Kodierung die
     * Identität — deshalb ändert sich an den Bestandspins nichts.
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
 * Die UHS-Listenroute. `opts.neu` nachgetragen (LFH-331 · B3): `UnfallhilfsstellenPage`
 * liest `?neu=1` seit je, der Builder konnte den Param aber nicht bauen — Aufrufer
 * mussten ihn danebenschreiben, was die Registry an genau dieser Stelle umging.
 *
 * Achtung beim Kürzen: die Liste liegt unter `/unfallhilfsstellen/liste`. Der bare
 * Modulpfad zeigt auf `UnfallhilfsstellenDefault`, das `?neu=1` gar nicht liest.
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

/** Tabellenansicht aller Bereitstellungsräume — der Modul-Index springt seit LFH-347 · M56
 *  direkt in den zuletzt gewählten BR (wie `unfallhilfsstellen/liste`). */
export function bereitstellungsraeumeListePfad(einsatzId: number): string {
  return `${einsatzModulPfad(einsatzId, 'bereitstellungsraeume')}/liste`;
}

export function lageberichtePfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'lageberichte');
}

/**
 * Führungsüberblick eines Einsatzes — seit dem Neuentwurf (21.09.2026) die Startseite, auf
 * die `/einsaetze/:id` umleitet (`redirectZiel` in `einsatz/modulRegistry.ts`).
 */
export function ueberblickPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'ueberblick');
}

/**
 * Aggregierende Kräfteübersicht (Meldebild) eines Einsatzes. Seit dem Neuentwurf heißt das
 * Modul in der Navigation „Meldebild" und steht unter Kräfte & Mittel; der Routenschlüssel
 * bleibt, damit bestehende Deeplinks tragen.
 *
 * Der Routenschlüssel ist der aus `einsatz/modulRegistry.ts` und `App.tsx` — die Seite gab
 * es längst, sie war nur von keiner der vier Kräfte-Modulseiten aus erreichbar
 * (LFH-338 · C3, Befund H21).
 */
export function kraefteuebersichtPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'kraefteuebersicht');
}

export function tierePfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'tiere');
}

export function einsatzdatenPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'einsatzdaten');
}

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
     * Sichtvorgabe (LFH-620): die Seite übernimmt sie beim Ankommen und räumt die Parameter
     * (apply-then-clean wie `?neu=1`). Die Sicht selbst bleibt Seitenzustand — die URL
     * trägt einen AUFTRAG, keinen gespiegelten Filter. Anspringer sind die Sprungmarken
     * „Patienten" und „Vermisste" im Modulpanel (`einsatz/sprungmarken.ts`).
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
 * Erlaubte Werte der Personen-Sichtvorgabe — exhaustive Records aus demselben Grund wie
 * {@link ETB_TYP_ERLAUBT}: eine neue Variante bricht den Typcheck, statt zur Laufzeit
 * still verworfen zu werden.
 *
 * Bewusst KEIN `'patienten'`: „Patient" ist kein Personenstatus, sondern eine
 * Darstellung (`ansicht: 'raster'`, `personen/personenFilter.ts`). Ein sechster
 * Filterwert vermengte die beiden Achsen wieder, die der Neuentwurf getrennt hat.
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
 * Umkehr der Sichtvorgabe von {@link personenPfad} (LFH-620). Je Achse wird ein
 * unbekannter Wert GANZ verworfen (Regel aus `parsePlatzierenAuftrag`/`parseEtbFilter`);
 * die andere Achse bleibt davon unberührt, weil beide unabhängig sind.
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
 * Vollseiten-Aufnahme für Personen (LFH-340 · C5).
 *
 * Eine eigene Route, obwohl die Schnellerfassung dieselben Felder im Dialog zeigt: sie ist
 * die ANSPRING-Adresse für andere Module — ein Modal hat keine. Beide Wege tragen dasselbe
 * Bauteil (`personen/AufnahmeFelder`), es gibt also nur eine Maske.
 *
 * **Der Konsument ist da (LFH-341 · C6):** die UHS-Kopfzeile springt hierher. Der
 * optionale `uhs`-Auftrag reist im Query-Param, nicht im Router-State — er überlebt
 * damit einen Neuladen, und genau dafür gibt es diese Route statt eines Dialogs.
 * Die Aufnahmeseite bucht nach dem Anlegen den Eintritt in den Wartebereich.
 *
 * Statisches Segment vor `personen/:personId` — React Router rankt statisch über dynamisch,
 * die Reihenfolge in `App.tsx` entscheidet also nicht, aber ein Leser muss das nicht prüfen.
 */
export function personenAufnahmePfad(einsatzId: number, opts: { uhs?: number } = {}): string {
  return mitQuery(`${einsatzModulPfad(einsatzId, 'personen')}/aufnahme`, { uhs: opts.uhs });
}

export function schaedenPfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'schaeden'), {
    neu: opts.neu ? 1 : undefined,
  });
}

/** Dokumentenablage (LFH-632): Listenseite, `?neu=1` fokussiert die Ablage-Erfassung. */
export function dokumentePfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'dokumente'), {
    neu: opts.neu ? 1 : undefined,
  });
}

/** Ablösungs-Modul (LFH-635): Schichten und fällige Ablösungen je Einheit. */
export function abloesungPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'abloesung');
}

/** Fachmodul „Wetter & Pegel" (LFH-633): Pegel mit Verlauf, DWD-Warnungen, Vorhersage. */
export function wetterPegelPfad(einsatzId: number): string {
  return einsatzModulPfad(einsatzId, 'wetter-pegel');
}

/**
 * Ziel eines Pegel-Verweises (Dashboard-Kennzahl, Überblick-Marke): die Modulseite, wenn sie
 * für die Person frei ist, sonst die Pflege in Einstellungen › Pegel (LFH-633). Die Frage
 * „frei?" beantwortet der Aufrufer (`istKeyFreigegeben`), damit diese Datei keine Registry
 * und keinen Benutzer kennen muss.
 */
export function pegelZielPfad(einsatzId: number, modulFrei: boolean): string {
  return modulFrei ? wetterPegelPfad(einsatzId) : einsatzEinstellungenPfad(einsatzId, 'pegel');
}

/**
 * Betreuungs-Modul (LFH-639). Keine Detailroute (design.md D7) — ein Bezirk bzw. eine
 * Betreuungsstelle wird deshalb per Query-Param selektiert (LFH-25): `?bezirk=<id>` /
 * `?stelle=<id>`, stabile DB-`id`, die Seite scrollt auf die Zeile.
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

/**
 * Stab-Modul (LFH-46). `?neu=1` wird ab ST5 (LFH-543) von der Seite gelesen und geräumt
 * (Abschluss der Lagebesprechung, apply-then-clean wie ETB/Schäden).
 */
export function stabPfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'stab'), {
    neu: opts.neu ? 1 : undefined,
  });
}

/**
 * Erlaubte Werte des ETB-Typfilters.
 *
 * Ein **exhaustiver Record**, kein Array: fehlt hier eine Variante von `EtbTyp`, bricht
 * der Typcheck (TS2739), statt dass `parseEtbFilter` sie zur Laufzeit still verwirft und
 * ein aus der URL geladener Filter ohne Meldung leer bliebe. Dasselbe Muster wie beim
 * Enum-Wire-Kontrakt im Backend — der exhaustive Match ist die Zusicherung, nicht der
 * Assert daneben.
 *
 * Bewusst NICHT `Object.keys(etbTyp)` aus `theme/statusFarben`: das zöge die Theme- und
 * Token-Schicht in ein reines String-Modul (und in dessen Test). Der Typimport oben
 * verschwindet dagegen beim Übersetzen vollständig.
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
    /** Filterachse (LFH-342 · C7). Leere Werte fallen in `mitQuery` heraus. */
    q?: string;
    typ?: EtbTyp;
    von?: string;
    bis?: string;
    /** „Betrifft Einheit" (LFH-616) — der Knopf „ETB ↗" an der Einheit auf der Lagekarte. */
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
 * Umkehr der Filterachse von {@link etbPfad} (LFH-342 · C7).
 *
 * Verwirft Unbrauchbares GANZ statt halb zu übernehmen — dieselbe Regel wie bei
 * {@link parsePlatzierenAuftrag} (LFH-340 · C5): ein unbekannter Typ ergibt keinen Filter
 * auf diesen Typ, sondern gar keinen. Ein halb gefüllter Filter erzeugte sonst einen
 * Query-Key, den der Server mit 400 quittiert, während die Leiste einen gültigen Stand
 * anzeigt.
 *
 * Die Zeitwerte gehen ungeprüft durch: sie sind Wire-Strings, und ihre Umkehr in einen
 * anzeigbaren Zeitpunkt macht `etb/filterZeit.ts` — dort fällt ein unbrauchbarer Wert auf
 * `undefined`, statt hier als `Invalid Date` in den `DatePicker` zu geraten.
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
  // Dieselbe Prüfung wie `parseRouteId`: `abc` oder `0` ergäben am Server 400 bzw. einen
  // Filter auf nichts — dann lieber gar keiner.
  const einheit = parseRouteId(params.get('einheit_id') ?? undefined);
  if (einheit != null) werte.einheit_id = einheit;
  return werte;
}

export function personalPfad(einsatzId: number, opts: { personal?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'personal'), { personal: opts.personal });
}

export function einheitenPfad(einsatzId: number, opts: { einheit?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'einheiten'), { einheit: opts.einheit });
}

/**
 * Vollseiten-Detail je Einheit (LFH-339 · C4).
 *
 * Die Einheit ist damit vom Query-Param- auf das Item-Route-Muster gewechselt: sie hat
 * seit C4 eine eigene Detailansicht, und die Faustregel dieses Moduls lautet
 * „Vollseiten-Detail vorhanden → Item-Route".
 *
 * Der Grund ist LFH-19, nicht Symmetrie: die Kopfdaten sind neun Felder, dazu kommen drei
 * sofort wirkende Zuordnungslisten. Das ist keine Auswahl in einer Listenhälfte mehr.
 *
 * `einheitenPfad(id, { einheit })` bleibt bestehen und ist NICHT tot: Bestands-Deeplinks
 * aus anderen Modulen zeigen darauf, und die Listenseite leitet sie auf diese Route weiter.
 */
export function einheitDetailPfad(einsatzId: number, einheitId: number): string {
  return `${einsatzModulPfad(einsatzId, 'einheiten')}/${einheitId}`;
}

/**
 * Darstellung der Fahrzeugseite (LFH-642): die Tabelle oder das FMS-Tableau. Das Tableau
 * ist eine ANSICHT dieses Moduls und kein eigenes Modul — Endpunkte und Live-Ereignis
 * hängen am Schlüssel `fahrzeuge`, ein eigener Schlüssel wäre getrennt schaltbar und
 * endete in 403 ohne Live-Updates. Anspringer ist die Sprungmarke „FMS-Tableau"
 * (`einsatz/sprungmarken.ts`).
 */
export type FahrzeugeAnsicht = 'liste' | 'tableau';

/**
 * `ansicht` ist wie bei {@link personenPfad} ein AUFTRAG: die Seite übernimmt ihn beim
 * Ankommen und räumt den Parameter (apply-then-clean); die Ansicht bleibt Seitenzustand.
 */
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

export function einsatzabschnittePfad(
  einsatzId: number,
  opts: { abschnitt?: number } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'einsatzabschnitte'), { abschnitt: opts.abschnitt });
}

export function meldungenPfad(einsatzId: number, opts: { meldung?: number } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'meldungen'), { meldung: opts.meldung });
}

/**
 * Vorbelegung der Nachforderungs-Erfassung (LFH-634, D9) — z. B. „Nachfordern" aus einer
 * Unterdeckung der Verpflegung. Keine Personenangaben: die Werte sind Bezeichnungen und Zahlen.
 */
export interface NachforderungVorbelegung {
  art: string;
  bezeichnung: string;
  /** Positive Ganzzahl. */
  anzahl: number;
  begruendung?: string;
}

/**
 * Nachforderungsseite. `?neu=1` öffnet die Erfassung; eine `vorbelegung` setzt `neu=1`
 * selbst und hängt `art`, `bezeichnung`, `anzahl` und `begruendung` an (kodiert über
 * `mitQuery`, Freitext darf `&` und `=` tragen). Die Seite räumt alles nach dem Lesen
 * (apply-then-clean).
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
 * Wie `parsePlatzierenAuftrag`: Unbrauchbares wird GANZ verworfen, nicht halb übernommen —
 * eine Erfassung mit Art „Verpflegung", aber ohne die Fehlmenge sähe vorbelegt aus und
 * forderte das Falsche nach. `anzahl` muss eine positive Ganzzahl in Dezimalschreibweise
 * sein; `Number()` allein nähme auch `1e2` und ` 5` an. `art` und `bezeichnung` dürfen
 * nicht leer sein (dieselbe Regel wie die Pflichtfelder des Formulars), `begruendung` ist
 * optional und fällt leer weg.
 *
 * `neu` liest dieser Parser bewusst NICHT: das ist Sache der Seite, und ein
 * `get('neu')`-Leser in dieser Datei wäre für `schnellaktionen.guard.test.ts` keinem Modul
 * zuordenbar.
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
 * Lagekarte, optional mit vorselektiertem Gefahrengebiet (Reverse-Deeplink von der
 * GefahrenPage, LFH-155). Query-Param statt Item-Route: die Karte selektiert das Gebiet
 * und fliegt es an — sie hat keine Vollseiten-Detailansicht je Gefahrengebiet.
 */
export function lagekartePfad(
  einsatzId: number,
  opts: {
    gefahrengebiet?: number;
    ansicht?: number;
    snapshot?: number;
    platzieren?: { typ: PlatzierenZielTyp; id: number };
    zentrum?: Kartenzentrum;
  } = {},
): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'lagekarte'), {
    gefahrengebiet: opts.gefahrengebiet,
    ansicht: opts.ansicht,
    // Historien-Modus (C/LFH-321): ?snapshot=<id> zeigt den eingefrorenen Stand (schreibgeschützt).
    snapshot: opts.snapshot,
    // Platzier-Auftrag (LFH-340 · C5): die Karte geht in den Platzier-Modus für genau
    // dieses Objekt, der nächste Klick auf die Karte setzt seine Koordinate.
    platzieren: opts.platzieren ? `${opts.platzieren.typ}:${opts.platzieren.id}` : undefined,
    // Kartenmittelpunkt (LFH-619, Koordinatensprung der Sprungpalette): die Karte fliegt
    // die Stelle an und räumt den Parameter. Fünf Nachkommastellen ≙ rund 1 m.
    zentrum: opts.zentrum ? `${runde5(opts.zentrum.lat)},${runde5(opts.zentrum.lon)}` : undefined,
  });
}

/** Ein WGS84-Punkt, auf den die Lagekarte springen soll. */
export interface Kartenzentrum {
  lat: number;
  lon: number;
}

/** Rundet auf fünf Nachkommastellen, ohne abschliessende Nullen in die URL zu schreiben. */
function runde5(x: number): string {
  return String(Number(x.toFixed(5)));
}

/**
 * Liest den Kartenmittelpunkt aus `?zentrum=<lat>,<lon>` zurück (LFH-619).
 *
 * Wie `parsePlatzierenAuftrag`: Unbrauchbares wird GANZ verworfen, nicht halb gefüllt — eine
 * halbe Koordinate liefe mit `NaN` oder `0` in `flyTo` und schickte die Karte auf den
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
 * Objekttypen, die von außen zum Verorten auf die Karte geschickt werden können.
 *
 * Bewusst eine EIGENE, engere Menge als der karteninterne `PlatzierenPunktTyp`: was hier
 * steht, muss die Karte auch aus einem Fremd-Link heraus platzieren können. Wer den Typ
 * erweitert, prüft `pages/LagekartePage.tsx` mit — dort wird der Wert zurückgelesen.
 */
export type PlatzierenZielTyp = 'schaden' | 'uhs' | 'person';

/** Exhaustiv: ein neuer Zieltyp bricht den Typcheck, statt im Parser still zu fehlen. */
const PLATZIEREN_ZIEL_ERLAUBT: Record<PlatzierenZielTyp, true> = {
  schaden: true,
  uhs: true,
  // Fundort-Koordinate einer Person (LFH-613, „Auf Lagekarte verorten" der Detailseite).
  person: true,
};

/**
 * Liest den Platzier-Auftrag aus `?platzieren=<typ>:<id>` zurück.
 *
 * Strenger als ein `split(':')`: ein unbekannter Typ oder eine unbrauchbare Id liefern
 * `null`, nicht ein halb gefülltes Objekt. Der Aufrufer räumt den Parameter danach ohnehin —
 * ein stehengebliebener Auftrag schickte die Karte bei jedem Neuladen erneut in den Modus.
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

// ── Route-Param-Robustheit ───────────────────────────────────────────────────

/**
 * Parst einen URL-Route-Parameter zu einer gültigen Entitäts-ID oder `null`.
 * Strenger als nur `Number.isNaN`: akzeptiert ausschließlich positive Ganzzahlen
 * (fängt zusätzlich `''` → 0, Dezimal-, Negativ- und Nicht-Zahl-Werte ab).
 * Backend-Entitäts-IDs sind immer > 0, daher ist `<= 0` ebenfalls ungültig.
 */
export function parseRouteId(param: string | undefined): number | null {
  if (param == null || param.trim() === '') return null;
  const n = Number(param);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Sektions-Routen der Einsatz-Einstellungen (LFH-345 · C10) ────────────────

/** Die fünf Sektionen von `/einsaetze/:id/einstellungen` (`pegel` seit LFH-606). */
export type EinstellungenSektion = 'allgemein' | 'verhalten' | 'aufbewahrung' | 'module' | 'pegel';

/**
 * Sektionen in Bedienreihenfolge — EINE Wahrheit für das Tab-Band, die Routentabelle und
 * das Ziel des baren Modulpfades.
 *
 * Der Grund für die Liste statt dreier Stellen mit denselben Strings ist derselbe wie bei
 * `adminNav` (LFH-284): ein Tab ohne Route ist ein toter Klick, eine Route ohne Tab ist eine
 * unerreichbare Seite, und beide Fehler sind vom Bildschirm aus nicht zu sehen, solange man
 * nicht genau diesen einen Reiter anfasst.
 *
 * Die **erste** Sektion ist das Redirect-Ziel des baren Pfades (Muster `ersteSektionPfad`
 * aus `admin/adminNav`); die Reihenfolge ist deshalb gepinnt, nicht Geschmack.
 */
export const EINSTELLUNGEN_SEKTIONEN: readonly { key: EinstellungenSektion; label: string }[] = [
  { key: 'allgemein', label: 'Allgemein' },
  { key: 'verhalten', label: 'Verhalten & Automatik' },
  { key: 'aufbewahrung', label: 'Aufbewahrung' },
  { key: 'module', label: 'Module' },
  // LFH-606: hinten angehängt, nicht vorn — die erste Sektion ist das Redirect-Ziel.
  { key: 'pegel', label: 'Pegel' },
];

/**
 * Sektions-Route der Einsatz-Einstellungen (LFH-345 · C10, H15/M15).
 *
 * Ohne Sektion zeigt sie auf den Einstieg: der bare Modulpfad `…/einstellungen` (den die
 * Modul-Navigation aus `modulZielRoute` baut) leitet genau dorthin um.
 */
export function einsatzEinstellungenPfad(
  einsatzId: number,
  sektion: EinstellungenSektion = 'allgemein',
): string {
  return `${einsatzModulPfad(einsatzId, 'einstellungen')}/${sektion}`;
}
