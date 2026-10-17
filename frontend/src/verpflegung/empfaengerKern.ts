/**
 * Empfänger einer Ausgabe — reiner Kern der Anzeige (LLH-1055 Teil II, Entscheidung LLH-1024 F3,
 * Spec `kraefte-verpflegung`, „Empfänger einer Ausgabe“ und „Noch nicht verpflegt“).
 *
 * Empfänger ist höchstens EINER: eine Einheit (Abholung, steht für ihren Teilbaum) oder ein
 * Abschnitt (Zuführung), nie eine Person. Namen, Gliederung, Stärke und Eintreffen kommen allein
 * aus der Projektion `empfaenger` in `GET …/verpflegung`, nie aus `GET …/einheiten` (das Gerät
 * darf es nicht lesen).
 *
 * {@link verpflegungsstand} leitet je Zeitfenster ab, wer noch nicht verpflegt ist. Der Server
 * liefert keine solche Liste, weil nur der Client die vorgemerkten Ausgaben kennt:
 *
 * - **verpflegt** ist eine Einheit, an die oder an deren Über-Einheit eine gültige (nicht
 *   zurückgenommene) Ausgabe dieses Zeitfensters ging. Unter „verpflegt“ stehen nur die direkten
 *   Empfänger, mit Menge und Zeit; die Untereinheiten nennt ihre Zahl.
 * - **noch nicht verpflegt** sind die übrigen nicht aufgelösten Einheiten mit Eintreffen, außer
 *   sie sind erst nach dem Ende des Zeitfensters eingetroffen.
 * - **ohne Eintreffen** stehen gesondert: ohne Zeitachsen-Ereignis wird nicht geraten, ob die
 *   Einheit im Einsatz war (`frontend/AGENTS.md`, „Keine erfundenen Daten“).
 * - Eine **Zuführung** an einen Abschnitt verpflegt keine Einheit: sie sagt nicht, wer gegessen
 *   hat. Die Zeilen der Einheiten im Abschnitt (oder darunter) nennen sie.
 * - **anderswo verpflegt** (LLH-1048, Entscheidung LLH-1024 F7): ein an eine Verpflegungsstelle
 *   gebundenes Gerät sieht nur die Ausgaben seiner Stelle; was anderswo (an einer anderen Stelle
 *   oder ohne Stelle) an Einheiten ging, liefert der Server als Summe je Einheit
 *   (`verpflegt_anderswo`). Sie verpflegt die Einheit und ihren Teilbaum wie eine eigene Ausgabe
 *   und steht unter „verpflegt“ als Menge ohne Zeit. Nur, was der Server liefert; am Desktop und
 *   am einsatzweiten Gerät ist die Liste leer.
 * - Eine **vorgemerkte** Ausgabe (ohne Netz, noch nicht bestätigt) steht als „ausstehend“ an
 *   ihrer Einheit und nimmt sie nicht aus der Liste, wie sie nicht in die Deckung zählt.
 *
 * Stärke nur über `summiereStaerke` und `staerkeText` (`frontend/AGENTS.md`, „Eine Heimat je
 * Zahl“), der Abschnitt einer Einheit über `abschnittDerEinheit` (eigener, sonst geerbter).
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type {
  AusgabeEingabe,
  EmpfaengerAbschnitt,
  EmpfaengerEinheit,
  VerpflegungAusgabe,
  VerpflegungEmpfaenger,
  VerpflegungZeitfenster,
} from '../api/types';
import { staerkeText, summiereStaerke } from '../anzeige/staerke';
import { abschnittDerEinheit } from '../kraefte/kraeftebaumKern';

dayjs.extend(utc);

/** Der gewählte Empfänger; `null` heißt „ohne Empfänger“ (Vorgabe). */
export interface EmpfaengerWahl {
  art: 'einheit' | 'abschnitt';
  id: number;
}

/** Ohne Einheiten und Abschnitte; auch, solange die Verpflegung nicht geladen ist. */
export const LEERE_EMPFAENGER: VerpflegungEmpfaenger = { einheiten: [], abschnitte: [] };

/** Wählbar beim Zählen: eine nicht aufgelöste Einheit oder ein Abschnitt der Liste. */
export function isEmpfaengerWaehlbar(
  w: EmpfaengerWahl | null,
  e: VerpflegungEmpfaenger,
): w is EmpfaengerWahl {
  if (!w) return false;
  return w.art === 'einheit'
    ? e.einheiten.some((x) => x.id === w.id && !x.aufgeloest_at)
    : e.abschnitte.some((x) => x.id === w.id);
}

