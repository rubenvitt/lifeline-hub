import dayjs, { type Dayjs } from 'dayjs';
import { DEFAULT_KONVENTIONEN, inZone, type AnzeigeKonventionen } from '../anzeige/format';
import { kalendertag, zeitKurz } from '../anzeige/zeitDarstellung';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';

/**
 * Zeitachse der Lagemeldungen: Tagesgruppen und Filter, rein und ohne React.
 *
 * Maßgeblich ist die **Ereigniszeit** der Quellmeldung (`ereigniszeit`), nicht der Zeitpunkt der
 * Übergabe an die Lage (LLH-1039): eine nachgereichte Meldung steht dort, wo sie geschah. Das Feld
 * heißt wie an der Meldung selbst, damit eine Sicht, die Meldungen direkt liest, dieselben
 * Funktionen nutzt.
 *
 * Der Wire-String ist UTC OHNE Zonenkennung; `dayjs(s)` läse ihn als Ortszeit und verschöbe
 * die Tagesgrenze. Deshalb läuft alles über `inZone` — dieselbe Zone, in der `ZeitAnzeige`
 * die Uhrzeit rendert.
 */

/** Gruppenschlüssel: das Datum in der Anzeigezone, `YYYY-MM-DD` — sortierbar als Text. */
export function tagesSchluessel(
  utc: string,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return inZone(utc, konv).format('YYYY-MM-DD');
}

