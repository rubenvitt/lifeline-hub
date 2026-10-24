import type { Dayjs } from 'dayjs';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { uhrzeit } from '../anzeige/zeitDarstellung';
import type { LageberichtAbschnitt, LageberichtKopf, LageberichtVorlageKey } from '../api/types';
import { VORLAGEN, type AbschnittDef } from './vorlagen';

/**
 * Ableitungen der Lageberichte-Übersicht (LLH-1064): was gilt, was in Arbeit ist, was früher galt.
 * Rein und ohne Abruf; die Seite (`pages/LageberichtePage.tsx`) und die Paneele
 * (`lageberichte/LageberichtUebersicht.tsx`) lesen nur von hier.
 */

/** Zeitstand absteigend, bei Gleichstand die höhere Kennung zuerst (wie die Serverordnung). */
function juengsterZuerst(a: LageberichtKopf, b: LageberichtKopf): number {
  if (a.zeitstand !== b.zeitstand) return a.zeitstand < b.zeitstand ? 1 : -1;
  return b.id - a.id;
}

export interface Uebersicht {
  /** Die jüngste Freigabe nach Zeitstand: der Stand, der gilt. `null` ohne Freigabe. */
  aktuell: LageberichtKopf | null;
  /** Alle Entwürfe, jüngster Zeitstand zuerst. */
  inArbeit: LageberichtKopf[];
  /** Alle übrigen Freigaben, jüngster Zeitstand zuerst. */
  verlauf: LageberichtKopf[];
}

/**
 * Teilt die Liste in aktuell · in Arbeit · Verlauf. Jeder Bericht steht genau einmal; anders als
 * die Kettensicht (`ketten.ts`) liest die Übersicht keine Vorgänger, ein Zyklus kann also nichts
 * verschlucken. Der aktuelle Stand ist der Zeitstand, nicht die letzte Anlage: eine spät
 * freigegebene ältere Lage verdrängt keine jüngere.
 */
export function teileUebersicht(berichte: readonly LageberichtKopf[]): Uebersicht {
  const freigegeben = berichte.filter((b) => b.status === 'freigegeben').sort(juengsterZuerst);
  return {
    aktuell: freigegeben[0] ?? null,
    inArbeit: berichte.filter((b) => b.status !== 'freigegeben').sort(juengsterZuerst),
    verlauf: freigegeben.slice(1),
  };
}

/**
 * Wurde der Bericht schon fortgeschrieben? Dann steht die Fortschreibung als Entwurf oder Freigabe
 * daneben, und ein zweites Fortschreiben spaltete die Kette.
 */
export function hatNachfolger(berichte: readonly LageberichtKopf[], id: number): boolean {
  return berichte.some((b) => b.vorgaenger_id === id);
}

function vorlageDef(schluessel: LageberichtVorlageKey | string) {
  return VORLAGEN.find((v) => v.schluessel === schluessel);
}

/**
 * Wie viele Abschnitte der Vorlage Text tragen („5/8“). Leerraum zählt nicht (wie
 * `befuellteAbschnitte`), ein Schlüssel außerhalb der Vorlage auch nicht. `null` bei unbekannter
 * Vorlage: dann gibt es keine Gesamtzahl, und eine erfundene stünde falsch da.
 */
export function abschnittsFuellstand(
  vorlage: LageberichtVorlageKey | string,
  abschnitte: readonly LageberichtAbschnitt[],
): { gefuellt: number; gesamt: number } | null {
  const v = vorlageDef(vorlage);
  if (!v) return null;
  const text = new Map(abschnitte.map((a) => [a.schluessel, a.text]));
  const gefuellt = v.abschnitte.filter((a) => (text.get(a.schluessel) ?? '').trim() !== '').length;
  return { gefuellt, gesamt: v.abschnitte.length };
}

/** Je Vorlage der Abschnitt, der die Lage zusammenfasst und im Paneel „Aktuell“ anliest. */
const KERN: Record<LageberichtVorlageKey, string> = {
  lagebericht: 'zusammenfassung',
  lagebeurteilung: 'vorschlag_beste',
  freitext: 'text',
};

export function kernAbschnitt(vorlage: LageberichtVorlageKey | string): AbschnittDef | undefined {
  const v = vorlageDef(vorlage);
  return v?.abschnitte.find((a) => a.schluessel === KERN[v.schluessel]);
}

/**
 * Die ersten `zeilen` Zeilen mit Text, Leerzeilen dazwischen bleiben (Absätze im Markdown).
 * Gekürzt wird an der Zeile, nie mitten im Wort. `null` für einen leeren Text.
 */
export function textAuszug(text: string, zeilen = 3): { text: string; gekuerzt: boolean } | null {
  const alle = text.replace(/\s+$/, '').split('\n');
  let gezaehlt = 0;
  let ende = 0;
  for (; ende < alle.length && gezaehlt < zeilen; ende += 1) {
    if (alle[ende].trim() !== '') gezaehlt += 1;
  }
  if (gezaehlt === 0) return null;
  return {
    text: alle.slice(0, ende).join('\n'),
    gekuerzt: alle.slice(ende).some((z) => z.trim() !== ''),
  };
}

const TITEL: Record<LageberichtVorlageKey, string> = {
  lagebericht: 'Lageüberblick',
  lagebeurteilung: 'Lagebeurteilung',
  freitext: 'Bericht',
};

/**
 * Titelvorschlag aus der Uhrzeit („Lageüberblick 1410“ bzw. „Lageüberblick 14:10“), in der
 * Anzeigezone, nicht in der des Browsers (LFH-692, Spec `zeiteingabe`), und in der wirksamen
 * Zeitdarstellung (Rolle `uhrzeit`, LLH-1437): der Tag steht im Zeitstand daneben. Wie die
 * Platzhalter eines ETB-Bausteins (`etb/BausteinPlatzhalterModal.tsx`, LLH-1061) ist er ein Text,
 * den die Oberfläche vorschlägt und der Mensch vor dem Speichern sieht und ändern kann; deshalb
 * nimmt er dieselbe Darstellung wie die Anzeige, die Gerätewahl eingeschlossen. Geändert wird er
 * im Entwurf. Auch die Anlage aus der Lagekarte nimmt ihn (`LageplanAnlageDialog`).
 */
export function titelVorschlag(
  vorlage: LageberichtVorlageKey,
  jetzt: Dayjs,
  konv: AnzeigeKonventionen,
): string {
  return `${TITEL[vorlage]} ${uhrzeit(jetzt, konv)}`;
}
