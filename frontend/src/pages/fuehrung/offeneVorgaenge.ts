import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type {
  Abloesung,
  Auftrag,
  EinsatzAnzeige,
  Erinnerung,
  Fuehrungsfunktion,
  Meldung,
  Nachforderung,
} from '../../api/types';
import type { ListenAbschnittZustand } from '../../components/instrument';
import { einstufungOf } from '../../abloesung/einstufung';
import { istEinsatzLeitung } from '../../einsatz/schreibrecht';
import { istAlarmiert } from '../../meldungen/meldungKennzahlen';
import {
  istOffen as nachforderungOffen,
  istUeberfaellig,
} from '../../nachforderungen/nachforderungStufen';
import { offeneAuftraege } from './ueberblickDaten';

dayjs.extend(utc);

/**
 * Paneel „Offene Vorgänge“ im Führungsüberblick (LLH-1145, Spec `ueberblick-offene-vorgaenge`,
 * Herleitung `/mnt/project-files/llh-1022/llh-1145/design.md`) — rein: welche Einträge ein
 * Abschnitt zeigt, in welcher Folge, und was „meine Stelle“ heißt.
 *
 * - **Gezählt wird hier nichts.** Die Zahl jedes Abschnitts kommt aus dem Modulzähler (LFH-550),
 *   die der Ablösung aus demselben Browser-Zähler wie die Rail (`berechneAbloesungZaehler`). Die
 *   Listen hier wählen nur aus und ordnen.
 * - **Folge** je Abschnitt: überfällig → nächste Frist → älteste, Kennung als letzte Stufe, damit
 *   ein Neuabruf nichts umordnet.
 * - **Meine Stelle** (D5): Empfänger ist eine eigene Funktion ODER Absender bin ich. Eigene
 *   Funktionen sind die besetzten Sachgebiete, ohne Sachgebiet mit Rolle Einsatzleitung „EL“ —
 *   dieselbe Ableitung wie `src/einsatz/funktion.rs::ableiten`. Ablösungen haben keinen
 *   Stellenbezug und werden nicht gefiltert.
 */

/** Wie viele Einträge ein Abschnitt zeigt; der Rest steht im Modul. */
export const VORGAENGE_JE_ABSCHNITT = 3;
/** Erinnerungen: fällige und die in diesem Fenster fällig werdenden. */
export const ERINNERUNG_FENSTER_MINUTEN = 30;

/** Die Wahl der Segmentleiste; steht als `?vorgaenge=meine` in der URL (Vorgabe „alle“). */
export type VorgangsSicht = 'alle' | 'meine';
export const VORGANGS_SICHT_PARAM = 'vorgaenge';

/** Liest die Sicht aus der URL; jeder andere Wert ist „alle“. */
export function sichtAusUrl(wert: string | null): VorgangsSicht {
  return wert === 'meine' ? 'meine' : 'alle';
}

/** Wer „ich“ bin: eigene Funktionen und Benutzerkennung. */
export interface MeineStelle {
  funktionen: ReadonlySet<Fuehrungsfunktion>;
  benutzerId: number | null;
}

/**
 * Eigene Funktionen im Einsatz: die besetzten Sachgebiete; ohne Sachgebiet mit Rolle
 * Einsatzleitung „EL“ (wie `funktion::ableiten`), sonst keine.
 */
export function meineStelle(
  einsatz: Pick<EinsatzAnzeige, 'meine_sachgebiete' | 'meine_rolle' | 'status'> | undefined,
  benutzerId: number | null | undefined,
): MeineStelle {
  const sachgebiete = einsatz?.meine_sachgebiete ?? [];
  const funktionen = new Set<Fuehrungsfunktion>(sachgebiete);
  if (funktionen.size === 0 && istEinsatzLeitung(einsatz)) funktionen.add('el');
  return { funktionen, benutzerId: benutzerId ?? null };
}

function binIch(stelle: MeineStelle, id: number | null | undefined): boolean {
  return stelle.benutzerId != null && id === stelle.benutzerId;
}

function hatFunktion(stelle: MeineStelle, code: Fuehrungsfunktion | null | undefined): boolean {
  return code != null && stelle.funktionen.has(code);
}

export function meldungFuerMich(m: Meldung, stelle: MeineStelle): boolean {
  return hatFunktion(stelle, m.empfaenger_funktion) || binIch(stelle, m.erfasst_von_id);
}

export function auftragFuerMich(a: Auftrag, stelle: MeineStelle): boolean {
  return (
    (a.empfaenger ?? []).some((e) => hatFunktion(stelle, e.funktion)) ||
    binIch(stelle, a.erstellt_von_id)
  );
}

