/**
 * Ablösung (LFH-647, LFH-660) — Live-Zufluss der Schichtliste, ohne Sprung unter dem Cursor
 * (Prüfliste Kriterium 12, Bedien-Leitlinie Festlegung 6, WCAG 3.2.5).
 *
 * Die Liste ist nach Fälligkeit geordnet, und die Ordnung legt der Server fest. Eine Schicht,
 * die eine ANDERE Person beginnt (oder die ein fremder Vollzug als Folgeschicht erzeugt),
 * landet deshalb an ihrem Fälligkeitsplatz — auch oberhalb der Karte, auf der gerade der
 * Cursor steht. Solche fremden Neuzugänge warten hinter dem Sammelbanner, bis er bedient wird.
 *
 * ANDERS ALS `Datensicht` UND DIE ETB-ZEITACHSE hängt die Schleuse hier NICHT am Fokus. Das
 * Akzeptanzkriterium („verschiebt keine sichtbare Karte, bis der Banner bedient wird") gilt
 * unbedingt, und eine Karte kann auch unter dem Mauszeiger stehen, ohne dass etwas fokussiert
 * ist. Die Liste ist klein (eine Karte je eingesetzter Einheit), ein stehendes Banner kostet
 * also kaum etwas.
 *
 * WAS SOFORT STEHT:
 * - **Eigene** Neuzugänge: die Ids aus den Antworten der eigenen Aufrufe (Beginnen,
 *   Folgeschicht eines Vollzugs, Rücknahme). `AbloesungAnzeige` trägt keinen Anleger, die
 *   Herkunft ist also nur hier bekannt. Die Id wird VOR der Invalidierung vorgemerkt; kommt
 *   der Datenstand über das Live-Ereignis schon vorher an, steht die Karte für diesen einen
 *   Moment hinter dem Banner und rückt mit der Vormerkung sofort nach.
 * - **Der Inhalt vorhandener Karten** (Einstufung, Ablöser, Rhythmus, Fälligkeit): er kommt
 *   immer aus den frischen Daten.
 *
 * DIE FOLGE IST EINGEFROREN, DER INHALT FRISCH (LFH-660, Muster der Zeilenschleuse in
 * `Datensicht`). Ändert eine andere Person Rhythmus oder Beginn einer Schicht oder die
 * Rhythmus-Vorgabe eines Abschnitts, rückt die Karte nach Server-Ordnung an einen neuen
 * Fälligkeitsplatz — und die Karten dazwischen sprängen unter dem Cursor. Eingefroren wird
 * dafür nicht eine Id-Liste, sondern der SORTIERSCHLÜSSEL je gezeigter Karte: die Fälligkeit,
 * nach der sie zuletzt eingeordnet wurde. Der Server ordnet `ORDER BY faellig_at, id`; nach
 * (eingefrorenem Schlüssel, Id) sortiert ergibt sich bei frischen Schlüsseln also genau seine
 * Ordnung, und ein eigener Neuzugang findet ohne Sonderlogik
 * seinen Platz zwischen den eingefrorenen. Verglichen wird als Zeichenkette, wie SQLite es tut
 * (das Wire-Format `YYYY-MM-DD HH:MM:SS` sortiert lexikographisch).
 *
 * WANN DIE FOLGE AUFTAUT:
 * - von selbst, wenn die frische Ordnung der gezeigten Karten mit der gezeigten übereinstimmt
 *   — dann werden die Schlüssel still nachgeführt, sichtbar ändert sich nichts;
 * - mit dem Banner und mit dem Ansichtswechsel (`freigegeben`), zusammen mit den
 *   zurückgehaltenen Neuzugängen;
 * - mit einer EIGENEN Änderung (`eingeordnet`), aber nur für die Karten, die sie betrifft:
 *   die eigene Rhythmusänderung ordnet diese eine Karte ein, die eigene Vorgabe die Schichten
 *   ihres Abschnitts. Zurückgehaltene fremde Neuzugänge bleiben dabei zurückgehalten.
 *
 * KRITERIUM 9 GEGEN KRITERIUM 12: Die Zeit allein ordnet nie um — die Einstufung ist monoton in
 * der Fälligkeit, und nach ihr sortiert der Server. Eine fällige Karte kann also nur durch eine
 * fremde Änderung unter einer planmäßigen stehen, und genau dann steht das Banner. Es nennt sie
 * („1 fällige Schicht rückt nach oben"), und die Karte selbst trägt ihre frische Einstufung
 * (Fläche, Rand, Wort). Unten gehalten wird sie also nie still, nur bis zum nächsten Klick.
 *
 * WAS SOFORT WEGFÄLLT: Entfallene (ein fremder Vollzug verschiebt die abgelöste Schicht nach
 * „abgelöst"). Eine nicht mehr vorhandene Karte kann man nicht zeigen — dieselbe Regel wie in
 * `Datensicht` und `etb/zeitachseModell.ts`. Sie verlässt dabei auch den gezeigten Stand:
 * bringt eine fremde Rücknahme sie zurück, ist sie wieder Zuwachs.
 *
 * NULL GEZEIGTE KARTEN HALTEN NICHTS ZURÜCK: ohne Karte steht kein Cursor über einer Karte,
 * und ein Leerzustand „Keine laufenden Schichten" neben einem Banner „1 neue Schicht" wäre
 * ein Widerspruch (dieselbe Falle, die `Datensicht` beim Einfrieren der leeren Ladeansicht
 * dokumentiert).
 */
