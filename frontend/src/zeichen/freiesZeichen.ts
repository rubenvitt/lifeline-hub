/**
 * Leseadapter der freien Lagekarten-Zeichen (LFH-836,
 * openspec/changes/archive/2026-10-11-lfh-836-freie-zeichen-einsatzzeichen/design.md D5, D6). EINZIGE Stelle, die ein
 * gespeichertes freies Zeichen in eine Zeichenbeschreibung von @einsatzzeichen übersetzt — für
 * DB-Zeilen, Lage-Snapshots, Offline-Stände und „zuletzt verwendet“ gleichermaßen.
 *
 * - **`zeichen_spec` gesetzt:** `parseAnySpec`, dann zeichnen. Lehnt die Bibliothek ab (etwa nach
 *   einem Upgrade mit neuer Sperrregel), läuft die Kaskade über die Felder der Spec.
 * - **Altform** (Kennungen des Altpakets taktische-zeichen, als `string`, denn sie sind Eingabe):
 *   bei einer DB-Zeile seit LLH-1160 als Hülle `{"v":1,"alt":{…}}` in `zeichen_spec` (Migration
 *   0192), in Lage-Snapshots von vorher und alten Offline-Ständen als eigene Felder. Übersetzt:
 *   Körper, Organisations-Alias, Stärke und Fachaufgaben aus `fachobjektZeichen` (LFH-835), dazu
 *   die Symboltabelle unten. Was das Altpaket an einem Grundzeichen nicht zeichnete
 *   (`accepts` des Altkatalogs), bleibt auch hier weg; so zeigte es der Hub bisher.
 * - **Kaskade** (Spec `lagekarte-taktische-zeichen`): Symbol → Fachaufgabe → Einheitsgröße →
 *   Organisation → Farbe → Körper; jeder Versuch in `try/catch`. Gleichwertige Fassungen einer
 *   Stufe: vermessen vor abgeleitet, wie bei den Fachobjekten.
 * - **Platzhalter:** zeichnet nichts, steht der Punkt (`{ kind: 'point' }`) da, damit das Zeichen
 *   auswählbar und löschbar bleibt.
 * - `vereinfacht`: ein gespeichertes Merkmal ist nicht im Bild (Kaskade, Platzhalter, ein Wert ohne
 *   Nachfolger). Eine Näherung aus D5 ist keine Vereinfachung, sie zeigt jedes Merkmal.
 * - Ergebnis je Eingang gecacht; der Schlüssel `ez|` + `serializeAnySpec` ist für eine
 *   `SymbolSpec` derselbe wie bei `fachobjektZeichen` (`serializeSpec`).
 */
import {
  CompositionError,
  NotMeasuredError,
  drawAnySpec,
  freestandingRedirect,
  parseAnySpec,
  referenceMovementSpec,
  serializeAnySpec,
  vocabulary,
} from '@einsatzzeichen/core';
import {
  PALETTE,
  TECHNICAL_FILL_TOKENS,
  isFreestandingSpec,
  type AnySpec,
  type CapabilityId,
  type Drawing,
  type FreestandingSpec,
  type PictogramId,
  type StateId,
  type SymbolSpec,
  type TechnicalBodyMarkId,
  type TechnicalFillToken,
  type TendencyId,
} from '@einsatzzeichen/schema';
import {
  eigen,
  FUNKTIONSROLLE,
  KOERPER,
  STAERKE,
  ZUSATZ,
  fassungen,
  organisation,
  verbinde,
  type Teil,
} from './fachobjektZeichen';

/** Ein gespeichertes freies Zeichen, wie es aus DB-Zeile, Snapshot, Offline-Stand oder Leiste kommt. */
export interface FreiesZeichenEingabe {
  zeichen_spec?: string | null;
  grundzeichen?: string | null;
  organisation?: string | null;
  fachaufgabe?: string | null;
  symbol?: string | null;
  einheit?: string | null;
  funktion?: string | null;
  /** Freie Hexfarbe des Altbestands (`#rrggbb`). */
  farbe?: string | null;
}

export interface FreiesZeichenBild {
  /** Die wirksame Spec: die erste Stufe der Kaskade, die zeichnet, sonst der Punkt. */
  spec: AnySpec;
  drawing: Drawing;
  /** Karten-Bildschlüssel: `ez|` + kanonische Serialisierung der wirksamen Spec. */
  schluessel: string;
  /** Ein gespeichertes Merkmal fehlt im Bild; der Inspector nennt dann die Alt-Kennung. */
  vereinfacht: boolean;
}

