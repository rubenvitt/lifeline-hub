import type { Dayjs } from 'dayjs';
import type { Lagebesprechung, LagebesprechungAbschlussBody, Stab } from '../api/types';
import { alsBackendZeit } from '../etb/filterZeit';
import { terminZeitpunkt } from './lagebesprechungZustand';

/** Werte der Maske „Lagebesprechung abschließen". */
export interface AbschlussFormWerte {
  entschluss: string;
  /** `null`/`undefined` = kein Termin. */
  naechste?: Dayjs | null;
  /** Zeitpunkt der Besprechung; leer = Zeitpunkt des Absendens. */
  abgehalten?: Dayjs | null;
}

/** Beim ÖFFNEN eingefroren — Vorbelegung der Felder und Vergleichsbasis für „unverändert". */
export interface AbschlussVorbelegung {
  naechste: Dayjs | null;
  abgehalten: Dayjs;
  /**
   * Der Termin, den die Maske beim Öffnen GESEHEN hat, als Wire-Wert — `null`, wenn der Stand
   * keinen trug (`naechste_lagebesprechung_at` ist dann absent, nicht `null`). Basis für
   * „fremd geändert" (Ruling 10).
   */
  terminWire: string | null;
}

/**
 * Vorbelegung (Nutzerentscheidung LFH-543): der bestehende Termin, wenn er in der Zukunft liegt,
 * sonst leer; der Zeitpunkt ist jetzt. Ein vergangener Termin wird nicht vorbelegt — er ist
 * gerade die Besprechung, die abgeschlossen wird.
 */
export function abschlussVorbelegung(
  terminWire: string | null | undefined,
  jetzt: Dayjs,
): AbschlussVorbelegung {
  const termin = terminZeitpunkt(terminWire);
  return {
    naechste: termin && termin.isAfter(jetzt) ? termin : null,
    abgehalten: jetzt,
    terminWire: terminWire ?? null,
  };
}

/** Der Zeitpunkt, der für die Besprechung gilt: der erfasste, leer = jetzt. */
function besprechungsZeitpunkt(abgehalten: Dayjs | null | undefined, jetzt: Dayjs): Dayjs {
  return abgehalten ?? jetzt;
}

/**
 * Bezug „ab wann liegt ein Termin in der Zukunft": der spätere von Zeitpunkt der Besprechung und
 * jetzt. Ein vorverlegter Zeitpunkt darf einen Termin nicht als künftig ausgeben, der schon
 * vorbei ist; ein nachträglich erfasster nicht einen, der vor der Besprechung liegt.
 */
export function terminBezug(abgehalten: Dayjs | null | undefined, jetzt: Dayjs): Dayjs {
  const zeitpunkt = besprechungsZeitpunkt(abgehalten, jetzt);
  return zeitpunkt.isAfter(jetzt) ? zeitpunkt : jetzt;
}

/**
 * Clientseitiger Spiegel des 422 (`naechste_at ≤ abgehalten_at`): ein gesetzter Termin muss nach
 * dem Zeitpunkt der Besprechung liegen (leer = jetzt). Ein leeres Feld ist immer zulässig. Auf
 * Sekunden verglichen wie die Wire-Werte, die der Server vergleicht.
 */
export function naechsteNachBesprechung(
  naechste: Dayjs | null | undefined,
  abgehalten: Dayjs | null | undefined,
  jetzt: Dayjs,
): boolean {
  if (naechste == null) return true;
  return naechste.isAfter(besprechungsZeitpunkt(abgehalten, jetzt), 'second');
}

