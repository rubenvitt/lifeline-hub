import { useSyncExternalStore } from 'react';
import type { BenachrichtigungArt } from '../api/types';
import { sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';
import { ALLE_ARTEN, BENACHRICHTIGUNG_ARTEN } from './benachrichtigungKatalog';

/**
 * „Stumm auf diesem Gerät“ (LLH-1421, Entwurf `/mnt/project-files/llh-1421/design.md` D6; Spec
 * `benachrichtigungen`, „Stumm auf diesem Gerät“): Eingangsarten, die auf diesem Gerät keinen
 * Ton, keinen Eintrag im Eingangsband und keine OS-Meldung auslösen (`useEingangshinweis.tsx`).
 * Zahl am Knopf „Eingänge“, Tab-Titel, App-Badge und Verlauf bleiben: der Eingang ist nicht
 * gelesen, nur leise.
 *
 * Eine Geräte-Einstellung ohne Personenbezug im Browserspeicher (`GERAETESPEICHER`, bleibt bei
 * jedem Ausgang wie der Alarmton). Alarme sind nie stumm schaltbar.
 */

const SCHLUESSEL = 'lfh:eingaenge:stumm';

/** Die Eingangsarten des Einsatzes: Stufe Eingang, keine Org-Art, nicht Unwetter (ein Toast). */
export const EINGANG_ARTEN: readonly BenachrichtigungArt[] = ALLE_ARTEN.filter(
  (a) =>
    BENACHRICHTIGUNG_ARTEN[a].stufe === 'hinweis' &&
    !BENACHRICHTIGUNG_ARTEN[a].org &&
    a !== 'unwetter',
);

const KEINE: readonly BenachrichtigungArt[] = [];

/** Gelesener Stand; `null` = noch nicht gelesen. Ohne Speicher gilt er bis zum Neuladen. */
let stand: readonly BenachrichtigungArt[] | null = null;
const hoerer = new Set<() => void>();

/** Der gespeicherte Wert als Liste; Unlesbares, Alarme und Fremdes fallen weg. */
function parse(wert: string | null): readonly BenachrichtigungArt[] {
  if (!wert) return KEINE;
  let liste: unknown;
  try {
    liste = JSON.parse(wert);
  } catch {
    return KEINE;
  }
  if (!Array.isArray(liste)) return KEINE;
  return EINGANG_ARTEN.filter((a) => liste.includes(a));
}

/** Die stummen Arten dieses Geräts, in Katalogreihenfolge. */
export function stummeArten(): readonly BenachrichtigungArt[] {
  stand ??= parse(sicherLesen(SCHLUESSEL));
  return stand;
}

/** Ob `art` auf diesem Gerät stumm ist. Ein Alarm nie. */
export function istStumm(art: BenachrichtigungArt): boolean {
  return stummeArten().includes(art);
}

/** Schaltet `art` auf diesem Gerät stumm oder laut; erst der Zustand, dann der Speicher. */
export function setzeStumm(art: BenachrichtigungArt, stumm: boolean): void {
  if (!EINGANG_ARTEN.includes(art)) return;
  const vorher = stummeArten();
  const neu = EINGANG_ARTEN.filter((a) => (a === art ? stumm : vorher.includes(a)));
  stand = neu;
  sicherSchreiben(SCHLUESSEL, JSON.stringify(neu));
  for (const h of hoerer) h();
}

/** Nur für Tests: den gelesenen Stand vergessen. */
export function vergesseStummStand(): void {
  stand = null;
}

function abonnieren(beiAenderung: () => void): () => void {
  hoerer.add(beiAenderung);
  // Ein anderer Tab desselben Geräts hat umgeschaltet.
  const beiSpeicher = (ev: StorageEvent) => {
    if (ev.key !== SCHLUESSEL) return;
    stand = parse(ev.newValue);
    beiAenderung();
  };
  window.addEventListener('storage', beiSpeicher);
  return () => {
    hoerer.delete(beiAenderung);
    window.removeEventListener('storage', beiSpeicher);
  };
}

/** Die stummen Arten dieses Geräts, für die Schalter im Verlauf. */
export function useStummeArten(): readonly BenachrichtigungArt[] {
  return useSyncExternalStore(abonnieren, stummeArten, stummeArten);
}