type Merkmal = 'fachaufgabe' | 'symbol' | 'organisation' | 'einheit' | 'funktion' | 'farbe';

// Welche Merkmale das Altpaket an einem Grundzeichen zeichnete (`accepts` aus
// taktische-zeichen-core 0.10, ohne Name, Typ und Verwaltungsstufe). Fahrrad, Kraftrad und
// Zweirad nahmen nichts an.
const FAHRZEUG: readonly Merkmal[] = ['fachaufgabe', 'symbol', 'organisation', 'einheit'];
const BEHAELTER: readonly Merkmal[] = ['fachaufgabe', 'symbol', 'organisation'];
const ANNAHME: Record<string, readonly Merkmal[]> = {
  ohne: ['symbol'],
  'taktische-formation': FAHRZEUG,
  befehlsstelle: FAHRZEUG,
  stelle: BEHAELTER,
  'ortsfeste-stelle': BEHAELTER,
  person: ['einheit', 'fachaufgabe', 'funktion', 'symbol', 'organisation'],
  gebaeude: BEHAELTER,
  fahrzeug: FAHRZEUG,
  'kraftfahrzeug-landgebunden': FAHRZEUG,
  'kraftfahrzeug-gelaendegaengig': FAHRZEUG,
  'kraftfahrzeug-gelaendegaengig-kategorie3': FAHRZEUG,
  amphibienfahrzeug: FAHRZEUG,
  wechsellader: FAHRZEUG,
  'wechsellader-wechselbehaelter': FAHRZEUG,
  abrollbehaelter: BEHAELTER,
  wechselbehaelter: BEHAELTER,
  wechselbruecke: BEHAELTER,
  rollcontainer: BEHAELTER,
  anhaenger: BEHAELTER,
  'anhaenger-abrollbehaelter': FAHRZEUG,
  'anhaenger-wechselbehaelter': FAHRZEUG,
  'anhaenger-pkw': BEHAELTER,
  'anhaenger-lkw': BEHAELTER,
  schienenfahrzeug: FAHRZEUG,
  kettenfahrzeug: FAHRZEUG,
  fahrrad: [],
  kraftrad: [],
  zweirad: [],
  wasserfahrzeug: ['einheit', 'organisation', 'fachaufgabe'],
  flugzeug: ['einheit', 'organisation'],
  hubschrauber: ['einheit', 'organisation'],
  massnahme: ['symbol', 'farbe'],
  anlass: ['symbol'],
  gefahr: ['symbol', 'farbe'],
  'gefahr-vermutet': ['symbol', 'farbe'],
  'gefahr-akut': ['symbol', 'farbe'],
};

// Grundzeichen → Körper; `null` heißt „Kein Grundzeichen“ (nur ein freistehendes Symbol). Die
// Fachobjekt-Tabelle gilt mit. Näherungen (D5): Befehlsstelle als Formation in Führung und
// Leitung (LFH-1293), Behälter-Familie ohne Aufbau (LFH-831), Zweiräder als Landfahrzeug
// (LFH-1298).
const GRUNDZEICHEN: Record<string, Teil | null> = {
  ...KOERPER,
  ohne: null,
  'ortsfeste-stelle': { kind: 'circle-12', bodyVariant: 'raised-gable' },
  gebaeude: { kind: 'building' },
  fahrzeug: { kind: 'vehicle-land' },
  'kraftfahrzeug-gelaendegaengig': { kind: 'vehicle-land', vehicleCategory: 'kfz-kategorie-2' },
  'kraftfahrzeug-gelaendegaengig-kategorie3': {
    kind: 'vehicle-land',
    vehicleCategory: 'kfz-kategorie-3',
  },
  amphibienfahrzeug: { kind: 'vehicle-land', vehicleCategory: 'amphibienfahrzeug' },
  wechsellader: { kind: 'swap-loader-vehicle', vehicleCategory: 'kfz-kategorie-1' },
  'wechsellader-wechselbehaelter': {
    kind: 'swap-loader-vehicle',
    vehicleCategory: 'kfz-kategorie-1',
  },
  abrollbehaelter: { kind: 'swap-loader-vehicle' },
  wechselbehaelter: { kind: 'swap-loader-vehicle' },
  wechselbruecke: { kind: 'swap-loader-vehicle' },
  rollcontainer: { kind: 'swap-loader-vehicle' },
  'anhaenger-abrollbehaelter': { kind: 'trailer', vehicleCategory: 'kfz-kategorie-1' },
  'anhaenger-wechselbehaelter': { kind: 'trailer', vehicleCategory: 'kfz-kategorie-1' },
  'anhaenger-pkw': { kind: 'trailer', vehicleCategory: 'anhaenger-ein-rad' },
  'anhaenger-lkw': { kind: 'trailer', vehicleCategory: 'anhaenger-zwei-raeder' },
  schienenfahrzeug: { kind: 'vehicle-land', vehicleCategory: 'schienenfahrzeug' },
  kettenfahrzeug: { kind: 'vehicle-land', vehicleCategory: 'kettenfahrzeug' },
  fahrrad: { kind: 'vehicle-land' },
  kraftrad: { kind: 'vehicle-land' },
  flugzeug: { kind: 'vehicle-air', bodyVariant: 'fixed-wing-hull' },
  massnahme: { kind: 'measure' },
  'gefahr-vermutet': { kind: 'hazard', states: ['suspected-situation'] },
  'gefahr-akut': { kind: 'hazard', states: ['acute-situation'] },
};

