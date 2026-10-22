import type { Dayjs } from 'dayjs';
import type {
  Nachforderung,
  NachforderungPrioritaet,
  NachforderungZusageEingabe,
  PatchNachforderung,
} from '../api/types';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { zielAusText, type ZielAbschnitt, type ZielRaum } from './zielVorschlaege';

/**
 * Zusage und Bearbeiten an der Karte (LLH-1097 D1–D3, D9, D11) — rein: die Bodies aus den
 * Formularwerten und die Zeilen, die eine Karte über die Zusage zeigt.
 */

/** „Wer“ bereinigt: getrimmt, ohne Leere, ohne Doppelte, in Eingabefolge (wie der Server). */
export function bereinigeWer(wer: readonly string[] | null | undefined): string[] {
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];
  for (const roh of wer ?? []) {
    const w = roh.trim();
    if (!w || gesehen.has(w)) continue;
    gesehen.add(w);
    ergebnis.push(w);
  }
  return ergebnis;
}

/** Werte des Zusage-Formulars. */
export interface ZusageWerte {
  anzahl: number | null;
  wer: string[];
  eintreffen: Dayjs | null;
}

/** Startwerte: die angeforderte Menge als Vorgabe (D1), sonst leer. */
export function zusageStart(n: Pick<Nachforderung, 'anzahl'>): ZusageWerte {
  return { anzahl: n.anzahl ?? null, wer: [], eintreffen: null };
}

/** Body von `POST …/zusage`: nur Gesetztes; eine kleinere Menge teilt der Server (D1). */
export function zusageBody(w: ZusageWerte): NachforderungZusageEingabe {
  const rufnamen = bereinigeWer(w.wer);
  return {
    ...(w.anzahl != null ? { anzahl: w.anzahl } : {}),
    ...(rufnamen.length > 0 ? { rufnamen } : {}),
    ...(w.eintreffen ? { eintreffen_erwartet_at: alsBackendZeit(w.eintreffen) } : {}),
  };
}

/** Wer und Eintreffen gehören zu einer laufenden Zusage (D9). */
export function hatZusage(n: Pick<Nachforderung, 'status'>): boolean {
  return n.status === 'zugesagt' || n.status === 'unterwegs';
}

/** Werte des Bearbeiten-Formulars. */
export interface AenderungWerte {
  anzahl: number | null;
  /** Ziel als Name, wie „Wohin“ beim Anlegen. */
  wohin: string;
  prioritaet: NachforderungPrioritaet;
  bezeichnung: string;
  wer: string[];
  eintreffen: Dayjs | null;
}

/** Startwerte des Bearbeitens; `wohin` ist der gezeigte Name des Ziels (ohne Pfeil). */
export function aenderungStart(n: Nachforderung, wohin: string, eintreffen: Dayjs | null) {
  return {
    anzahl: n.anzahl ?? null,
    wohin,
    prioritaet: n.prioritaet,
    bezeichnung: n.bezeichnung ?? '',
    wer: [...n.zusage_rufnamen],
    eintreffen,
  } satisfies AenderungWerte;
}

function gleich(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Body von `PATCH …/{nid}`: nur, was sich gegenüber der Karte geändert hat (D9). Ein geändertes
 * Ziel geht als genau ein Zielfeld; leer gemacht als `ziel_text: null` — ein Zielfeld im Body
 * ersetzt das ganze Ziel. Unverändertes „Wohin“ (auch ein Name, den die Seite nicht kennt) bleibt
 * draußen. Leer = keine Änderung (`{}`).
 */
export function aenderungBody(
  n: Nachforderung,
  start: Pick<AenderungWerte, 'wohin'>,
  w: AenderungWerte,
  raeume: readonly ZielRaum[],
  abschnitte: readonly ZielAbschnitt[],
): PatchNachforderung {
  const body: PatchNachforderung = {};
  if (w.anzahl != null && w.anzahl !== n.anzahl) body.anzahl = w.anzahl;
  if (w.prioritaet !== n.prioritaet) body.prioritaet = w.prioritaet;
  const details = w.bezeichnung.trim() || null;
  if (details !== (n.bezeichnung ?? null)) body.bezeichnung = details;
  const wohin = w.wohin.trim();
  if (wohin !== start.wohin.trim()) {
    const ziel = zielAusText(wohin, raeume, abschnitte);
    Object.assign(body, Object.keys(ziel).length > 0 ? ziel : { ziel_text: null });
  }
  if (hatZusage(n)) {
    const wer = bereinigeWer(w.wer);
    if (!gleich(wer, n.zusage_rufnamen)) body.rufnamen = wer;
    const eintreffen = w.eintreffen ? alsBackendZeit(w.eintreffen) : null;
    if (eintreffen !== (n.eintreffen_erwartet_at ?? null)) body.eintreffen_erwartet_at = eintreffen;
  }
  return body;
}

/**
 * Was die Karte über die Zusage sagt (D11): „Wer: 83-1, 83-2“, bei einer Teilung „1 von 2
 * zugesagt“ (solange weniger zugesagt als angefordert war) bzw. „Rest einer Teilzusage“.
 */
export function zusageZeilen(
  n: Pick<Nachforderung, 'zusage_rufnamen' | 'anzahl' | 'anzahl_angefordert' | 'teilung_aus_id'>,
): string[] {
  const zeilen: string[] = [];
  if (n.anzahl != null && n.anzahl_angefordert != null && n.anzahl < n.anzahl_angefordert) {
    zeilen.push(`${n.anzahl} von ${n.anzahl_angefordert} zugesagt`);
  }
  if (n.teilung_aus_id != null) zeilen.push('Rest einer Teilzusage');
  if (n.zusage_rufnamen.length > 0) zeilen.push(`Wer: ${n.zusage_rufnamen.join(', ')}`);
  return zeilen;
}
