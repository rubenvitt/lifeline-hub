import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { ModulZaehler, Nachforderung, NachforderungStatus } from '../api/types';
import { NACHFORDERUNG_STATUS, prioRang } from '../kommunikation';

dayjs.extend(utc);

/**
 * Die Stufen der Nachforderung als Board (LLH-1078, Spec `nachforderungen-board`) — rein.
 *
 * - **Zählregel** {@link zaehleNachforderungen}: offen = angefordert + zugesagt + unterwegs, dazu
 *   die Zahl je offener Stufe. Dieselbe Regel zählt der Server für den Modulzähler
 *   (`src/einsatz/zaehler.rs:zaehle_nachforderungen`); das gemeinsame Fixture
 *   `tests/fixtures/verdichtung/regeln.json` hält beide gleich (`lage/verdichtungFixture.test.ts`).
 *   Modulpanel, Kopfzeile, Überblick und Vorbereitung lesen den Server-Zähler; die Spaltenköpfe
 *   des Boards zählen mit dieser Regel über die Karten, die sie zeigen.
 * - **Spalten** {@link boardSpalten}: eine je Stufe in fester Folge; „Eingetroffen“ zeigt die
 *   letzten {@link EINGETROFFEN_STUNDEN} h, ältere stehen darunter gesammelt.
 * - **Zeitzeilen** {@link kartenZeiten}: die Stelle, an der LLH-1097 das erwartete Eintreffen und
 *   „überfällig“ (Ton `achtung` mit Wort) einhängt.
 */

/** Die Stufen in der Folge der Spalten. */
export const STUFEN = [
  'angefordert',
  'zugesagt',
  'unterwegs',
  'eingetroffen',
  'abgelehnt',
] as const satisfies readonly NachforderungStatus[];

/** Die offenen Stufen; die übrigen sind abgeschlossen. */
export const OFFENE_STUFEN = ['angefordert', 'zugesagt', 'unterwegs'] as const;

/** Wie lange eine eingetroffene Nachforderung in ihrer Spalte vorn steht. */
export const EINGETROFFEN_STUNDEN = 12;
const EINGETROFFEN_FENSTER_MS = EINGETROFFEN_STUNDEN * 60 * 60 * 1000;

/** Was der Server zählt (`ModulZaehler.nachforderungen`), dieselben Felder. */
export type NachforderungsZahlen = NonNullable<ModulZaehler['nachforderungen']>;

/** Noch nicht eingetroffen und nicht abgelehnt — wie `ist_offen` der Liste. */
export function istOffen(status: NachforderungStatus): boolean {
  return status !== 'eingetroffen' && status !== 'abgelehnt';
}

/** Die Zählregel der offenen Nachforderungen je Stufe (Parität mit dem Server, Fixture). */
export function zaehleNachforderungen(
  liste: ReadonlyArray<Pick<Nachforderung, 'status'>>,
): NachforderungsZahlen {
  const z: NachforderungsZahlen = { offen: 0, angefordert: 0, zugesagt: 0, unterwegs: 0 };
  for (const n of liste) {
    if (!istOffen(n.status)) continue;
    z.offen += 1;
    if (n.status === 'angefordert') z.angefordert += 1;
    else if (n.status === 'zugesagt') z.zugesagt += 1;
    else if (n.status === 'unterwegs') z.unterwegs += 1;
  }
  return z;
}

/** Der sichtbare Name einer Stufe — derselbe Wortlaut wie das Statusetikett. */
export function stufeWort(stufe: NachforderungStatus): string {
  return NACHFORDERUNG_STATUS[stufe]?.label ?? stufe;
}

function ms(zeit: string): number {
  return dayjs.utc(zeit).valueOf();
}

/** Eingetroffen innerhalb der letzten 12 h (Grenze eingeschlossen). */
export function istKuerzlichEingetroffen(
  n: Pick<Nachforderung, 'status' | 'eingetroffen_at'>,
  jetzt: number,
): boolean {
  if (n.status !== 'eingetroffen') return false;
  // Ohne Zeitpunkt (Altbestand) bleibt sie vorn: verstecken hieße „nicht da“.
  if (!n.eingetroffen_at) return true;
  return jetzt - ms(n.eingetroffen_at) <= EINGETROFFEN_FENSTER_MS;
}

/**
 * Die Gruppe einer Karte im Board: ihre Stufe, eingetroffene älter als 12 h als eigene Gruppe.
 * Die Zuflussschleuse hält diese Gruppe fest, damit eine Karte unter dem Zeiger weder die Spalte
 * wechselt noch über die 12-h-Grenze aus dem Bild rutscht.
 */
export type BoardGruppe = NachforderungStatus | 'eingetroffen-aelter';

export function boardGruppe(n: Nachforderung, jetzt: number): BoardGruppe {
  if (n.status === 'eingetroffen' && !istKuerzlichEingetroffen(n, jetzt)) {
    return 'eingetroffen-aelter';
  }
  return n.status;
}

