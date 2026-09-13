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
  return { naechste: termin && termin.isAfter(jetzt) ? termin : null, abgehalten: jetzt };
}

/**
 * Formwerte → POST-Body. `naechste_at` ist dreiwertig (`api/types.ts`, `LagebesprechungAbschlussBody`):
 *
 * - vorbelegter Termin UNVERÄNDERT → Schlüssel fehlt (der Server lässt ihn stehen);
 * - leeres Feld → `null` (löschen), auch ohne Vorbelegung — Ruling 1, LFH-543-Ledger;
 * - sonst der gewählte Wert. Nie `''`: der löschte serverseitig still.
 *
 * `abgehalten_at` geht IMMER mit, leer als Zeitpunkt des Absendens. Nur dann lässt sich die
 * Antwort der eigenen Anfrage zuordnen (`eigeneLagebesprechung`).
 */
export function abschlussBody(
  werte: AbschlussFormWerte,
  vorbelegung: AbschlussVorbelegung,
  jetzt: Dayjs,
): LagebesprechungAbschlussBody {
  const body: LagebesprechungAbschlussBody = {
    entschluss: werte.entschluss.trim(),
    abgehalten_at: alsBackendZeit(werte.abgehalten ?? jetzt),
  };
  if (werte.naechste == null) return { ...body, naechste_at: null };
  const gewaehlt = alsBackendZeit(werte.naechste);
  if (vorbelegung.naechste != null && gewaehlt === alsBackendZeit(vorbelegung.naechste)) {
    return body;
  }
  return { ...body, naechste_at: gewaehlt };
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
