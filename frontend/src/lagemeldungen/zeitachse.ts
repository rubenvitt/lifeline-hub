import dayjs, { type Dayjs } from 'dayjs';
import { DEFAULT_KONVENTIONEN, inZone, type AnzeigeKonventionen } from '../anzeige/format';

/**
 * Zeitachse der Lagemeldungen (LFH-348 · C13, Befund M85): Tagesgruppen und Zeitfenster —
 * rein, ohne React, damit die Tagesgrenze ohne Render prüfbar ist.
 *
 * Der Wire-String ist UTC OHNE Zonenkennung; `dayjs(s)` läse ihn als Ortszeit und
 * verschöbe die Tagesgrenze um den Zonenversatz (dieselbe Falle wie in `etb/filterZeit.ts`).
 * Deshalb läuft alles über `inZone` aus `anzeige/format.ts` — dieselbe Zone, in der
 * `ZeitAnzeige` daneben die Uhrzeit rendert; sonst stünde ein 00:30-Eintrag unter dem
 * falschen Tageskopf.
 */

export type Zeitfenster = 'stunde' | 'vierStunden' | 'heute';

export const ZEITFENSTER: readonly { readonly text: string; readonly value: Zeitfenster }[] = [
  { text: 'Letzte Stunde', value: 'stunde' },
  { text: 'Letzte 4 Stunden', value: 'vierStunden' },
  { text: 'Heute', value: 'heute' },
];

/** Gruppenschlüssel: das Datum in der Anzeigezone, `YYYY-MM-DD` — sortierbar als Text. */
export function tagesSchluessel(
  utc: string,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return inZone(utc, konv).format('YYYY-MM-DD');
}

/** „Jetzt" in der Anzeigezone — dieselbe Zone, in der `tagesSchluessel` den Tag bestimmt. */
export function jetztInZone(
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  jetzt: Dayjs = dayjs(),
): Dayjs {
  if (!konv.zeitzone) return jetzt;
  try {
    return jetzt.tz(konv.zeitzone);
  } catch {
    return jetzt;
  }
}

/**
 * Gruppenetikett: „Heute" / „Gestern" / `DD.MM.YYYY`. Nimmt die KONVENTIONEN, nicht ein
 * `jetzt` — damit der Aufrufer die Zone nicht vergessen kann (Review LFH-348: der einzige
 * Produktivaufrufer reichte kein `jetzt` durch, „Heute" fiel bei abweichender Anzeigezone
 * auf den falschen Tageskopf). Der Schlüssel `YYYY-MM-DD` ist zonenlos; verglichen wird er
 * mit dem heutigen Schlüssel derselben Zone, nicht mit einem Zeitpunkt.
 */
export function tagesEtikett(
  schluessel: string,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  jetzt: Dayjs = dayjs(),
): string {
  const heute = jetztInZone(konv, jetzt);
  if (schluessel === heute.format('YYYY-MM-DD')) return 'Heute';
  if (schluessel === heute.subtract(1, 'day').format('YYYY-MM-DD')) return 'Gestern';
  return dayjs(schluessel, 'YYYY-MM-DD').format('DD.MM.YYYY');
}

/** Trifft der Zeitpunkt in das Fenster? Grenzen einschließend (59 min drin, 61 min draußen). */
export function imZeitfenster(
  utc: string,
  fenster: Zeitfenster,
  jetzt: Dayjs = dayjs(),
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): boolean {
  const d = inZone(utc, konv);
  switch (fenster) {
    case 'stunde':
      return !d.isBefore(jetzt.subtract(1, 'hour'));
    case 'vierStunden':
      return !d.isBefore(jetzt.subtract(4, 'hour'));
    case 'heute':
      return d.isSame(jetztInZone(konv, jetzt), 'day');
  }
}

/** Ortsfilter der Zeitachse: alle, nur verortete, nur unverortete Einträge. */
export type Ortsfilter = 'alle' | 'mit' | 'ohne';

/** Filterstand der Zeitachse — `'alle'` heißt „kein Filter auf dieser Achse". */
export interface LageFilter {
  fenster: Zeitfenster | 'alle';
  ort: Ortsfilter;
  /** Freitext über Meldungstext, Absender und Meldungsnummer; leer = kein Filter. */
  suche: string;
}

export const LEERER_FILTER: LageFilter = { fenster: 'alle', ort: 'alle', suche: '' };

/** Ist irgendein Filter gesetzt? Trennt „leer" von „weggefiltert" im Leerzustand. */
export function filterAktiv(f: LageFilter): boolean {
  return f.fenster !== 'alle' || f.ort !== 'alle' || f.suche.trim() !== '';
}

/** Die Felder, die ein Lageobjekt für Filter und Gruppen braucht (Teil von `LageMeldung`). */
export interface LageEintragKern {
  text: string;
  erstellt_at: string;
  lat?: number | null;
  lon?: number | null;
  meldung_lfd_nr: number;
  meldung_absender: string;
}

/** Filtert die Menge — rein, Reihenfolge bleibt. */
export function filtereLagemeldungen<T extends LageEintragKern>(
  eintraege: readonly T[],
  f: LageFilter,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  jetzt: Dayjs = dayjs(),
): T[] {
  const nadel = f.suche.trim().toLowerCase();
  return eintraege.filter((l) => {
    if (f.fenster !== 'alle' && !imZeitfenster(l.erstellt_at, f.fenster, jetzt, konv)) {
      return false;
    }
    if (f.ort !== 'alle' && (l.lat != null && l.lon != null) !== (f.ort === 'mit')) return false;
    if (nadel !== '') {
      const heuhaufen = `${l.text} ${l.meldung_absender} ${l.meldung_lfd_nr}`.toLowerCase();
      if (!heuhaufen.includes(nadel)) return false;
    }
    return true;
  });
}

export interface Tagesgruppe<T> {
  schluessel: string;
  etikett: string;
  zeilen: T[];
}

/**
 * Tagesgruppen, jüngster Tag zuerst und innerhalb des Tages jüngster Eintrag zuerst — die
 * Zeitachse wird von oben gelesen („was ist zuletzt passiert?"). Die Reihenfolge kommt aus
 * den Daten, nicht aus der Serverliste: die liefert aufsteigend.
 *
 * Sortiert wird über den Wire-String: `YYYY-MM-DD HH:mm:ss` ist als Text chronologisch, und
 * ein Umweg über `inZone` änderte an der Ordnung nichts (die Zone verschiebt alle gleich).
 */
export function gruppiereNachTag<T extends LageEintragKern>(
  eintraege: readonly T[],
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  jetzt: Dayjs = dayjs(),
): Tagesgruppe<T>[] {
  const sortiert = [...eintraege].sort((a, b) =>
    a.erstellt_at < b.erstellt_at ? 1 : a.erstellt_at > b.erstellt_at ? -1 : 0,
  );
  const gruppen: Tagesgruppe<T>[] = [];
  for (const l of sortiert) {
    const schluessel = tagesSchluessel(l.erstellt_at, konv);
    const letzte = gruppen[gruppen.length - 1];
    if (letzte?.schluessel === schluessel) letzte.zeilen.push(l);
    else gruppen.push({ schluessel, etikett: tagesEtikett(schluessel, konv, jetzt), zeilen: [l] });
  }
  return gruppen;
}
