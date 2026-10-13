// Hub-Vokabular der taktischen Zeichen: Ableitung aus App-Feldern (`baueTzProps`) und Fest-Specs.
// Gezeichnet werden die Fachobjekte über @einsatzzeichen (`zeichen/fachobjektZeichen.ts`, LFH-835).
// Die Kennungen stammen aus dem früheren Paket taktische-zeichen (bis LFH-836); ihre Typen stehen
// seitdem hier, nur mit den Werten, die der Hub für Fachobjekte vergibt (design.md D9). Freie
// Zeichen tippt der Leseadapter `zeichen/freiesZeichen.ts` als `string`, denn sie sind Eingabe.
import type { Ausmass, UhsTyp } from '../../api/types';

/** Grundzeichen der Fachobjekte; jedes hat einen Körper in `fachobjektZeichen` (`KOERPER`). */
export const GRUNDZEICHEN_IDS = [
  'taktische-formation',
  'kraftfahrzeug-landgebunden',
  'person',
  'befehlsstelle',
  'wasserfahrzeug',
  'zweirad',
  'anhaenger',
  'hubschrauber',
  'anlass',
  'gefahr',
  'stelle',
] as const;
export type GrundzeichenId = (typeof GRUNDZEICHEN_IDS)[number];

/**
 * Organisationen, die der Hub vergibt: Override im Inspector, Ableitung aus Träger und OPTA.
 * Gespeicherte Werte kommen als `string` aus der DB; die Übersetzung nimmt jeden.
 */
export type OrganisationId =
  'feuerwehr' | 'thw' | 'hilfsorganisation' | 'polizei' | 'bundeswehr' | 'zivil';

/**
 * Fachaufgaben der Fachobjekte (`tz_fachaufgabe`, Ableitung, UHS, Betreuung): die Werte, die
 * `fachobjektZeichen` abbildet (`FAEHIGKEIT`, `VERSORGUNG`) und „Führung“.
 */
export type FachaufgabeId =
  | 'brandbekaempfung'
  | 'wasserversorgung'
  | 'technische-hilfeleistung'
  | 'bergung'
  | 'sprengen'
  | 'entschaerfen'
  | 'abc'
  | 'messen'
  | 'dekontamination'
  | 'dekontamination-personen'
  | 'dekontamination-geraete'
  | 'rettungswesen'
  | 'aerztliche-versorgung'
  | 'krankenhaus'
  | 'einsatzeinheit'
  | 'betreuung'
  | 'unterbringung'
  | 'seelsorge'
  | 'versorgung-trinkwasser'
  | 'versorgung-brauchwasser'
  | 'instandhaltung'
  | 'iuk'
  | 'erkundung'
  | 'veterinaerwesen'
  | 'schlachten'
  | 'wasserrettung'
  | 'wasserfahrzeuge'
  | 'rettungshunde'
  | 'abwehr-wassergefahren'
  | 'heben'
  | 'raeumen'
  | 'hoehenrettung'
  | 'beleuchtung'
  | 'pumpen'
  | 'umweltschaeden-gewaesser'
  | 'warnen'
  | 'transport'
  | 'logistik'
  | 'verpflegung'
  | 'verbrauchsgueter'
  | 'versorgung-elektrizitaet'
  | 'fuehrung';

/**
 * Auswahl der Fachaufgabe eines taktischen Zeichens: Override im Inspector der Lagekarte und
 * Zeichen einer Einheiten-Vorlage (LLH-1042). Eine Teilmenge von {@link FachaufgabeId}.
 */
export const FACHAUFGABE_OPTIONS: { value: FachaufgabeId; label: string }[] = [
  { value: 'rettungswesen', label: 'Rettungswesen/Sanität' },
  { value: 'aerztliche-versorgung', label: 'Ärztliche Versorgung' },
  { value: 'betreuung', label: 'Betreuung' },
  { value: 'verpflegung', label: 'Verpflegung' },
  { value: 'fuehrung', label: 'Führung' },
  { value: 'bergung', label: 'Bergung' },
  { value: 'wasserrettung', label: 'Wasserrettung' },
];