/** „Jetzt" in der Anzeigezone — dieselbe Zone, in der `tagesSchluessel` den Tag bestimmt. */
function jetztInZone(
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
 * Gruppenetikett: „Heute" / „Gestern" / sonst der Tag in der Schreibweise des Formatkerns
 * (`01jun26` bzw. `01.06.26`, LLH-1061). Nimmt die KONVENTIONEN statt eines
 * `jetzt`, damit der Aufrufer die Zone nicht vergessen kann; verglichen wird mit dem heutigen
 * Schlüssel derselben Zone.
 */
export function tagesEtikett(
  schluessel: string,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  jetzt: Dayjs = dayjs(),
): string {
  const heute = jetztInZone(konv, jetzt);
  if (schluessel === heute.format('YYYY-MM-DD')) return 'Heute';
  if (schluessel === heute.subtract(1, 'day').format('YYYY-MM-DD')) return 'Gestern';
  return kalendertag(schluessel, konv);
}

/**
 * Trifft der Zeitpunkt in den Zeitraum? Absolute Grenzen (Wire, UTC) aus der Schnellwahl
 * `anzeige/ZeitraumWahl.tsx` (LLH-1322), einschließend wie der ETB-Filter am Server
 * (`ereigniszeit >= von`, `<= bis`). Eine fehlende oder unlesbare Grenze ist offen.
 */
export function imZeitraum(utc: string, { von, bis }: { von?: string; bis?: string }): boolean {
  const d = alsZeitpunkt(utc);
  const ab = alsZeitpunkt(von);
  const bisZ = alsZeitpunkt(bis);
  if (!ab && !bisZ) return true;
  if (!d) return false;
  if (ab && d.isBefore(ab)) return false;
  if (bisZ && d.isAfter(bisZ)) return false;
  return true;
}

/** Ortsfilter der Zeitachse: alle, nur verortete, nur unverortete Einträge. */
export type Ortsfilter = 'alle' | 'mit' | 'ohne';

/**
 * Herkunftsfilter (LLH-1031): alle, nur von einem gekoppelten Gerät erfasste, nur aus dem
 * Meldungseingang übernommene (Art ≠ Lagemeldung).
 */
export type Herkunftsfilter = 'alle' | 'geraet' | 'uebernommen';

/** Filterstand der Zeitachse — `'alle'` heißt „kein Filter auf dieser Achse". */
export interface LageFilter {
  /**
   * Zeitraum nach Ereigniszeit: absolute Grenzen (Wire, UTC) aus der Adresse, wie im ETB
   * (Spec `etb-filterleiste`, „Zeitraum mit Schnellwahl“). Fehlt eine, ist sie offen.
   */
  von?: string;
  bis?: string;
  ort: Ortsfilter;
  herkunft: Herkunftsfilter;
  /** Freitext über Meldungstext, Absender und Meldungsnummer; leer = kein Filter. */
  suche: string;
}

export const LEERER_FILTER: LageFilter = {
  ort: 'alle',
  herkunft: 'alle',
  suche: '',
};

/** Ist irgendein Filter gesetzt? Trennt „leer" von „weggefiltert" im Leerzustand. */
export function filterAktiv(f: LageFilter): boolean {
  return (
    f.von != null ||
    f.bis != null ||
    f.ort !== 'alle' ||
    f.herkunft !== 'alle' ||
    f.suche.trim() !== ''
  );
}

/** Die Felder, die ein Lageobjekt für Filter und Gruppen braucht (Teil von `LageMeldung`). */
interface LageEintragKern {
  text: string;
  /** Ereigniszeit der Quellmeldung (UTC-Wire) — Zeit, Tag, Zeitraum und Ordnung. */
  ereigniszeit: string;
  lat?: number | null;
  lon?: number | null;
  meldung_lfd_nr: number;
  meldung_absender: string;
  /** Art der Meldung; fehlt in Lage-Ständen von vor LLH-1031. */
  meldungsart?: string;
  /** Erfasst von einem gekoppelten Gerät; fehlt in Lage-Ständen von vor LLH-1031. */
  is_von_geraet?: boolean;
}

/** Trifft die Herkunft? Ein Eintrag ohne Art (alter Lage-Stand) ist nur unter „alle“. */
function herkunftPasst(l: LageEintragKern, herkunft: Herkunftsfilter): boolean {
  switch (herkunft) {
    case 'alle':
      return true;
    case 'geraet':
      return l.is_von_geraet === true;
    case 'uebernommen':
      return l.meldungsart != null && l.meldungsart !== 'lagemeldung';
  }
}

/** Filtert die Menge — rein, Reihenfolge bleibt. */
export function filtereLagemeldungen<T extends LageEintragKern>(
  eintraege: readonly T[],
  f: LageFilter,
): T[] {
  const nadel = f.suche.trim().toLowerCase();
  return eintraege.filter((l) => {
    if (!imZeitraum(l.ereigniszeit, f)) return false;
    if (f.ort !== 'alle' && (l.lat != null && l.lon != null) !== (f.ort === 'mit')) return false;
    if (!herkunftPasst(l, f.herkunft)) return false;
    if (nadel !== '') {
      const heuhaufen = `${l.text} ${l.meldung_absender} ${l.meldung_lfd_nr}`.toLowerCase();
      if (!heuhaufen.includes(nadel)) return false;
    }
    return true;
  });
}

interface Tagesgruppe<T> {
  schluessel: string;
  etikett: string;
  zeilen: T[];
}

/**
 * Tagesgruppen, jüngster Tag und jüngster Eintrag zuerst, nach Ereigniszeit. Der Server liefert
 * schon so; sortiert wird trotzdem, damit die Ordnung nicht an der Quelle hängt. Über den
 * Wire-String: `YYYY-MM-DD HH:mm:ss` ist als Text chronologisch. Gleichstand behält die
 * Eingangsreihenfolge (stabile Sortierung, beim Server: zuletzt übergeben zuerst).
 */
export function gruppiereNachTag<T extends LageEintragKern>(
  eintraege: readonly T[],
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  jetzt: Dayjs = dayjs(),
): Tagesgruppe<T>[] {
  const sortiert = [...eintraege].sort((a, b) =>
    a.ereigniszeit < b.ereigniszeit ? 1 : a.ereigniszeit > b.ereigniszeit ? -1 : 0,
  );
  const gruppen: Tagesgruppe<T>[] = [];
  for (const l of sortiert) {
    const schluessel = tagesSchluessel(l.ereigniszeit, konv);
    const letzte = gruppen[gruppen.length - 1];
    if (letzte?.schluessel === schluessel) letzte.zeilen.push(l);
    else gruppen.push({ schluessel, etikett: tagesEtikett(schluessel, konv, jetzt), zeilen: [l] });
  }
  return gruppen;
}

/**
 * Zeit der Übergabe an die Lage für das Meta der Zeile: nur die Uhrzeit, solange sie am Tag der
 * Ereigniszeit liegt (der steht im Tageskopf), sonst mit Tag — sonst läse sich eine am Folgetag
 * nachgereichte Übergabe als Uhrzeit des Ereignistags. Beides in der Anzeigezone, in der Rolle
 * „kurz“ mit dem Ereignistag als „heute“ (LLH-1061: `1430` bzw. `131430`).
 */
export function uebergabeZeit(
  ereigniszeit: string,
  uebergabe: string,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return zeitKurz(uebergabe, konv, inZone(ereigniszeit, konv));
}
