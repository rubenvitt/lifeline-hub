/**
 * Die zuletzt offene Adresse im Einsatzrahmen, je Person (LFH-954, Spec `seiten-orientierung`,
 * design.md D5). Einziger Leser ist `einsatzRueckweg.ts`, der Rückweg „Zurück zu <Einsatz>“ auf
 * den Seiten der Ebene 1 und in der Hilfe (LLH-1731).
 *
 * Anders als `zuletztModule.ts` zählt hier auch die Ankunft: gefragt ist „wo war ich“, nicht „was
 * habe ich gewählt“. Gemerkt wird der volle Pfad, damit der Rückweg an dieselbe Stelle führt,
 * nicht auf die Startseite des Moduls, aber ohne die Suche: dort stehen Freitextfilter, und die
 * gehören nicht für eine Schicht in den Browserspeicher (Spec `seiten-orientierung`).
 *
 * Was gemerkt wird, entscheidet der Rahmen (`EinsatzLayout.tsx`, Merk-Effekt und `merkbar`): kein
 * Ort in einem gesperrten Modul und keiner auf der Auffangseite „Seite nicht gefunden“ (LLH-1729,
 * `nichtGefundenContext.ts`), sonst führte der Rückweg in die Sperre oder auf „gibt es nicht“.
 *
 * JE BENUTZER und MIT FRIST einer Schicht, aus demselben Grund wie `zuletztModule.ts`: am geteilten
 * Fükw-Rechner führte der Rückweg sonst in den Einsatz der vorigen Schicht.
 */
import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';
import { einsatzPfad } from '../routing/deeplinks';

/** Lebensdauer ab dem letzten Besuch: eine Schichtlänge, wie `ZULETZT_FRIST_MS`. */
export const LETZTER_ORT_FRIST_MS = 12 * 60 * 60 * 1000;

export interface LetzterOrt {
  einsatzId: number;
  /** Pfad ohne Suche, z. B. `/einsaetze/5/personen`. */
  pfad: string;
}

const schluessel = (benutzerId: number) => `lfh:nav:letzter-ort:${benutzerId}`;

/**
 * Nur Adressen des gemerkten Einsatzes: der Rückweg navigiert dorthin, ein fremder Inhalt im
 * Speicher darf nirgends sonst hinführen. Eine Suche am Pfad lässt der Rahmen weg; der Zweig für
 * `?` bleibt, damit ein älterer Speicherstand mit Suche weiter gilt, und schadet nicht.
 */
function gehoertZumEinsatz(ort: LetzterOrt): boolean {
  const basis = einsatzPfad(ort.einsatzId);
  return ort.pfad === basis || ort.pfad.startsWith(`${basis}/`) || ort.pfad.startsWith(`${basis}?`);
}

export function merkeLetztenOrt(benutzerId: number, ort: LetzterOrt, jetzt = Date.now()): void {
  sicherSchreiben(schluessel(benutzerId), JSON.stringify({ ...ort, at: jetzt }));
}

/** Der rohe Speicherstand samt Zeitpunkt, `null` ohne Eintrag; nur für `restoreLetztenOrt`. */
export type LetzterOrtSnapshot = string | null;

/** Hält den Speicherstand fest, bevor der Rahmen eine neue Adresse merkt. */
export function snapshotLetztenOrt(benutzerId: number): LetzterOrtSnapshot {
  return sicherLesen(schluessel(benutzerId));
}

/**
 * Nimmt das Merken von `eigen` zurück: schreibt den Stand davor unverändert zurück, samt seinem
 * Zeitpunkt (ein neuer verlängerte die Frist eines fast abgelaufenen Orts), und entfernt den
 * Eintrag, wenn davor keiner da war. Für den Rahmen, wenn eine Seite erst nach dem Laden meldet,
 * dass es ihr Objekt nicht (mehr) gibt (LLH-1827, `nichtGefundenContext.ts`): ihre Adresse hatte
 * er bei der Ankunft schon gemerkt.
 *
 * Nur, solange im Speicher noch genau `eigen` steht: hat ein anderer Tab inzwischen einen Ort
 * gemerkt, ist der neuer als der Stand davor und bleibt.
 */
export function restoreLetztenOrt(
  benutzerId: number,
  eigen: LetzterOrt,
  vorher: LetzterOrtSnapshot,
): void {
  const steht = parseLetztenOrt(sicherLesen(schluessel(benutzerId)));
  if (steht == null || steht.einsatzId !== eigen.einsatzId || steht.pfad !== eigen.pfad) return;
  if (vorher == null) sicherEntfernen(schluessel(benutzerId));
  else sicherSchreiben(schluessel(benutzerId), vorher);
}

/** Liest einen Speicherstand, ohne Frist und ohne Prüfung des Einsatzes. */
function parseLetztenOrt(roh: string | null): (LetzterOrt & { at: number }) | null {
  if (!roh) return null;
  try {
    const wert: unknown = JSON.parse(roh);
    if (typeof wert !== 'object' || wert === null) return null;
    const { einsatzId, pfad, at } = wert as Record<string, unknown>;
    if (typeof einsatzId !== 'number' || typeof pfad !== 'string' || typeof at !== 'number') {
      return null;
    }
    return { einsatzId, pfad, at };
  } catch {
    return null;
  }
}

/** Der gemerkte Ort, oder `null` (nichts gemerkt, abgelaufen, fremder Inhalt). */
export function leseLetztenOrt(benutzerId: number, jetzt = Date.now()): LetzterOrt | null {
  const wert = parseLetztenOrt(sicherLesen(schluessel(benutzerId)));
  if (wert == null || jetzt - wert.at > LETZTER_ORT_FRIST_MS) return null;
  const ort = { einsatzId: wert.einsatzId, pfad: wert.pfad };
  return gehoertZumEinsatz(ort) ? ort : null;
}