/** Auswahl der Organisation eines taktischen Zeichens (Inspector, Einheiten-Vorlage). */
export const ORGANISATION_OPTIONS: { value: OrganisationId; label: string }[] = [
  { value: 'feuerwehr', label: 'Feuerwehr' },
  { value: 'thw', label: 'THW' },
  { value: 'hilfsorganisation', label: 'Hilfsorganisation' },
  { value: 'polizei', label: 'Polizei' },
  { value: 'bundeswehr', label: 'Bundeswehr' },
  { value: 'zivil', label: 'Zivil' },
];

/** Einheitsgrößen aus dem Typ-Label einer Einheit. */
export type EinheitId = 'trupp' | 'staffel' | 'gruppe' | 'zug' | 'zugtrupp';

/** DV-102-Funktions-Indikator; der Hub setzt nur die Führungskraft. */
export type FunktionId = 'fuehrungskraft';

/** Symbole der UHS-Typen. */
export type SymbolId = 'sammelplatz-betroffene' | 'sammeln';

type Objekttyp = 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt';

const GRUNDZEICHEN: Record<Objekttyp, GrundzeichenId> = {
  einheit: 'taktische-formation',
  fahrzeug: 'kraftfahrzeug-landgebunden',
  fuehrung: 'person',
  abschnitt: 'befehlsstelle',
};

// Einheit-Größe wird aus dem einheit_typ-Label abgeleitet (DV-102-Schlüssel).
const GROESSE_NACH_LABEL: Record<string, EinheitId> = {
  trupp: 'trupp',
  staffel: 'staffel',
  gruppe: 'gruppe',
  zug: 'zug',
  zugtrupp: 'zugtrupp',
};

export function groesseAusLabel(label: string | null | undefined): EinheitId | undefined {
  if (!label) return undefined;
  return GROESSE_NACH_LABEL[label.trim().toLowerCase()];
}

interface TzEingabe {
  objekttyp: Objekttyp;
  einheitTypLabel?: string | null;
  fachaufgabe?: string | null; // tz_fachaufgabe am Objekt (manueller Override)
  organisation?: string | null; // tz_organisation am Objekt (manueller Override)
  orgDefault?: string | null; // Org-Default aus /api/organisation
  // Fahrzeug-Rohfelder für die Ableitung; manuelle tz_*-Overrides bleiben vorrangig.
  fahrzeugtyp?: string | null; // Freitext-Typ → spezifischeres Grundzeichen + Fachaufgabe
  opta?: string | null; // OPTA → Organisation-Fallback (best effort, unvalidiert)
  traegerorganisation?: string | null; // Trägerorganisation → Organisation (primär)
  // Personal-Felder für die Ableitung; ein manueller tz_fachaufgabe-Override bleibt vorrangig.
  funktion?: string | null; // Qualifikations-/Funktionstext → Fachaufgabe
  istFuehrungskraft?: boolean; // setzt den DV-102-Funktions-Indikator 'fuehrungskraft'
}

/** Das Zeichen eines Fachobjekts im Hub-Vokabular; gezeichnet über `fachobjektZeichen`. */
export interface TzProps {
  grundzeichen?: GrundzeichenId;
  organisation?: OrganisationId;
  fachaufgabe?: FachaufgabeId;
  einheit?: EinheitId;
  symbol?: SymbolId;
  /** Freie Farbe (nur Schäden, `AUSMASS_FARBE`); `fachobjektZeichen` bildet sie aufs Palettentoken ab. */
  farbe?: string;
  funktion?: FunktionId;
}

// Fahrzeugtyp (Freitext) → spezifischeres DV-102-Grundzeichen. Konservativ: nur eindeutige Fälle,
// sonst das generische 'kraftfahrzeug-landgebunden'. `kraftrad` ist in der Library deprecated →
// 'zweirad'.
export function grundzeichenAusFahrzeugtyp(
  fahrzeugtyp: string | null | undefined,
): GrundzeichenId | undefined {
  const t = fahrzeugtyp?.trim().toLowerCase();
  if (!t) return undefined;
  if (/\b(boot|mzb|rtb)\b|mehrzweckboot|schlauchboot|rettungsboot|wasserfahrzeug/.test(t))
    return 'wasserfahrzeug';
  if (/\b(krad|kraftrad|motorrad)\b/.test(t)) return 'zweirad';
  if (/\b(anh|anhaenger|fwa)\b|anhänger/.test(t)) return 'anhaenger';
  if (/\b(heli|hubschrauber|helikopter)\b/.test(t)) return 'hubschrauber';
  return undefined;
}