/** Wert der Option „ohne Empfänger“ in einer Auswahl. */
export const OHNE_EMPFAENGER = 'ohne';

/** `einheit:31`, `abschnitt:41` — der Wert einer Option (wie die Empfänger eines Auftrags). */
export function empfaengerSchluessel(w: EmpfaengerWahl | null): string {
  return w ? `${w.art}:${w.id}` : OHNE_EMPFAENGER;
}

export function parseEmpfaengerSchluessel(s: string | null | undefined): EmpfaengerWahl | null {
  const m = /^(einheit|abschnitt):(\d+)$/.exec(s ?? '');
  if (!m) return null;
  const id = Number(m[2]);
  return id > 0 ? { art: m[1] as EmpfaengerWahl['art'], id } : null;
}

/** Die Felder der Eingabe: höchstens einer der beiden, ohne Empfänger keiner. */
export function empfaengerFelder(
  w: EmpfaengerWahl | null,
): Pick<AusgabeEingabe, 'einheit_id' | 'abschnitt_id'> {
  if (!w) return {};
  return w.art === 'einheit' ? { einheit_id: w.id } : { abschnitt_id: w.id };
}

type MitEmpfaenger = Pick<VerpflegungAusgabe, 'einheit_id' | 'abschnitt_id'>;

/** Der Empfänger einer Ausgabe (gespeichert oder vorgemerkt). */
export function empfaengerVon(a: MitEmpfaenger): EmpfaengerWahl | null {
  if (a.einheit_id != null) return { art: 'einheit', id: a.einheit_id };
  if (a.abschnitt_id != null) return { art: 'abschnitt', id: a.abschnitt_id };
  return null;
}

/** Name einer Einheit; eine unbekannte Kennung bleibt sichtbar statt still zu fehlen. */
function einheitName(id: number, e: VerpflegungEmpfaenger): string {
  return e.einheiten.find((x) => x.id === id)?.name ?? `Einheit #${id}`;
}

function abschnittName(id: number, e: VerpflegungEmpfaenger): string {
  return e.abschnitte.find((x) => x.id === id)?.name ?? `Abschnitt #${id}`;
}

/** „an 2. Gruppe“, „Zuführung Deich“; leer ohne Empfänger. */
export function empfaengerText(a: MitEmpfaenger, e: VerpflegungEmpfaenger): string {
  const w = empfaengerVon(a);
  if (!w) return '';
  return w.art === 'einheit' ? `an ${einheitName(w.id, e)}` : `Zuführung ${abschnittName(w.id, e)}`;
}

/**
 * Stärke des Teilbaums als Text („0/1/8//9“), `null` ohne Stärke: eine Einheit ohne disponierte
 * Kräfte zeigt keine Zahl statt „0/0/0//0“.
 */
export function staerkeAnzeige(e: EmpfaengerEinheit): string | null {
  return staerkeVorgabe(e) != null ? staerkeText(summiereStaerke([e])) : null;
}

/** „2. Gruppe · Florian 1-2 · 0/1/8//9“. */
export function einheitLabel(e: EmpfaengerEinheit): string {
  return [e.name, e.funkrufname, staerkeAnzeige(e)].filter(Boolean).join(' · ');
}

/**
 * Vorgabe der Menge bei einer Ausgabe an eine Einheit: die Ist-Stärke ihres Teilbaums (eine
 * Ausgabe an sie verpflegt ihn), gesamt. `null` ohne Stärke: dann bleibt die Menge leer.
 */
export function staerkeVorgabe(e: EmpfaengerEinheit): number | null {
  const s = summiereStaerke([e]);
  const gesamt = s ? s.fuehrer + s.unterfuehrer + s.mannschaft : 0;
  return gesamt > 0 ? gesamt : null;
}

