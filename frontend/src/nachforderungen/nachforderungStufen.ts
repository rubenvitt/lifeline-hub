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
 * - **Zeitzeilen** {@link kartenZeiten}: dazu das erwartete Eintreffen einer Zusage (LLH-1097 D7),
 *   im Ton `achtung`, sobald es verstrichen ist ({@link istUeberfaellig}) oder nach „benötigt bis“
 *   liegt. „überfällig“ zählt nur der Client, ohne Alarm ({@link zaehleUeberfaellig}).
 */

/** Die Stufen in der Folge der Spalten. */
export const STUFEN = [
  'angefordert',
  'zugesagt',
  'unterwegs',
  'eingetroffen',
  'abgelehnt',
  'zurueckgezogen',
] as const satisfies readonly NachforderungStatus[];

/** Die offenen Stufen; die übrigen sind abgeschlossen. */
export const OFFENE_STUFEN = ['angefordert', 'zugesagt', 'unterwegs'] as const;

/** Wie lange eine eingetroffene Nachforderung in ihrer Spalte vorn steht. */
export const EINGETROFFEN_STUNDEN = 12;
const EINGETROFFEN_FENSTER_MS = EINGETROFFEN_STUNDEN * 60 * 60 * 1000;

/** Was der Server zählt (`ModulZaehler.nachforderungen`), dieselben Felder. */
export type NachforderungsZahlen = NonNullable<ModulZaehler['nachforderungen']>;

/** Die abgeschlossenen Stufen ohne Eintreffen: eingeklappte Spalten neben dem Board. */
export const EINGEKLAPPTE_STUFEN = ['abgelehnt', 'zurueckgezogen'] as const;
export type EingeklappteStufe = (typeof EINGEKLAPPTE_STUFEN)[number];

/** Weder eingetroffen noch abgelehnt noch zurückgezogen — wie `ist_offen` der Liste. */
export function istOffen(status: NachforderungStatus): boolean {
  return status !== 'eingetroffen' && status !== 'abgelehnt' && status !== 'zurueckgezogen';
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
  return n.eingetroffen_at ?? n.abgelehnt_at ?? n.zurueckgezogen_at ?? n.angefordert_at;
}

/**
 * Eine Zusage, deren erwartetes Eintreffen verstrichen ist (LLH-1097 D7): zugesagt oder unterwegs,
 * mit Eintreffen vor `jetzt` (Minutentakt der Seite). Kein Alarm: Etikett und Zähler im Board.
 */
export function istUeberfaellig(
  n: Pick<Nachforderung, 'status' | 'eintreffen_erwartet_at'>,
  jetzt: number,
): boolean {
  if (n.status !== 'zugesagt' && n.status !== 'unterwegs') return false;
  return !!n.eintreffen_erwartet_at && ms(n.eintreffen_erwartet_at) < jetzt;
}

/** Wie viele der Karten überfällig sind — der Zähler über dem Board. */
export function zaehleUeberfaellig(
  liste: ReadonlyArray<Pick<Nachforderung, 'status' | 'eintreffen_erwartet_at'>>,
  jetzt: number,
): number {
  return liste.filter((n) => istUeberfaellig(n, jetzt)).length;
}

/** Das erwartete Eintreffen liegt nach der Bedarfszeit (LLH-1089 „Wo LLH-1097 einhängt“). */
export function istNachBedarfszeit(
  n: Pick<Nachforderung, 'eintreffen_erwartet_at' | 'benoetigt_bis'>,
): boolean {
  return (
    !!n.eintreffen_erwartet_at &&
    !!n.benoetigt_bis &&
    ms(n.eintreffen_erwartet_at) > ms(n.benoetigt_bis)
  );
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

/** Eine Zeitzeile der Karte; `achtung` trägt das erwartete Eintreffen, wenn es nicht mehr passt. */
export interface KartenZeit {
  schluessel: string;
  text: string;
  ton?: 'achtung';
}

/**
 * Die Zeitzeilen einer Karte: angefordert (mit Person), benötigt bis (LLH-1089), zugesagt,
 * erwartetes Eintreffen (LLH-1097 D7/D11), unterwegs, eingetroffen — jede nur, wenn ihr Zeitpunkt
 * da ist (keine erfundenen Daten). Das erwartete Eintreffen steht nur, solange die Zusage läuft
 * (zugesagt, unterwegs), im Ton `achtung`, wenn es verstrichen ist (`jetzt`) oder nach der
 * Bedarfszeit liegt; dann mit „· nach Bedarfszeit“.
 */
export function kartenZeiten(
  n: Pick<
    Nachforderung,
    | 'status'
    | 'angefordert_at'
    | 'erstellt_von_name'
    | 'benoetigt_bis'
    | 'zugesagt_at'
    | 'eintreffen_erwartet_at'
    | 'unterwegs_at'
    | 'eingetroffen_at'
  >,
  zeitpunkt: (zeit: string) => string,
  jetzt?: number,
): KartenZeit[] {
  const zeilen: KartenZeit[] = [
    {
      schluessel: 'angefordert',
      text: `Angefordert: ${zeitpunkt(n.angefordert_at)}${n.erstellt_von_name ? ` · ${n.erstellt_von_name}` : ''}`,
    },
  ];
  if (n.benoetigt_bis) {
    zeilen.push({ schluessel: 'benoetigt', text: `Benötigt bis: ${zeitpunkt(n.benoetigt_bis)}` });
  }
  if (n.zugesagt_at) {
    zeilen.push({ schluessel: 'zugesagt', text: `Zugesagt: ${zeitpunkt(n.zugesagt_at)}` });
  }
  if (n.eintreffen_erwartet_at && (n.status === 'zugesagt' || n.status === 'unterwegs')) {
    const nachBedarf = istNachBedarfszeit(n);
    const verstrichen = jetzt != null && istUeberfaellig(n, jetzt);
    zeilen.push({
      schluessel: 'erwartet',
      text: `Eintreffen erwartet: ${zeitpunkt(n.eintreffen_erwartet_at)}${nachBedarf ? ' · nach Bedarfszeit' : ''}`,
      ...(nachBedarf || verstrichen ? { ton: 'achtung' as const } : {}),
    });
  }
  if (n.unterwegs_at) {
    zeilen.push({ schluessel: 'unterwegs', text: `Unterwegs: ${zeitpunkt(n.unterwegs_at)}` });
  }
  if (n.eingetroffen_at) {
    zeilen.push({
      schluessel: 'eingetroffen',
      text: `Eingetroffen: ${zeitpunkt(n.eingetroffen_at)}`,
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
