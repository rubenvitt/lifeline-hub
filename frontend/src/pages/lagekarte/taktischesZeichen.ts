import { grundzeichen as grundzeichenKatalog } from 'taktische-zeichen-react';
import type {
  ComponentType,
  EinheitId,
  FachaufgabeId,
  FunktionId,
  GrundzeichenId,
  OrganisationId,
  TaktischesZeichen as TZSpec,
} from 'taktische-zeichen-react';
import type { Ausmass, UhsTyp } from '../../api/types';

export type Objekttyp = 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt';

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

export interface TzEingabe {
  objekttyp: Objekttyp;
  einheitTypLabel?: string | null;
  fachaufgabe?: string | null; // tz_fachaufgabe am Objekt (manueller Override)
  organisation?: string | null; // tz_organisation am Objekt (manueller Override)
  orgDefault?: string | null; // Org-Default aus /api/organisation
  // Fahrzeug-Rohfelder für die Ableitung (LFH-171); manuelle tz_*-Overrides bleiben vorrangig.
  fahrzeugtyp?: string | null; // Freitext-Typ → spezifischeres Grundzeichen + Fachaufgabe
  opta?: string | null; // OPTA → Organisation-Fallback (best effort, unvalidiert)
  traegerorganisation?: string | null; // Trägerorganisation → Organisation (primär)
  // Personal-Felder für die Ableitung (LFH-172); manueller tz_fachaufgabe-Override bleibt vorrangig.
  funktion?: string | null; // Qualifikations-/Funktionstext → Fachaufgabe
  istFuehrungskraft?: boolean; // setzt den DV-102-Funktions-Indikator 'fuehrungskraft'
}

export type TzProps = Pick<
  TZSpec,
  'grundzeichen' | 'organisation' | 'fachaufgabe' | 'einheit' | 'symbol' | 'farbe' | 'funktion'
>;

// Fahrzeugtyp (Freitext) → spezifischeres DV-102-Grundzeichen. Konservativ: nur eindeutige
// Fälle; alles andere behält das generische 'kraftfahrzeug-landgebunden'. `kraftrad` ist in
// der Library deprecated → 'zweirad'. (LFH-171)
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

// Freitext (Trägerorganisation bzw. OPTA) → DV-102-OrganisationId per Schlüsselwort. (LFH-171)
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

// Fahrzeugtyp (Freitext) → Fachaufgabe (kuratierte Whitelist; Reihenfolge = Priorität). Kein
// Treffer → keine Fachaufgabe (lieber generisch als falsch). (LFH-171)
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

// Personal-Funktions-/Qualifikationstext (Freitext) → Fachaufgabe (schmale Whitelist;
// Reihenfolge = Priorität). Kein Treffer → keine Ableitung (bleibt beim fuehrung-Default). (LFH-172)
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

// accepts-Gating (taktische-zeichen-core): manche Grundzeichen rendern bestimmte Overlays NICHT
// — die Library ignoriert sie still. Wir setzen sie deshalb gar nicht erst, damit der
// Icon-Dedup-Key (markerIcons.tzIconKey) nicht divergiert und kein Phantom-Overlay entsteht.
// Wahrheitsquelle ist der `accepts`-Katalog jedes Grundzeichens (KEINE handgepflegten Sets, die
// gegen den Katalog driften könnten). LFH-170 braucht das für beliebige Grundzeichen der freien
// Zeichen; baueTzProps nutzt dieselbe Prüfung.
const AKZEPTIERTE_OVERLAYS: ReadonlyMap<string, ReadonlySet<ComponentType>> = new Map(
  grundzeichenKatalog.map((g) => [g.id, new Set(g.accepts ?? [])]),
);

/** Rendert das Grundzeichen das gegebene Overlay laut DV-102-Katalog? Unbekanntes Grundzeichen
 *  → false (sicher: kein Phantom-Overlay). */
export function grundzeichenAkzeptiert(grundzeichen: string, overlay: ComponentType): boolean {
  return AKZEPTIERTE_OVERLAYS.get(grundzeichen)?.has(overlay) ?? false;
}

/** Leitet die DV-102-Spec aus App-Feldern ab. Priorität je Overlay:
 *  manueller Objekt-Override (tz_*) ?? aus Fahrzeugtyp/Träger/OPTA abgeleitet ?? Typ-/Org-Default.
 *  accepts-Gating entfernt Overlays, die das gewählte Grundzeichen nicht rendert. */
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

  // DV-102-Funktions-Indikator: nur für als Führungskraft markierte Personen (Person-Grundzeichen
  // akzeptiert 'funktion'). Die Library-Enum kennt nur fuehrungskraft|sonderfunktion.
  const funktion: FunktionId | undefined =
    e.objekttyp === 'fuehrung' && e.istFuehrungskraft ? 'fuehrungskraft' : undefined;

  return {
    grundzeichen,
    organisation: grundzeichenAkzeptiert(grundzeichen, 'organisation') ? organisation : undefined,
    fachaufgabe: grundzeichenAkzeptiert(grundzeichen, 'fachaufgabe') ? fachaufgabe : undefined,
    einheit: e.objekttyp === 'einheit' ? groesseAusLabel(e.einheitTypLabel) : undefined,
    funktion,
  };
}

// Schaden-Ausmaß → Farbe (einzige Quelle; marker.ts bezieht die Schaden-Farbe über schadenTz).
const AUSMASS_FARBE: Record<string, string> = {
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

/** Schaden: Warn-Dreieck „gefahr"; das Ausmaß steuert ausschließlich die Farbe (Form trägt
 *  die Bedeutung, daher farbenblind-tauglich). Farbe ist garantiert gesetzt. */
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

/** Unfallhilfsstelle: Grundzeichen „stelle" + Overlay nach UhsTyp. */
export function uhsTz(typ: UhsTyp): TzProps {
  return UHS_TZ[typ];
}
