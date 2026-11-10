import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatVor } from '../../anzeige/abstand';
import type { EinsatzSpiegelAnzeige, SpiegelAntragAnzeige } from '../../api/types';
import {
  betreuungsstellePfad,
  bereitstellungsraumDetailPfad,
  etbPfad,
  evakuierungsbezirkPfad,
  meldungenPfad,
  personDetailPfad,
  personenPfad,
  verpflegungAusgabePfad,
} from '../../routing/deeplinks';

dayjs.extend(utc);

/**
 * Wortlaut und Ziele des Hinweisbands am Spiegel (LLH-1492, Spec `einsatz-spiegel`, „Der Spiegel
 * zeigt seine Herkunft und seinen Stand“, und `spiegel-antraege`). Rein, für die Tests exportiert.
 */

/**
 * Ab diesem Abstand zum letzten Abgleich steht „keine Verbindung seit …“. Die Spec nennt das
 * Dreifache des Takts; den Takt (`LIFELINE_INSTANZ_SPIEGEL_SEKUNDEN`, Vorgabe 5 s) kennt der Client
 * nicht, und der Kopf frischt nur mit Live-Ereignissen und dem Abruf des Bands
 * ({@link SPIEGEL_KOPF_ABRUF_MS}) auf. Eine Minute liegt über beidem.
 */
export const KEINE_VERBINDUNG_AB_MS = 60_000;

/** Abstand, in dem das Band den Einsatzkopf am Spiegel neu holt: Abgleiche ohne neue Zeile
 *  melden kein Live-Ereignis, der letzte Abgleich bliebe sonst stehen. */
export const SPIEGEL_KOPF_ABRUF_MS = 30_000;

/** Kopf des Bands: „Spiegel von ELW 1“. */
export function spiegelTitel(s: Pick<EinsatzSpiegelAnzeige, 'gegenstelle'>): string {
  return `Spiegel von ${s.gegenstelle}`;
}

/**
 * Stand des Abgleichs: beendet (Widerruf), noch keiner, zu alt oder der letzte. `zeit` formatiert
 * den Zeitpunkt in der Anzeigekonvention; `aktiv` heißt, der Einsatz ist aktiv (nur dann gilt der
 * kurze Takt, und ein Ausbleiben ist eine Störung).
 */
export function spiegelStand(
  s: Pick<EinsatzSpiegelAnzeige, 'beendet' | 'letzter_abgleich_at'>,
  aktiv: boolean,
  jetzt: number,
  zeit: (wert: string) => string,
): { text: string; gestoert: boolean } {
  if (s.beendet) return { text: 'Abgleich beendet', gestoert: false };
  const letzter = s.letzter_abgleich_at;
  if (!letzter) return { text: 'noch kein Abgleich', gestoert: aktiv };
  const vor = formatVor(letzter, jetzt);
  const alt = jetzt - dayjs.utc(letzter).valueOf() > KEINE_VERBINDUNG_AB_MS;
  if (aktiv && alt) {
    return { text: `keine Verbindung seit ${vor.replace(/^vor /, '')}`, gestoert: true };
  }
  return { text: `Abgleich ${zeit(letzter)}`, gestoert: false };
}

/** Zähler der eigenen Anträge: „2 ausstehend · 1 abgelehnt“; leer ohne Anträge. */
export function antragZaehler(
  s: Pick<EinsatzSpiegelAnzeige, 'antraege_ausstehend' | 'antraege_abgelehnt'>,
): string[] {
  const teile: string[] = [];
  if (s.antraege_ausstehend > 0) {
    teile.push(
      `${s.antraege_ausstehend} ${s.antraege_ausstehend === 1 ? 'Antrag' : 'Anträge'} ausstehend`,
    );
  }
  if (s.antraege_abgelehnt > 0) teile.push(`${s.antraege_abgelehnt} abgelehnt`);
  return teile;
}

/** Was beantragt wurde, als Wort; Arten wie in der Warteschlange. */
const ART_WORT: Readonly<Record<string, string>> = {
  etb: 'ETB-Eintrag',
  meldung: 'Meldung',
  person: 'Person',
  sichtung: 'Sichtung',
  anlass: 'Anlass',
  verbleib: 'Verbleib',
  notiz: 'Notiz',
  transport: 'Transport',
  massnahme: 'Maßnahme',
  verletzung: 'Verletzung',
  stand: 'Standmeldung',
  belegung: 'Belegungsmeldung',
  registrierung: 'Registrierung',
  abmeldung: 'Abmeldung',
  eintreffen: 'Eintreffen',
  ausgabe: 'Verpflegungsausgabe',
};

