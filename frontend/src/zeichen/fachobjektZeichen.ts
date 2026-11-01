/**
 * Hub-Vokabular (`TzProps`, die Kennungen des Altpakets taktische-zeichen) → Zeichenbeschreibung
 * von @einsatzzeichen (`SymbolSpec`). EINZIGE Stelle dieser Übersetzung für die Zeichen der
 * Fachobjekte (LFH-835, openspec/changes/archive/2026-09-30-lfh-835-fachobjekt-zeichen-einsatzzeichen/design.md).
 *
 * - D1: Übersetzt wird beim Lesen. DB-Spalten `tz_*`, Snapshots und Offline-Stände behalten die
 *   alten Kennungen; eine Migration erreichte Snapshots und Geräte nicht.
 * - D2: Abbildungstabellen unten; die fachlichen Entscheidungen vom 29.09.2026 stehen dort, die
 *   Stelle und die Person seit LLH-1161 ohne die Notlösungen für LFH-829/LFH-830, die
 *   Führungskraft seit LLH-1231 mit Funktionsindikator.
 * - D3: Welche Kombination sich zeichnen lässt, entscheidet allein die Komposition — nicht
 *   `validateSpec` und keine gepflegte Accepts-Liste. Deshalb eine Rückfallkaskade: jede Fassung
 *   der Fachaufgabe, dann ohne Fachaufgabe, ohne Stärke, ohne Organisation, Körper allein.
 * - Seit @einsatzzeichen 4.0 leitet der Motor fehlende Vermessungen ab, statt sie abzulehnen
 *   (`Drawing.derivations`, LFH-991). Gleichwertige Fassungen einer Stufe (randbündig, Box,
 *   Radpaar) wählt die Kaskade deshalb vermessen vor abgeleitet: ein bisher vermessenes Zeichen
 *   bleibt, wie es war, eine bisher fehlende Fachaufgabe erscheint abgeleitet.
 * - D4: Ergebnis je Eingang gecacht.
 *
 * Freie Zeichen übersetzt `freiesZeichen.ts` (LFH-836); es nutzt Körper, Organisations-Alias,
 * Stärke und Fachaufgaben von hier mit.
 */
import {
  CompositionError,
  NotMeasuredError,
  drawAnySpec,
  drawSymbol,
  serializeAnySpec,
  serializeSpec,
} from '@einsatzzeichen/core';
import {
  ORGANIZATION_IDS,
  type CapabilityId,
  type ColorToken,
  type Drawing,
  type FunctionRoleId,
  type OrganizationId,
  type PictogramSpec,
  type StateId,
  type SymbolSpec,
  type TechnicalBodyMarkId,
} from '@einsatzzeichen/schema';
import { AUSMASS_FARBE, type TzProps } from '../pages/lagekarte/taktischesZeichen';
import type { Gefahrentyp, Schadensgrad } from '../api/types';

export interface FachobjektZeichen {
  /**
   * Die wirksame Spec: aus der ersten Stufe der Kaskade, die komponiert, die erste vermessene
   * Fassung, sonst die erste abgeleitete.
   */
  spec: SymbolSpec;
  drawing: Drawing;
  /** Karten-Bildschlüssel: `ez|` + kanonische Serialisierung der wirksamen Spec. */
  schluessel: string;
}

export type Teil = Partial<SymbolSpec>;
type Koerpermarke = CapabilityId | TechnicalBodyMarkId;