// Freitext (Trägerorganisation bzw. OPTA) → DV-102-OrganisationId per Schlüsselwort.
export function organisationAusText(text: string | null | undefined): OrganisationId | undefined {
  const t = text?.trim().toLowerCase();
  if (!t) return undefined;
  if (/feuerwehr|\b(ff|bf|wf|fw)\b/.test(t)) return 'feuerwehr';
  if (/\bthw\b|technisches hilfswerk/.test(t)) return 'thw';
  if (/polizei|\bpol\b/.test(t)) return 'polizei';
  if (/bundeswehr|\bbw\b/.test(t)) return 'bundeswehr';
  if (/\b(drk|asb|juh|mhd|dlrg)\b|johanniter|malteser|hilfsorganisation|rotes kreuz/.test(t))
    return 'hilfsorganisation';
  return undefined;
}

// Fahrzeugtyp (Freitext) → Fachaufgabe (kuratierte Whitelist, Reihenfolge = Priorität). Kein
// Treffer → keine Fachaufgabe (lieber generisch als falsch).
export function fachaufgabeAusFahrzeugtyp(
  fahrzeugtyp: string | null | undefined,
): FachaufgabeId | undefined {
  const t = fahrzeugtyp?.trim().toLowerCase();
  if (!t) return undefined;
  if (/\b(lf|hlf|tlf|stlf|mlf|klf|tsf|lz|dlk|dl)\b|lösch|loesch/.test(t)) return 'brandbekaempfung';
  if (/\b(rtw|ktw|nef|naw|rth)\b|rettungsdienst|sanit/.test(t)) return 'rettungswesen';
  if (/\b(rw|gw-?t)\b|rüst|ruest|hilfeleistung/.test(t)) return 'technische-hilfeleistung';
  if (/\bgw-?l(og)?\b|logistik/.test(t)) return 'logistik';
  if (/\b(elw|kdow|kdo|ftz)\b|führung|fuehrung/.test(t)) return 'fuehrung';
  return undefined;
}

// Funktions-/Qualifikationstext → Fachaufgabe (schmale Whitelist, Reihenfolge = Priorität). Kein
// Treffer → keine Ableitung.
export function fachaufgabeAusFunktion(
  funktion: string | null | undefined,
): FachaufgabeId | undefined {
  const t = funktion?.trim().toLowerCase();
  if (!t) return undefined;
  if (/notarzt|\barzt\b|ärzt|aerzt/.test(t)) return 'aerztliche-versorgung';
  if (/sanit|rettungs(dienst|assist|sanit|helf)|\b(nfs|rs)\b/.test(t)) return 'rettungswesen';
  if (/iuk|funk|fernmelde/.test(t)) return 'iuk';
  if (/logistik|nachschub/.test(t)) return 'logistik';
  return undefined;
}

/**
 * Leitet die DV-102-Spec aus App-Feldern ab. Priorität je Overlay: manueller Override (tz_*) ??
 * abgeleitet aus Fahrzeugtyp/Träger/OPTA ?? Typ-/Org-Default. Ergebnis ist Hub-Vokabular: welche
 * Merkmale sich am Grundzeichen zeichnen lassen, entscheidet erst `fachobjektZeichen` (LFH-835).
 */
