/**
 * Hub-Vokabular (`TzProps`, die Kennungen des Altpakets taktische-zeichen) → Zeichenbeschreibung
 * von @einsatzzeichen (`SymbolSpec`). EINZIGE Stelle dieser Übersetzung für die Zeichen der
 * Fachobjekte (LFH-835, openspec/changes/lfh-835-fachobjekt-zeichen-einsatzzeichen/design.md).
 *
 * - D1: Übersetzt wird beim Lesen. DB-Spalten `tz_*`, Snapshots und Offline-Stände behalten die
 *   alten Kennungen; eine Migration erreichte Snapshots und Geräte nicht.
 * - D2: Abbildungstabellen unten; die fachlichen Entscheidungen vom 29.09.2026 stehen dort.
 * - D3: Welche Kombination sich zeichnen lässt, entscheidet allein die Komposition — nicht
 *   `validateSpec` und keine gepflegte Accepts-Liste. Deshalb eine Rückfallkaskade: jede Fassung
 *   der Fachaufgabe, dann ohne Fachaufgabe, ohne Stärke, ohne Organisation, Körper allein.
 * - D4: Ergebnis je Eingang gecacht.
 *
 * Freie Zeichen laufen NICHT hier durch, sie bleiben bis LFH-836 auf dem Altpaket.
 */
import {
  CompositionError,
  NotMeasuredError,
  drawSymbol,
  serializeSpec,
} from '@einsatzzeichen/core';
import {
  ORGANIZATION_IDS,
  type CapabilityId,
  type ColorToken,
  type Drawing,
  type OrganizationId,
  type SymbolSpec,
  type TechnicalBodyMarkId,
} from '@einsatzzeichen/schema';
import { AUSMASS_FARBE, type TzProps } from '../pages/lagekarte/taktischesZeichen';

export interface FachobjektZeichen {
  /** Die wirksame Spec — die erste Fassung der Kaskade, die tatsächlich komponiert. */
  spec: SymbolSpec;
  drawing: Drawing;
  /** Karten-Bildschlüssel: `ez|` + kanonische Serialisierung der wirksamen Spec. */
  schluessel: string;
}

type Teil = Partial<SymbolSpec>;
type Koerpermarke = CapabilityId | TechnicalBodyMarkId;

// Grundzeichen des Hubs → Körper. `befehlsstelle` (Abschnitt) ist neutral in „Führung und
// Leitung“, ohne functionRole mit eingebackenem Kürzel. `stelle` ist nur als circle-12 der
// Hilfsorganisation mit Fachaufgabe darstellbar (F.3; Lücke LFH-829). `zweirad` hat keinen Körper
// (LFH-831) und wird Landfahrzeug. `organisation` hier überstimmt die gespeicherte.
const KOERPER: Record<string, Teil> = {
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
  stelle: { kind: 'circle-12', organization: 'hilfsorganisation' },
};

// Alte Organisationskennungen, die @einsatzzeichen umbenannt hat; die übrigen sind gleich.
const ORGANISATION_ALIAS: Record<string, OrganizationId> = {
  fuehrung: 'fuehrung-leitung',
  gefahrenabwehr: 'sonstige-gefahrenabwehr',
  zivil: 'zivile-einheiten',
};

const STAERKE: Record<string, Teil> = {
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

function organisation(wert: string | undefined): OrganizationId | undefined {
  if (!wert) return undefined;
  const id = ORGANISATION_ALIAS[wert] ?? wert;
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
function verbinde(...teile: Array<Teil | undefined>): SymbolSpec {
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

/** Die Fassungen einer Fachaufgabe am gegebenen Körper, in Versuchsreihenfolge. */
function fassungen(fachaufgabe: string | undefined, koerper: Teil): Teil[] {
  if (!fachaufgabe) return [];
  const versorgung = VERSORGUNG[fachaufgabe];
  // Ist die Marke am Körper nicht vermessen, bleibt wenigstens das Fußband (Versorgung, Anhang G).
  if (versorgung) return [versorgung, { bodyVariant: versorgung.bodyVariant }];
  const faehigkeiten = FAEHIGKEIT[fachaufgabe];
  if (!faehigkeiten) return [];
  const liste: Teil[] = [{ bodyMarks: faehigkeiten }, { capabilities: faehigkeiten }];
  // Rettungsdienstfahrzeuge stehen auf dem Radpaar, nicht auf einer Kfz-Kategorie: RTW/KTW mit
  // Sanität (F.2), NEF/NAW mit Arzt (F.2.4/F.2.5 „alternative“).
  if (
    koerper.kind === 'vehicle-land' &&
    faehigkeiten.some((f) => f === 'medical-service' || f === 'physician')
  ) {
    liste.push({
      vehicleCategory: undefined,
      bodyVariant: 'plain-wheel-pair',
      bodyMarks: faehigkeiten,
    });
  }
  return liste;
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

function kandidaten(tz: TzProps): SymbolSpec[] | null {
  const koerper = tz.grundzeichen ? KOERPER[tz.grundzeichen] : undefined;
  if (!koerper) return null;
  const org: Teil = { organization: koerper.organization ?? organisation(tz.organisation) };
  const staerke = tz.einheit ? STAERKE[tz.einheit] : undefined;
  // An der Person entfallen Fachaufgabe und Funktion (Entscheidung 29.09.2026, Lücke LFH-830).
  const fachaufgabe =
    koerper.kind === 'person'
      ? undefined
      : (tz.fachaufgabe ?? (tz.symbol ? SYMBOL_ERSATZ[tz.symbol] : undefined));
  const farbe: Teil = tz.farbe ? { technicalFill: FARBE_TOKEN[tz.farbe] ?? 'grau' } : {};

  const liste: SymbolSpec[] = [];
  for (const f of fassungen(fachaufgabe, koerper)) {
    liste.push(verbinde(koerper, org, farbe, staerke, f));
  }
  liste.push(verbinde(koerper, org, farbe, staerke));
  liste.push(verbinde(koerper, org, farbe));
  liste.push(verbinde(koerper, farbe, { organization: undefined }));
  liste.push(verbinde({ kind: koerper.kind }));
  return liste;
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
  for (const spec of kandidaten(tz) ?? []) {
    const drawing = zeichne(spec);
    if (drawing) {
      ergebnis = { spec, drawing, schluessel: `ez|${serializeSpec(spec)}` };
      break;
    }
  }
  CACHE.set(key, ergebnis);
  return ergebnis;
}
