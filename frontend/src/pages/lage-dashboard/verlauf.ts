/**
 * Datenmodell des Paneels „Verlauf“ im Lagebild Sanitätsdienst (LLH-1574,
 * `/mnt/project-files/llh-1574/design.md` D3): Kontakte je volle Stunde der Anzeigezone,
 * gestapelt nach Anlass (LLH-1566). Rein.
 *
 * Festlegungen, jede im Test gepinnt:
 *  - **Festes Fenster von {@link VERLAUF_STUNDEN} Stunden, das mit der laufenden Stunde endet.**
 *    Ein junger Einsatz steht rechts, statt gedehnt; die Säulenbreite springt nie.
 *  - **Zuordnung nach `erfasst_at`**, dem Kontakt. Kontakt wie `anlassbild`: alle außer Vermissten.
 *  - **Vier Anlässe mit eigener Farbe, der Rest „Übrige“** (`theme/tokens.ts`,
 *    `anlassVerlaufFarben*`). Die Ablesung je Säule nennt trotzdem jeden Anlass einzeln.
 */
import dayjs from 'dayjs';
import type { Person, PersonAnlass } from '../../api/types';
import { inZone, type AnzeigeKonventionen } from '../../anzeige/format';
import { stunde as stundeDerZone } from '../../anzeige/zeitDarstellung';
import { ANLASS_REIHE, ANLASS_WORT } from '../../personen/personMeta';
import type { AnlassbildSchluessel } from '../../personen/personenBilanz';
import type { AnlassVerlaufTon } from '../../theme/tokens';
import { wireAlsEpoche } from './lagebild';

/** Breite des Fensters in Stunden. */
export const VERLAUF_STUNDEN = 12;

const STUNDE_MS = 60 * 60_000;

/** Stapelfolge von unten nach oben: die vier farbigen Anlässe, dann „Übrige“. */
export const VERLAUF_TOENE = [
  'verletzung',
  'internistisch',
  'intoxikation',
  'hitze_kaelte',
  'uebrige',
] as const satisfies readonly AnlassVerlaufTon[];

/** Der Ton eines Anlasses: vier eigene, alle anderen und „ohne Anlass“ grau. */
export function anlassTon(anlass: PersonAnlass | null | undefined): AnlassVerlaufTon {
  switch (anlass) {
    case 'verletzung':
    case 'internistisch':
    case 'intoxikation':
    case 'hitze_kaelte':
      return anlass;
    default:
      return 'uebrige';
  }
}

/** Wort eines Tons in der Legende. */
export const VERLAUF_TON_WORT: Record<AnlassVerlaufTon, string> = {
  verletzung: ANLASS_WORT.verletzung,
  internistisch: ANLASS_WORT.internistisch,
  intoxikation: ANLASS_WORT.intoxikation,
  hitze_kaelte: ANLASS_WORT.hitze_kaelte,
  uebrige: 'Übrige',
};

/** Eine Säule: Beginn der Stunde, ihre Beschriftung, Summe, je Ton und je Anlass. */
export interface VerlaufStunde {
  beginn: number;
  /** Stunde der Anzeigezone, zweistellig („14“). */
  stunde: string;
  gesamt: number;
  je: Record<AnlassVerlaufTon, number>;
  /** Für die Ablesung: jeder Anlass einzeln, „ohne“ zuletzt. */
  jeAnlass: Record<AnlassbildSchluessel, number>;
  /** Die Stunde läuft noch. */
  laufend: boolean;
}

export interface Verlauf {
  stunden: VerlaufStunde[];
  /** Kontakte im Fenster. */
  imFenster: number;
  /** Größte Säule; `null`, wenn das Fenster leer ist. Bei Gleichstand die jüngere. */
  spitze: VerlaufStunde | null;
}

function leereZaehlung<K extends string>(schluessel: readonly K[]): Record<K, number> {
  return Object.fromEntries(schluessel.map((k) => [k, 0])) as Record<K, number>;
}

/**
 * Kontakte je Stunde über die letzten {@link VERLAUF_STUNDEN} vollen Stunden der Anzeigezone,
 * die letzte ist die laufende. Kontakte vor dem Fenster oder mit unlesbarer Zeit zählen nicht. Rein.
 */
export function kontakteJeStunde(
  personen: readonly Pick<Person, 'status' | 'anlass' | 'erfasst_at'>[],
  jetzt: number,
  konv: AnzeigeKonventionen,
  stunden: number = VERLAUF_STUNDEN,
): Verlauf {
  // Beginn der laufenden Stunde in der Anzeigezone; Stundengrenzen sind dort und in UTC dieselben
  // Augenblicke, außer bei Zonen mit halbem Versatz — deshalb über die Zone.
  const jetztWire = dayjs(jetzt).utc().format('YYYY-MM-DD HH:mm:ss');
  const laufendBeginn = inZone(jetztWire, konv).startOf('hour').valueOf();
  const start = laufendBeginn - (stunden - 1) * STUNDE_MS;
  const saeulen: VerlaufStunde[] = Array.from({ length: stunden }, (_, i) => {
    const beginn = start + i * STUNDE_MS;
    return {
      beginn,
      stunde: stundeDerZone(dayjs(beginn), konv),
      gesamt: 0,
      je: leereZaehlung(VERLAUF_TOENE),
      jeAnlass: leereZaehlung<AnlassbildSchluessel>([...ANLASS_REIHE, 'ohne']),
      laufend: i === stunden - 1,
    };
  });
  let imFenster = 0;
  for (const p of personen) {
    if (p.status === 'vermisst' || !p.erfasst_at) continue;
    const t = wireAlsEpoche(p.erfasst_at);
    if (!Number.isFinite(t) || t < start || t > jetzt) continue;
    const s = saeulen[Math.min(stunden - 1, Math.floor((t - start) / STUNDE_MS))];
    s.gesamt++;
    s.je[anlassTon(p.anlass)]++;
    s.jeAnlass[p.anlass ?? 'ohne']++;
    imFenster++;
  }
  let spitze: VerlaufStunde | null = null;
  for (const s of saeulen) if (s.gesamt > 0 && s.gesamt >= (spitze?.gesamt ?? 0)) spitze = s;
  return { stunden: saeulen, imFenster, spitze };
}

/** Ablesung einer Säule: „14 Uhr: 9 Kontakte · Verletzung 4 · Internistisch 3 · ohne Anlass 2“. */
export function ablesung(s: VerlaufStunde): string {
  const kopf = `${s.stunde} Uhr${s.laufend ? ' (laufend)' : ''}: ${s.gesamt} ${
    s.gesamt === 1 ? 'Kontakt' : 'Kontakte'
  }`;
  const teile = ANLASS_REIHE.filter((a) => s.jeAnlass[a] > 0).map(
    (a) => `${ANLASS_WORT[a]} ${s.jeAnlass[a]}`,
  );
  if (s.jeAnlass.ohne > 0) teile.push(`ohne Anlass ${s.jeAnlass.ohne}`);
  return [kopf, ...teile].join(' · ');
}