// Grundzeichen des Hubs → Körper. `befehlsstelle` (Abschnitt) ist neutral in „Führung und
// Leitung“, ohne functionRole mit eingebackenem Kürzel. `stelle` ist circle-12 mit Fachaufgabe
// (F.3) in der Organisation des Betreibers, ohne bekannte Organisation neutral (LLH-1161; bis
// dahin fest Hilfsorganisation wegen Lücke LFH-829). `zweirad` hat keinen Körper (LFH-831) und
// wird Landfahrzeug. `organisation` hier überstimmt die gespeicherte.
export const KOERPER: Record<string, Teil> = {
  'taktische-formation': { kind: 'formation' },
  'kraftfahrzeug-landgebunden': { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-1' },
  wasserfahrzeug: { kind: 'vehicle-water' },
  hubschrauber: { kind: 'vehicle-air' },
  anhaenger: { kind: 'trailer' },
  zweirad: { kind: 'vehicle-land' },
  person: { kind: 'person' },
  befehlsstelle: { kind: 'formation', organization: 'fuehrung-leitung' },
  anlass: { kind: 'event' },
  gefahr: { kind: 'hazard' },
  stelle: { kind: 'circle-12' },
};

// Alte Organisationskennungen, die @einsatzzeichen umbenannt hat; die übrigen sind gleich.
const ORGANISATION_ALIAS: Record<string, OrganizationId> = {
  fuehrung: 'fuehrung-leitung',
  gefahrenabwehr: 'sonstige-gefahrenabwehr',
  zivil: 'zivile-einheiten',
};

export const STAERKE: Record<string, Teil> = {
  trupp: { strength: 'trupp' },
  staffel: { strength: 'staffel' },
  gruppe: { strength: 'gruppe' },
  zug: { strength: 'zug' },
  // Zugtrupp = Trupp mit Formationskappe (D.1.9, I.1.6).
  zugtrupp: { strength: 'trupp', bodyMarks: ['formation-solid-cap-3mm'] },
};

// Fachaufgabe → Fähigkeit. Jede wird zuerst randbündig (`bodyMarks`, wie die Referenzrezepte)
// versucht, dann als Box (`capabilities`). `fuehrung` fehlt bewusst: eine Fähigkeit „Führung“ gibt
// es nicht, und eine gelbe Umfärbung etwa eines Feuerwehr-ELW wäre irreführend.
const FAEHIGKEIT: Record<string, CapabilityId[]> = {
  brandbekaempfung: ['fire-fighting'],
  wasserversorgung: ['water-conveyance'],
  'technische-hilfeleistung': ['technical-assistance'],
  bergung: ['recovery'],
  sprengen: ['blasting'],
  entschaerfen: ['explosive-ordnance-clearance'],
  abc: ['cbrn-protection'],
  messen: ['cbrn-detection'],
  dekontamination: ['decontamination'],
  'dekontamination-personen': ['decontamination'],
  'dekontamination-geraete': ['decontamination'],
  rettungswesen: ['medical-service'],
  'aerztliche-versorgung': ['physician'],
  krankenhaus: ['hospital'],
  einsatzeinheit: ['medical-service', 'care'],
  betreuung: ['care'],
  unterbringung: ['temporary-accommodation-resting'],
  seelsorge: ['pastoral-care'],
  'versorgung-trinkwasser': ['drinking-water'],
  'versorgung-brauchwasser': ['service-water'],
  instandhaltung: ['maintenance'],
  iuk: ['information-communications'],
  erkundung: ['reconnaissance'],
  veterinaerwesen: ['veterinary'],
  schlachten: ['slaughter-culling'],
  wasserrettung: ['water-rescue'],
  wasserfahrzeuge: ['watercraft-operations'],
  rettungshunde: ['biological-location'],
  'abwehr-wassergefahren': ['water-hazard-control'],
  heben: ['crane-lifting'],
  raeumen: ['mechanized-clearing'],
  hoehenrettung: ['rescue-aerial-ladder'],
  beleuchtung: ['lighting'],
  pumpen: ['pumping'],
  'umweltschaeden-gewaesser': ['water-environmental-damage-control'],
  warnen: ['loudspeaker-warning'],
  transport: ['transport'],
};

// Versorgung (Anhang G) ist ein Fußband, keine Fähigkeit.
const VERSORGUNG: Record<string, Teil> = {
  logistik: { bodyVariant: 'foot-band' },
  verpflegung: { bodyVariant: 'foot-band', bodyMarks: ['catering'] },
  verbrauchsgueter: { bodyVariant: 'foot-band', bodyMarks: ['fuels-consumables'] },
  'versorgung-elektrizitaet': { bodyVariant: 'foot-band', bodyMarks: ['power-supply'] },
};

// Hub-Funktion → Funktionsrolle. Die Führungskraft (Einheitsführer, Abschnittsleiter) trägt Raute
// und schwarze Kappe der Leitungsrollen ohne Kürzel (`leader`, ESZ-116). Die Rolle hat kein eigenes
// Original, der Motor zeichnet sie stets abgeleitet (LLH-1231).
export const FUNKTIONSROLLE: Record<string, Teil> = {
  fuehrungskraft: { functionRole: 'leader' },
};

// Symbole haben in SymbolSpec keine Achse (LFH-834). Die UHS-Typen Patientenablage und
// Verletztensammelstelle werden bis dahin wie „sonstige“ gezeichnet; der Typ steht in der
// Unterzeile des Inspectors.
const SYMBOL_ERSATZ: Record<string, string> = {
  'sammelplatz-betroffene': 'rettungswesen',
  sammeln: 'rettungswesen',
};

// Schadensfarbe → Palettentoken; freie Farben kennt die Bibliothek nicht. Die Hexwerte stehen nur in
// `AUSMASS_FARBE` (keine Kopie hier, Gate-5-Guard), der Schlüssel ist das Ausmaß.
const FARBE_TOKEN: Record<string, ColorToken> = {
  [AUSMASS_FARBE.gering]: 'gruen',
  [AUSMASS_FARBE.mittel]: 'gelb',
  [AUSMASS_FARBE.gross]: 'orange',
  [AUSMASS_FARBE.katastrophal]: 'rot',
};

// Gefahrenart eines Schadens → Gefahrenhinweis nach DV 102, 5.8.1 (LLH-1115, design.md D3). Der
// Hinweis steht als Zustand am Träger „Gefahr“; die Bibliothek setzt ihn in die Randlage neben den
// verkleinerten Träger (abgeleitet aus 5.8.1.13_2), die Füllung (Ausmaß) bleibt. `undefined` heißt:
// DV 102 kennt für diese Gefahr keinen Hinweis, das Zeichen bleibt das leere Dreieck. Keine eigenen
// Hinweise erfinden; die Begründung je Lücke steht in der Spec `schaden-gefahr` (LLH-1341).
// Vollständig per Typ, damit eine neue Gefahrenart hier entschieden werden muss.
const GEFAHRENHINWEIS: Record<Gefahrentyp, StateId | undefined> = {
  atemgifte: undefined,
  angstreaktion: undefined,
  ausbreitung: undefined,
  atomare_strahlung: 'radioactivity-hazard',
  chemische_stoffe: 'hazardous-substances',
  erkrankung_verletzung: undefined,
  explosion: 'explosion-hazard',
  elektrizitaet: 'electrical-energy-hazard',
  einsturz: undefined,
  absturz: undefined,
  // Brandphasen (5.8.5) bezeichnen die Phase eines Brandes, keine Gefahrenart.
  brand: undefined,
  durchbruch: undefined,
  // Näherung: Gefahr durch Wasser (5.8.1.6 „Gefahr durch Wassereinbruch“).
  ertrinken: 'water-ingress-hazard',
};

// Schadensgrad eines Schadens → Zustand nach DV 102, 5.8.4 (LLH-1115), auf der Körpermitte.
const SCHADENSGRAD_ZUSTAND: Record<Schadensgrad, StateId> = {
  angeschlagen: 'damaged',
  teilzerstoert: 'partially-destroyed',
  zerstoert: 'destroyed',
};

/**
 * Die Zustandsstufen eines Schadens in Versuchsreihenfolge: Hinweis und Schadensgrad, nur der
 * Hinweis, nur der Schadensgrad. Die Gefahrenart wiegt mehr, sie bestimmt das Kartenzeichen.
 */
function zustandsStufen(tz: TzProps): Teil[] {
  const hinweis = eigen(GEFAHRENHINWEIS, tz.gefahrenart);
  const grad = eigen(SCHADENSGRAD_ZUSTAND, tz.schadensgrad);
  const stufen: Teil[] = [];
  if (hinweis && grad) stufen.push({ states: [hinweis, grad] });
  if (hinweis) stufen.push({ states: [hinweis] });
  if (grad) stufen.push({ states: [grad] });
  return stufen;
}

/**
 * Liest eine Abbildungstabelle nur über eigene Schlüssel. Gespeicherte Kennungen sind Eingabe:
 * `constructor` oder `__proto__` dürfen keine Prototyp-Eigenschaft liefern (LFH-836, Review).
 */
export function eigen<T>(
  tabelle: Readonly<Record<string, T>>,
  schluessel: string | null | undefined,
): T | undefined {
  return schluessel != null && Object.prototype.hasOwnProperty.call(tabelle, schluessel)
    ? tabelle[schluessel]
    : undefined;
}

export function organisation(wert: string | undefined): OrganizationId | undefined {
  if (!wert) return undefined;
  const id = eigen(ORGANISATION_ALIAS, wert) ?? wert;
  return (ORGANIZATION_IDS as readonly string[]).includes(id) ? (id as OrganizationId) : undefined;
}

function marken(...teile: Array<Teil | undefined>): Koerpermarke[] | undefined {
  const alle = teile.flatMap((t) => (t?.bodyMarks ?? []) as Koerpermarke[]);
  return alle.length > 0 ? alle : undefined;
}

/**
 * Fügt Teil-Specs zusammen; spätere überstimmen frühere. `bodyMarks` werden aneinandergehängt, ein
 * ausdrücklich `undefined` gesetztes Feld entfernt es (etwa die Kfz-Kategorie am Radpaar).
 */
export function verbinde(...teile: Array<Teil | undefined>): SymbolSpec {
  const spec: Record<string, unknown> = {};
  for (const t of teile) {
    for (const [k, v] of Object.entries(t ?? {})) {
      if (v === undefined) delete spec[k];
      else spec[k] = v;
    }
  }
  const bm = marken(...teile);
  if (bm) spec.bodyMarks = bm;
  else delete spec.bodyMarks;
  return spec as unknown as SymbolSpec;
}

/**
 * Die Fassungen einer Fachaufgabe am gegebenen Körper, als Stufen in Versuchsreihenfolge. Die
 * Fassungen einer Stufe sind gleichwertig (vermessen vor abgeleitet, s. `waehle`), eine spätere
 * Stufe gibt etwas auf.
 */
export function fassungen(fachaufgabe: string | undefined, koerper: Teil): Teil[][] {
  if (!fachaufgabe) return [];
  const versorgung = eigen(VERSORGUNG, fachaufgabe);
  // Ist die Marke am Körper nicht darstellbar, bleibt wenigstens das Fußband (Versorgung, Anhang G).
  if (versorgung) return [[versorgung], [{ bodyVariant: versorgung.bodyVariant }]];
  const faehigkeiten = eigen(FAEHIGKEIT, fachaufgabe);
  if (!faehigkeiten) return [];
  const stufe: Teil[] = [{ bodyMarks: faehigkeiten }, { capabilities: faehigkeiten }];
  // Rettungsdienstfahrzeuge stehen auf dem Radpaar, nicht auf einer Kfz-Kategorie: RTW/KTW mit
  // Sanität (F.2), NEF/NAW mit Arzt (F.2.4/F.2.5 „alternative“). Seit 4.0 zeichnet der Motor die
  // Marke auch abgeleitet auf der Kategorie; die vermessene Radpaar-Fassung geht trotzdem vor,
  // weil sie in derselben Stufe steht.
  if (
    koerper.kind === 'vehicle-land' &&
    faehigkeiten.some((f) => f === 'medical-service' || f === 'physician')
  ) {
    stufe.push({
      vehicleCategory: undefined,
      bodyVariant: 'plain-wheel-pair',
      bodyMarks: faehigkeiten,
    });
  }
  return [stufe];
}

function zeichne(spec: SymbolSpec): Drawing | null {
  try {
    return drawSymbol(spec);
  } catch (e) {
    if (
      !(e instanceof CompositionError) &&
      !(e instanceof NotMeasuredError) &&
      import.meta.env.DEV
    ) {
      // Kein Kombinationsverbot, sondern vermutlich ein Programmfehler (z. B. unbekannte Variante).
      console.warn('[fachobjektZeichen] unerwarteter Fehler beim Zeichnen', spec, e);
    }
    return null;
  }
}

/** Die Stufen der Kaskade; jede Stufe hält gleichwertige Fassungen. */
function kandidaten(tz: TzProps): SymbolSpec[][] | null {
  const koerper = eigen(KOERPER, tz.grundzeichen);
  if (!koerper) return null;
  const org: Teil = { organization: koerper.organization ?? organisation(tz.organisation) };
  const staerke = eigen(STAERKE, tz.einheit);
  // Die Person (Führungskraft) trägt ihre Fachaufgabe; der Motor zeichnet sie dort nur abgeleitet,
  // die Kaskade nimmt die abgeleitete Fassung (LLH-1161, bis dahin entfiel sie wegen LFH-830).
  // Mit Funktionsindikator sitzt die Marke an der Hülle der Funktionsfassung (LLH-1231).
  const fachaufgabe = tz.fachaufgabe ?? eigen(SYMBOL_ERSATZ, tz.symbol);
  const farbe: Teil = tz.farbe ? { technicalFill: eigen(FARBE_TOKEN, tz.farbe) ?? 'grau' } : {};

  const liste: SymbolSpec[][] = [
    ...zustandsStufen(tz).map((z) => [verbinde(koerper, org, farbe, staerke, z)]),
    ...fassungen(fachaufgabe, koerper).map((stufe) =>
      stufe.map((f) => verbinde(koerper, org, farbe, staerke, f)),
    ),
  ];
  liste.push([verbinde(koerper, org, farbe, staerke)]);
  liste.push([verbinde(koerper, org, farbe)]);
  liste.push([verbinde(koerper, farbe, { organization: undefined })]);
  liste.push([verbinde({ kind: koerper.kind })]);
  // Der Funktionsindikator geht allem anderen vor: erst die ganze Kaskade mit Indikator, dann
  // dieselbe ohne ihn (LLH-1231).
  const rolle = eigen(FUNKTIONSROLLE, tz.funktion);
  if (!rolle) return liste;
  return [...liste.map((stufe) => stufe.map((spec) => verbinde(spec, rolle))), ...liste];
}

/**
 * Die erste vermessene Fassung der Stufe, sonst die erste abgeleitete, sonst `null`. Abgeleitet
 * heißt: die Zeichnung trägt `derivations` (@einsatzzeichen 4.0, „Ableiten statt Messsperre“).
 */
function waehle(stufe: SymbolSpec[]): FachobjektZeichen | null {
  let abgeleitet: FachobjektZeichen | null = null;
  for (const spec of stufe) {
    const drawing = zeichne(spec);
    if (!drawing) continue;
    const z = { spec, drawing, schluessel: `ez|${serializeSpec(spec)}` };
    if (!drawing.derivations?.length) return z;
    abgeleitet ??= z;
  }
  return abgeleitet;
}

const CACHE = new Map<string, FachobjektZeichen | null>();

function eingangsSchluessel(tz: TzProps): string {
  return JSON.stringify([
    tz.grundzeichen,
    tz.organisation,
    tz.fachaufgabe,
    tz.einheit,
    tz.symbol,
    tz.farbe,
    tz.funktion,
    tz.gefahrenart,
    tz.schadensgrad,
  ]);
}

/**
 * Das Zeichen eines Fachobjekts nach @einsatzzeichen, oder `null`, wenn nicht einmal sein Körper
 * darstellbar ist (unbekanntes Grundzeichen). Wirft nie.
 */
export function fachobjektZeichen(tz: TzProps): FachobjektZeichen | null {
  const key = eingangsSchluessel(tz);
  if (CACHE.has(key)) return CACHE.get(key)!;
  let ergebnis: FachobjektZeichen | null = null;
  for (const stufe of kandidaten(tz) ?? []) {
    ergebnis = waehle(stufe);
    if (ergebnis) break;
  }
  CACHE.set(key, ergebnis);
  return ergebnis;
}

/**
 * Eine Funktion im Führungsstellen-Kasten der Fernmeldeskizze (LFH-1029): die vermessene
 * Funktionsfassung aus Anhang D (EAL, UEAL) oder, wo der Katalog keine hat (S1–S6), eine Person
 * der Führung und Leitung mit dem Kürzel in der Mitte.
 */
export type FunktionsZeichenEingabe = { rolle: FunctionRoleId } | { kuerzel: string };

const FUNKTION_CACHE = new Map<string, FachobjektZeichen | null>();

/** Wie `fachobjektZeichen`: gecacht, wirft nie; im Notfall die Person ohne Kürzel. */
export function funktionsZeichen(e: FunktionsZeichenEingabe): FachobjektZeichen | null {
  const key = JSON.stringify(e);
  if (FUNKTION_CACHE.has(key)) return FUNKTION_CACHE.get(key)!;
  const person: SymbolSpec = { kind: 'person', organization: 'fuehrung-leitung' };
  const spec: SymbolSpec =
    'rolle' in e
      ? { ...person, functionRole: e.rolle }
      : { ...person, labels: { center: e.kuerzel } };
  const ergebnis = waehle([spec]) ?? waehle([person]);
  FUNKTION_CACHE.set(key, ergebnis);
  return ergebnis;
}

/**
 * Das Zeichen eines Bereitstellungsraums (LLH-1107): das Führungszeichen D.2.1
 * „Bereitstellungsraum“ aus Anhang D, freistehend als Piktogramm — gelbe Ortsfläche mit dem
 * Bereitstellungsrahmen. Ohne Organisation: der Raum gehört keiner, und der Katalog führt das
 * Zeichen nur in dieser Fassung. Den Meldekopf (D.2.2) zeichnet der Hub nicht, er führt ihn nicht
 * als Angabe.
 */
const BEREITSTELLUNGSRAUM_SPEC: PictogramSpec = {
  kind: 'pictogram',
  pictogram: 'leadership.staging-area',
};

interface BereitstellungsraumZeichen {
  spec: PictogramSpec;
  drawing: Drawing;
  /** Karten-Bildschlüssel wie bei `fachobjektZeichen`: `ez|` + kanonische Serialisierung. */
  schluessel: string;
}

let brZeichenCache: BereitstellungsraumZeichen | null | undefined;

/**
 * Wie `fachobjektZeichen`: gecacht, wirft nie; `null`, wenn die Bibliothek das Zeichen nicht
 * zeichnet (dann bleibt der Marker ein Kreis).
 */
export function bereitstellungsraumZeichen(): BereitstellungsraumZeichen | null {
  if (brZeichenCache !== undefined) return brZeichenCache;
  try {
    brZeichenCache = {
      spec: BEREITSTELLUNGSRAUM_SPEC,
      drawing: drawAnySpec(BEREITSTELLUNGSRAUM_SPEC),
      schluessel: `ez|${serializeAnySpec(BEREITSTELLUNGSRAUM_SPEC)}`,
    };
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[fachobjektZeichen] Bereitstellungsraum nicht gezeichnet', e);
    }
    brZeichenCache = null;
  }
  return brZeichenCache;
}