export function erinnerungFuerMich(e: Erinnerung, stelle: MeineStelle): boolean {
  return hatFunktion(stelle, e.empfaenger_funktion_code) || binIch(stelle, e.erstellt_von_id);
}

/** Nachforderungen gehen an Stellen außerhalb des Stabs: nur der Absender zählt. */
export function nachforderungFuerMich(n: Nachforderung, stelle: MeineStelle): boolean {
  return binIch(stelle, n.erstellt_von_id);
}

function ms(wire: string | null | undefined): number | null {
  if (!wire) return null;
  const d = dayjs.utc(wire);
  return d.isValid() ? d.valueOf() : null;
}

/** Aufsteigend, ohne Wert zuletzt. */
function frueher(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/** Meldungen: offen; Bestätigung überfällig → neu → älteste (Eingang). */
export function vorgangsMeldungen(meldungen: readonly Meldung[]): Meldung[] {
  return meldungen
    .filter((m) => m.ist_offen)
    .sort(
      (a, b) =>
        Number(istAlarmiert(b)) - Number(istAlarmiert(a)) ||
        Number(b.status === 'neu') - Number(a.status === 'neu') ||
        frueher(ms(a.eingang_at), ms(b.eingang_at)) ||
        a.id - b.id,
    );
}

/** Aufträge: die Folge des Überblicks (überfällig → Frist → älteste), `offeneAuftraege`. */
export function vorgangsAuftraege(auftraege: Auftrag[]): Auftrag[] {
  return offeneAuftraege(auftraege);
}

/** Nachforderungen: offen; überfällig → Bedarfszeit → älteste Anforderung. */
export function vorgangsNachforderungen(
  liste: readonly Nachforderung[],
  jetzt: number,
): Nachforderung[] {
  return liste
    .filter((n) => nachforderungOffen(n.status))
    .sort(
      (a, b) =>
        Number(istUeberfaellig(b, jetzt)) - Number(istUeberfaellig(a, jetzt)) ||
        frueher(ms(a.benoetigt_bis), ms(b.benoetigt_bis)) ||
        frueher(ms(a.angefordert_at), ms(b.angefordert_at)) ||
        a.id - b.id,
    );
}

/** Erinnerungen: offen und fällig oder in den nächsten 30 min; früheste Fälligkeit zuerst. */
export function vorgangsErinnerungen(liste: readonly Erinnerung[], jetzt: number): Erinnerung[] {
  const grenze = jetzt + ERINNERUNG_FENSTER_MINUTEN * 60_000;
  return liste
    .filter((e) => {
      if (e.status !== 'offen') return false;
      const f = ms(e.faellig_at);
      return e.ist_faellig || (f != null && f <= grenze);
    })
    .sort((a, b) => frueher(ms(a.faellig_at), ms(b.faellig_at)) || a.id - b.id);
}

/**
 * Ablösungen: laufende Schichten, die überfällig oder in der Vorwarnzeit sind — dieselbe Menge wie
 * der Browser-Zähler (`countFaellige`); früheste Fälligkeit zuerst.
 */
export function vorgangsAbloesungen(liste: readonly Abloesung[], jetzt: number): Abloesung[] {
  const uhr = dayjs(jetzt);
  return liste
    .filter((a) => a.status === 'laufend' && einstufungOf(a, uhr) !== 'planmaessig')
    .sort((a, b) => frueher(ms(a.faellig_at), ms(b.faellig_at)) || a.id - b.id);
}

/** Filtert nur in der Sicht „meine“; „alle“ gibt die Liste unverändert zurück. */
export function nachSicht<T>(
  liste: T[],
  sicht: VorgangsSicht,
  fuerMich: (eintrag: T) => boolean,
): T[] {
  return sicht === 'meine' ? liste.filter(fuerMich) : liste;
}

/** Was ein Abschnitt an seiner Listenabfrage liest (Teilmenge von `UseQueryResult`). */
export interface ListenAbfrage {
  isError: boolean;
  isPending: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * Stand der Liste eines Abschnitts. Gesperrt, wenn das Modul nicht frei ist; eine nie geladene,
 * pausierte Abfrage ist „ohne Netz“, nie leer (`isPending`, nicht `isLoading`, wie
 * `api/abrufZustand.ts`).
 */
export function listenStand(frei: boolean, q: ListenAbfrage): ListenAbschnittZustand {
  if (!frei) return 'gesperrt';
  if (q.isError) return 'fehler';
  if (q.isPending) return q.fetchStatus === 'paused' ? 'offline' : 'laden';
  return 'daten';
}