const EINHEIT: Record<string, Teil> = {
  ...STAERKE,
  bereitschaft: { unitGrouping: 'verband-i' },
  abteilung: { unitGrouping: 'verband-ii' },
  grossverband: { unitGrouping: 'verband-iii' },
};

// Alt-Symbol → Nutzlast (Grundlage: Abgleich vom 10.10.2026, `mapping.mjs`). Im Grundzeichen wird
// eine Fähigkeit randbündig, dann als Box versucht; freistehend ist sie das Kapitel-4-Piktogramm.
// Ein Zustand hängt an `states` bzw. steht als `state` (Personen- und Tierzustände nach
// `freestandingRedirect`). Eine technische Körpermarke gibt es nur im Grundzeichen, ein Körper,
// ein Anhang-J-Piktogramm und ein fertiges Punktzeichen (`frei`, etwa ein Pfeil aus 5.2) nur
// freistehend („Grundzeichen im Grundzeichen“ entfällt, D5). Zu einer Körpermarke kann `frei`
// das freistehende Gegenstück nennen.
// Mehrdeutige Symbole sind bildtreu übersetzt, also wie das Altpaket sie zeichnete.
type SymbolNutzlast =
  | { faehigkeit: CapabilityId; zusatz?: string }
  | { zustand: StateId }
  | { tendenz: TendencyId }
  | { marke: TechnicalBodyMarkId; frei?: AnySpec }
  | { koerper: SymbolSpec }
  | { piktogramm: PictogramId; leitergebunden?: true }
  | { frei: AnySpec };

const kommunikation = (id: string, leitergebunden = false): SymbolNutzlast =>
  leitergebunden
    ? { piktogramm: `comms.${id}` as PictogramId, leitergebunden: true }
    : { piktogramm: `comms.${id}` as PictogramId };

