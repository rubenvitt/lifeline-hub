/**
 * Stand der geplanten Ablöser an der Karte einer laufenden Schicht (LLH-1131 Teil II, Spec
 * `kraefte-abloesung`, „Stand der ablösenden Einheit an der Karte“): „Ablösung: 2. Rettungsstaffel ·
 * alarmiert 1340 · eingetroffen 1412 · abgerufen 1425 (BR Sportplatz)“.
 *
 * Die Zeitpunkte kommen aus der Kräfte-Zeitachse des Ablösers, aus seiner offenen Einsatzperiode
 * (`EinheitPerioden`, wie `abloesung/ohneSchicht.ts` sie liest): alarmiert, wenn die Periode mit
 * der Alarmierung begann, eingetroffen mit ihrem Eintreffen (ohne Alarmierung ihr Beginn). Eine
 * beendete Periode zählt nicht.
 * Der Raum steht in Klammern, solange die Einheit in einem Bereitstellungsraum steht
 * (`aktueller_br_id` der Einheit, Name aus der Raumliste); ohne Namen fehlt die Klammer.
 * Abgerufen ist sie, solange die Raumliste sie unter `abrufe` führt (LLH-1309: das Abruf-Ereignis
 * der BR-Belegung, nach dem Ausrücken nicht mehr) und sie noch in genau diesem Raum steht: eine
 * zwischengespeicherte Raumliste kennt das Ausrücken nicht. Ohne Raumliste fehlt die Angabe.
 *
 * Welche Einheiten geplant sind, liest `abloeserIds` (Liste, ohne Liste der Spiegel). Der Client
 * rechnet keine Vererbung und kein „geplant“ nach (`frontend/src/kraefte/AGENTS.md`, „Ablösung“).
 *
 * Teilbaum (LLH-1509): Ist ein Verband geplant, zählen die Ereignisse seiner Untereinheiten mit,
 * je Art der früheste Zeitpunkt im Teilbaum. Welche Untereinheiten dazugehören, liefert der Server
 * am Ablöser (`untereinheiten`); der Client sucht sie nicht selbst über die Gliederung. Der Raum ist
 * der des gezeigten Abrufs, sonst der erste im Teilbaum (der Ablöser selbst zuerst).
 */
import type { Abloesung, EinheitPerioden } from '../api/types';
import { type AnzeigeKonventionen } from '../anzeige/format';
import { abloeserIds } from './abloeser';
import { zeitKurz } from '../anzeige/zeitDarstellung';

export interface AbloeserStand {
  einheit_id: number;
  einheit_name: string;
  /** Beginn der offenen Periode, wenn sie mit der Alarmierung begann (Wire-String). */
  alarmiert_at: string | null;
  eingetroffen_at: string | null;
  /** Abruf aus dem Raum, in dem die Einheit gerade steht (Wire-String). */
  abgerufen_at: string | null;
  /** Name des Bereitstellungsraums, in dem die Einheit gerade steht. */
  br_name: string | null;
}

/** Woraus der Stand gelesen wird; Einheiten und Räume sind optional (Modulfreigaben). */
export interface AbloeserStandQuellen {
  perioden: readonly EinheitPerioden[];
  einheiten?: readonly { id: number; aktueller_br_id?: number | null }[];
  brNamen?: ReadonlyMap<number, string>;
  /** Raum und Zeitpunkt des Abrufs je Einheit, aus `abrufe` der Raumliste. */
  abrufe?: ReadonlyMap<number, { br_id: number; seit_at: string }>;
}

/** Hat der Ablöser ein Ereignis (Alarmierung, Eintreffen oder Abruf)? */
export function hasAbloeserStand(s: AbloeserStand): boolean {
  return s.alarmiert_at != null || s.eingetroffen_at != null || s.abgerufen_at != null;
}

/** Der Abruf zählt nur im Raum, in dem die Einheit laut `aktueller_br_id` gerade steht. */
function abrufIm(
  abruf: { br_id: number; seit_at: string } | undefined,
  br: number | undefined,
): string | null {
  return abruf && br != null && abruf.br_id === br ? abruf.seit_at : null;
}

/** Der frühere zweier Wire-Strings (gleiches Format, daher lexikografisch); `null` zählt nicht. */
function frueher(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return b < a ? b : a;
}