import type { Dayjs } from 'dayjs';
import type { Abloesung } from '../api/types';
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

export interface Zuflussteilung {
  /** Die gerenderte Liste, in der gezeigten (eingefrorenen) Folge, mit frischem Inhalt. */
  sichtbar: Abloesung[];
  /** Fremde Neuzugänge hinter dem Banner. */
  zurueckgehalten: Abloesung[];
  /** Die Server-Ordnung der sichtbaren Karten weicht von der gezeigten ab. */
  umgeordnet: boolean;
}

/**
 * Teilt die laufenden Schichten (Server-Ordnung) in gezeigte und zurückgehaltene und ordnet
 * die gezeigten nach ihrem eingefrorenen Schlüssel.
 */
export function teileZufluss(laufende: readonly Abloesung[], stand: Zuflussstand): Zuflussteilung {
  const { gezeigt, eigene } = stand;
  const alles = { sichtbar: [...laufende], zurueckgehalten: [], umgeordnet: false };
  if (gezeigt == null) return alles;
  const server: Abloesung[] = [];
  const zurueckgehalten: Abloesung[] = [];
  for (const s of laufende) {
    if (gezeigt.has(s.id) || eigene.has(s.id)) server.push(s);
    else zurueckgehalten.push(s);
  }
  if (server.length === 0) return alles;
  // Zweitrang ist die Id, wie im `ORDER BY faellig_at, id` des Servers — NICHT die Position in
  // seiner Liste: bei gleicher eingefrorener Fälligkeit (in derselben Sekunde begonnene
  // Schichten, im Browser gemessen) fiele ein stabiles Sortieren sonst auf die NEUE Folge
  // zurück, und die fremd vorgezogene Karte spränge doch.
  const schluessel = (s: Abloesung) => gezeigt.get(s.id) ?? s.faellig_at;
  const sichtbar = [...server].sort((a, b) => {
    const ka = schluessel(a);
    const kb = schluessel(b);
    return ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
  });
  const umgeordnet = sichtbar.some((s, i) => s.id !== server[i].id);
  return { sichtbar, zurueckgehalten, umgeordnet };
}

/**
 * Der Stand nach einem Render: `gezeigt` wird die sichtbare Menge, sichtbar gewordene eigene
 * verlassen die Vormerkung. Stimmt die Folge mit der Server-Ordnung überein, werden die
 * Schlüssel still auf die frische Fälligkeit gezogen; weicht sie ab, bleiben sie stehen.
 * `null`, wenn sich nichts ändert — der Aufrufer setzt den Zustand im Render nach, und ohne
 * diesen Riegel liefe er in eine Schleife. Deshalb vergleicht er auch die SCHLÜSSEL, nicht nur
 * die Ids.
 */
export function nachgefuehrt(
  stand: Zuflussstand,
  sichtbar: readonly Abloesung[],
  umgeordnet: boolean,
): Zuflussstand | null {
  const alt = stand.gezeigt;
  const gezeigt = new Map(
    sichtbar.map((s) => [s.id, (umgeordnet && alt?.get(s.id)) || s.faellig_at] as const),
  );
  const eigene = new Set([...stand.eigene].filter((id) => !gezeigt.has(id)));
  const gleich =
    alt != null &&
    alt.size === gezeigt.size &&
    [...gezeigt].every(([id, schluessel]) => alt.get(id) === schluessel) &&
    eigene.size === stand.eigene.size;
  return gleich ? null : { gezeigt, eigene };
}

/** Banner bedient oder Ansicht gewechselt: die volle Menge wird gezeigt, nach frischer Folge. */
export function freigegeben(stand: Zuflussstand, laufende: readonly Abloesung[]): Zuflussstand {
  return { gezeigt: new Map(laufende.map((s) => [s.id, s.faellig_at])), eigene: stand.eigene };
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

/** Fällige Karten, über denen in der gezeigten Folge eine planmäßige steht. */
function faelligUntenGehalten(folge: readonly Abloesung[], jetzt: Dayjs): number {
  let planmaessigDarueber = false;
  let n = 0;
  for (const s of folge) {
    if (einstufungVon(s.faellig_at, jetzt) === 'planmaessig') planmaessigDarueber = true;
    else if (planmaessigDarueber) n += 1;
  }
  return n;
}

/**
 * Wortlaut des Banners. Eine zurückgehaltene Schicht kann fällig sein (fremde Rücknahme
 * eines alten Vollzugs, zurückdatierter Beginn) — dann nennt das Banner sie, damit sie nicht
 * still dahinter wartet (Prüfliste Kriterium 9). Dasselbe gilt für eine fällige Karte, die die
 * eingefrorene Folge unter einer planmäßigen hält (`umgeordnet`: die gezeigte Folge, wenn sie
 * von der Server-Ordnung abweicht, sonst `null`).
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
        : `Reihenfolge geändert, ${k === 1 ? '1 fällige Schicht rückt' : `${k} fällige Schichten rücken`} nach oben`,
    );
  }
  return teile.join(' · ');
}