export function antragArtWort(art: string): string {
  return ART_WORT[art] ?? art;
}

export const ANTRAG_ZUSTAND_WORT: Readonly<Record<string, string>> = {
  ausstehend: 'ausstehend',
  zugestellt: 'zugestellt',
  // Übernommen, die Zeile ist aber noch nicht im Spiegel.
  uebernommen: 'übernommen',
  abgelehnt: 'abgelehnt',
};

/** Längster Auszug eines Freitexts in der Liste. */
const AUSZUG_MAX = 80;

function zeichenkette(daten: unknown, feld: string): string | null {
  const wert =
    daten != null && typeof daten === 'object' ? (daten as Record<string, unknown>)[feld] : null;
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

function zahl(daten: unknown, feld: string): number | null {
  const wert =
    daten != null && typeof daten === 'object' ? (daten as Record<string, unknown>)[feld] : null;
  return typeof wert === 'number' ? wert : null;
}

function auszug(text: string): string {
  const eineZeile = text.replace(/\s+/g, ' ');
  return eineZeile.length > AUSZUG_MAX ? `${eineZeile.slice(0, AUSZUG_MAX)} …` : eineZeile;
}

/**
 * Die erfassten Daten in einer Zeile, soweit sie ohne Kennungen der führenden Instanz lesbar sind:
 * Wortlaut bei ETB, Meldung und Notiz, Name bei einer Person, Zahlen bei Meldungen und Ausgaben.
 * Leer, wenn nichts Lesbares da ist.
 */
export function antragDatenText(a: Pick<SpiegelAntragAnzeige, 'art' | 'daten'>): string {
  const d = a.daten;
  switch (a.art) {
    case 'etb':
    case 'meldung': {
      const von = zeichenkette(d, a.art === 'etb' ? 'von' : 'absender');
      const inhalt = zeichenkette(d, 'inhalt');
      return [von, inhalt ? auszug(inhalt) : null].filter(Boolean).join(': ');
    }
    case 'notiz':
      return auszug(zeichenkette(d, 'text') ?? '');
    case 'person':
      return [zeichenkette(d, 'name'), zeichenkette(d, 'vorname')].filter(Boolean).join(', ');
    case 'stand': {
      const n = zahl(d, 'evakuiert');
      return n == null ? '' : `${n} evakuiert`;
    }
    case 'belegung': {
      const n = zahl(d, 'belegt');
      return n == null ? '' : `${n} untergebracht`;
    }
    case 'ausgabe': {
      const n = zahl(d, 'menge');
      return n == null ? '' : `${n} EP`;
    }
    default:
      return '';
  }
}

function zielZahl(ziel: unknown, name: string): number | null {
  const wert =
    ziel != null && typeof ziel === 'object' ? (ziel as Record<string, unknown>)[name] : null;
  if (typeof wert === 'number') return wert;
  if (typeof wert === 'string' && /^\d+$/.test(wert)) return Number(wert);
  return null;
}

/**
 * Wo die Erfassung neu beginnt („Neu erfassen“): die Seite, an der sie entstand, mit dem Ziel aus
 * `ziel` (lokale Kennungen). `null`, wenn das Ziel fehlt.
 */
export function antragErfassungsort(
  einsatzId: number,
  a: Pick<SpiegelAntragAnzeige, 'art' | 'ziel'>,
): string | null {
  switch (a.art) {
    case 'etb':
      return etbPfad(einsatzId, { neu: true });
    case 'meldung':
      return meldungenPfad(einsatzId);
    case 'person':
      return personenPfad(einsatzId, { neu: true });
    case 'sichtung':
    case 'anlass':
    case 'verbleib':
    case 'notiz':
    case 'transport':
    case 'massnahme':
    case 'verletzung': {
      const pid = zielZahl(a.ziel, 'pid');
      return pid == null ? null : personDetailPfad(einsatzId, pid);
    }
    case 'stand': {
      const bid = zielZahl(a.ziel, 'bid');
      return bid == null ? null : evakuierungsbezirkPfad(einsatzId, bid);
    }
    case 'belegung':
    case 'registrierung':
    case 'abmeldung': {
      const sid = zielZahl(a.ziel, 'sid');
      return sid == null ? null : betreuungsstellePfad(einsatzId, sid);
    }
    case 'eintreffen': {
      const bid = zielZahl(a.ziel, 'bid');
      return bid == null ? null : bereitstellungsraumDetailPfad(einsatzId, bid);
    }
    case 'ausgabe': {
      const zid = zielZahl(a.ziel, 'zid');
      return zid == null ? null : verpflegungAusgabePfad(einsatzId, zid);
    }
    default:
      return null;
  }
}
