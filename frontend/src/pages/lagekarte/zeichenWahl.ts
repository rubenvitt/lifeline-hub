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
 *   Tierzustand. Namen aus den Piktogrammtiteln. Führt das Register eine zweite Darstellung
 *   (`variant: 'alternative'`) und zeichnet die Bibliothek sie freistehend, steht sie als eigene
 *   Kachel direkt hinter der ersten — mit unterscheidendem Namen ({@link darstellungsName}).
 * - **Details:** Organisation, Fachaufgabe als randbündige Körpermarke (`bodyMarks`, wie die
 *   Fachobjekte), Einheit (`strength`/`unitGrouping`), Farbe nur aus der Palette und nur, wo das
 *   Zeichen eine technische Füllung trägt (D6). Die Achse „Funktion“ des Altpakets gibt es nicht.
 */
import {
  ALL_PICTOGRAMS,
  checkAnySpec,
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
  type AnimalStateId,
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
/** Titel und Register-Datei der zweiten Darstellung je Piktogramm, nur wo das Register eine führt. */
const ZWEITE_DARSTELLUNG = new Map<string, { titel: string; datei: string }>();
for (const p of ALL_PICTOGRAMS) {
  if (p.variant === 'primary') TITEL.set(p.id, p.title);
  else if (p.variant === 'alternative') {
    ZWEITE_DARSTELLUNG.set(p.id, { titel: p.title, datei: p.referenceAsset });
  }
}

const ZWEITE = 'alternative' as const;
/** Das Feld der Darstellung: die erste trägt keins. */
const variante = (zweite: boolean) => (zweite ? { variant: ZWEITE } : {});

/** Ein Piktogramm des Registers mit seiner zweiten Darstellung, soweit es eine führt. */
export interface Darstellungen {
  id: string;
  titel: string;
  zweite?: { titel: string; datei: string };
}

/**
 * Der Name einer Darstellung, wo das Register zwei führt; sonst der Titel.
 *
 * - Anhang J (`comms.*`): die erste Darstellung ist drahtlos (Zickzack), die zweite
 *   leitergebunden (`pictograms/comms/01-connections.ts` der Bibliothek, Register-Datei
 *   `…_leitergebunden.svg`) — „(Funk)“ und „(Draht)“.
 * - Trägt die zweite einen eigenen Titel, gilt er.
 * - Sonst das Wort hinter dem Titel in der Register-Datei (`5.8.1.7_Gefährliche Stoffe_Chlor.svg`
 *   → „(Chlor)“): die Bibliothek gibt beiden Fassungen denselben Titel, das Register benennt die
 *   zweite nur im Dateinamen. Ein einzelner Buchstabe, eine Zahl oder „Alternative“ ist kein Name.
 * - Rückfall „(zweite Darstellung)“. Die erste Darstellung behält ihren Titel.
 */
export function darstellungsName(p: Darstellungen, zweite: boolean): string {
  if (!p.zweite) return p.titel;
  if (p.id.startsWith('comms.') && /leitergebunden/i.test(p.zweite.datei)) {
    return `${p.titel} ${zweite ? '(Draht)' : '(Funk)'}`;
  }
  if (!zweite) return p.titel;
  if (p.zweite.titel !== p.titel) return p.zweite.titel;
  const wort = p.zweite.datei
    .replace(/\.svg$/i, '')
    .split('_')
    .slice(2)
    .join(' ')
    .trim();
  if (/^\p{L}{3,}$/u.test(wort) && !/^alternative$/i.test(wort)) return `${p.titel} (${wort})`;
  return `${p.titel} (zweite Darstellung)`;
}

const titel = (pictogram: string): string => TITEL.get(pictogram) ?? pictogram;
const faehigkeitName = (id: string) => titel(`capability.${id}`);
const zustandName = (id: string) => titel(`state.${id}`);
/** Name eines Piktogramms in der ersten oder zweiten Darstellung ({@link darstellungsName}). */
const nameDerDarstellung = (pictogram: string, zweite: boolean) =>
  darstellungsName(
    { id: pictogram, titel: titel(pictogram), zweite: ZWEITE_DARSTELLUNG.get(pictogram) },
    zweite,
  );

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
 * (Zustand), ohne `state:`, `pic:` oder `tier:`, die zweite Darstellung mit `:alternative`
 * dahinter (`pic:comms.voice:alternative`). `null` ohne Symbol.
 */
export function symbolVon(spec: AnySpec): string | null {
  if (isFreestandingSpec(spec)) {
    const zusatz = 'variant' in spec && spec.variant === ZWEITE ? `:${ZWEITE}` : '';
    if (spec.kind === 'state') return `state:${spec.state}${zusatz}`;
    if (spec.kind === 'pictogram') return `pic:${spec.pictogram}${zusatz}`;
    if (spec.kind === 'animal-state') return `tier:${spec.state}${zusatz}`;
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
  const { art, wert, zweite } = zerlegeSymbol(id);
  if (entwurf && !isFreestandingSpec(entwurf)) {
    const basis = ohne(entwurf, 'capabilities', 'states');
    if (art === 'cap') return { ...basis, capabilities: [wert as CapabilityId] };
    if (art === 'st') return { ...basis, states: [wert as StateId] };
    return basis;
  }
  if (art === 'state') return { kind: 'state', state: wert as StateId, ...variante(zweite) };
  if (art === 'pic') {
    return { kind: 'pictogram', pictogram: wert as PictogramId, ...variante(zweite) };
  }
  if (art === 'tier') {
    return { kind: 'animal-state', state: wert as AnimalStateId, ...variante(zweite) };
  }
  return null;
}

/** Zerlegt eine Kachel-Kennung in Art, Wert und Darstellung (siehe {@link symbolVon}). */
function zerlegeSymbol(id: string | null): { art?: string; wert: string; zweite: boolean } {
  if (!id) return { wert: '', zweite: false };
  const art = id.slice(0, id.indexOf(':'));
  let wert = id.slice(id.indexOf(':') + 1);
  const zweite = wert.endsWith(`:${ZWEITE}`);
  if (zweite) wert = wert.slice(0, -(ZWEITE.length + 1));
  return { art, wert, zweite };
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

type FreiArt = 'state' | 'pic' | 'tier';

/** Die Kennung im Register (`state.*` für Zustand und Tierzustand). */
const registerId = (art: FreiArt, wert: string) => (art === 'pic' ? wert : `state.${wert}`);

/**
 * Die Kacheln einer freistehenden Art aus den Befunden ihres Wertfeldes: jeder erlaubte Wert, und
 * dahinter seine zweite Darstellung, wo das Register eine führt und die Bibliothek sie zeichnet
 * (`checkAnySpec`). Die zweite steht auch dann, wenn die erste freistehend nicht kanonisch ist
 * (5.8.8.6: die erste gehört an die Person, die zweite zeichnet nur freistehend).
 */
function freistehendeKacheln<V extends string>(
  art: FreiArt,
  befunde: readonly { value: V; status: string }[],
  bau: (wert: V, zweite: boolean) => FreestandingSpec,
): KachelOption[] {
  const kacheln: KachelOption[] = [];
  const kachel = (wert: V, zweite: boolean): KachelOption => {
    const spec = bau(wert, zweite);
    const pictogram = registerId(art, wert);
    return {
      id: symbolVon(spec)!,
      label: nameDerDarstellung(pictogram, zweite),
      suche: '',
      drawing: kachelBild(spec),
    };
  };
  for (const { value, status } of befunde) {
    if (status === 'allowed') kacheln.push(kachel(value, false));
    if (ZWEITE_DARSTELLUNG.has(registerId(art, value)) && checkAnySpec(bau(value, true)).ok) {
      kacheln.push(kachel(value, true));
    }
  }
  return kacheln;
}

/**
 * Das Symbolraster. Mit Grundzeichen die Fähigkeiten und Zustände, die das Vokabular am Entwurf
 * (ohne sein Symbol) erlaubt; ohne Grundzeichen (`null`) die freistehenden Zustände, Piktogramme
 * und Tierzustände, die `freestandingVocabulary` erlaubt. Die Kachel „Kein Symbol“ setzt der
 * Picker davor.
 */
export function symbolOptionen(entwurf: SymbolSpec | null): KachelOption[] {
  if (!entwurf) {
    SYMBOLE_OHNE ??= [
      ...freistehendeKacheln(
        'state',
        freestandingVocabulary(
          { kind: 'state', state: FREESTANDING_FIELD_VALUES.state.state.values[0] },
          'state',
        ),
        (state, zweite) => ({ kind: 'state', state, ...variante(zweite) }),
      ),
      ...freistehendeKacheln(
        'pic',
        freestandingVocabulary(
          { kind: 'pictogram', pictogram: FREESTANDING_FIELD_VALUES.pictogram.pictogram.values[0] },
          'pictogram',
        ),
        (pictogram, zweite) => ({ kind: 'pictogram', pictogram, ...variante(zweite) }),
      ),
      ...freistehendeKacheln(
        'tier',
        freestandingVocabulary(
          {
            kind: 'animal-state',
            state: FREESTANDING_FIELD_VALUES['animal-state'].state.values[0],
          },
          'state',
        ),
        (state, zweite) => ({ kind: 'animal-state', state, ...variante(zweite) }),
      ),
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

/** Ohne Grundzeichen gibt es unter „Details“ nur die Bezeichnung. */
export const KEINE_DETAILS: DetailOptionen = {
  organisation: [],
  fachaufgabe: [],
  einheit: [],
  farbe: [],
};
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
// Aufwärmen
// ---------------------------------------------------------------------------------------------

/** Plant einen Schritt und gibt zurück, wie er sich wieder abbestellen lässt. */
export type Planer = (schritt: () => void) => () => void;

/** Im Leerlauf des Browsers (`requestIdleCallback`), sonst nach kurzer Pause (`setTimeout`). */
export const leerlaufPlaner: Planer = (schritt) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => schritt(), { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(schritt, 50);
  return () => clearTimeout(id);
};

/**
 * Die Schritte des Aufwärmens, je Schritt EIN Raster einer Art: die Grundzeichen, der Satz ohne
 * Grundzeichen, dann je Art das Symbolraster und die Auswahlen unter „Details“.
 */
function aufwaermSchritte(): (() => void)[] {
  return [
    () => void grundzeichenOptionen(),
    () => void symbolOptionen(null),
    ...Object.keys(GRUNDZEICHEN_NAMEN).flatMap((kind) => {
      const spec: SymbolSpec = { kind: kind as SymbolKind };
      return [() => void symbolOptionen(spec), () => void detailOptionen(spec)];
    }),
  ];
}

/**
 * Rechnet die Optionen des Pickers im Leerlauf vor (design.md, Risiko „Picker-Kosten“;
 * Messung in `messung.md`): `vocabulary()` zeichnet jeden Kandidaten probeweise, und der erste
 * Besuch einer Grundzeichenart kostete im Browser rund eine halbe Sekunde. Gefüllt werden dieselben
 * Merker, die der Picker liest; die Bibliothek merkt sich zudem ihre Fassungen je Art.
 *
 * In Häppchen: je Schritt ein Raster einer Art, der nächste erst im nächsten Leerlauf — die Karte
 * bleibt bedienbar. Die Rückgabe bricht ab (Unmount). Ein Wurf in einem Schritt hält das Aufwärmen
 * nicht an; der Picker rechnet das Raster dann selbst.
 */
export function waermeVokabularAuf(planen: Planer = leerlaufPlaner): () => void {
  const schritte = aufwaermSchritte();
  let aus = false;
  let abbestellen = () => {};
  const weiter = () => {
    if (aus) return;
    const schritt = schritte.shift();
    if (!schritt) return;
    try {
      schritt();
    } catch {
      // Bewusst still: das Raster rechnet sonst der Picker beim Öffnen.
    }
    if (schritte.length > 0) abbestellen = planen(weiter);
  };
  abbestellen = planen(weiter);
  return () => {
    aus = true;
    abbestellen();
  };
}

// ---------------------------------------------------------------------------------------------
// Namen
// ---------------------------------------------------------------------------------------------

/** Der Name des Symbols eines Zeichens (Piktogrammtitel), oder `null` ohne Symbol. */
export function symbolName(spec: AnySpec): string | null {
  const id = symbolVon(spec);
  if (!id) return null;
  const { art, wert, zweite } = zerlegeSymbol(id);
  if (art === 'cap') return faehigkeitName(wert);
  if (art === 'st') return zustandName(wert);
  const pictogram = registerId(art as FreiArt, wert);
  return nameDerDarstellung(pictogram, zweite);
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