const SYMBOL: Record<string, SymbolNutzlast> = {
  drehleiter: { faehigkeit: 'rescue-aerial-ladder' },
  hebegeraet: { faehigkeit: 'crane-lifting' },
  bagger: { faehigkeit: 'excavation' },
  raeumgeraet: { faehigkeit: 'mechanized-clearing' },
  bruecke: { faehigkeit: 'bridge' },
  // Näherung: Kampfmittel/Explosivstoffe (5.8.1.12).
  sprengmittel: { zustand: 'explosive-ordnance-hazard' },
  beleuchtung: { faehigkeit: 'lighting' },
  bett: { faehigkeit: 'temporary-accommodation-resting' },
  verpflegung: { faehigkeit: 'catering' },
  verbrauchsgueter: { faehigkeit: 'fuels-consumables' },
  trinkwasser: { faehigkeit: 'drinking-water' },
  brauchwasser: { faehigkeit: 'service-water' },
  elektrizitaet: { faehigkeit: 'power-supply' },
  // Näherung: „Geräte“ allgemein als Handwerkzeug (4.7.7).
  geraete: { faehigkeit: 'hand-tools' },
  sprengung: { faehigkeit: 'blasting' },
  transport: { faehigkeit: 'transport' },
  fahrzeug: { koerper: { kind: 'vehicle-land' } },
  fahrrad: { koerper: { kind: 'vehicle-land' } },
  kraftrad: { koerper: { kind: 'vehicle-land' } },
  zweirad: { koerper: { kind: 'vehicle-land' } },
  flugzeug: { koerper: { kind: 'vehicle-air', bodyVariant: 'fixed-wing-hull' } },
  hubschrauber: { koerper: { kind: 'vehicle-air' } },
  entstehungsbrand: { zustand: 'incipient-fire' },
  'fortentwickelter-brand': { zustand: 'developed-fire' },
  vollbrand: { zustand: 'fully-developed-fire' },
  sirene: { faehigkeit: 'siren-warning' },
  lautsprecher: { faehigkeit: 'loudspeaker-warning' },
  // Bildtreu: Lautsprecher mit Schallbögen.
  warnung: { faehigkeit: 'loudspeaker-warning' },
  // Bildtreu: Dreieck mit gekreuzten Stangen (4.8.16).
  zelt: { faehigkeit: 'frame-tent' },
  // SKK 2010, 7.5 „Bewegung in zwei Richtungen (z. B. Sichten, Ordnen, Verteilen)“: freistehend
  // der Pfeil 5.2.4 als Punktzeichen, im Grundzeichen nicht belegt (ESZ-138, ESZ-139).
  sichten: { frei: referenceMovementSpec('movement-both-directions') },
  // Im Grundzeichen die Körpermarke F.3.6, freistehend der Pfeil 5.2.6 (SKK 2010, 7.6; ESZ-139).
  sammeln: { marke: 'circle-collection-arrow', frei: referenceMovementSpec('gathering') },
  // Im Grundzeichen bildtreu F.3.12 (Doppelpfeil, Stiel, V), freistehend das Altzeichen
  // SKK 2010, 10.3.23 (ESZ-139).
  'sammelplatz-betroffene': {
    marke: 'circle-double-arrow-lower-v',
    frei: { kind: 'pictogram', pictogram: 'site.affected-persons-assembly-point' },
  },
  veterinaerwesen: { faehigkeit: 'veterinary' },
  schlachten: { faehigkeit: 'slaughter-culling' },
  // Näherung: verletzt → krank (5.8.6.1).
  'tier-verletzt': { zustand: 'sick-animal' },
  'tier-tot': { zustand: 'dead-animal' },
  person: { koerper: { kind: 'person' } },
  'person-verletzt': { zustand: 'person-injured' },
  'person-tot': { zustand: 'person-dead' },
  'person-vermisst': { zustand: 'person-missing' },
  // Näherung: verschüttet → in Notlage (5.8.8.10).
  'person-verschuettet': { zustand: 'person-in-distress' },
  'person-gerettet': { zustand: 'person-rescued' },
  'person-zu-transportieren': { zustand: 'person-to-be-transported' },
  'person-transportiert': { zustand: 'person-transported' },
  beschaedigt: { zustand: 'damaged' },
  teilzerstoert: { zustand: 'partially-destroyed' },
  zerstoert: { zustand: 'destroyed' },
  teilblockiert: { zustand: 'route-difficult-to-pass' },
  blockiert: { zustand: 'route-impassable' },
  'tendenz-steigend': { tendenz: 'tendency-rising' },
  'tendenz-fallend': { tendenz: 'tendency-falling' },
  'tendenz-unveraendert': { tendenz: 'tendency-unchanged' },
  'ausfall-25': { zustand: 'activity-slightly-increased-outage-up-to-25-percent' },
  'ausfall-50': { zustand: 'activity-moderately-increased-outage-up-to-50-percent' },
  'ausfall-75': { zustand: 'activity-significantly-increased-outage-up-to-75-percent' },
  'ausfall-100': { zustand: 'activity-strongly-increased-total-outage' },
  // Bildtreu 4.1.1 (ABC-Schutz), auch in der Gefahr.
  abc: { faehigkeit: 'cbrn-protection' },
  dekontamination: { faehigkeit: 'decontamination' },
  // „P“/„G“ als Lauf an der Marke (`ZUSATZ`, LLH-1338). Näherung freistehend: das Piktogramm 4.1.3
  // trägt keinen Lauf.
  'dekontamination-personen': {
    faehigkeit: 'decontamination',
    zusatz: ZUSATZ['dekontamination-personen'],
  },
  'dekontamination-geraete': {
    faehigkeit: 'decontamination',
    zusatz: ZUSATZ['dekontamination-geraete'],
  },
  // Bildtreu: zwei Wellenlinien wie in 4.7.1.
  wasser: { faehigkeit: 'water-hazard-control' },
  wasserfahrzeug: { koerper: { kind: 'vehicle-water' } },
  pumpe: { faehigkeit: 'pumping' },
  // Anhang J: leitergebunden („Draht“) ist die zweite Darstellung, Funk die erste.
  bilduebertragung: kommunikation('image-transmission', true),
  'bilduebertragung-funk': kommunikation('image-transmission'),
  datenuebertragung: kommunikation('data-transmission', true),
  'datenuebertragung-funk': kommunikation('data-transmission'),
  fax: kommunikation('fax-transmission', true),
  'fax-funk': kommunikation('fax-transmission'),
  fernsprechen: kommunikation('voice', true),
  'fernsprechen-funk': kommunikation('voice'),
  relaisfunkbetrieb: kommunikation('voice-radio-dmo-repeater'),
  richtbetrieb: kommunikation('directional-radio'),
  kabelbau: kommunikation('cable-construction'),
  // Altzeichen SKK 2010, 8.5 und 8.6, im Raum von Anhang J (ESZ-137).
  fernschreiben: kommunikation('teleprinter-transmission', true),
  'fernschreiben-funk': kommunikation('teleprinter-transmission'),
  festbilduebertragung: kommunikation('still-image-transmission', true),
  'festbilduebertragung-funk': kommunikation('still-image-transmission'),
  vermutung: { zustand: 'suspected-situation' },
  akut: { zustand: 'acute-situation' },
  'technische-hilfeleistung': { faehigkeit: 'technical-assistance' },
  bergung: { faehigkeit: 'recovery' },
  seelsorge: { faehigkeit: 'pastoral-care' },
  // Sonderform 3.6, freistehend (ESZ-134); im Grundzeichen gibt es sie nur als Teil eines
  // ganzen Zeichens (Drohnentrupp), nicht an Stelle, Gefahr oder Maßnahme.
  drohne: { piktogramm: 'special-form.drone' },
};

