import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatVor } from '../../anzeige/abstand';
import type { BruchErfassung, EinsatzSpiegelAnzeige, SpiegelAntragAnzeige } from '../../api/types';
import type { PersonEintragAktion } from '../../offline/personEintrag';
import { vormerkungText } from '../../personen/personEintragSpeichern';
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

/** Eigene Änderungen aus der Zeit vor dem Führungswechsel, die der neue Führer nicht kannte
 *  (Bruchstelle, LLH-1641); ohne solche nichts. */
export function bruchText(s: Pick<EinsatzSpiegelAnzeige, 'bruchstelle'>): string | null {
  if (!s.bruchstelle) return null;
  return `${s.bruchstelle} ${s.bruchstelle === 1 ? 'Änderung' : 'Änderungen'} nicht übernommen`;
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

/** Zeilen ohne Antragsart nach Tabelle, sonst nach Bereich (LLH-1646). */
const BRUCH_TABELLE_WORT: Readonly<Record<string, string>> = {
  etb_eintrag: 'ETB-Eintrag',
  meldung: 'Meldung',
  einsatz_person: 'Person',
};

const BRUCH_KATEGORIE_WORT: Readonly<Record<BruchErfassung['kategorie'], string>> = {
  fuehrung: 'Einsatzdaten',
  etb: 'ETB',
  lage: 'Lagekarte',
  kraefte: 'Kräfte',
  personen: 'Personen',
  betreuung: 'Betreuung',
  kommunikation: 'Fernmeldewesen',
  anhaenge: 'Anhang',
};

/** Was die nicht übernommene Erfassung ist, als Wort (LLH-1646). */
export function bruchArtWort(
  e: Pick<BruchErfassung, 'antrag_art' | 'tabelle' | 'kategorie'>,
): string {
  if (e.antrag_art) return antragArtWort(e.antrag_art);
  return BRUCH_TABELLE_WORT[e.tabelle] ?? BRUCH_KATEGORIE_WORT[e.kategorie] ?? e.tabelle;
}

/** Folgezeilen, die mit der Erfassung gingen („+ 1 Zeile“); ohne keine Angabe. */
export function bruchFolgenText(folgen: number): string | null {
  if (folgen <= 0) return null;
  return `+ ${folgen} ${folgen === 1 ? 'Zeile' : 'Zeilen'}`;
}

/** Lässt sich als Antrag stellen: Antragsart bekannt und Inhalt sichtbar (N1). */
export function bruchStellbar(e: Pick<BruchErfassung, 'antrag_art' | 'verborgen'>): boolean {
  return e.antrag_art != null && !e.verborgen;
}

/** Ergebnis von „Alle stellen“, wenn etwas offen blieb: „2 nicht gestellt: Bezug …“. */
export function bruchOffenText(offen: readonly { grund: string }[]): string | null {
  if (offen.length === 0) return null;
  const gruende = [...new Set(offen.map((o) => o.grund))].join(' ');
  return `${offen.length} nicht gestellt: ${gruende}`;
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

function personenAnzahl(n: number): string {
  return n === 1 ? '1 Person' : `${n} Personen`;
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
    case 'sichtung':
    case 'anlass':
    case 'verbleib':
    case 'transport':
    case 'massnahme':
    case 'verletzung':
      // Derselbe Wortlaut wie „Offline vorgemerkt“ am Patientenkopf. Die Daten gingen ungeprüft
      // in den Antrag: was sich nicht lesen lässt, ergibt nichts statt eines Fehlers.
      try {
        const text = vormerkungText({
          art: a.art,
          person_id: 0,
          bezeichnung: '',
          daten: d,
        } as unknown as PersonEintragAktion);
        return text.includes('undefined') ? '' : text;
      } catch {
        return '';
      }
    case 'registrierung': {
      const liste = (d as unknown as { personen?: unknown } | null)?.personen;
      const personen: unknown[] = Array.isArray(liste) ? liste : [];
      const namen = personen
        .map((p) =>
          [zeichenkette(p, 'name'), zeichenkette(p, 'vorname')].filter(Boolean).join(', '),
        )
        .filter(Boolean);
      return personen.length === 0
        ? ''
        : [personenAnzahl(personen.length), namen.join('; ')].filter(Boolean).join(': ');
    }
    case 'abmeldung': {
      // Haushalt und Personen tragen fremde Kennungen: nur, was abgemeldet wird.
      if (
        d != null &&
        typeof d === 'object' &&
        (d as { haushalt_id?: unknown }).haushalt_id != null
      )
        return 'Haushalt';
      const ids = (d as { person_ids?: unknown } | null)?.person_ids;
      return Array.isArray(ids) && ids.length > 0 ? personenAnzahl(ids.length) : '';
    }
    case 'eintreffen':
      return d != null && typeof d === 'object' && (d as { unangemeldet?: unknown }).unangemeldet
        ? 'unangemeldete Kraft'
        : 'Kraft';
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
