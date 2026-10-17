import type { Dayjs } from 'dayjs';
import { inZone } from './format';
import { tagesgrenzen } from './uhrzeit';
import { alsBackendZeit, alsZeitpunkt, heuteInZone } from './zeitEingabe';

/**
 * Zeitfenster-Schnellwahl einer zeitlich gefilterten Liste (LLH-1080, Spec `etb-filterleiste`,
 * „Zeitraum mit Schnellwahl“). Rein und ohne Uhr: `jetzt` kommt vom Aufrufer (Serveruhr).
 *
 * **Absolute Grenzen** (Entscheidung Ruben, 17.10.2026): eine Wahl rechnet sofort in `von` (und
 * ggf. `bis`) um und schreibt diese in die Adresse. Link, Druck und Bildschirm zeigen so dieselbe
 * Menge, und es gibt nur EINE Zeitlogik (`parseEtbFilter`). Die Beschriftung liest die Grenzen
 * und erkennt „Heute“ und „seit LB“ durch Vergleich wieder — auch nach Neuladen oder aus einem
 * geteilten Link.
 *
 * Der Beginn liegt auf der vollen Minute: die Beschriftung sagt „seit 1345“, ein Eintrag um
 * 13:45:10 gehört dazu. Die Tabelle der Zeitfelder (`zeitSchnellwahl.ts`, Feldarten) ist eine
 * andere Frage und bleibt unberührt; die Lagemeldungen können diese hier später übernehmen.
 */

export type ZeitfensterArt = 'stunde' | 'vierStunden' | 'seitLb' | 'heute';

export const ZEITFENSTER_LABEL: Record<ZeitfensterArt, string> = {
  stunde: 'Letzte Stunde',
  vierStunden: 'Letzte 4 Stunden',
  seitLb: 'Seit letzter Lagebesprechung',
  heute: 'Heute',
};

/** Die angebotenen Fenster, in dieser Folge; die Lagebesprechung nur, wenn es eine gibt. */
export function zeitfensterArten({ mitLb }: { mitLb: boolean }): ZeitfensterArt[] {
  return mitLb ? ['stunde', 'vierStunden', 'seitLb', 'heute'] : ['stunde', 'vierStunden', 'heute'];
}

export interface Zeitbezug {
  /** Jetzt nach der Serveruhr. */
  jetzt: Dayjs;
  /** Anzeigezone des Einsatzes. */
  zone: string | null | undefined;
  /** `abgehalten_at` der letzten Lagebesprechung (Wire, UTC), falls bekannt und freigegeben. */
  letzteLb?: string | null;
}

/** Grenzen einer Wahl im Wire-Format, oder `null`, wenn sie nicht gilt (keine Lagebesprechung). */
export function zeitfensterWahl(
  art: ZeitfensterArt,
  { jetzt, zone, letzteLb }: Zeitbezug,
): { von: string } | null {
  const minute = jetzt.utc().startOf('minute');
  switch (art) {
    case 'stunde':
      return { von: alsBackendZeit(minute.subtract(1, 'hour')) };
    case 'vierStunden':
      return { von: alsBackendZeit(minute.subtract(4, 'hour')) };
    case 'heute':
      return { von: alsBackendZeit(tagesgrenzen(heuteInZone(zone, jetzt), zone).von) };
    case 'seitLb':
      return letzteLb ? { von: letzteLb } : null;
  }
}

/**
 * „1345“ am selben Tag wie jetzt, sonst „161345“ — taktisch, ohne Sekunden. „Heute“ nach der
 * Serveruhr des Bezugs, nie nach der Geräteuhr: die Beschriftung kippte sonst an einer anderen
 * Mitternacht als die Wahl.
 */
export function taktisch(wire: string, { jetzt, zone }: Pick<Zeitbezug, 'jetzt' | 'zone'>): string {
  const d = inZone(wire, { zeitzone: zone });
  const heute = inZone(alsBackendZeit(jetzt), { zeitzone: zone });
  return d.isSame(heute, 'day') ? d.format('HHmm') : d.format('DDHHmm');
}

/**
 * Was das Bedienziel „Zeitraum“ zeigt: „Zeitraum“ (leer), „Heute“, „seit LB 1330“, „seit 1345“,
 * „1000–1100“ oder „bis 1100“. Ohne Sekunden.
 */
export function zeitraumBeschriftung(
  grenzen: { von?: string; bis?: string },
  bezug: Zeitbezug,
): string {
  const { von, bis } = grenzen;
  if (!von && !bis) return 'Zeitraum';
  if (von && !bis) {
    const heute = zeitfensterWahl('heute', bezug)?.von;
    if (heute && gleich(von, heute)) return 'Heute';
    if (bezug.letzteLb && gleich(von, bezug.letzteLb)) return `seit LB ${taktisch(von, bezug)}`;
    return `seit ${taktisch(von, bezug)}`;
  }
  if (!von) return `bis ${taktisch(bis!, bezug)}`;
  return `${taktisch(von, bezug)}–${taktisch(bis!, bezug)}`;
}

function gleich(a: string, b: string): boolean {
  const x = alsZeitpunkt(a);
  const y = alsZeitpunkt(b);
  return x != null && y != null && x.isSame(y);
}
