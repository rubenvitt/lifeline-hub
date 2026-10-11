/**
 * Zeichenwahl der freien Lagekarten-Zeichen aus dem Vokabular von @einsatzzeichen (LFH-836,
 * openspec/changes/lfh-836-freie-zeichen-einsatzzeichen/design.md D7, Spec
 * `lagekarte-zeichenwahl`). Rein und ohne React: was der Picker anbietet, wie eine Wahl den
 * Entwurf ändert und wie ein Zeichen heißt.
 *
 * - **Angeboten wird nur, was zeichnet.** Jede Option kommt aus `vocabulary()` bzw.
 *   `freestandingVocabulary()`; die Bibliothek zeichnet jeden Kandidaten probeweise. Deshalb sind
 *   die Ergebnisse je Entwurfsstand gemerkt (hier je Serialisierung, im Picker per `useMemo`).
 *   Gemessen in `messung.md` (Aufgabe 5.2).
 * - **Grundzeichen:** die Arten aus `vocabulary({}, 'kind')`; die Namen stehen in
 *   {@link GRUNDZEICHEN_NAMEN} (Alltagsbegriffe; die Bezeichnung der Bibliothek ist Suchbegriff).
 * - **Symbol mit Grundzeichen:** Fähigkeit in der Boxfassung (`capabilities`) oder Zustand
 *   (`states`), eins zur Zeit. **Ohne Grundzeichen:** freistehender Zustand, Piktogramm oder
 *   Tierzustand. Namen aus den Piktogrammtiteln.
 * - **Details:** Organisation, Fachaufgabe als randbündige Körpermarke (`bodyMarks`, wie die
 *   Fachobjekte), Einheit (`strength`/`unitGrouping`), Farbe nur aus der Palette und nur, wo das
 *   Zeichen eine technische Füllung trägt (D6). Die Achse „Funktion“ des Altpakets gibt es nicht.
 */
import {
  ALL_PICTOGRAMS,
  FREESTANDING_FIELD_VALUES,
  ORGANIZATION_LABELS,
  SPEC_FIELD_VALUES,
  STRENGTH_LABELS,
  UNIT_GROUPING_LABELS,
  drawAnySpec,
  freestandingRedirect,
  freestandingVocabulary,
  parseAnySpec,
  serializeAnySpec,
  symbolKindChoiceLabel,
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
  type OrganizationId,
  type PictogramId,
  type StateId,
  type StrengthId,
  type SymbolKind,
  type SymbolSpec,
  type TechnicalFillToken,
  type UnitGroupingId,
} from '@einsatzzeichen/schema';
import { freiesZeichen } from '../../zeichen/freiesZeichen';

/**
 * Deutsche Namen der 19 Grundzeichenarten, wie die Lagekarte sie nennt. Eine Hub-Tabelle (D7):
 * die Bezeichnungen der Bibliothek (`symbolKindChoiceLabel`) sind geometrisch („12-mm-Kreis“,
 * „Konkreter Punkt“) und bleiben Suchbegriff neben dem Namen.
 */
export const GRUNDZEICHEN_NAMEN: Record<SymbolKind, string> = {
  formation: 'Taktische Formation',
  person: 'Person',
  'vehicle-land': 'Landfahrzeug',
  'vehicle-air': 'Luftfahrzeug',
  'vehicle-water': 'Wasserfahrzeug',
  post: 'Funktionsstelle',
  building: 'Gebäude',
  container: 'Behälter',
  area: 'Fläche',
  measure: 'Maßnahme',
  hazard: 'Gefahr',
  point: 'Punkt',
  event: 'Ereignis',
  'spontaneous-helper': 'Spontanhelfende',
  trailer: 'Anhänger',
  'swap-loader-vehicle': 'Wechsellader',
  'upright-rectangle': 'Hochkantrechteck',
  'circle-12': 'Stelle',
  'reduced-house': 'Haus, reduziert',
};

/** Weitere Alltagsbegriffe für die Suche, wo Name und Bibliothek sie nicht tragen. */
const GRUNDZEICHEN_SUCHE: Partial<Record<SymbolKind, string>> = {
  'vehicle-land': 'Fahrzeug Kraftfahrzeug Kfz',
  'vehicle-air': 'Hubschrauber Flugzeug',
  'vehicle-water': 'Boot',
  event: 'Anlass Schadensereignis',
  'circle-12': 'Einrichtung',
  formation: 'Einheit',
};

