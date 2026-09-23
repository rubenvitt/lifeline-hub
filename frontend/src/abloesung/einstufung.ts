/**
 * Ablösung (LFH-635) — reine Ableitungen: Einstufung, Modulzähler, Überblick-Marken.
 *
 * Die Einstufung rechnet das Backend beim Lesen (`src/abloesung/mod.rs::einstufung`). Das
 * Frontend rechnet sie NACH, weil die Uhr im Client weitertickt: eine Schicht, die beim
 * letzten Abruf „planmäßig" war, ist zwanzig Minuten später in der Vorwarnzeit, ohne dass
 * ein neuer Abruf käme. Deshalb dieselbe Regel mit denselben Grenzfällen (genau fällig ⇒
 * überfällig, genau 30 min ⇒ Vorwarnung) — `einstufung.test.ts` pinnt sie wie der
 * Rust-Test `einstufung_grenzfaelle`.
 *
 * ZEIT: Wire-Strings sind UTC OHNE Zonenkennung; gelesen wird ausschließlich über
 * `dayjs.utc`, nie über `dayjs(s)` (das läse Ortszeit und verschöbe still um den Versatz).
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Abloesung, AbloesungEinstufung } from '../api/types';

dayjs.extend(utc);

/** Vorwarnzeit vor der Fälligkeit — Spiegel von `VORWARNUNG_MINUTEN` im Backend. */
export const VORWARNUNG_MINUTEN = 30;

/** Wire-Zeit (UTC ohne Zone) → Zeitpunkt; `null` bei fehlendem oder unlesbarem Wert. */
export function abloesungZeit(wire: string | null | undefined): Dayjs | null {
  if (!wire) return null;
  const d = dayjs.utc(wire);
  return d.isValid() ? d : null;
}

/**
 * Einstufung gegen `jetzt`. Eine unlesbare Fälligkeit gilt wie im Backend als überfällig:
 * sie soll auffallen, nicht verschwinden.
 */
export function einstufungVon(faelligAt: string, jetzt: Dayjs): AbloesungEinstufung {
  const f = abloesungZeit(faelligAt);
  if (!f) return 'ueberfaellig';
  const abstand = f.valueOf() - jetzt.valueOf();
  if (abstand <= 0) return 'ueberfaellig';
  if (abstand <= VORWARNUNG_MINUTEN * 60_000) return 'vorwarnung';
  return 'planmaessig';
}

/** Modulzähler: laufende Schichten in der Vorwarnzeit oder überfällig. */
export function zaehleFaellige(abloesungen: readonly Abloesung[], jetzt: Dayjs): number {
  return abloesungen.filter(
    (a) => a.status === 'laufend' && einstufungVon(a.faellig_at, jetzt) !== 'planmaessig',
  ).length;
}

/** Eine Überblick-Marke der Ablösung: Schichten desselben Abschnitts mit gleicher
 *  Fälligkeit (minutengenau) zusammengefasst. */
export interface AbloesungsMarke {
  key: string;
  /** Fälligkeit (Wire-String der frühesten Schicht der Gruppe). */
  zeit: string;
  text: string;
  /** Anzahl der Einheiten der Gruppe. */
  einheiten: number;
}

/** Rhythmus als Text: „6 h", „6 h 30 min", „45 min" — wie `rhythmus_text` im Backend. */
export function rhythmusText(minuten: number): string {
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/**
 * Laufende Schichten → Marken „Ablösung <Abschnitt>, <n> Einheiten" bzw. „Ablösung
 * <Einheit>". Schichten ohne Abschnitt bilden je eine eigene Marke — ohne Einsatzstelle
 * gibt es nichts, das sie gemeinsam benennen würde.
 */
export function abloesungsMarken(abloesungen: readonly Abloesung[]): AbloesungsMarke[] {
  const gruppen = new Map<string, Abloesung[]>();
  for (const a of abloesungen) {
    if (a.status !== 'laufend' || !abloesungZeit(a.faellig_at)) continue;
    const minute = abloesungZeit(a.faellig_at)!.startOf('minute').valueOf();
    const key = a.abschnitt_id != null ? `ab-${a.abschnitt_id}-${minute}` : `ab-einheit-${a.id}`;
    const liste = gruppen.get(key);
    if (liste) liste.push(a);
    else gruppen.set(key, [a]);
  }
  return [...gruppen.entries()].map(([key, liste]) => {
    const frueheste = [...liste].sort(
      (x, y) => abloesungZeit(x.faellig_at)!.valueOf() - abloesungZeit(y.faellig_at)!.valueOf(),
    )[0];
    const text =
      liste.length === 1
        ? `Ablösung ${frueheste.einheit_name}`
        : `Ablösung ${frueheste.abschnitt_name ?? 'Abschnitt'}, ${liste.length} Einheiten`;
    return { key, zeit: frueheste.faellig_at, text, einheiten: liste.length };
  });
}
