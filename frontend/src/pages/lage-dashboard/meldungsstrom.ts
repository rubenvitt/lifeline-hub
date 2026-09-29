/**
 * Meldungsstrom des Lage-Dashboards — reine Ableitungen. Der Strom zeigt die jüngsten ETB-Einträge
 * aller Typen; neue werden nicht unter dem Cursor eingeschoben, sondern per Sammelbanner
 * angekündigt. Die Weiche ist eine Wassermarke (`angezeigtBis`, höchste gezeigte lfd. Nr.): die
 * Seite hält sie, diese Datei rechnet, was sichtbar bleibt und was zurückgehalten wird.
 */
import type { EtbEintragAnzeige, MeldeWeg } from '../../api/types';
import { verfasserText } from '../../etb/verfasser';
import {
  DEFAULT_KONVENTIONEN,
  formatUhrzeit,
  type AnzeigeKonventionen,
} from '../../anzeige/format';
import { MELDEWEG_OPTIONEN } from '../../etb/schnellerfassungModell';

/** Wie viele Einträge das Paneel zeigt (Entwurf S3). */
const STROM_ZEIGEN = 7;

/**
 * Wie viele Einträge abgerufen werden — mehr als gezeigt, damit nach einer Welle neuer Einträge die
 * bisher gezeigten noch im Fenster liegen.
 */
export const STROM_ABRUF = 30;

interface StromAuswahl {
  /** Die gezeigten Einträge, jüngster zuerst. */
  sichtbar: EtbEintragAnzeige[];
  /** Zurückgehaltene neue Einträge (lfd. Nr. über der Wassermarke). */
  neu: number;
  /** `true`, wenn jeder abgerufene Eintrag neu ist — der Zähler ist dann eine Untergrenze. */
  neuMindestens: boolean;
  /** Höchste lfd. Nr. im Abruf (0 bei leerem Strom). */
  hoechste: number;
}

/** Höchste lfd. Nr. im Abruf, 0 bei leerem Strom. Rein. */
export function hoechsteLfdNr(eintraege: readonly EtbEintragAnzeige[]): number {
  return eintraege.reduce((max, e) => (e.lfd_nr > max ? e.lfd_nr : max), 0);
}

/**
 * Soll die Wassermarke auf den jüngsten Stand springen? Ja beim ersten Abruf oder wenn unter ihr
 * nichts mehr steht — über einem leeren Paneel wäre ein Banner eine Aufforderung ohne Grund. Rein.
 */
export function wassermarkeNachziehen(
  eintraege: readonly EtbEintragAnzeige[],
  angezeigtBis: number | null,
): boolean {
  if (angezeigtBis === null) return true;
  if (angezeigtBis === hoechsteLfdNr(eintraege)) return false;
  return !eintraege.some((e) => e.lfd_nr <= angezeigtBis);
}

/** Was der Strom zeigt und was er zurückhält. Sortiert selbst (lfd. Nr. absteigend). Rein. */
export function stromAuswahl(
  eintraege: readonly EtbEintragAnzeige[],
  angezeigtBis: number | null,
  zeigen: number = STROM_ZEIGEN,
): StromAuswahl {
  const sortiert = [...eintraege].sort((a, b) => b.lfd_nr - a.lfd_nr);
  const hoechste = hoechsteLfdNr(eintraege);
  const grenze = angezeigtBis ?? hoechste;
  const neu = sortiert.filter((e) => e.lfd_nr > grenze).length;
  return {
    sichtbar: sortiert.filter((e) => e.lfd_nr <= grenze).slice(0, zeigen),
    neu,
    neuMindestens: neu > 0 && neu === sortiert.length,
    hoechste,
  };
}

/** Wortlaut des Sammelbanners. Rein. */
export function bannerText(neu: number, mindestens: boolean): string {
  const zahl = mindestens ? `Mindestens ${neu}` : String(neu);
  return neu === 1 && !mindestens ? '1 neuer Eintrag' : `${zahl} neue Einträge`;
}

const MELDEWEG_LABEL = Object.fromEntries(
  MELDEWEG_OPTIONEN.map((o) => [o.value, o.label]),
) as Record<MeldeWeg, string>;

/**
 * Quelle eines Eintrags: „von · Meldeweg". Fehlt `von`, steht der Erfasser samt Funktions-Snapshot
 * da („Vitt · S2"). Ein fehlender Meldeweg fällt weg. Rein.
 */
export function stromQuelle(e: EtbEintragAnzeige): string {
  const von = e.von?.trim() || verfasserText(e);
  return [von, e.meldeweg ? MELDEWEG_LABEL[e.meldeweg] : null].filter(Boolean).join(' · ');
}

/** Ereigniszeit als `HH:mm` in der Anzeigezone. Rein. */
export function stromZeit(
  e: EtbEintragAnzeige,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return formatUhrzeit(e.ereigniszeit, konv);
}