/** Deutsche Namen der Palettenfarben (`TECHNICAL_FILL_TOKENS`). */
export const FARB_NAMEN: Record<TechnicalFillToken, string> = {
  schwarz: 'Schwarz',
  weiss: 'Weiß',
  rot: 'Rot',
  blau: 'Blau',
  gelb: 'Gelb',
  gruen: 'Grün',
  hellgruen: 'Hellgrün',
  orange: 'Orange',
  braun: 'Braun',
  grau: 'Grau',
  hellgrau: 'Hellgrau',
  hellblau: 'Hellblau',
};

/** Startentwurf der Leiste und des Dialogs „Zeichen hier setzen“: eine taktische Formation. */
export const START_ZEICHEN_SPEC = serializeAnySpec({ kind: 'formation' });

const TITEL = new Map<string, string>();
for (const p of ALL_PICTOGRAMS) if (p.variant === 'primary') TITEL.set(p.id, p.title);

const titel = (pictogram: string): string => TITEL.get(pictogram) ?? pictogram;
const faehigkeitName = (id: string) => titel(`capability.${id}`);
const zustandName = (id: string) => titel(`state.${id}`);

/** Die Fähigkeiten, die es auch als randbündige Körpermarke gibt: der Vorrat der Fachaufgabe. */
const FACHAUFGABEN: readonly CapabilityId[] = SPEC_FIELD_VALUES.capabilities.values.filter((c) =>
  (SPEC_FIELD_VALUES.bodyMarks.values as readonly string[]).includes(c),
);
const istFachaufgabe = (m: string) => (FACHAUFGABEN as readonly string[]).includes(m);

// ---------------------------------------------------------------------------------------------
// Entwurf
// ---------------------------------------------------------------------------------------------

/**
 * Der Entwurf aus seiner Serialisierung. Unlesbares (kaputt, aus einer neueren Bibliothek) nimmt
 * die wirksame Spec des Leseadapters, zur Not den Platzhalter — der Picker hat immer ein Zeichen.
 */
export function leseEntwurf(zeichenSpec: string): AnySpec {
  try {
    return parseAnySpec(zeichenSpec);
  } catch {
    return freiesZeichen({ zeichen_spec: zeichenSpec }).spec;
  }
}

/** Die Grundzeichenart, oder `null` bei einem freistehenden Zeichen („Kein Grundzeichen“). */
export function grundzeichenVon(spec: AnySpec): SymbolKind | null {
  return isFreestandingSpec(spec) ? null : spec.kind;
}

function zeichnet(spec: AnySpec): boolean {
  try {
    drawAnySpec(spec);
    return true;
  } catch {
    return false;
  }
}

function ohne<T extends object>(spec: T, ...felder: string[]): T {
  const kopie = { ...spec } as Record<string, unknown>;
  for (const f of felder) delete kopie[f];
  return kopie as T;
}

/** Die Fachaufgaben des Entwurfs (Fähigkeiten unter den Körpermarken); andere Marken bleiben stehen. */
function fachaufgabenVon(spec: SymbolSpec): CapabilityId[] {
  return (spec.bodyMarks ?? []).filter(istFachaufgabe) as CapabilityId[];
}

function ohneFachaufgabe(spec: SymbolSpec): SymbolSpec {
  const rest = (spec.bodyMarks ?? []).filter((m) => !istFachaufgabe(m));
  return rest.length > 0 ? { ...spec, bodyMarks: rest } : ohne(spec, 'bodyMarks');
}

/**
 * Wechselt das Grundzeichen und übernimmt vom alten Entwurf, was die neue Art zeichnet — Feld für
 * Feld, vom Träger zum Beiwerk. Was sie ablehnt, verwirft der Wechsel (Spec
 * `lagekarte-zeichenwahl`). Von einem freistehenden Zeichen geht nichts mit.
 */
export function mitGrundzeichen(alt: AnySpec, kind: SymbolKind): SymbolSpec {
  let spec: SymbolSpec = { kind };
  if (isFreestandingSpec(alt)) return spec;
  const versuche = (teil: Partial<SymbolSpec>) => {
    const neu = { ...spec, ...teil } as SymbolSpec;
    if (zeichnet(neu)) spec = neu;
  };
  if (alt.organization) versuche({ organization: alt.organization });
  if (alt.technicalFill) versuche({ technicalFill: alt.technicalFill });
  if (alt.strength) versuche({ strength: alt.strength });
  if (alt.unitGrouping) versuche({ unitGrouping: alt.unitGrouping });
  for (const m of fachaufgabenVon(alt)) versuche({ bodyMarks: [...(spec.bodyMarks ?? []), m] });
  if (alt.capabilities?.length) versuche({ capabilities: alt.capabilities });
  if (alt.states?.length) versuche({ states: alt.states });
  return spec;
}