const PUNKT: SymbolSpec = { kind: 'point' };

/** Die Felder der Altform in der Reihenfolge, in der die Alt-Kennung sie nennt. */
export const ALT_FELDER = [
  'grundzeichen',
  'organisation',
  'fachaufgabe',
  'symbol',
  'einheit',
  'funktion',
  'farbe',
] as const;

/**
 * Die Altform eines freien Zeichens, sonst `null`: die Altwerte aus der Hülle
 * `{"v":1,"alt":{…}}`, die Migration 0192 an Altzeilen in `zeichen_spec` geschrieben hat
 * (LLH-1160), oder — ohne `zeichen_spec`, bei Lage-Snapshots von vorher — die eigenen Felder.
 * Nur Zeichenketten zählen; die Hülle stammt aus der DB, sie ist trotzdem Eingabe.
 */
export function altform(e: FreiesZeichenEingabe): FreiesZeichenEingabe | null {
  if (!e.zeichen_spec) return e.grundzeichen || e.symbol ? e : null;
  // Vorprüfung: eine echte Beschreibung wird nicht zweimal geparst.
  if (!e.zeichen_spec.includes('"alt"')) return null;
  let huelle: unknown;
  try {
    huelle = JSON.parse(e.zeichen_spec);
  } catch {
    return null;
  }
  const alt = (huelle as { alt?: unknown } | null)?.alt;
  if (!alt || typeof alt !== 'object' || Array.isArray(alt)) return null;
  const werte: FreiesZeichenEingabe = {};
  for (const feld of ALT_FELDER) {
    const wert = (alt as Record<string, unknown>)[feld];
    if (typeof wert === 'string') werte[feld] = wert;
  }
  return werte;
}

function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Das Palettentoken mit dem kleinsten Abstand im RGB-Raum zu einer Alt-Hexfarbe (D6); bei
 * Gleichstand gewinnt die Reihenfolge in `TECHNICAL_FILL_TOKENS`. `null` für Unlesbares.
 */