/** Der Ablöser und seine Untereinheiten (vom Server), der Ablöser zuerst. */
function teilbaum(s: Abloesung, id: number): number[] {
  return [id, ...(s.abloeser.find((a) => a.einheit_id === id)?.untereinheiten ?? [])];
}

/** Name eines Ablösers aus Liste oder Spiegel. */
function abloeserName(s: Abloesung, id: number): string {
  return (
    s.abloeser.find((a) => a.einheit_id === id)?.einheit_name ??
    (s.abloesende_einheit_id === id ? (s.abloesende_einheit_name ?? '') : '')
  );
}

/**
 * Der Stand je geplantem Ablöser einer laufenden Schicht, in der Reihenfolge der Planung. `null`,
 * wenn die Schicht nicht läuft, keinen Ablöser hat oder keiner ein Ereignis trägt: dann bleibt die
 * Karte bei „Ablösung geplant durch …“.
 */
export function buildAbloeserStand(
  s: Abloesung,
  quellen: AbloeserStandQuellen,
): AbloeserStand[] | null {
  if (s.status !== 'laufend') return null;
  const ids = abloeserIds(s);
  if (ids.length === 0) return null;
  const offen = new Map<number, EinheitPerioden['perioden'][number]>();
  for (const { einheit_id, perioden } of quellen.perioden) {
    const letzte = perioden[perioden.length - 1];
    if (letzte && !letzte.ende_at) offen.set(einheit_id, letzte);
  }
  const brJeEinheit = new Map<number, number>();
  for (const e of quellen.einheiten ?? []) {
    if (e.aktueller_br_id != null) brJeEinheit.set(e.id, e.aktueller_br_id);
  }
  const stand = ids.map((id): AbloeserStand => {
    let alarmiert: string | null = null;
    let eingetroffen: string | null = null;
    let abgerufen: string | null = null;
    let abrufRaum: number | undefined;
    let ersterRaum: number | undefined;
    for (const k of teilbaum(s, id)) {
      const p = offen.get(k);
      const br = brJeEinheit.get(k);
      alarmiert = frueher(alarmiert, p && p.anker === 'alarmierung' ? p.beginn_at : null);
      // Begann die Periode mit dem Eintreffen, ist ihr Beginn das Eintreffen.
      eingetroffen = frueher(
        eingetroffen,
        p?.eintreffen_at ?? (p?.anker === 'eintreffen' ? p.beginn_at : null),
      );
      const abruf = abrufIm(quellen.abrufe?.get(k), br);
      if (abruf != null && (abgerufen == null || abruf < abgerufen)) {
        abgerufen = abruf;
        abrufRaum = br;
      }
      ersterRaum ??= br;
    }
    const raum = abrufRaum ?? ersterRaum;
    return {
      einheit_id: id,
      einheit_name: abloeserName(s, id),
      alarmiert_at: alarmiert,
      eingetroffen_at: eingetroffen,
      abgerufen_at: abgerufen,
      br_name: raum != null ? (quellen.brNamen?.get(raum) ?? null) : null,
    };
  });
  return stand.some(hasAbloeserStand) ? stand : null;
}

/** Ein Ablöser als Text: „2. Rettungsstaffel · alarmiert 1340 · eingetroffen 1412 · abgerufen 1425 (BR …)“. */
export function abloeserEintragText(s: AbloeserStand, konv: AnzeigeKonventionen): string {
  const teile = [s.einheit_name];
  if (s.alarmiert_at) teile.push(`alarmiert ${zeitKurz(s.alarmiert_at, konv)}`);
  if (s.eingetroffen_at) teile.push(`eingetroffen ${zeitKurz(s.eingetroffen_at, konv)}`);
  if (s.abgerufen_at) teile.push(`abgerufen ${zeitKurz(s.abgerufen_at, konv)}`);
  const text = teile.join(' · ');
  return s.br_name ? `${text} (${s.br_name})` : text;
}

/** Die ganze Kartenzeile, auch für den `title` (einzeilig, Ablöser mit „; “ getrennt). */
export function abloeserStandText(
  stand: readonly AbloeserStand[],
  konv: AnzeigeKonventionen,
): string {
  return `Ablösung: ${stand.map((s) => abloeserEintragText(s, konv)).join('; ')}`;
}
