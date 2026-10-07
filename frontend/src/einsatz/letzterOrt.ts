/**
 * Die zuletzt offene Adresse im Einsatzrahmen, je Person (LFH-954, Spec `seiten-orientierung`,
 * design.md D5). Einziger Leser ist der Rückweg auf Profil und Verwaltung („Zurück zu <Einsatz>“).
 *
 * Anders als `zuletztModule.ts` zählt hier auch die Ankunft: gefragt ist „wo war ich“, nicht „was
 * habe ich gewählt“. Gemerkt wird die volle Adresse samt Suche, damit der Rückweg an dieselbe
 * Stelle führt, nicht auf die Startseite des Moduls.
 *
 * JE BENUTZER und MIT FRIST einer Schicht, aus demselben Grund wie `zuletztModule.ts`: am geteilten
 * Fükw-Rechner führte der Rückweg sonst in den Einsatz der vorigen Schicht.
 */
import { sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';
import { einsatzPfad } from '../routing/deeplinks';

/** Lebensdauer ab dem letzten Besuch: eine Schichtlänge, wie `ZULETZT_FRIST_MS`. */
export const LETZTER_ORT_FRIST_MS = 12 * 60 * 60 * 1000;

export interface LetzterOrt {
  einsatzId: number;
  /** Pfad samt Suche, z. B. `/einsaetze/5/personen?sicht=karte`. */
  pfad: string;
}

const schluessel = (benutzerId: number) => `lfh:nav:letzter-ort:${benutzerId}`;

/**
 * Nur Adressen des gemerkten Einsatzes: der Rückweg navigiert dorthin, ein fremder Inhalt im
 * Speicher darf nirgends sonst hinführen.
 */
function gehoertZumEinsatz(ort: LetzterOrt): boolean {
  const basis = einsatzPfad(ort.einsatzId);
  return ort.pfad === basis || ort.pfad.startsWith(`${basis}/`) || ort.pfad.startsWith(`${basis}?`);
}

export function merkeLetztenOrt(benutzerId: number, ort: LetzterOrt, jetzt = Date.now()): void {
  sicherSchreiben(schluessel(benutzerId), JSON.stringify({ ...ort, at: jetzt }));
}

/** Der gemerkte Ort, oder `null` (nichts gemerkt, abgelaufen, fremder Inhalt). */
export function leseLetztenOrt(benutzerId: number, jetzt = Date.now()): LetzterOrt | null {
  const roh = sicherLesen(schluessel(benutzerId));
  if (!roh) return null;
  try {
    const wert: unknown = JSON.parse(roh);
    if (typeof wert !== 'object' || wert === null) return null;
    const { einsatzId, pfad, at } = wert as Record<string, unknown>;
    if (typeof einsatzId !== 'number' || typeof pfad !== 'string' || typeof at !== 'number') {
      return null;
    }
    if (jetzt - at > LETZTER_ORT_FRIST_MS) return null;
    const ort = { einsatzId, pfad };
    return gehoertZumEinsatz(ort) ? ort : null;
  } catch {
    return null;
  }
}