export function naechstesFarbtoken(hex: string): TechnicalFillToken | null {
  const rgb = hexRgb(hex);
  if (!rgb) return null;
  let bestes: TechnicalFillToken | null = null;
  let abstand = Infinity;
  for (const token of TECHNICAL_FILL_TOKENS) {
    const p = hexRgb(PALETTE[token])!;
    const d = p.reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0);
    if (d < abstand) {
      abstand = d;
      bestes = token;
    }
  }
  return bestes;
}

/**
 * Die Palettenfarbe der technischen Füllung einer wirksamen Spec (D6), sonst `null` — ohne
 * Füllung trägt das Zeichen keine eigene Farbe. Für Markerfarbe und Kachelrahmen im Inspector.
 */
export function fuellfarbe(spec: AnySpec): string | null {
  if (isFreestandingSpec(spec)) return null;
  return spec.technicalFill ? PALETTE[spec.technicalFill] : null;
}

function ohneDoppel<T>(liste: readonly T[]): T[] {
  return [...new Set(liste)];
}

/** `verbinde` aus `fachobjektZeichen`, zusätzlich mit aneinandergehängten Zuständen und Fähigkeiten. */
function vereinige(...teile: Array<Teil | undefined>): SymbolSpec {
  const spec = verbinde(...teile) as unknown as Record<string, unknown>;
  for (const feld of ['states', 'capabilities', 'bodyMarks'] as const) {
    const alle = ohneDoppel(teile.flatMap((t) => (t?.[feld] ?? []) as readonly string[]));
    if (alle.length > 0) spec[feld] = alle;
    else delete spec[feld];
  }
  return spec as unknown as SymbolSpec;
}

function zeichne(spec: AnySpec): Drawing | null {
  try {
    return drawAnySpec(spec);
  } catch (e) {
    if (
      !(e instanceof CompositionError) &&
      !(e instanceof NotMeasuredError) &&
      import.meta.env.DEV
    ) {
      // Kein Kombinationsverbot, sondern vermutlich ein Programmfehler.
      console.warn('[freiesZeichen] unerwarteter Fehler beim Zeichnen', spec, e);
    }
    return null;
  }
}

type Treffer = Omit<FreiesZeichenBild, 'vereinfacht'>;

/** Die erste vermessene Fassung der Stufe, sonst die erste abgeleitete, sonst `null`. */
function waehle(stufe: AnySpec[]): Treffer | null {
  let abgeleitet: Treffer | null = null;
  for (const spec of stufe) {
    const drawing = zeichne(spec);
    if (!drawing) continue;
    const z = { spec, drawing, schluessel: `ez|${serializeAnySpec(spec)}` };
    if (!drawing.derivations?.length) return z;
    abgeleitet ??= z;
  }
  return abgeleitet;
}

/** Läuft die Stufen ab; eine spätere Stufe als die erste heißt: etwas ist entfallen. */
function kaskade(stufen: AnySpec[][], verloren: boolean): FreiesZeichenBild {
  for (const [i, stufe] of stufen.entries()) {
    const z = waehle(stufe);
    if (z) return { ...z, vereinfacht: verloren || i > 0 };
  }
  return platzhalter();
}

let PLATZHALTER: FreiesZeichenBild | null = null;
function platzhalter(): FreiesZeichenBild {
  PLATZHALTER ??= {
    spec: PUNKT,
    drawing: drawAnySpec(PUNKT),
    schluessel: `ez|${serializeAnySpec(PUNKT)}`,
    vereinfacht: true,
  };
  return PLATZHALTER;
}

function symbolFrei(n: SymbolNutzlast): AnySpec | null {
  if ('faehigkeit' in n) return { kind: 'pictogram', pictogram: `capability.${n.faehigkeit}` };
  if ('zustand' in n) {
    const s: FreestandingSpec = { kind: 'state', state: n.zustand };
    return freestandingRedirect(s) ?? s;
  }
  if ('tendenz' in n) return { kind: 'state', state: n.tendenz };
  if ('koerper' in n) return n.koerper;
  if ('piktogramm' in n) {
    return n.leitergebunden
      ? { kind: 'pictogram', pictogram: n.piktogramm, variant: 'alternative' }
      : { kind: 'pictogram', pictogram: n.piktogramm };
  }
  if ('frei' in n) return n.frei ?? null;
  return null;
}

