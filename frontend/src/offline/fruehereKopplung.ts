/**
 * Vorgemerktes eines beendeten Geräts (LLH-1331, Change `e8n4y8en-vorgemerktes-nach-kopplungsende`,
 * Spec `feldgeraet-bedienung`, „Vorgemerktes überdauert das Ende der Kopplung“).
 *
 * Jede Kopplung legt ein eigenes Gerätekonto an, die Warteschlange ist an die `benutzer_id`
 * gebunden. Damit vorgemerkte Einträge das Ende einer Kopplung überdauern, merkt sich der Browser
 * die Kennungen seiner Gerätekonten (D2). Eine neue Gerätesitzung im selben Einsatz mit derselben
 * Ansicht und Stelle übernimmt deren Zeilen (D3); alles andere bleibt sichtbar und lässt sich nur
 * nach Rückfrage verwerfen. Zeilen von Personen stehen nie in dieser Liste.
 */
import { useEffect, useState } from 'react';
import type { GeraetAnzeige } from '../api/types';
import { sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';
import {
  beobachteQueueAenderungen,
  rebindQueueKonten,
  deleteQueueKonten,
  countQueueKonten,
} from './queue';

/** Ohne Obergrenze und ohne Aufräumen: ein vergessenes Konto ließe Zeilen unsichtbar zurück, die
 *  ein anderer Tab noch nach dem Zählen einreiht. Ein Eintrag sind wenige Byte je Kopplung. */
const SCHLUESSEL = 'lifeline-hub.geraet-konten';

export interface GeraetKonto {
  benutzer_id: number;
  einsatz_id: number;
  ansicht: string;
  stelle_id: number | null;
}

function isKonto(wert: unknown): wert is GeraetKonto {
  if (typeof wert !== 'object' || wert === null) return false;
  const k = wert as Record<string, unknown>;
  return (
    typeof k.benutzer_id === 'number' &&
    typeof k.einsatz_id === 'number' &&
    typeof k.ansicht === 'string' &&
    (k.stelle_id === null || typeof k.stelle_id === 'number')
  );
}

/** Die gemerkten Gerätekonten, neueste zuerst. Ein unlesbarer Stand gilt als leer. */
export function loadGeraetKonten(): GeraetKonto[] {
  const roh = sicherLesen(SCHLUESSEL);
  if (!roh) return [];
  try {
    const wert: unknown = JSON.parse(roh);
    return Array.isArray(wert) ? wert.filter(isKonto) : [];
  } catch {
    return [];
  }
}

function save(konten: GeraetKonto[]): void {
  // Gesperrter Speicher (privater Modus): keine Übernahme, die Zeilen bleiben wie vor LLH-1331.
  sicherSchreiben(SCHLUESSEL, JSON.stringify(konten));
}

/** Gleicher Einsatz, gleiche Ansicht, gleiche Stelle (D3). */
function matches(a: GeraetKonto, b: GeraetKonto): boolean {
  return a.einsatz_id === b.einsatz_id && a.ansicht === b.ansicht && a.stelle_id === b.stelle_id;
}

function toKonto(benutzerId: number, geraet: GeraetAnzeige): GeraetKonto {
  return {
    benutzer_id: benutzerId,
    einsatz_id: geraet.einsatz_id,
    ansicht: geraet.ansicht,
    stelle_id: geraet.stelle_id ?? null,
  };
}

/** Frühere Gerätekonten: alle gemerkten außer dem aktuellen (ohne Sitzung alle). */
function fruehereIds(aktuell: number | null): number[] {
  return loadGeraetKonten()
    .map((k) => k.benutzer_id)
    .filter((id) => id !== aktuell);
}

/**
 * Übernimmt die Zeilen aller früheren Konten, die zum aktuellen passen (D3). Ohne gemerktes
 * aktuelles Konto nichts. Auch für Nachzügler: Ein Tab der beendeten Kopplung kann nach der
 * Bestätigung noch einreihen.
 */
export async function adoptFruehereKopplung(aktuell: number): Promise<number> {
  const passende = passendeIds(aktuell);
  return passende.length > 0 ? rebindQueueKonten(passende, aktuell) : 0;
}

/** Frühere Konten mit gleichem Einsatz, gleicher Ansicht und gleicher Stelle wie das aktuelle. */
function passendeIds(aktuell: number): number[] {
  const konten = loadGeraetKonten();
  const eigenes = konten.find((k) => k.benutzer_id === aktuell);
  if (!eigenes) return [];
  return konten
    .filter((k) => k.benutzer_id !== aktuell && matches(k, eigenes))
    .map((k) => k.benutzer_id);
}

/**
 * Der Server hat eine Gerätesitzung bestätigt (`AuthProvider`, neben `merkeGeraet`): Konto
 * merken und passende frühere Konten übernehmen. Kein Konto wird vergessen: Ein Tab der beendeten
 * Kopplung kann noch einreihen, seine Zeilen bleiben so sichtbar und werden übernommen
 * ({@link useFruehereKopplungCount}). Wirft nie.
 */
export async function confirmGeraetKonto(benutzerId: number, geraet: GeraetAnzeige): Promise<void> {
  try {
    const bisher = loadGeraetKonten().filter((k) => k.benutzer_id !== benutzerId);
    save([toKonto(benutzerId, geraet), ...bisher]);
    await adoptFruehereKopplung(benutzerId);
  } catch (e) {
    console.error('Frühere Kopplung: Übernahme fehlgeschlagen', e);
  }
}

/** Anzahl der Einträge früherer Gerätekonten (ausstehend und abgelehnt), ohne Payload. */
export function countFruehereKopplung(aktuell: number | null): Promise<number> {
  return countQueueKonten(fruehereIds(aktuell));
}

/** Verwirft die Einträge nicht passender früherer Gerätekonten (nur nach Rückfrage, D3).
 *  Passende übernimmt es und löscht sie nie, auch keinen Nachzügler zwischen beiden Schritten.
 *  Die Konten bleiben gemerkt, siehe {@link confirmGeraetKonto}. */
export async function discardFruehereKopplung(aktuell: number): Promise<number> {
  await adoptFruehereKopplung(aktuell);
  const passende = passendeIds(aktuell);
  return deleteQueueKonten(fruehereIds(aktuell).filter((id) => !passende.includes(id)));
}

/**
 * Reaktive Anzahl für „Kopplung beendet“ und die Gerätehülle. `aktiv = false` (Person, kein
 * Gerät) liefert immer 0: eine Person sieht und verwirft keine Zeilen von Gerätekonten. Mit
 * aktueller Gerätesitzung übernimmt jeder Lauf zuerst passende Nachzügler, auch aus anderen Tabs.
 */
export function useFruehereKopplungCount(aktuell: number | null, aktiv: boolean): number {
  const [anzahl, setAnzahl] = useState(0);
  useEffect(() => {
    if (!aktiv) {
      setAnzahl(0);
      return;
    }
    let gueltig = true;
    const laden = () => {
      // Eine Übernahme meldet die Änderung selbst und löst einen zweiten, dann leeren Lauf aus.
      const vorher = aktuell === null ? Promise.resolve(0) : adoptFruehereKopplung(aktuell);
      vorher
        .then(() => countFruehereKopplung(aktuell))
        .then(
          (n) => {
            if (gueltig) setAnzahl(n);
          },
          () => undefined,
        );
    };
    laden();
    const beenden = beobachteQueueAenderungen(laden);
    return () => {
      gueltig = false;
      beenden();
    };
  }, [aktuell, aktiv]);
  return aktiv ? anzahl : 0;
}
