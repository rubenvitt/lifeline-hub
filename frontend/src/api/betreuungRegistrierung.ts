import { apiGet, apiSend, type ApiSendOptionen } from './client';
import type {
  Abmeldung,
  AbmeldungEingabe,
  Haushalt,
  KostformZaehlung,
  RegistrierListe,
  RegistrierungEingabe,
} from './types';

/**
 * Registrierstelle der Betreuung (LLH-1612, Change `hitr91ob-registrierstelle-betreuung`): einen
 * Haushalt an einer Stelle registrieren, die Registrierliste der Stelle, Abmelden und die
 * Kostformen ohne Personenbezug. Eigene Datei neben `api/betreuung.ts`, weil Registrieren,
 * Abmelden und die Liste zusätzlich das Modul Personen verlangen (403 ohne).
 *
 * Schreibwege mit `client_id` (Replay liefert den ersten Stand) und Erfassungszeit; ohne Netz
 * vormerken nur über `offline/schreiben.ts`.
 */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/betreuung`;

/** Haushalt registrieren oder Personen anhängen (`haushalt_id`); 201 mit dem Haushalt. */
export function sendRegistrierung(
  einsatzId: number,
  stelleId: number,
  body: RegistrierungEingabe,
  optionen?: ApiSendOptionen,
): Promise<Haushalt> {
  return apiSend<Haushalt>(
    `${basis(einsatzId)}/stellen/${stelleId}/registrierungen`,
    'POST',
    body,
    optionen,
  );
}

/** Registrierliste einer Stelle; personenbezogen, ohne Modul Personen 403. */
export function loadRegistrierListe(einsatzId: number, stelleId: number): Promise<RegistrierListe> {
  return apiGet<RegistrierListe>(`${basis(einsatzId)}/stellen/${stelleId}/registrierungen`);
}

/**
 * Registrierliste für den Druck (LLH-1616): jeder Abruf schreibt je Person einen `druck`-Eintrag
 * ins Zugriffsprotokoll; nur über diesen Weg drucken (`druck/AGENTS.md`). Unverträglichkeiten
 * liefert der Server nur mit `mitUnvertraeglichkeiten`.
 */
export function loadRegistrierlisteDruck(
  einsatzId: number,
  stelleId: number,
  mitUnvertraeglichkeiten: boolean,
): Promise<RegistrierListe> {
  const query = mitUnvertraeglichkeiten ? '?unvertraeglichkeiten=1' : '';
  return apiGet<RegistrierListe>(
    `${basis(einsatzId)}/stellen/${stelleId}/registrierungen/druck${query}`,
  );
}

/** Einen Haushalt oder einzelne Personen abmelden (Verbleib „entlassen“). */
export function sendAbmeldung(
  einsatzId: number,
  stelleId: number,
  body: AbmeldungEingabe,
  optionen?: ApiSendOptionen,
): Promise<Abmeldung> {
  return apiSend<Abmeldung>(
    `${basis(einsatzId)}/stellen/${stelleId}/abmeldungen`,
    'POST',
    body,
    optionen,
  );
}

/** Kostformen aller Registrierten des Einsatzes, ohne Personenbezug; nur Modul Betreuung. */
export function loadKostformZaehlung(einsatzId: number): Promise<KostformZaehlung> {
  return apiGet<KostformZaehlung>(`${basis(einsatzId)}/kostformen`);
}