/** Die gleichwertigen Fassungen eines Symbols im Grundzeichen, oder `null`, wenn es entfällt. */
function symbolImKoerper(n: SymbolNutzlast): Teil[] | null {
  if ('faehigkeit' in n) {
    // Ein Zusatz steht nur an der Marke, nicht in der Box (s. `ZUSATZ`).
    const randbuendig: Teil = n.zusatz
      ? { bodyMarks: [n.faehigkeit], labels: { center: n.zusatz } }
      : { bodyMarks: [n.faehigkeit] };
    return [randbuendig, { capabilities: [n.faehigkeit] }];
  }
  if ('zustand' in n) return [{ states: [n.zustand] }];
  if ('tendenz' in n) return [{ tendency: n.tendenz }];
  if ('marke' in n) return [{ bodyMarks: [n.marke] }];
  return null;
}

/** Die Farbe als Teil-Spec; entfällt sie an einem Grundzeichen, das sie zeigte, ist sie verloren. */
function farbTeil(farbe: string | undefined, koerper: Teil): { teil: Teil; verloren: boolean } {
  if (!farbe) return { teil: {}, verloren: false };
  const token = naechstesFarbtoken(farbe);
  if (!token) return { teil: {}, verloren: true };
  try {
    const [option] = vocabulary(vereinige(koerper), 'technicalFill', { candidates: [token] });
    if (option?.status === 'allowed') return { teil: { technicalFill: token }, verloren: false };
  } catch {
    // Ein Wurf im Vokabular ist kein Befund über die Farbe; sie entfällt wie ohne Erlaubnis.
  }
  return { teil: {}, verloren: true };
}

function ausAltspalten(e: FreiesZeichenEingabe, verloren: boolean): FreiesZeichenBild {
  const gz = e.grundzeichen || 'ohne';
  const annahme = eigen(ANNAHME, gz);
  if (!annahme || eigen(GRUNDZEICHEN, gz) === undefined) return platzhalter();
  const nimm = (m: Merkmal, wert: string | null | undefined) =>
    wert && annahme.includes(m) ? wert : undefined;
  const symbolId = nimm('symbol', e.symbol);
  const nutzlast = eigen(SYMBOL, symbolId);
  const koerper = eigen(GRUNDZEICHEN, gz) ?? null;

  if (!koerper) {
    const frei = nutzlast ? symbolFrei(nutzlast) : null;
    return frei ? kaskade([[frei]], verloren) : platzhalter();
  }

  const orgId = nimm('organisation', e.organisation);
  const org: Teil = { organization: koerper.organization ?? organisation(orgId) };
  const einheitId = nimm('einheit', e.einheit);
  const staerke = eigen(EINHEIT, einheitId);
  const fachaufgabe = nimm('fachaufgabe', e.fachaufgabe);
  const fach = fassungen(fachaufgabe, koerper);
  const symbol = nutzlast ? symbolImKoerper(nutzlast) : null;
  const farbe = farbTeil(nimm('farbe', e.farbe), koerper);
  const funktionId = nimm('funktion', e.funktion);
  const rolle = eigen(FUNKTIONSROLLE, funktionId);

  const ohneNachfolger =
    (orgId !== undefined && org.organization === undefined) ||
    (einheitId !== undefined && !staerke) ||
    (fachaufgabe !== undefined && fach.length === 0) ||
    (symbolId !== undefined && !symbol) ||
    (funktionId !== undefined && !rolle) ||
    farbe.verloren;

  const basis = [koerper, org, farbe.teil, staerke];
  const stufen: AnySpec[][] = [];
  if (symbol) {
    for (const f of fach.length > 0 ? fach : [[{}]]) {
      stufen.push(f.flatMap((ft) => symbol.map((st) => vereinige(...basis, ft, st))));
    }
  }
  for (const f of fach) stufen.push(f.map((ft) => vereinige(...basis, ft)));
  stufen.push([vereinige(...basis)]);
  stufen.push([vereinige(koerper, org, farbe.teil)]);
  // Organisation und Farbe nahm kein Grundzeichen des Altkatalogs zugleich an; „ohne Organisation“
  // und „ohne Farbe“ fallen deshalb in eine Stufe (der Spec-Pfad trennt sie, `FELDSTUFEN`).
  stufen.push([vereinige(koerper, { organization: undefined })]);
  stufen.push([{ kind: koerper.kind } as SymbolSpec]);
  // Der Funktionsindikator geht allem anderen vor: erst die ganze Kaskade mit Indikator, dann
  // dieselbe ohne ihn, wie bei den Fachobjekten (LLH-1285).
  const mitRolle = rolle
    ? [...stufen.map((stufe) => stufe.map((spec) => vereinige(spec as Teil, rolle))), ...stufen]
    : stufen;
  return kaskade(mitRolle, verloren || ohneNachfolger);
}

