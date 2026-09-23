/**
 * Reine Einordnung der Wetterteile der Modulseite „Wetter & Pegel" (LFH-633, design.md D2).
 *
 * Arbeitsteilung wie beim Pegel (LFH-606): das Backend prüft beim Antworten die OBERGRENZE,
 * ab der ein Stand gar nicht mehr taugt (6 h Warnungen, 12 h Vorhersage), und meldet dann
 * `ausfall`. Ob ein Stand „veraltet" ist, entscheidet diese Datei gegen die Uhr der Anzeige,
 * aus `abgerufen_at` (letzter erfolgreicher Abruf, RFC 3339) — und sie prüft die Obergrenze
 * NOCH EINMAL: kommt keine neue Antwort (Rechner offline, aus dem Ruhezustand geweckt), hält
 * die Abfrage ihre alten Daten, und die Prüfung des Backends greift nie. Aus demselben Grund
 * fallen abgelaufene Warnungen und vergangene Vorhersagestunden hier noch einmal heraus.
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

/** Ab diesem Alter ist ein Stand „Stand unbekannt" — dieselben Grenzen wie im Backend
 *  (`wetter::abruf`, OBERGRENZE_*), hier gegen die Uhr der Anzeige. */
export const OBERGRENZE_MS: Record<WetterTeilName, number> = {
  warnungen: 6 * 60 * 60_000,
  vorhersage: 12 * 60 * 60_000,
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
  const alter = jetzt - epoche;
  if (alter > OBERGRENZE_MS[name]) return { art: 'unbekannt', stand: PEGEL_STAND_UNBEKANNT };
  const stand = `Stand ${standZeit(teil.abgerufen_at as string, jetzt, konv)}`;
  return { art: alter > VERALTET_AB_MS[name] ? 'veraltet' : 'aktuell', stand };
}

/**
 * „gilt jetzt" (Beginn ≤ jetzt oder unbekannt) gegen „angekündigt". Eine Warnung, deren Ende
 * verstrichen ist (`ende ≤ jetzt`, dieselbe Grenze wie `quelle::gueltige` im Backend), fällt
 * heraus — die Abfrage läuft alle 5 min, die Uhr alle 30 s. Die Reihenfolge der Eingabe
 * (Backend: Stufe absteigend, dann Beginn) bleibt in beiden Hälften erhalten. Rein.
 */
export function teileWarnungen<W extends { beginn?: string | null; ende?: string | null }>(
  warnungen: readonly W[],
  jetzt: number,
): { giltJetzt: W[]; angekuendigt: W[] } {
  const giltJetzt: W[] = [];
  const angekuendigt: W[] = [];
  for (const w of warnungen) {
    const ende = w.ende ? Date.parse(w.ende) : Number.NaN;
    if (Number.isFinite(ende) && ende <= jetzt) continue;
    const t = w.beginn ? Date.parse(w.beginn) : Number.NaN;
    (Number.isFinite(t) && t > jetzt ? angekuendigt : giltJetzt).push(w);
  }
  return { giltJetzt, angekuendigt };
}

const DREI_STUNDEN_MS = 3 * 60 * 60_000;
const TAG_MS = 24 * 60 * 60_000;

const STUNDE_MS = 60 * 60_000;

/**
 * Jede dritte Stunde ab der laufenden, innerhalb von 24 h — gezählt nach ZEIT, nicht nach
 * Index: fehlt in der Reihe eine Stunde, verrutscht der Takt sonst unbemerkt. Stunden VOR der
 * laufenden fallen heraus, auch wenn seit dem letzten Abruf eine volle Stunde verstrichen ist
 * (dieselbe Regel wie `quelle::kommende_stunden` im Backend). Rein.
 */
export function dreiStundenTakt<S extends { zeitpunkt: string }>(
  alle: readonly S[],
  jetzt: number,
): S[] {
  const laufende = Math.floor(jetzt / STUNDE_MS) * STUNDE_MS;
  const stunden = alle.filter((s) => Date.parse(s.zeitpunkt) >= laufende);
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