export interface EmpfaengerOptionGruppe {
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Gruppen jeder Empfängerwahl: die Einheiten in der Folge des Kräftebaums (wie der Server sie
 * liefert), dann die Abschnitte als Zuführung. Aufgelöste Einheiten nur für Nachträge vor der
 * Auflösung (der Server prüft den Zeitpunkt, 409), als eigene Gruppe.
 */
export function empfaengerOptionen(
  e: VerpflegungEmpfaenger,
  { aufgeloeste }: { aufgeloeste: boolean },
): EmpfaengerOptionGruppe[] {
  const option = (x: EmpfaengerEinheit) => ({
    value: empfaengerSchluessel({ art: 'einheit', id: x.id }),
    label: einheitLabel(x),
  });
  return [
    { label: 'Einheiten', options: e.einheiten.filter((x) => !x.aufgeloest_at).map(option) },
    {
      label: 'Zuführung an Abschnitt',
      options: e.abschnitte.map((a) => ({
        value: empfaengerSchluessel({ art: 'abschnitt', id: a.id }),
        label: `Zuführung ${a.name}`,
      })),
    },
    {
      label: 'aufgelöst',
      options: aufgeloeste ? e.einheiten.filter((x) => !!x.aufgeloest_at).map(option) : [],
    },
  ].filter((g) => g.options.length > 0);
}

// ── Noch nicht verpflegt ──────────────────────────────────────────────────────────────────

/** Menge und Zeitpunkt einer gültigen Ausgabe an einen Empfänger. */
export interface AusgabeKurz {
  menge: number;
  zeitpunkt_at: string;
}

/** Eine noch nicht verpflegte Einheit. */
export interface StandZeile {
  id: number;
  name: string;
  funkrufname: string | null;
  einheit: EmpfaengerEinheit;
  /** Vorfahren in derselben Liste: die Einrückung nach der Gliederung. */
  tiefe: number;
  /** Eigener, sonst geerbter Abschnitt. */
  abschnitt: string | null;
  /** EP, die an diese Einheit auf dem Gerät vorgemerkt und noch nicht bestätigt sind. */
  ausstehend: number;
  /** Name des Abschnitts, an den (oder an dessen Über-Abschnitt) zugeführt wurde. */
  zufuehrung: string | null;
}

/** Eine Einheit mit Ausgabe in diesem Zeitfenster. */
export interface VerpflegtZeile {
  id: number;
  name: string;
  funkrufname: string | null;
  abschnitt: string | null;
  aufgeloest: boolean;
  /** Nach Zeitpunkt. */
  ausgaben: AusgabeKurz[];
  /** EP anderswo (an einer anderen Stelle oder ohne Stelle), nur am gebundenen Gerät; sonst 0. */
  anderswo: number;
  /** Nicht aufgelöste Untereinheiten, die die Ausgabe mit verpflegt (Teilbaum). */
  untereinheiten: number;
}

export interface ZufuehrungZeile {
  id: number;
  name: string;
  ausgaben: AusgabeKurz[];
}

export interface Verpflegungsstand {
  offen: StandZeile[];
  ohneEintreffen: StandZeile[];
  verpflegt: VerpflegtZeile[];
  zufuehrungen: ZufuehrungZeile[];
}

function gruppiere(
  ausgaben: readonly VerpflegungAusgabe[],
  schluessel: (a: VerpflegungAusgabe) => number | null | undefined,
): Map<number, AusgabeKurz[]> {
  const nach = new Map<number, AusgabeKurz[]>();
  const sortiert = [...ausgaben].sort((a, b) => a.zeitpunkt_at.localeCompare(b.zeitpunkt_at));
  for (const a of sortiert) {
    const id = schluessel(a);
    if (id == null) continue;
    nach.set(id, [...(nach.get(id) ?? []), { menge: a.menge, zeitpunkt_at: a.zeitpunkt_at }]);
  }
  return nach;
}

/** Die Kette einer Kennung nach oben, ohne sie selbst; zyklensicher. */
function vorfahren(id: number, eltern: ReadonlyMap<number, number | null>): number[] {
  const kette: number[] = [];
  const gesehen = new Set([id]);
  let p = eltern.get(id) ?? null;
  while (p != null && !gesehen.has(p)) {
    gesehen.add(p);
    kette.push(p);
    p = eltern.get(p) ?? null;
  }
  return kette;
}

/**
 * Wer in diesem Zeitfenster verpflegt ist und wer nicht (Regeln im Dateikopf). `ausstehend` sind
 * die auf dem Gerät vorgemerkten Ausgaben DIESES Zeitfensters.
 */
export function verpflegungsstand(
  zf: Pick<VerpflegungZeitfenster, 'ausgaben' | 'bis_at' | 'verpflegt_anderswo'>,
  e: VerpflegungEmpfaenger,
  ausstehend: readonly Pick<AusgabeEingabe, 'menge' | 'einheit_id'>[] = [],
): Verpflegungsstand {
  const gueltig = zf.ausgaben.filter((a) => a.zurueckgenommen_at == null);
  const anEinheit = gruppiere(gueltig, (a) => a.einheit_id);
  const anAbschnitt = gruppiere(gueltig, (a) => a.abschnitt_id);
  const anderswo = new Map<number, number>();
  // `?? []`: ein Lagebild von der Platte aus der Zeit vor LLH-1048 trägt das Feld noch nicht.
  for (const a of zf.verpflegt_anderswo ?? []) {
    if (a.menge > 0) anderswo.set(a.einheit_id, (anderswo.get(a.einheit_id) ?? 0) + a.menge);
  }
  const hatAusgabe = (id: number) => anEinheit.has(id) || anderswo.has(id);

  const eltern = new Map(e.einheiten.map((x) => [x.id, x.ueber_einheit_id ?? null]));
  const abschnittEltern = new Map(e.abschnitte.map((a) => [a.id, a.ueber_abschnitt_id ?? null]));
  const abschnittJe = abschnittDerEinheit(e.einheiten);
  const isErreicht = (id: number) => hatAusgabe(id) || vorfahren(id, eltern).some(hatAusgabe);
  /** Die Zuführung an den Abschnitt der Einheit oder einen darüber, der nächste gewinnt. */
  const zufuehrungFuer = (id: number): string | null => {
    const ab = abschnittJe.get(id);
    if (!ab) return null;
    const ziel = [ab.id, ...vorfahren(ab.id, abschnittEltern)].find((a) => anAbschnitt.has(a));
    return ziel == null ? null : abschnittName(ziel, e);
  };
  const bisMs = dayjs.utc(zf.bis_at).valueOf();
  /** Eingetroffen erst nach dem Ende: im Zeitfenster nicht zu verpflegen. */
  const isSpaeter = (x: EmpfaengerEinheit) => {
    const ms = x.eintreffen_at ? dayjs.utc(x.eintreffen_at).valueOf() : NaN;
    return Number.isFinite(ms) && Number.isFinite(bisMs) && ms > bisMs;
  };

  const vorgemerkt = new Map<number, number>();
  for (const a of ausstehend) {
    if (a.einheit_id != null) {
      vorgemerkt.set(a.einheit_id, (vorgemerkt.get(a.einheit_id) ?? 0) + a.menge);
    }
  }

  const offenRoh: EmpfaengerEinheit[] = [];
  const ohneRoh: EmpfaengerEinheit[] = [];
  for (const x of e.einheiten) {
    if (x.aufgeloest_at || isErreicht(x.id) || isSpaeter(x)) continue;
    (x.eintreffen_at ? offenRoh : ohneRoh).push(x);
  }
  const zeilen = (roh: EmpfaengerEinheit[]): StandZeile[] => {
    const inListe = new Set(roh.map((x) => x.id));
    return roh.map((x) => ({
      id: x.id,
      name: x.name,
      funkrufname: x.funkrufname ?? null,
      einheit: x,
      tiefe: vorfahren(x.id, eltern).filter((v) => inListe.has(v)).length,
      abschnitt: abschnittJe.get(x.id)?.name ?? null,
      ausstehend: vorgemerkt.get(x.id) ?? 0,
      zufuehrung: zufuehrungFuer(x.id),
    }));
  };

  const nachId = new Map(e.einheiten.map((x) => [x.id, x]));
  const verpflegt: VerpflegtZeile[] = [
    ...e.einheiten.filter((x) => hatAusgabe(x.id)).map((x) => x.id),
    ...[...new Set([...anEinheit.keys(), ...anderswo.keys()])].filter((id) => !nachId.has(id)),
  ].map((id) => {
    const einheit = nachId.get(id);
    return {
      id,
      name: einheit?.name ?? `Einheit #${id}`,
      funkrufname: einheit?.funkrufname ?? null,
      abschnitt: abschnittJe.get(id)?.name ?? null,
      aufgeloest: !!einheit?.aufgeloest_at,
      ausgaben: anEinheit.get(id) ?? [],
      anderswo: anderswo.get(id) ?? 0,
      untereinheiten: e.einheiten.filter(
        (u) => !u.aufgeloest_at && vorfahren(u.id, eltern).includes(id),
      ).length,
    };
  });

  const bekannteAbschnitte = new Set(e.abschnitte.map((a) => a.id));
  const zufuehrungen: ZufuehrungZeile[] = [
    ...e.abschnitte.filter((a) => anAbschnitt.has(a.id)),
    ...[...anAbschnitt.keys()]
      .filter((id) => !bekannteAbschnitte.has(id))
      .map((id): EmpfaengerAbschnitt => ({ id, name: `Abschnitt #${id}` })),
  ].map((a) => ({ id: a.id, name: a.name, ausgaben: anAbschnitt.get(a.id) ?? [] }));

  return { offen: zeilen(offenRoh), ohneEintreffen: zeilen(ohneRoh), verpflegt, zufuehrungen };
}
