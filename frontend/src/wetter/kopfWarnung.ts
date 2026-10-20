/**
 * Die EINE DWD-Warnung, die das Lagebild im Seitenkopf nennt (LLH-1117, Spec `lage-wetter-pegel`,
 * „Wetterwarnung im Seitenkopf des Lagebilds"). Wetter betrifft fast jede Lage; das Lagebild
 * zeigt es deshalb im Kopf, nie im Kennzahlenband (LFH-640: Lageplätze nur per Entscheidung).
 *
 * Anders als `unwetter.ts` gilt hier JEDE amtliche Stufe, nicht nur schwer und extrem: die Marke
 * ist still (kein Ton, keine AlarmZentrale) und belastet das Alarmbudget (LFH-663) nicht.
 *
 * Gewählt wird die höchste Stufe, bei gleicher Stufe die geltende vor der angekündigten, dann der
 * früheste Beginn; die übrigen zählen als `weitere`. Ohne verwertbaren Stand (`aktuell`/`veraltet`)
 * oder ohne Warnung: `null` — keine Marke, auch keine „0".
 *
 * Rein; strukturelle Eingabetypen wie `unwetter.ts`.
 */
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import type { WetterWarnstufe } from '../api/types';
import { standZeit } from '../pegel/pegelKennzahl';
import { dwdWarnstufe } from '../theme/statusFarben';
import { WARNSTUFE_RANG } from './unwetter';
import { teilStand, teileWarnungen } from './wetterStand';
import { titelSchreibung } from './wetterText';

type Warnung = {
  stufe: WetterWarnstufe;
  ereignis: string;
  beginn?: string | null;
  ende?: string | null;
};

type WarnTeil = {
  zustand: string;
  abgerufen_at?: string | null;
  daten?: readonly Warnung[] | null;
};

export interface KopfWarnung {
  stufe: WetterWarnstufe;
  /** Amtliche Bezeichnung der Stufe („Unwetterwarnung"), der zweite Kanal neben der Farbe. */
  stufenwort: string;
  /** „Starkregen ab 18:11" (angekündigt) bzw. „Sturmböen bis 14:00" (gilt jetzt). */
  text: string;
  /** Wie viele geltende oder angekündigte Warnungen die Marke außerdem nicht nennt. */
  weitere: number;
}

const beginnMs = (w: Warnung) => {
  const t = w.beginn ? Date.parse(w.beginn) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

export function kopfWarnung(
  teil: WarnTeil | null | undefined,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): KopfWarnung | null {
  if (!teil) return null;
  const art = teilStand(teil, 'warnungen', jetzt).art;
  if (art !== 'aktuell' && art !== 'veraltet') return null;
  const { giltJetzt, angekuendigt } = teileWarnungen(teil.daten ?? [], jetzt);
  const kandidaten = [
    ...giltJetzt.map((w) => ({ w, gilt: true })),
    ...angekuendigt.map((w) => ({ w, gilt: false })),
  ].sort(
    (a, b) =>
      WARNSTUFE_RANG[b.w.stufe] - WARNSTUFE_RANG[a.w.stufe] ||
      Number(b.gilt) - Number(a.gilt) ||
      beginnMs(a.w) - beginnMs(b.w),
  );
  const erste = kandidaten[0];
  if (!erste) return null;
  const { w, gilt } = erste;
  const zeit = gilt
    ? w.ende && Number.isFinite(Date.parse(w.ende))
      ? `bis ${standZeit(w.ende, jetzt, konv)}`
      : 'bis auf Weiteres'
    : `ab ${standZeit(w.beginn as string, jetzt, konv)}`;
  return {
    stufe: w.stufe,
    stufenwort: dwdWarnstufe[w.stufe].label,
    text: `${titelSchreibung(w.ereignis)} ${zeit}`,
    weitere: kandidaten.length - 1,
  };
}
