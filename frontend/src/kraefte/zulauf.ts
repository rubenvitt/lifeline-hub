import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Nachforderung } from '../api/types';
import { istUeberfaellig } from '../nachforderungen/nachforderungStufen';

dayjs.extend(utc);

/**
 * Zulauf aus Nachforderungen im Meldebild (LLH-1384, Spec `kraeftebaum`, „Zulauf aus
 * Nachforderungen“; Herleitung `/mnt/project-files/llh-1021/llh-1384/design.md`) — rein.
 *
 * - Die **Zahl** ist die Menge, die zugesagt oder unterwegs ist (D2). Angefordert steht nur in der
 *   Notiz, ohne Plus: ein Bedarf, kein Zulauf. Eingetroffen, abgelehnt, zurückgezogen fehlen.
 * - Der Zulauf zählt **nicht** in Stärke, Einheiten oder Personal (D3): diese Datei liefert nur die
 *   Kennzahl des Statusbands und wird von keiner Stärkerechnung gelesen.
 * - **Menge** je Nachforderung: `anzahl`, ohne Anzahl 1, abzüglich der schon als Einheit
 *   übernommenen (`einheit_ids`), nie unter 0 (D4).
 * - **Ein Eintrag** je Art (getrimmt), Stufe und Eintreffen auf die Minute (D5); verstrichenes
 *   Eintreffen nach der Board-Regel `istUeberfaellig` trägt „überfällig“ und tönt `achtung` (D6).
 *
 * Bewusst ein kleiner Baustein nach dem heutigen Muster des Statusbands; der Dashboard-Baukasten
 * (LLH-1022/LLH-1140) löst ihn ab.
 */

export type ZulaufQuelle = Pick<
  Nachforderung,
  'art' | 'anzahl' | 'status' | 'eintreffen_erwartet_at' | 'einheit_ids'
>;

type ZulaufStufe = 'angefordert' | 'zugesagt' | 'unterwegs';

export interface ZulaufEintrag {
  art: string;
  stufe: ZulaufStufe;
  menge: number;
  /** Erwartetes Eintreffen (UTC) des ersten Eintrags der Gruppe; fehlt ohne Angabe. */
  eintreffen: string | null;
  ueberfaellig: boolean;
}

export interface ZulaufZelle {
  /** Menge zugesagt + unterwegs. */
  wert: number;
  /** Die Einträge als eine Zeile, der Zulauf vorn (die Notiz endet bei Platzmangel mit „…“). */
  notiz: string;
  ton: 'neutral' | 'achtung';
  eintraege: ZulaufEintrag[];
}

const STUFEN: ReadonlySet<string> = new Set<ZulaufStufe>(['angefordert', 'zugesagt', 'unterwegs']);

function menge(n: ZulaufQuelle): number {
  return Math.max(0, (n.anzahl ?? 1) - n.einheit_ids.length);
}

function minute(utcStr: string): number {
  return dayjs.utc(utcStr).startOf('minute').valueOf();
}

/** Folge (D5): Zulauf nach Eintreffen, ohne danach, unterwegs vor zugesagt; angefordert zuletzt. */
function vergleiche(a: ZulaufEintrag, b: ZulaufEintrag): number {
  const rang = (e: ZulaufEintrag) => (e.stufe === 'angefordert' ? 1 : 0);
  if (rang(a) !== rang(b)) return rang(a) - rang(b);
  const ta = a.eintreffen ? minute(a.eintreffen) : Number.POSITIVE_INFINITY;
  const tb = b.eintreffen ? minute(b.eintreffen) : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.stufe !== b.stufe) return a.stufe === 'unterwegs' ? -1 : 1;
  return a.art.localeCompare(b.art, 'de');
}

function eintragText(e: ZulaufEintrag, zeit: (utcStr: string) => string): string {
  if (e.stufe === 'angefordert') return `${e.menge} ${e.art} angefordert`;
  let text = `+${e.menge} ${e.art}`;
  if (e.stufe === 'unterwegs') text += ' unterwegs';
  if (e.eintreffen) text += `, Eintreffen ${zeit(e.eintreffen)}`;
  if (e.ueberfaellig) text += ' überfällig';
  return text;
}

/**
 * Die Kennzahl „Zulauf“ aus der Nachforderungsliste; `null`, wenn nichts angefordert, zugesagt
 * oder unterwegs ist. `jetzt` in ms (Seitenuhr), `zeit` formatiert ein Eintreffen für die Anzeige.
 */
export function zulaufBand(
  liste: readonly ZulaufQuelle[],
  jetzt: number,
  zeit: (utcStr: string) => string,
): ZulaufZelle | null {
  const gruppen = new Map<string, ZulaufEintrag>();
  for (const n of liste) {
    if (!STUFEN.has(n.status)) continue;
    const m = menge(n);
    if (m === 0) continue;
    const stufe = n.status as ZulaufStufe;
    const art = n.art.trim();
    // Ein Bedarf hat noch kein Eintreffen; ein verbliebenes nach einer Rücknahme zählt nicht.
    const eintreffen = stufe === 'angefordert' ? null : (n.eintreffen_erwartet_at ?? null);
    const schluessel = [art, stufe, eintreffen ? minute(eintreffen) : ''].join('\u0000');
    const ueberfaellig = istUeberfaellig(n, jetzt);
    const vorhanden = gruppen.get(schluessel);
    if (vorhanden) {
      vorhanden.menge += m;
      vorhanden.ueberfaellig ||= ueberfaellig;
    } else {
      gruppen.set(schluessel, { art, stufe, menge: m, eintreffen, ueberfaellig });
    }
  }
  if (gruppen.size === 0) return null;
  const eintraege = [...gruppen.values()].sort(vergleiche);
  return {
    wert: eintraege.reduce((s, e) => s + (e.stufe === 'angefordert' ? 0 : e.menge), 0),
    notiz: eintraege.map((e) => eintragText(e, zeit)).join(' · '),
    ton: eintraege.some((e) => e.ueberfaellig) ? 'achtung' : 'neutral',
    eintraege,
  };
}