export function baueTzProps(e: TzEingabe): TzProps {
  const grundzeichen: GrundzeichenId =
    e.objekttyp === 'fahrzeug'
      ? (grundzeichenAusFahrzeugtyp(e.fahrzeugtyp) ?? GRUNDZEICHEN.fahrzeug)
      : GRUNDZEICHEN[e.objekttyp];

  const organisation = (e.organisation ??
    organisationAusText(e.traegerorganisation) ??
    organisationAusText(e.opta) ??
    e.orgDefault ??
    undefined) as OrganisationId | undefined;

  const fachaufgabe = (e.fachaufgabe ??
    (e.objekttyp === 'fahrzeug' ? fachaufgabeAusFahrzeugtyp(e.fahrzeugtyp) : undefined) ??
    (e.objekttyp === 'fuehrung' ? fachaufgabeAusFunktion(e.funktion) : undefined) ??
    (e.objekttyp === 'abschnitt' || e.objekttyp === 'fuehrung' ? 'fuehrung' : undefined)) as
    FachaufgabeId | undefined;

  // DV-102-Funktions-Indikator nur für als Führungskraft markierte Personen.
  const funktion: FunktionId | undefined =
    e.objekttyp === 'fuehrung' && e.istFuehrungskraft ? 'fuehrungskraft' : undefined;

  return {
    grundzeichen,
    organisation,
    fachaufgabe,
    einheit: e.objekttyp === 'einheit' ? groesseAusLabel(e.einheitTypLabel) : undefined,
    funktion,
  };
}

// Schaden-Ausmaß → Farbe (einzige Quelle; marker.ts bezieht die Schaden-Farbe über schadenTz).
export const AUSMASS_FARBE: Record<Ausmass, string> = {
  gering: '#52c41a',
  mittel: '#faad14',
  gross: '#fa8c16',
  katastrophal: '#f5222d',
};
const AUSMASS_FALLBACK = '#8c8c8c';

/** Einsatzort (id:0): DV-102-Grundzeichen „anlass" (Einsatz-/Schadensanlass). */
export function einsatzortTz(): TzProps {
  return { grundzeichen: 'anlass' };
}

/**
 * Eigene Führungsstelle (LFH-1181): DV-102-Grundzeichen „Befehlsstelle“ (BABZ D.1.1), die Stelle,
 * an der die Einsatzleitung arbeitet — mobil wie ortsfest dasselbe Zeichen.
 */
export function fuehrungsstelleTz(): TzProps {
  return { grundzeichen: 'befehlsstelle' };
}

/**
 * Schaden: Warn-Dreieck „gefahr"; das Ausmaß steuert nur die Farbe (die Form trägt die Bedeutung,
 * farbenblind-tauglich). Die Farbe ist immer gesetzt.
 */
export function schadenTz(ausmass: Ausmass): TzProps & { farbe: string } {
  return { grundzeichen: 'gefahr', farbe: AUSMASS_FARBE[ausmass] ?? AUSMASS_FALLBACK };
}

// UHS: „stelle" (Kreis) + sanitätsdienstliches Overlay je UhsTyp.
const UHS_TZ: Record<UhsTyp, TzProps> = {
  behandlungsplatz: { grundzeichen: 'stelle', fachaufgabe: 'aerztliche-versorgung' },
  patientenablage: { grundzeichen: 'stelle', symbol: 'sammelplatz-betroffene' },
  verletztensammelstelle: { grundzeichen: 'stelle', symbol: 'sammeln' },
  sonstige: { grundzeichen: 'stelle', fachaufgabe: 'rettungswesen' },
};

/**
 * Organisation des Betreibers einer Stelle (LLH-1161): die Organisations-Vorgabe des Hubs, denn UHS
 * und Betreuungsstelle tragen keine eigene. Ohne Vorgabe steht die Stelle neutral.
 */
function betreiber(organisation: string | null | undefined): Pick<TzProps, 'organisation'> {
  return organisation ? { organisation: organisation as OrganisationId } : {};
}

/** Unfallhilfsstelle: Grundzeichen „stelle" + Overlay nach UhsTyp, Organisation des Betreibers. */
export function uhsTz(typ: UhsTyp, organisation?: string | null): TzProps {
  return { ...UHS_TZ[typ], ...betreiber(organisation) };
}

/**
 * Betreuungsstelle: Grundzeichen „stelle" + Fachaufgabe „betreuung" nach DV 102, für alle vier
 * Einrichtungsstufen dasselbe (der Katalog kennt keine Variante je Stufe) — die Art steht in der
 * Unterzeile des Inspectors. Organisation wie bei der UHS.
 */
export function betreuungsstelleTz(organisation?: string | null): TzProps {
  return { grundzeichen: 'stelle', fachaufgabe: 'betreuung', ...betreiber(organisation) };
}
