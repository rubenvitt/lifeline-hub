import type { VerbleibEingabe } from '../api/einsatzPerson';
import type { Betreuungsstelle, VerbleibArt } from '../api/types';

/**
 * Reiner Kern des Verbleib-Dialogs (`VerbleibErfassung.tsx`, LFH-674 design.md D6), ohne
 * Rendern prüfbar. Der Dialog zeigt Felder je Art, damit das Feldbudget (Modal ≤ ~3 sichtbar)
 * hält: Transportmittel nur beim Transport, die Betreuungsstelle nur bei der Notunterkunft
 * und nur mit Lesezugriff auf das Modul Betreuung.
 *
 * Das Suffix `Kern` ist Pflicht: `verbleibErfassung.ts` kollidierte case-insensitiv mit der
 * Komponente, und der Import `./VerbleibErfassung` traf still diese Datei (gemessen: „Element
 * type is invalid", CLAUDE.md zu LFH-347).
 */

export interface VerbleibFormWerte {
  art?: VerbleibArt;
  ziel?: string;
  transportmittel?: string;
  notiz?: string;
  betreuungsstelle_id?: number | null;
}

export const VERBLEIB_ART_OPTIONEN: { value: VerbleibArt; label: string }[] = [
  { value: 'transport', label: 'Transport' },
  { value: 'notunterkunft', label: 'Notunterkunft' },
  { value: 'entlassung', label: 'Entlassung vor Ort' },
  { value: 'vor_ort', label: 'verbleibt vor Ort' },
  { value: 'verstorben', label: 'Verbleib des Leichnams' },
];

export function sichtbareVerbleibFelder(
  art: VerbleibArt | undefined,
  betreuungFrei: boolean,
): { ziel: boolean; transportmittel: boolean; stelle: boolean } {
  return {
    ziel: true,
    transportmittel: art === 'transport',
    stelle: art === 'notunterkunft' && betreuungFrei,
  };
}

/**
 * Auswahl der Stellen: stornierte fallen weg (der Server lehnt sie mit 409 ab), geschlossene
 * bleiben WÄHLBAR und tragen den Zusatz im Label — ein Verbleib wird oft nachgetragen, und die
 * Person kann dort gewesen sein, bevor die Stelle schloss (Entscheidung 24.09.2026).
 */
export function stellenOptionen(stellen: Betreuungsstelle[]): { value: number; label: string }[] {
  return stellen
    .filter((s) => !s.storniert_at)
    .map((s) => ({
      value: s.id,
      label: s.status === 'geschlossen' ? `${s.bezeichnung} · geschlossen` : s.bezeichnung,
    }));
}

/**
 * Ziel nach einer Stellenwahl. Der Name der Stelle wird VORBELEGT, sichtbar und änderbar
 * (Entscheidung 24.09.2026) — der Server kopiert keinen Namen. Überschrieben wird nur ein
 * leeres Ziel oder eine noch unveränderte Vorbelegung der zuvor gewählten Stelle; eigener Text
 * der Person bleibt stehen.
 */
export function zielNachStellenwahl(a: {
  ziel: string | undefined;
  vorher: Betreuungsstelle | undefined;
  neu: Betreuungsstelle | undefined;
}): string | undefined {
  const leer = !a.ziel || a.ziel.trim() === '';
  const unveraendert = a.vorher != null && a.ziel === a.vorher.bezeichnung;
  if (leer || unveraendert) return a.neu?.bezeichnung;
  return a.ziel;
}

/**
 * Ziel nach einem Artwechsel. Wer von der Notunterkunft mit gewählter Stelle auf eine andere
 * Art wechselt, hätte sonst den Stellennamen als Transportziel im Feld — sichtbar, aber eine
 * Einladung zum Fehler (Review LFH-674). Geleert wird nur die UNVERÄNDERTE Vorbelegung.
 */
export function zielNachArtwechsel(a: {
  art: VerbleibArt | undefined;
  ziel: string | undefined;
  gewaehlt: Betreuungsstelle | undefined;
}): string | undefined {
  if (a.art === 'notunterkunft' || !a.gewaehlt) return a.ziel;
  return a.ziel === a.gewaehlt.bezeichnung ? undefined : a.ziel;
}

/**
 * Request-Body. Felder, die nicht sichtbar sind, gehen nicht mit: ein nach dem Artwechsel
 * liegengebliebener Stellen-Verweis wäre ein 422, einer nach verlorenem Betreuungszugriff ein
 * 403 — beides Ablehnungen, die die Person im Dialog nicht beheben kann. antd hält den Wert
 * eines ausgeblendeten Feldes im Speicher (`preserve`), deshalb entscheidet `stelleSichtbar`,
 * nicht das Vorhandensein des Werts.
 */
export function verbleibBody(
  w: VerbleibFormWerte & { art: VerbleibArt },
  stelleSichtbar: boolean,
): VerbleibEingabe {
  const body: VerbleibEingabe = {
    art: w.art,
    ziel: w.ziel ?? null,
    transportmittel: w.art === 'transport' ? (w.transportmittel ?? null) : null,
    status: w.art === 'transport' ? 'abtransportiert' : null,
    notiz: w.notiz ?? null,
  };
  if (stelleSichtbar && w.art === 'notunterkunft' && w.betreuungsstelle_id != null) {
    body.betreuungsstelle_id = w.betreuungsstelle_id;
  }
  return body;
}
