/**
 * „Zuletzt verwendet“ des Vorschlagsfelds `components/StammdatenFeld.tsx` am Gerät (LLH-1144,
 * design.md D5; Spec `stammdaten-feld`). Ein eigenes Modul, weil `offline/geraetRaeumung.ts` es
 * räumt und keine Abfragen oder Sitzung mitziehen soll.
 *
 * Gespeichert ist nur Text, den die Person übernommen hat (Chip übernommen, Meldung erfasst), je
 * Kontext höchstens {@link ZULETZT_MAX}, neueste vorn. Freitext kann einen Personennamen tragen;
 * deshalb räumt jeder Ausgang (`GERAETESPEICHER`, `jeder-ausgang`). Ohne Speicher bleibt die
 * Gruppe leer.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { Vorschlagsquelle } from '../components/stammdatenFeldKern';
import {
  sicherEntfernen,
  sicherLesen,
  sicherSchluessel,
  sicherSchreiben,
} from '../lib/sichererSpeicher';

/** Kontext für Funkrufnamen und Gegenstellen (ETB Von/An, Meldung Absender/Empfänger). */
export const KONTEXT_FUNKRUFNAME = 'funkrufname';

const ZULETZT_PRAEFIX = 'lfh:stammdatenfeld:zuletzt:';
export const ZULETZT_MAX = 8;

function zuletztSchluessel(kontext: string): string {
  return `${ZULETZT_PRAEFIX}${kontext}`;
}

/** Die gemerkten Werte, neueste vorn; leer bei fremdem Wert oder gesperrtem Speicher. */
export function ladeZuletzt(kontext: string): string[] {
  const roh = sicherLesen(zuletztSchluessel(kontext));
  if (!roh) return [];
  try {
    const werte: unknown = JSON.parse(roh);
    return Array.isArray(werte)
      ? werte.filter((w): w is string => typeof w === 'string').slice(0, ZULETZT_MAX)
      : [];
  } catch {
    return [];
  }
}

const zuhoerer = new Set<() => void>();

/**
 * Merkt übernommene Werte (Chip übernommen, Meldung erfasst), neueste vorn, ohne Doppel (ohne
 * Groß-/Kleinschreibung), höchstens {@link ZULETZT_MAX}. Wirft nie; ohne Speicher wirkt es nicht.
 */
export function merkeZuletzt(kontext: string, ...texte: readonly (string | undefined)[]): void {
  let liste = ladeZuletzt(kontext);
  for (const roh of texte) {
    const text = roh?.trim();
    if (!text) continue;
    const k = text.toLocaleLowerCase('de');
    liste = [text, ...liste.filter((w) => w.toLocaleLowerCase('de') !== k)];
  }
  sicherSchreiben(zuletztSchluessel(kontext), JSON.stringify(liste.slice(0, ZULETZT_MAX)));
  for (const z of zuhoerer) z();
}

/** Abmelden und Sitzungsende (`offline/geraetRaeumung.ts`): alle Kontexte. */
export function zuletztRaeumen(): void {
  for (const k of sicherSchluessel()) {
    if (k.startsWith(ZULETZT_PRAEFIX)) sicherEntfernen(k);
  }
  for (const z of zuhoerer) z();
}

function abonniere(z: () => void): () => void {
  zuhoerer.add(z);
  return () => zuhoerer.delete(z);
}

export function useZuletztQuelle(kontext: string): Vorschlagsquelle {
  // Der Rohtext ist der stabile Schnappschuss; geparst wird erst im Memo.
  const roh = useSyncExternalStore(abonniere, () => sicherLesen(zuletztSchluessel(kontext)));
  return useMemo(() => {
    void roh;
    return {
      id: 'zuletztVerwendet',
      gruppe: 'zuletzt',
      eintraege: ladeZuletzt(kontext).map((w) => ({ label: w, wert: w })),
    };
  }, [roh, kontext]);
}