/**
 * Das gewählte Symbol als Kachel-Kennung: mit Grundzeichen `cap:` (Fähigkeit) oder `st:`
 * (Zustand), ohne `state:`, `pic:` oder `tier:`. `null` ohne Symbol.
 */
export function symbolVon(spec: AnySpec): string | null {
  if (isFreestandingSpec(spec)) {
    if (spec.kind === 'state') return `state:${spec.state}`;
    if (spec.kind === 'pictogram') return `pic:${spec.pictogram}`;
    if (spec.kind === 'animal-state') return `tier:${spec.state}`;
    return null;
  }
  if (spec.capabilities?.length) return `cap:${spec.capabilities[0]}`;
  if (spec.states?.length) return `st:${spec.states[0]}`;
  return null;
}

/**
 * Setzt das Symbol einer Kachel. Mit Grundzeichen ersetzt es Fähigkeit und Zustand des Entwurfs
 * (`null` = „Kein Symbol“); ohne Grundzeichen (`entwurf` freistehend oder `null`) ist es das
 * ganze Zeichen. Ohne Grundzeichen und ohne Symbol gibt es kein Zeichen: `null`.
 */
export function mitSymbol(entwurf: AnySpec | null, id: string | null): AnySpec | null {
  const [art, wert] = id ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] : [];
  if (entwurf && !isFreestandingSpec(entwurf)) {
    const basis = ohne(entwurf, 'capabilities', 'states');
    if (art === 'cap') return { ...basis, capabilities: [wert as CapabilityId] };
    if (art === 'st') return { ...basis, states: [wert as StateId] };
    return basis;
  }
  if (art === 'state') return { kind: 'state', state: wert as StateId };
  if (art === 'pic') return { kind: 'pictogram', pictogram: wert as PictogramId };
  if (art === 'tier') return { kind: 'animal-state', state: wert } as FreestandingSpec;
  return null;
}

export type DetailAchse = 'organisation' | 'fachaufgabe' | 'einheit' | 'farbe';

/** Setzt (oder leert mit `null`) eine Achse unter „Details“. Freistehend ändert sich nichts. */
export function mitDetail(spec: AnySpec, achse: DetailAchse, wert: string | null): AnySpec {
  if (isFreestandingSpec(spec)) return spec;
  switch (achse) {
    case 'organisation':
      return wert ? { ...spec, organization: wert as OrganizationId } : ohne(spec, 'organization');
    case 'farbe':
      return wert
        ? { ...spec, technicalFill: wert as TechnicalFillToken }
        : ohne(spec, 'technicalFill');
    case 'fachaufgabe': {
      const basis = ohneFachaufgabe(spec);
      return wert
        ? { ...basis, bodyMarks: [...(basis.bodyMarks ?? []), wert as CapabilityId] }
        : basis;
    }
    case 'einheit': {
      const basis = ohne(spec, 'strength', 'unitGrouping');
      if (!wert) return basis;
      const [feld, id] = wert.split(':');
      return feld === 'strength'
        ? { ...basis, strength: id as StrengthId }
        : { ...basis, unitGrouping: id as UnitGroupingId };
    }
  }
}