/**
 * Formwerte → POST-Body. `naechste_at` ist dreiwertig (`api/types.ts`, `LagebesprechungAbschlussBody`):
 * Schlüssel fehlt = Termin bleibt · `null` = löschen · Wert = setzen. Nie `''`: der löschte
 * serverseitig still.
 *
 * Grundsatz (Ruling 10): die Maske ändert oder löscht nur den Termin, den sie beim Öffnen
 * gesehen hat. `liveTerminWire` ist der Stand beim ABSENDEN — `stab` wird live invalidiert.
 * Die Regeln in dieser Reihenfolge, jede genau einmal:
 *
 * 1. **Bewusst gewählter Wert** (gesetzt und ≠ Vorbelegung) → der Wert. Er steht VOR der Frage
 *    „fremd geändert", weil er deren einzige Ausnahme ist: eine eigene Eingabe gewinnt, das 422
 *    prüft der Server. Ab hier ist das Feld leer oder unverändert.
 * 2. **Fremd geändert** (live ≠ gesehen) → Schlüssel fehlt. Ein leeres oder unverändertes Feld
 *    überschreibt keinen Termin, den jemand anderes inzwischen gesetzt oder gelöscht hat —
 *    auch kein bewusst geleertes. Diese Regel steht VOR 3–5: sonst löschte ein überholter,
 *    unverändert vorbelegter Termin den fremd gesetzten neuen.
 * 3. **Kein Termin beim Öffnen**, Feld leer → Schlüssel fehlt (serverseitig gleichbedeutend mit
 *    `null`, trifft aber keinen inzwischen gesetzten Wert).
 * 4. **Vorbelegt und unverändert** → Schlüssel fehlt, solange der Termin noch nach
 *    {@link terminBezug} liegt; sonst `null` — ein überholter Termin wird gelöscht (Ruling 1).
 * 5. **Sonst** `null`: vergangener Termin beim Öffnen und Feld leer (Ruling 1), oder die
 *    Vorbelegung bewusst geleert bzw. „kein Termin" gewählt.
 *
 * `abgehalten_at` geht IMMER mit, leer als Zeitpunkt des Absendens. Nur dann lässt sich die
 * Antwort der eigenen Anfrage zuordnen (`eigeneLagebesprechung`).
 */
export function abschlussBody(
  werte: AbschlussFormWerte,
  vorbelegung: AbschlussVorbelegung,
  jetzt: Dayjs,
  liveTerminWire: string | null | undefined,
): LagebesprechungAbschlussBody {
  const body: LagebesprechungAbschlussBody = {
    entschluss: werte.entschluss.trim(),
    abgehalten_at: alsBackendZeit(besprechungsZeitpunkt(werte.abgehalten, jetzt)),
  };
  const gewaehlt = werte.naechste == null ? null : alsBackendZeit(werte.naechste);
  const vorbelegt = vorbelegung.naechste == null ? null : alsBackendZeit(vorbelegung.naechste);

  // 1. Bewusst gewählter Wert.
  if (gewaehlt != null && gewaehlt !== vorbelegt) return { ...body, naechste_at: gewaehlt };
  // 2. Fremd geändert.
  if ((liveTerminWire ?? null) !== vorbelegung.terminWire) return body;
  // 3. Kein Termin beim Öffnen (das Feld ist dann zwingend leer).
  if (vorbelegung.terminWire == null) return body;
  // 4. Vorbelegt und unverändert, noch künftig.
  if (
    gewaehlt != null &&
    vorbelegung.naechste!.isAfter(terminBezug(werte.abgehalten, jetzt), 'second')
  ) {
    return body;
  }
  // 5. Sonst löschen.
  return { ...body, naechste_at: null };
}

/**
 * Die eigene Zeile aus der POST-Antwort — oder `undefined`.
 *
 * Die Route lädt die Antwort NACH dem Commit in einer zweiten Lesetransaktion
 * (`src/routes/stab.rs:248-264`). Schließt zeitgleich jemand anderes ab, trägt
 * `letzte_lagebesprechung` dessen Zeile; ein Deeplink darauf zeigte einen fremden Beleg.
 */
export function eigeneLagebesprechung(
  antwort: Stab,
  gesendet: LagebesprechungAbschlussBody,
): Lagebesprechung | undefined {
  const letzte = antwort.letzte_lagebesprechung;
  if (!letzte) return undefined;
  const passt =
    letzte.entschluss.trim() === gesendet.entschluss &&
    letzte.abgehalten_at === gesendet.abgehalten_at;
  return passt ? letzte : undefined;
}

/** Einzeilig und auf `max` Zeichen gekürzt (Zeile „Letzte"). */
export function kuerzeEntschluss(text: string, max = 80): string {
  const eineZeile = text.replace(/\s+/g, ' ').trim();
  return eineZeile.length > max ? `${eineZeile.slice(0, max - 1)}…` : eineZeile;
}
