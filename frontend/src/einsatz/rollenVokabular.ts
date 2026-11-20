import type { BenoetigteRolle, EinsatzRolle, OrgRolle, SystemRolle } from '../api/types';

/**
 * Das Rollen-Vokabular (LLH-1818, `frontend/AGENTS.md`, „Begriffe“): EINE Quelle für den Namen
 * jeder Rolle und die Zeile, was sie darf. Zugriff, Modulsperre, Benutzerverwaltung, Gründe
 * „Nur Ansicht · …“, Zugangsprotokoll und Benutzermenü lesen hier; ein Wächter
 * (`rollenVokabular.guard.test.ts`) verbietet Rollennamen als Literal anderswo.
 *
 * Die `Record`s über die Wire-Typen brechen den Build, sobald der Typ-Codegen eine Rolle ergänzt
 * (so kam „Mitarbeit“ hinzu, LLH-1817), statt still den Rohwert zu zeigen.
 *
 * Darf-Zeilen nennen den Umfang in wenigen Wörtern, nie die Bedienung (benannte Ausnahme in
 * „Texte: zeigen statt erklären“); höchstens 80 Zeichen.
 */
export interface RollenBegriff {
  /** Der Name, überall gleich. */
  name: string;
  /** Was die Rolle darf, als zweite Zeile in der aufgeklappten Rollenauswahl. */
  darf: string;
}

/** Rolle im Einsatz (Reiter „Zugriff“). Reihenfolge = Rang, Einsatzleitung zuerst. */
export const EINSATZ_ROLLE: Record<EinsatzRolle, RollenBegriff> = {
  einsatzleitung: {
    name: 'Einsatzleitung',
    darf: 'schreibt überall, verwaltet Zugriff und Geräte',
  },
  fuehrungspersonal: {
    name: 'Führungspersonal',
    darf: 'schreibt in Modulen, Kopfdaten und Einstellungen',
  },
  mitarbeit: {
    name: 'Mitarbeit',
    darf: 'erfasst Meldungen, Chat und ETB-Einträge, ändert sonst nichts',
  },
  beobachter: { name: 'Beobachter', darf: 'liest nur' },
};

/** Rolle in der Organisation (Benutzerverwaltung). */
export const ORG_ROLLE: Record<OrgRolle, RollenBegriff> = {
  keine: { name: 'Keine', darf: 'nur Einsätze, in die sie aufgenommen ist' },
  fuehrungskraft: {
    name: 'Führungskraft der Organisation',
    darf: 'legt Einsätze an, liest jeden Einsatz der Organisation',
  },
};

/** Rolle in der Verwaltung (Benutzerverwaltung). */
export const SYSTEM_ROLLE: Record<SystemRolle, RollenBegriff> = {
  keiner: { name: 'Keine', darf: 'keine Verwaltung' },
  admin: {
    name: 'System-Admin',
    darf: 'verwaltet Benutzer, Stammdaten und Einstellungen, liest jeden Einsatz',
  },
};

/** Grund „Nur Ansicht“ für Verwaltungsflächen (`components/nurAnsicht.ts` reicht ihn weiter). */
export const NUR_ADMIN = `nur ${SYSTEM_ROLLE.admin.name}`;

/**
 * Stufe der Modulsperre, von offen nach eng; `frei` steht für „keine Stufe“ (Wire: `null`). Die
 * Darf-Zeile nennt, wer das Modul öffnet (Spec `modul-freigabe`, Archiv: „Führung im Einsatz“
 * zählt die Rolle im Einsatz mit, „Führungskraft der Organisation“ nur die Org-Rolle).
 */
export const MODUL_STUFE: Record<BenoetigteRolle | 'frei', RollenBegriff> = {
  frei: { name: 'Frei (alle)', darf: 'alle, die den Einsatz sehen' },
  einsatzfuehrung: {
    name: 'Führung im Einsatz',
    darf: 'Einsatzleitung, Führungspersonal, Führungskraft der Organisation, System-Admin',
  },
  fuehrungskraft: {
    name: 'Führungskraft der Organisation',
    darf: 'nur Führungskraft der Organisation und System-Admin',
  },
  admin: { name: 'System-Admin', darf: 'nur System-Admin' },
};

/** Feldnamen: wo die Rolle gilt. */
export const ROLLE_IM_EINSATZ_FELD = 'Rolle im Einsatz';
export const ROLLE_IN_ORG_FELD = 'Rolle in der Organisation';
export const ROLLE_IN_VERWALTUNG_FELD = 'Rolle in der Verwaltung';

/** Der System-Admin der Organisation, der der Einsatz gehört (ersetzt „Org-Admin“). */
export const SYSTEM_ADMIN_DER_ORG = `${SYSTEM_ROLLE.admin.name} der Organisation`;

/** Ein Konto ohne Rolle in Verwaltung und Organisation. */
export const KEINE_ROLLE = 'Keine Rolle';

/** Die Namen der gesetzten Rollen eines Kontos, System-Admin zuerst; ohne Rolle „Keine Rolle“. */
export function kontoRollenNamen(konto: {
  system_rolle: SystemRolle;
  org_rolle: OrgRolle;
}): string[] {
  const namen: string[] = [];
  if (konto.system_rolle === 'admin') namen.push(SYSTEM_ROLLE.admin.name);
  if (konto.org_rolle === 'fuehrungskraft') namen.push(ORG_ROLLE.fuehrungskraft.name);
  return namen.length > 0 ? namen : [KEINE_ROLLE];
}
