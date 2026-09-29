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
interface AbschlussVorbelegung {
  naechste: Dayjs | null;
  abgehalten: Dayjs;
  /**
   * Der Termin, den die Maske beim Öffnen GESEHEN hat, als Wire-Wert — `null`, wenn der Stand
   * keinen trug (`naechste_lagebesprechung_at` ist dann absent). Basis für „fremd geändert".
   */
  terminWire: string | null;
}

/**
 * Vorbelegung: der bestehende Termin, wenn er in der Zukunft liegt, sonst leer; der Zeitpunkt
 * ist jetzt. Ein vergangener Termin ist gerade die Besprechung, die abgeschlossen wird.
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
 * Bezug „ab wann liegt ein Termin in der Zukunft": der spätere von Zeitpunkt und jetzt. Ein
 * vorverlegter Zeitpunkt darf keinen vergangenen Termin als künftig ausgeben, ein nachträglich
 * erfasster keinen, der vor der Besprechung liegt.
 */
export function terminBezug(abgehalten: Dayjs | null | undefined, jetzt: Dayjs): Dayjs {
  const zeitpunkt = besprechungsZeitpunkt(abgehalten, jetzt);
  return zeitpunkt.isAfter(jetzt) ? zeitpunkt : jetzt;
}

/**
 * Clientseitiger Spiegel des 422 (`naechste_at ≤ abgehalten_at`). Ein leeres Feld ist immer
 * zulässig. Auf Sekunden verglichen wie die Wire-Werte am Server.
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
 * Formwerte → POST-Body. `naechste_at` ist dreiwertig: Schlüssel fehlt = Termin bleibt ·
 * `null` = löschen · Wert = setzen. Nie `''`: der löschte serverseitig still.
 *
 * Grundsatz: die Maske ändert oder löscht nur den Termin, den sie beim Öffnen gesehen hat.
 * `liveTerminWire` ist der Stand beim ABSENDEN. Die Regeln in dieser Reihenfolge:
 *
 * 1. **Bewusst gewählter Wert** (gesetzt und ≠ Vorbelegung) → der Wert; eine eigene Eingabe
 *    gewinnt, das 422 prüft der Server.
 * 2. **Fremd geändert** (live ≠ gesehen) → Schlüssel fehlt. Ein leeres oder unverändertes Feld
 *    überschreibt keinen fremd gesetzten oder gelöschten Termin. Steht VOR 3–5, sonst löschte
 *    ein überholter Vorbelegungswert den fremd gesetzten neuen.
 * 3. **Kein Termin beim Öffnen**, Feld leer → Schlüssel fehlt.
 * 4. **Vorbelegt und unverändert** → Schlüssel fehlt, solange der Termin noch nach
 *    {@link terminBezug} liegt; sonst `null` (ein überholter Termin wird gelöscht).
 * 5. **Sonst** `null`: vergangener Termin und Feld leer, oder bewusst geleert.
 *
 * `abgehalten_at` geht IMMER mit (leer = Zeitpunkt des Absendens), sonst ließe sich die Antwort
 * der eigenen Anfrage nicht zuordnen.
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
 * Die Route lädt die Antwort NACH dem Commit in einer zweiten Lesetransaktion; schließt
 * zeitgleich jemand anderes ab, trägt `letzte_lagebesprechung` dessen Zeile, und ein Deeplink
 * darauf zeigte einen fremden Beleg.
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
