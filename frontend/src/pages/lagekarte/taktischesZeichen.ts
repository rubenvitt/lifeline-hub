import type {
  EinheitId, FachaufgabeId, GrundzeichenId, OrganisationId,
  TaktischesZeichen as TZSpec,
} from 'taktische-zeichen-react';

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

export type TzProps = Pick<TZSpec, 'grundzeichen' | 'organisation' | 'fachaufgabe' | 'einheit'>;

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
