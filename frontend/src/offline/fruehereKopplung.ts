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
  OFFLINE_QUEUE_EVENT,
  queueKontenUmbinden,
  queueKontenVerwerfen,
  queueKontenZaehlen,
} from './queue';

const SCHLUESSEL = 'lifeline-hub.geraet-konten';
/** Mehr Kopplungen hat ein Tablet in einem Einsatz kaum; ältere ohne Zeilen fallen ohnehin weg. */
const HOECHSTENS = 10;

export interface GeraetKonto {
  benutzer_id: number;
  einsatz_id: number;
  ansicht: string;
  stelle_id: number | null;
}

function istKonto(wert: unknown): wert is GeraetKonto {
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
export function geraetKontenLesen(): GeraetKonto[] {
  const roh = sicherLesen(SCHLUESSEL);
  if (!roh) return [];
  try {
    const wert: unknown = JSON.parse(roh);
    return Array.isArray(wert) ? wert.filter(istKonto) : [];
  } catch {
    return [];
  }
}

function schreiben(konten: GeraetKonto[]): void {
  // Gesperrter Speicher (privater Modus): keine Übernahme, die Zeilen bleiben wie vor LLH-1331.
  sicherSchreiben(SCHLUESSEL, JSON.stringify(konten.slice(0, HOECHSTENS)));
}

/** Gleicher Einsatz, gleiche Ansicht, gleiche Stelle (D3). */
function passt(a: GeraetKonto, b: GeraetKonto): boolean {
  return a.einsatz_id === b.einsatz_id && a.ansicht === b.ansicht && a.stelle_id === b.stelle_id;
}

function alsKonto(benutzerId: number, geraet: GeraetAnzeige): GeraetKonto {
  return {
    benutzer_id: benutzerId,
    einsatz_id: geraet.einsatz_id,
    ansicht: geraet.ansicht,
    stelle_id: geraet.stelle_id ?? null,
  };
}

/** Frühere Gerätekonten: alle gemerkten außer dem aktuellen (ohne Sitzung alle). */
function fruehere(aktuell: number | null): number[] {
  return geraetKontenLesen()
    .map((k) => k.benutzer_id)
    .filter((id) => id !== aktuell);
}

/**
 * Der Server hat eine Gerätesitzung bestätigt (`AuthProvider`, neben `merkeGeraet`): Konto
 * merken, passende frühere Konten übernehmen, Konten ohne Zeilen vergessen. Wirft nie.
 */
export async function geraetKontoBestaetigt(
  benutzerId: number,
  geraet: GeraetAnzeige,
): Promise<void> {
  try {
    const aktuell = alsKonto(benutzerId, geraet);
    const bisher = geraetKontenLesen().filter((k) => k.benutzer_id !== benutzerId);
    schreiben([aktuell, ...bisher]);
    const passende = bisher.filter((k) => passt(k, aktuell)).map((k) => k.benutzer_id);
    if (passende.length > 0) await queueKontenUmbinden(passende, benutzerId);
    // Vergessen nur, was keine Zeilen mehr hat; ein anderer Tab kann die Liste inzwischen
    // erweitert haben, deshalb frisch gelesen.
    const behalten: GeraetKonto[] = [];
    for (const k of geraetKontenLesen()) {
      if (k.benutzer_id === benutzerId || (await queueKontenZaehlen([k.benutzer_id])) > 0) {
        behalten.push(k);
      }
    }
    schreiben(behalten);
  } catch (e) {
    console.error('Frühere Kopplung: Übernahme fehlgeschlagen', e);
  }
}

/** Anzahl der Einträge früherer Gerätekonten (ausstehend und abgelehnt), ohne Payload. */
export function fruehereKopplungZaehlen(aktuell: number | null): Promise<number> {
  return queueKontenZaehlen(fruehere(aktuell));
}

/** Verwirft alle Einträge früherer Gerätekonten (nur nach Rückfrage, D3). */
export async function fruehereKopplungVerwerfen(aktuell: number): Promise<number> {
  const ids = fruehere(aktuell);
  const geloescht = await queueKontenVerwerfen(ids);
  schreiben(geraetKontenLesen().filter((k) => !ids.includes(k.benutzer_id)));
  return geloescht;
}

/**
 * Reaktive Anzahl für „Kopplung beendet“ und die Gerätehülle. `aktiv = false` (Person, kein
 * Gerät) liefert immer 0: eine Person sieht und verwirft keine Zeilen von Gerätekonten.
 */
export function useFruehereKopplungAnzahl(aktuell: number | null, aktiv: boolean): number {
  const [anzahl, setAnzahl] = useState(0);
  useEffect(() => {
    if (!aktiv) {
      setAnzahl(0);
      return;
    }
    let gueltig = true;
    const laden = () => {
      fruehereKopplungZaehlen(aktuell).then(
        (n) => {
          if (gueltig) setAnzahl(n);
        },
        () => undefined,
      );
    };
    laden();
    window.addEventListener(OFFLINE_QUEUE_EVENT, laden);
    return () => {
      gueltig = false;
      window.removeEventListener(OFFLINE_QUEUE_EVENT, laden);
    };
  }, [aktuell, aktiv]);
  return aktiv ? anzahl : 0;
}