function abschluss(n: Nachforderung): string {
  return n.eingetroffen_at ?? n.abgelehnt_at ?? n.angefordert_at;
}

/**
 * Folge im Board: offene nach Priorität, dann die am längsten wartende zuerst; abgeschlossene mit
 * dem jüngsten Abschluss zuerst. Kennung als letzte Stufe, damit ein Neuabruf nichts umordnet.
 */
export function vergleicheImBoard(a: Nachforderung, b: Nachforderung): number {
  const stufe = STUFEN.indexOf(a.status) - STUFEN.indexOf(b.status);
  if (stufe !== 0) return stufe;
  if (istOffen(a.status)) {
    const rang = prioRang(a.prioritaet) - prioRang(b.prioritaet);
    if (rang !== 0) return rang;
    const alter = a.angefordert_at.localeCompare(b.angefordert_at);
    return alter !== 0 ? alter : a.id - b.id;
  }
  const zeit = abschluss(b).localeCompare(abschluss(a));
  return zeit !== 0 ? zeit : b.id - a.id;
}

export interface BoardSpalte {
  stufe: NachforderungStatus;
  /** Die Karten der Spalte. */
  karten: Nachforderung[];
  /** Nur „Eingetroffen“: die vor mehr als 12 h eingetroffenen, sonst leer. */
  aeltere: Nachforderung[];
}

/**
 * Die Spalten des Boards in fester Folge. `gruppeVon` erlaubt der Seite, eine gehaltene Gruppe
 * einzusetzen (Zuflussschleuse); die Folge der Eingabe bleibt innerhalb der Spalte erhalten.
 */
export function boardSpalten(
  geordnet: readonly Nachforderung[],
  gruppeVon: (n: Nachforderung) => BoardGruppe,
): BoardSpalte[] {
  const spalten = new Map<NachforderungStatus, BoardSpalte>(
    STUFEN.map((stufe) => [stufe, { stufe, karten: [], aeltere: [] }]),
  );
  for (const n of geordnet) {
    const g = gruppeVon(n);
    if (g === 'eingetroffen-aelter') spalten.get('eingetroffen')!.aeltere.push(n);
    else spalten.get(g)?.karten.push(n);
  }
  return STUFEN.map((stufe) => spalten.get(stufe)!);
}

/** Die erste Stufe mit Karten unter den offenen, sonst „Angefordert“ (Vorgabe am Handy). */
export function vorgabeStufe(spalten: readonly BoardSpalte[]): NachforderungStatus {
  return (
    OFFENE_STUFEN.find((s) => (spalten.find((x) => x.stufe === s)?.karten.length ?? 0) > 0) ??
    'angefordert'
  );
}

/** Eine Zeitzeile der Karte. `ton` bleibt bis LLH-1097 leer (ETA überschritten = „überfällig“). */
export interface KartenZeit {
  schluessel: string;
  text: string;
  ton?: 'achtung';
}

/**
 * Die Zeitzeilen einer Karte: angefordert (mit Person), zugesagt, unterwegs, eingetroffen — jede
 * nur, wenn ihr Zeitpunkt da ist (keine erfundenen Daten). Hier hängt LLH-1097 das erwartete
 * Eintreffen ein; bis dahin gibt es keine Zeile dafür.
 */
export function kartenZeiten(
  n: Pick<
    Nachforderung,
    'angefordert_at' | 'erstellt_von_name' | 'zugesagt_at' | 'unterwegs_at' | 'eingetroffen_at'
  >,
  formatZeit: (zeit: string) => string,
): KartenZeit[] {
  const zeilen: KartenZeit[] = [
    {
      schluessel: 'angefordert',
      text: `Angefordert: ${formatZeit(n.angefordert_at)}${n.erstellt_von_name ? ` · ${n.erstellt_von_name}` : ''}`,
    },
  ];
  if (n.zugesagt_at) {
    zeilen.push({ schluessel: 'zugesagt', text: `Zugesagt: ${formatZeit(n.zugesagt_at)}` });
  }
  if (n.unterwegs_at) {
    zeilen.push({ schluessel: 'unterwegs', text: `Unterwegs: ${formatZeit(n.unterwegs_at)}` });
  }
  if (n.eingetroffen_at) {
    zeilen.push({
      schluessel: 'eingetroffen',
      text: `Eingetroffen: ${formatZeit(n.eingetroffen_at)}`,
    });
  }
  return zeilen;
}

/** „5 offen · 2 unterwegs“ — die Kopfzeile der Seite und die Notiz im Überblick. */
export function offenText(z: Pick<NachforderungsZahlen, 'offen' | 'unterwegs'>): string {
  return `${z.offen} offen · ${z.unterwegs} unterwegs`;
}

/** „1 angefordert · 2 zugesagt · 2 unterwegs“ — Notiz der Vorbereitung. */
export function stufenText(z: NachforderungsZahlen): string {
  return `${z.angefordert} angefordert · ${z.zugesagt} zugesagt · ${z.unterwegs} unterwegs`;
}