// Die Felder einer `SymbolSpec` je Stufe der Kaskade, von „alles außer Symbol“ bis „Körper“.
const KOERPER_FELDER = ['kind', 'vehicleCategory', 'bodyVariant', 'whiteInnerContour'];
const FELDSTUFEN: readonly (readonly string[])[] = [
  [
    ...KOERPER_FELDER,
    'technicalFill',
    'organization',
    'strength',
    'unitGrouping',
    'administrativeLevel',
    'technicalHeadMark',
    'bodyMarks',
    'bodyMarkRenditions',
  ],
  [
    ...KOERPER_FELDER,
    'technicalFill',
    'organization',
    'strength',
    'unitGrouping',
    'administrativeLevel',
    'technicalHeadMark',
  ],
  [...KOERPER_FELDER, 'technicalFill', 'organization'],
  [...KOERPER_FELDER, 'technicalFill'],
  KOERPER_FELDER,
  ['kind'],
];

function ausSpec(spec: AnySpec): FreiesZeichenBild {
  if (isFreestandingSpec(spec)) {
    const umgeleitet = freestandingRedirect(spec);
    const stufen: AnySpec[][] = [umgeleitet ? [spec, umgeleitet] : [spec]];
    if ('variant' in spec && spec.variant) stufen.push([{ ...spec, variant: undefined }]);
    return kaskade(stufen, false);
  }
  const auswahl = (felder: readonly string[]) =>
    Object.fromEntries(
      Object.entries(spec).filter(([k]) => felder.includes(k)),
    ) as unknown as SymbolSpec;
  return kaskade([[spec], ...FELDSTUFEN.map((f) => [auswahl(f)])], false);
}

const CACHE_DECKEL = 1000;
const CACHE = new Map<string, FreiesZeichenBild>();

function eingangsSchluessel(e: FreiesZeichenEingabe): string {
  return JSON.stringify([
    e.zeichen_spec ?? null,
    e.grundzeichen ?? null,
    e.organisation ?? null,
    e.fachaufgabe ?? null,
    e.symbol ?? null,
    e.einheit ?? null,
    e.funktion ?? null,
    e.farbe ?? null,
  ]);
}

function uebersetze(e: FreiesZeichenEingabe): FreiesZeichenBild {
  if (e.zeichen_spec) {
    const huelle = altform(e);
    if (huelle) return ausAltspalten(huelle, false);
    let spec: AnySpec | null = null;
    try {
      spec = parseAnySpec(e.zeichen_spec);
    } catch {
      // Unlesbar (kaputt oder aus einer neueren Bibliothek): Rückfall auf die Altfelder.
    }
    if (spec) return ausSpec(spec);
    return e.grundzeichen || e.symbol ? ausAltspalten(e, true) : platzhalter();
  }
  return ausAltspalten(e, false);
}

/**
 * Das Zeichen eines freien Lagekarten-Zeichens nach @einsatzzeichen. Wirft nie; zeichnet nichts,
 * ist es der Punkt mit `vereinfacht: true`.
 */
export function freiesZeichen(e: FreiesZeichenEingabe): FreiesZeichenBild {
  const key = eingangsSchluessel(e);
  const vorhanden = CACHE.get(key);
  if (vorhanden) return vorhanden;
  let ergebnis: FreiesZeichenBild;
  try {
    ergebnis = uebersetze(e);
  } catch {
    // Letztes Netz: ein gespeicherter Wert darf die Karte nicht zum Absturz bringen (Spec
    // `lagekarte-taktische-zeichen`, „Definierter Rückfall statt Ausfall“).
    ergebnis = platzhalter();
  }
  // Deckel wie bei den Merkern der Zeichenwahl: Jede Vorschau im Picker legt einen Eintrag an.
  if (CACHE.size >= CACHE_DECKEL) CACHE.delete(CACHE.keys().next().value!);
  CACHE.set(key, ergebnis);
  return ergebnis;
}
