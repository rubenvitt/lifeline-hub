/**
 * Reine Einordnung der Wetterteile der Modulseite „Wetter & Pegel" (LFH-633, design.md D2).
 *
 * Arbeitsteilung wie beim Pegel (LFH-606): die OBERGRENZE, ab der ein Stand gar nicht mehr
 * taugt (6 h Warnungen, 12 h Vorhersage), prüft das Backend — nur es kennt das Cache-Alter —
 * und meldet dann `ausfall`. Ob ein Stand „veraltet" ist, entscheidet diese Datei gegen die
 * Uhr der Anzeige, aus `abgerufen_at` (letzter erfolgreicher Abruf, RFC 3339).
 *
 * Die Eingabetypen sind strukturell, damit die Datei nicht an den Namen der generierten
 * Wire-Typen hängt, sondern nur an den Feldern, die sie liest.
 */
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import { PEGEL_STAND_UNBEKANNT, VERALTET, standZeit } from '../pegel/pegelKennzahl';

export type WetterTeilName = 'warnungen' | 'vorhersage';

/** Ab diesem Alter des letzten Abrufs ist ein Teil „veraltet" (Spec „Datenstand"). */
export const VERALTET_AB_MS: Record<WetterTeilName, number> = {
  // Bright Sky erneuert Warnungen minütlich; der Abruf läuft alle 5 min.
  warnungen: 30 * 60_000,
  // MOSMIX wird stündlich gerechnet; der Abruf läuft alle 30 min.
  vorhersage: 3 * 60 * 60_000,
};

export { PEGEL_STAND_UNBEKANNT as STAND_UNBEKANNT, VERALTET };

export type TeilStandArt = 'aktuell' | 'veraltet' | 'unbekannt' | 'kein_ort';

export interface TeilStand {
  art: TeilStandArt;
  /** „Stand 14:25" · „Stand unbekannt" · `null` bei fehlendem Einsatzort. */
  stand: string | null;
}

/** Zustand eines Teils. Unlesbares oder fehlendes `abgerufen_at` bei `ok` zählt als
 *  unbekannt — ein Stand ohne Zeitpunkt ist keiner. Rein. */
export function teilStand(
  teil: { zustand: string; abgerufen_at?: string | null },
  name: WetterTeilName,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): TeilStand {
  if (teil.zustand === 'kein_ort') return { art: 'kein_ort', stand: null };
  const epoche = teil.abgerufen_at ? Date.parse(teil.abgerufen_at) : Number.NaN;
  if (teil.zustand !== 'ok' || !Number.isFinite(epoche)) {
    return { art: 'unbekannt', stand: PEGEL_STAND_UNBEKANNT };
  }
  const stand = `Stand ${standZeit(teil.abgerufen_at as string, jetzt, konv)}`;
  return { art: jetzt - epoche > VERALTET_AB_MS[name] ? 'veraltet' : 'aktuell', stand };
}

/**
 * „gilt jetzt" (Beginn ≤ jetzt oder unbekannt) gegen „angekündigt". Die Reihenfolge der
 * Eingabe (Backend: Stufe absteigend, dann Beginn) bleibt in beiden Hälften erhalten. Rein.
 */
export function teileWarnungen<W extends { beginn?: string | null }>(
  warnungen: readonly W[],
  jetzt: number,
): { giltJetzt: W[]; angekuendigt: W[] } {
  const giltJetzt: W[] = [];
  const angekuendigt: W[] = [];
  for (const w of warnungen) {
    const t = w.beginn ? Date.parse(w.beginn) : Number.NaN;
    (Number.isFinite(t) && t > jetzt ? angekuendigt : giltJetzt).push(w);
  }
  return { giltJetzt, angekuendigt };
}

const DREI_STUNDEN_MS = 3 * 60 * 60_000;
const TAG_MS = 24 * 60 * 60_000;

/**
 * Jede dritte Stunde ab der ersten, innerhalb von 24 h — gezählt nach ZEIT, nicht nach
 * Index: fehlt in der Reihe eine Stunde, verrutscht der Takt sonst unbemerkt. Rein.
 */
export function dreiStundenTakt<S extends { zeitpunkt: string }>(stunden: readonly S[]): S[] {
  const erste = stunden.length ? Date.parse(stunden[0].zeitpunkt) : Number.NaN;
  if (!Number.isFinite(erste)) return [];
  return stunden.filter((s) => {
    const abstand = Date.parse(s.zeitpunkt) - erste;
    return abstand >= 0 && abstand < TAG_MS && abstand % DREI_STUNDEN_MS === 0;
  });
}

const RICHTUNGEN = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as const;

/** Windrichtung in Grad → eine von acht Himmelsrichtungen (Herkunft des Windes). Rein. */
export function himmelsrichtung(grad: number | null | undefined): string | null {
  if (grad == null || !Number.isFinite(grad)) return null;
  const normiert = ((grad % 360) + 360) % 360;
  return RICHTUNGEN[Math.round(normiert / 45) % 8];
}
