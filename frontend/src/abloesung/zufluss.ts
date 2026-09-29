/**
 * Live-Zufluss der Schichtliste ohne Sprung unter dem Cursor (WCAG 3.2.5).
 *
 * Die Server-Ordnung ist die Fälligkeit; eine fremd begonnene Schicht landete auch oberhalb der
 * Karte unter dem Cursor. Fremde Neuzugänge warten deshalb hinter dem Sammelbanner. Anders als
 * bei `Datensicht` und der ETB-Zeitachse hängt die Schleuse NICHT am Fokus: eine Karte kann auch
 * unter dem Mauszeiger stehen, und die Liste ist klein.
 *
 * Sofort stehen eigene Neuzugänge (Ids aus den Antworten der eigenen Aufrufe, VOR der
 * Invalidierung vorgemerkt — `AbloesungAnzeige` trägt keinen Anleger) und der Inhalt
 * vorhandener Karten. Sofort weg sind entfallene Karten.
 *
 * DIE FOLGE IST EINGEFROREN, DER INHALT FRISCH: eingefroren wird der SORTIERSCHLÜSSEL je
 * gezeigter Karte (die Fälligkeit, nach der sie eingeordnet wurde). Sortiert nach (Schlüssel,
 * Id) wie `ORDER BY faellig_at, id` ergibt sich bei frischen Schlüsseln genau die
 * Server-Ordnung, und ein eigener Neuzugang findet ohne Sonderlogik seinen Platz. Verglichen
 * wird als Zeichenkette wie in SQLite.
 *
 * Die Folge taut auf: still, wenn die frische Ordnung der gezeigten entspricht; mit Banner oder
 * Ansichtswechsel (`freigegeben`); bei einer EIGENEN Änderung (`eingeordnet`) nur für die
 * betroffenen Karten.
 *
 * Die Zeit allein ordnet nie um (Einstufung monoton in der Fälligkeit). Steht eine fällige Karte
 * durch eine fremde Änderung unter einer milder eingestuften, nennt das Banner sie.
 *
 * Generisch über den Sortierschlüssel: die Verpflegung nutzt die `…Nach`-Varianten mit `von_at`.
 * Null gezeigte Karten halten nichts zurück — ein Leerzustand neben „1 neue Schicht" wäre ein
 * Widerspruch.
 */
import type { Dayjs } from 'dayjs';
import type { Abloesung, AbloesungEinstufung } from '../api/types';
import { einstufungVon, zaehleFaellige } from './einstufung';

export interface Zuflussstand {
  /**
   * Gezeigte Karten: Id → Fälligkeit, nach der die Karte eingeordnet ist (Wire-String).
   * `null` vor der ersten Lieferung.
   */
  gezeigt: ReadonlyMap<number, string> | null;
  /** Ids eigener Neuzugänge, die noch nicht gezeigt wurden. */
  eigene: ReadonlySet<number>;
}

export const LEERER_ZUFLUSSSTAND: Zuflussstand = { gezeigt: null, eigene: new Set() };

/** Was die Schleuse von einem Eintrag braucht: seine Kennung. */
interface MitId {
  id: number;
}

/** Sortierschlüssel eines Eintrags als Wire-String (lexikographisch sortierbar, wie in SQLite). */
export type Sortierschluessel<T> = (eintrag: T) => string;

const FAELLIGKEIT: Sortierschluessel<Abloesung> = (s) => s.faellig_at;

interface Zuflussteilung<T = Abloesung> {
  /** Die gerenderte Liste, in der gezeigten (eingefrorenen) Folge, mit frischem Inhalt. */
  sichtbar: T[];
  /** Fremde Neuzugänge hinter dem Banner. */
  zurueckgehalten: T[];
  /** Die Server-Ordnung der sichtbaren Karten weicht von der gezeigten ab. */
  umgeordnet: boolean;
}

/**
 * Teilt die laufenden Schichten (Server-Ordnung) in gezeigte und zurückgehaltene und ordnet
 * die gezeigten nach ihrem eingefrorenen Schlüssel.
 */
export function teileZuflussNach<T extends MitId>(
  laufende: readonly T[],
  stand: Zuflussstand,
  schluesselVon: Sortierschluessel<T>,
): Zuflussteilung<T> {
  const { gezeigt, eigene } = stand;
  const alles: Zuflussteilung<T> = {
    sichtbar: [...laufende],
    zurueckgehalten: [],
    umgeordnet: false,
  };
  if (gezeigt == null) return alles;
  const server: T[] = [];
  const zurueckgehalten: T[] = [];
  for (const s of laufende) {
    if (gezeigt.has(s.id) || eigene.has(s.id)) server.push(s);
    else zurueckgehalten.push(s);
  }
  if (server.length === 0) return alles;
  // Zweitrang ist die Id wie im `ORDER BY faellig_at, id` — NICHT die Position in der Liste: bei
  // gleicher eingefrorener Fälligkeit fiele ein stabiles Sortieren sonst auf die NEUE Folge zurück.
  const schluessel = (s: T) => gezeigt.get(s.id) ?? schluesselVon(s);
  const sichtbar = [...server].sort((a, b) => {
    const ka = schluessel(a);
    const kb = schluessel(b);
    return ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
  });
  const umgeordnet = sichtbar.some((s, i) => s.id !== server[i].id);
  return { sichtbar, zurueckgehalten, umgeordnet };
}