/** Der gesetzte Wert einer Achse unter „Details“, in der Form der Optionen. */
export function detailVon(spec: AnySpec, achse: DetailAchse): string | null {
  if (isFreestandingSpec(spec)) return null;
  switch (achse) {
    case 'organisation':
      return spec.organization ?? null;
    case 'farbe':
      return spec.technicalFill ?? null;
    case 'fachaufgabe':
      return fachaufgabenVon(spec)[0] ?? null;
    case 'einheit':
      if (spec.strength) return `strength:${spec.strength}`;
      if (spec.unitGrouping) return `unitGrouping:${spec.unitGrouping}`;
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Optionen
// ---------------------------------------------------------------------------------------------

export interface KachelOption {
  /** Kachel-Kennung (`data-id`), siehe {@link symbolVon}; beim Grundzeichen die Art. */
  id: string;
  label: string;
  /** Zusätzliche Suchbegriffe (Bibliotheksbezeichnung, Alltagsbegriffe). */
  suche: string;
  /** Was die Kachel zeigt; `null`, wenn sich das Symbol allein nicht zeichnen lässt. */
  drawing: Drawing | null;
}

export interface GrundzeichenOption extends KachelOption {
  spec: SymbolSpec;
}

// Gemerkt je Eingang: die Bibliothek zeichnet jeden Kandidaten probeweise (D7). Die Menge der
// Entwürfe einer Sitzung ist klein; ein Deckel hält sie trotzdem endlich.
const MERKER_DECKEL = 200;
function gemerkt<T>(merker: Map<string, T>, schluessel: string, rechne: () => T): T {
  const vorhanden = merker.get(schluessel);
  if (vorhanden !== undefined) return vorhanden;
  const wert = rechne();
  if (merker.size >= MERKER_DECKEL) merker.delete(merker.keys().next().value!);
  merker.set(schluessel, wert);
  return wert;
}

const KACHEL_BILDER = new Map<string, Drawing | null>();
/** Das Bild einer Kachel, gemerkt je Spec (die Kacheln eines Rasters wechseln selten). */
function kachelBild(spec: AnySpec): Drawing | null {
  return gemerkt(KACHEL_BILDER, serializeAnySpec(spec), () => {
    try {
      return drawAnySpec(spec);
    } catch {
      return null;
    }
  });
}

let GRUNDZEICHEN: GrundzeichenOption[] | null = null;

/** Die Grundzeichenarten, die das Vokabular erlaubt, mit Namen und Bild. */
export function grundzeichenOptionen(): GrundzeichenOption[] {
  GRUNDZEICHEN ??= vocabulary({}, 'kind')
    .filter((o) => o.status === 'allowed')
    .map(({ value: kind }) => {
      const spec: SymbolSpec = { kind };
      return {
        id: kind,
        label: GRUNDZEICHEN_NAMEN[kind] ?? symbolKindChoiceLabel(kind),
        suche: [symbolKindChoiceLabel(kind), GRUNDZEICHEN_SUCHE[kind] ?? ''].join(' '),
        drawing: kachelBild(spec),
        spec,
      };
    });
  return GRUNDZEICHEN;
}

/** Das Bild eines Zustands allein: freistehend, sonst an seinem kanonischen Träger. */
function zustandBild(state: StateId): Drawing | null {
  const frei: FreestandingSpec = { kind: 'state', state };
  return kachelBild(freestandingRedirect(frei) ?? frei);
}

const SYMBOLE_MIT = new Map<string, KachelOption[]>();
let SYMBOLE_OHNE: KachelOption[] | null = null;

const erlaubt = <V>(optionen: readonly { value: V; status: string }[]): V[] =>
  optionen.filter((o) => o.status === 'allowed').map((o) => o.value);

/**
 * Das Symbolraster. Mit Grundzeichen die Fähigkeiten und Zustände, die das Vokabular am Entwurf
 * (ohne sein Symbol) erlaubt; ohne Grundzeichen (`null`) die freistehenden Zustände, Piktogramme
 * und Tierzustände, die `freestandingVocabulary` erlaubt. Die Kachel „Kein Symbol“ setzt der
 * Picker davor.
 */
export function symbolOptionen(entwurf: SymbolSpec | null): KachelOption[] {
  if (!entwurf) {
    SYMBOLE_OHNE ??= [
      ...erlaubt(
        freestandingVocabulary(
          { kind: 'state', state: FREESTANDING_FIELD_VALUES.state.state.values[0] },
          'state',
        ),
      ).map((s) => ({
        id: `state:${s}`,
        label: zustandName(s),
        suche: '',
        drawing: kachelBild({ kind: 'state', state: s }),
      })),
      ...erlaubt(
        freestandingVocabulary(
          { kind: 'pictogram', pictogram: FREESTANDING_FIELD_VALUES.pictogram.pictogram.values[0] },
          'pictogram',
        ),
      ).map((p) => ({
        id: `pic:${p}`,
        label: titel(p),
        suche: '',
        drawing: kachelBild({ kind: 'pictogram', pictogram: p }),
      })),
      ...erlaubt(
        freestandingVocabulary(
          {
            kind: 'animal-state',
            state: FREESTANDING_FIELD_VALUES['animal-state'].state.values[0],
          },
          'state',
        ),
      ).map((s) => ({
        id: `tier:${s}`,
        label: zustandName(s),
        suche: '',
        drawing: kachelBild({ kind: 'animal-state', state: s } as FreestandingSpec),
      })),
    ];
    return SYMBOLE_OHNE;
  }
  const basis = ohne(entwurf, 'capabilities', 'states');
  return gemerkt(SYMBOLE_MIT, serializeAnySpec(basis), () => [
    ...erlaubt(vocabulary(basis, 'capabilities')).map((c) => ({
      id: `cap:${c}`,
      label: faehigkeitName(c),
      suche: '',
      drawing: kachelBild({ kind: 'pictogram', pictogram: `capability.${c}` as PictogramId }),
    })),
    ...erlaubt(vocabulary(basis, 'states')).map((s) => ({
      id: `st:${s}`,
      label: zustandName(s),
      suche: '',
      drawing: zustandBild(s),
    })),
  ]);
}

export interface DetailOption {
  value: string;
  label: string;
}

export interface DetailOptionen {
  organisation: DetailOption[];
  fachaufgabe: DetailOption[];
  einheit: DetailOption[];
  /** Nur Palettentoken; `farbe` ist der Wert aus `PALETTE`. Leer, wo das Zeichen keine Füllung trägt. */
  farbe: (DetailOption & { farbe: string })[];
}

const KEINE_DETAILS: DetailOptionen = { organisation: [], fachaufgabe: [], einheit: [], farbe: [] };
const DETAILS = new Map<string, DetailOptionen>();

/**
 * Die Auswahlen unter „Details“: je Achse die Werte, die das Vokabular am Entwurf erlaubt — jede
 * Achse gefragt am Entwurf ohne ihren eigenen Wert. Freistehend gibt es keine.
 */
export function detailOptionen(spec: AnySpec): DetailOptionen {
  if (isFreestandingSpec(spec)) return KEINE_DETAILS;
  return gemerkt(DETAILS, serializeAnySpec(spec), () => {
    const ohneOrg = ohne(spec, 'organization');
    const ohneEinheit = ohne(spec, 'strength', 'unitGrouping');
    const ohneFarbe = ohne(spec, 'technicalFill');
    return {
      organisation: erlaubt(vocabulary(ohneOrg, 'organization')).map((o) => ({
        value: o,
        label: ORGANIZATION_LABELS[o],
      })),
      fachaufgabe: erlaubt(
        vocabulary(ohneFachaufgabe(spec), 'bodyMarks', { candidates: FACHAUFGABEN }),
      ).map((c) => ({ value: c, label: faehigkeitName(c) })),
      einheit: [
        ...erlaubt(vocabulary(ohneEinheit, 'strength')).map((s) => ({
          value: `strength:${s}`,
          label: STRENGTH_LABELS[s],
        })),
        ...erlaubt(vocabulary(ohneEinheit, 'unitGrouping')).map((u) => ({
          value: `unitGrouping:${u}`,
          label: UNIT_GROUPING_LABELS[u],
        })),
      ],
      farbe: erlaubt(
        vocabulary(ohneFarbe, 'technicalFill', { candidates: TECHNICAL_FILL_TOKENS }),
      ).map((t) => ({
        value: t,
        label: FARB_NAMEN[t as TechnicalFillToken],
        farbe: PALETTE[t as TechnicalFillToken],
      })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Namen
// ---------------------------------------------------------------------------------------------

/** Der Name des Symbols eines Zeichens (Piktogrammtitel), oder `null` ohne Symbol. */
export function symbolName(spec: AnySpec): string | null {
  const id = symbolVon(spec);
  if (!id) return null;
  const wert = id.slice(id.indexOf(':') + 1);
  if (id.startsWith('cap:')) return faehigkeitName(wert);
  if (id.startsWith('pic:')) return titel(wert);
  return zustandName(wert);
}

/** Die Bestandteile eines Zeichens mit ihren Namen, vom Träger zum Beiwerk. */
export function zeichenTeile(spec: AnySpec): { achse: string; name: string }[] {
  if (isFreestandingSpec(spec)) {
    const name = symbolName(spec);
    return name ? [{ achse: 'Symbol', name }] : [];
  }
  const teile = [{ achse: 'Grundzeichen', name: GRUNDZEICHEN_NAMEN[spec.kind] ?? spec.kind }];
  if (spec.organization) {
    teile.push({ achse: 'Organisation', name: ORGANIZATION_LABELS[spec.organization] });
  }
  for (const f of fachaufgabenVon(spec)) {
    teile.push({ achse: 'Fachaufgabe', name: faehigkeitName(f) });
  }
  const symbol = symbolName(spec);
  if (symbol) teile.push({ achse: 'Symbol', name: symbol });
  if (spec.strength) teile.push({ achse: 'Einheit', name: STRENGTH_LABELS[spec.strength] });
  if (spec.unitGrouping) {
    teile.push({ achse: 'Einheit', name: UNIT_GROUPING_LABELS[spec.unitGrouping] });
  }
  if (spec.technicalFill) {
    teile.push({
      achse: 'Farbe',
      name: FARB_NAMEN[spec.technicalFill as TechnicalFillToken] ?? spec.technicalFill,
    });
  }
  return teile;
}

/** Benennt ein Zeichen — der zugängliche Name der „zuletzt verwendet“-Kacheln. Rein. */
export function zeichenName(spec: AnySpec): string {
  return zeichenTeile(spec)
    .map((t) => t.name)
    .join(' · ');
}
