import type {
  EinheitId, FachaufgabeId, GrundzeichenId, OrganisationId,
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
  trupp: 'trupp', staffel: 'staffel', gruppe: 'gruppe', zug: 'zug', zugtrupp: 'zugtrupp',
};

export function groesseAusLabel(label: string | null | undefined): EinheitId | undefined {
  if (!label) return undefined;
  return GROESSE_NACH_LABEL[label.trim().toLowerCase()];
}

export interface TzEingabe {
  objekttyp: Objekttyp;
  einheitTypLabel?: string | null;
  fachaufgabe?: string | null;   // tz_fachaufgabe am Objekt
  organisation?: string | null;  // tz_organisation am Objekt (Override)
  orgDefault?: string | null;    // Org-Default aus /api/organisation
}

export type TzProps = Pick<TZSpec, 'grundzeichen' | 'organisation' | 'fachaufgabe' | 'einheit' | 'symbol' | 'farbe'>;

/** Leitet die DV-102-Spec aus App-Feldern ab (Org-Default + Objekt-Override + Fachaufgabe). */
export function baueTzProps(e: TzEingabe): TzProps {
  const organisation = (e.organisation ?? e.orgDefault ?? undefined) as OrganisationId | undefined;
  const fachaufgabe = (e.fachaufgabe
    ?? (e.objekttyp === 'abschnitt' || e.objekttyp === 'fuehrung' ? 'fuehrung' : undefined)) as
    FachaufgabeId | undefined;
  return {
    grundzeichen: GRUNDZEICHEN[e.objekttyp],
    organisation,
    fachaufgabe,
    einheit: e.objekttyp === 'einheit' ? groesseAusLabel(e.einheitTypLabel) : undefined,
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