/** Ablösung: Sortierschlüssel ist die Fälligkeit. */
export function teileZufluss(laufende: readonly Abloesung[], stand: Zuflussstand): Zuflussteilung {
  return teileZuflussNach(laufende, stand, FAELLIGKEIT);
}

/**
 * Der Stand nach einem Render: `gezeigt` wird die sichtbare Menge, sichtbar gewordene eigene
 * verlassen die Vormerkung. Stimmt die Folge mit der Server-Ordnung überein, werden die
 * Schlüssel still nachgezogen. `null`, wenn sich nichts ändert — der Aufrufer setzt den Zustand
 * im Render nach und liefe sonst in eine Schleife; deshalb werden auch die SCHLÜSSEL verglichen.
 */
export function nachgefuehrtNach<T extends MitId>(
  stand: Zuflussstand,
  sichtbar: readonly T[],
  umgeordnet: boolean,
  schluesselVon: Sortierschluessel<T>,
): Zuflussstand | null {
  const alt = stand.gezeigt;
  const gezeigt = new Map(
    sichtbar.map((s) => [s.id, (umgeordnet && alt?.get(s.id)) || schluesselVon(s)] as const),
  );
  const eigene = new Set([...stand.eigene].filter((id) => !gezeigt.has(id)));
  const gleich =
    alt != null &&
    alt.size === gezeigt.size &&
    [...gezeigt].every(([id, schluessel]) => alt.get(id) === schluessel) &&
    eigene.size === stand.eigene.size;
  return gleich ? null : { gezeigt, eigene };
}

/** Ablösung: Sortierschlüssel ist die Fälligkeit. */
export function nachgefuehrt(
  stand: Zuflussstand,
  sichtbar: readonly Abloesung[],
  umgeordnet: boolean,
): Zuflussstand | null {
  return nachgefuehrtNach(stand, sichtbar, umgeordnet, FAELLIGKEIT);
}

/** Banner bedient oder Ansicht gewechselt: die volle Menge wird gezeigt, nach frischer Folge. */
export function freigegebenNach<T extends MitId>(
  stand: Zuflussstand,
  laufende: readonly T[],
  schluesselVon: Sortierschluessel<T>,
): Zuflussstand {
  return { gezeigt: new Map(laufende.map((s) => [s.id, schluesselVon(s)])), eigene: stand.eigene };
}

/** Ablösung: Sortierschlüssel ist die Fälligkeit. */
export function freigegeben(stand: Zuflussstand, laufende: readonly Abloesung[]): Zuflussstand {
  return freigegebenNach(stand, laufende, FAELLIGKEIT);
}

/**
 * Eine eigene Änderung ordnet die genannten Karten an ihren frischen Platz. Nur schon gezeigte
 * — eine zurückgehaltene fremde Schicht wird dadurch nicht freigegeben.
 */
export function eingeordnet(stand: Zuflussstand, schichten: readonly Abloesung[]): Zuflussstand {
  if (stand.gezeigt == null) return stand;
  const gezeigt = new Map(stand.gezeigt);
  for (const s of schichten) if (gezeigt.has(s.id)) gezeigt.set(s.id, s.faellig_at);
  return { ...stand, gezeigt };
}

const DRINGLICHKEIT: Record<AbloesungEinstufung, number> = {
  planmaessig: 0,
  vorwarnung: 1,
  ueberfaellig: 2,
};

/**
 * Fällige Karten, über denen in der gezeigten Folge eine MILDER eingestufte steht — eine
 * überfällige unter einer in der Vorwarnzeit zählt also mit, zwei Vorwarnungen untereinander
 * nicht.
 */
function faelligUntenGehalten(folge: readonly Abloesung[], jetzt: Dayjs): number {
  let mildesteDarueber = Infinity;
  let n = 0;
  for (const s of folge) {
    const stufe = DRINGLICHKEIT[einstufungVon(s.faellig_at, jetzt)];
    if (stufe > 0 && mildesteDarueber < stufe) n += 1;
    mildesteDarueber = Math.min(mildesteDarueber, stufe);
  }
  return n;
}

/**
 * Wortlaut des Banners. Eine zurückgehaltene oder durch die eingefrorene Folge unten gehaltene
 * fällige Schicht wird genannt, damit sie nicht still wartet (`umgeordnet`: die gezeigte Folge,
 * wenn sie von der Server-Ordnung abweicht, sonst `null`).
 */
export function zuflussText(
  zurueckgehalten: readonly Abloesung[],
  jetzt: Dayjs,
  umgeordnet: readonly Abloesung[] | null = null,
): string {
  const teile: string[] = [];
  const n = zurueckgehalten.length;
  if (n > 0) {
    const basis = n === 1 ? '1 neue Schicht' : `${n} neue Schichten`;
    const faellig = zaehleFaellige(zurueckgehalten, jetzt);
    teile.push(faellig > 0 ? `${basis}, davon ${faellig} fällig` : basis);
  }
  if (umgeordnet) {
    const k = faelligUntenGehalten(umgeordnet, jetzt);
    teile.push(
      k === 0
        ? 'Reihenfolge geändert'
        : `Reihenfolge geändert, ${k === 1 ? '1 fällige Schicht steht' : `${k} fällige Schichten stehen`} weiter unten`,
    );
  }
  return teile.join(' · ');
}
