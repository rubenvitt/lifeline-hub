/**
 * Verpflegung — Bedarfsvorschläge für ein Zeitfenster.
 *
 * Drei Quellen, alle nur, wenn das Quellmodul laut Server-Freigabe BEDIENBAR ist
 * (`istKeyFreigegeben`) — sichtbar allein reicht nicht, eine Rollensperre ist 403. Ein Fehler
 * lässt die Quelle leer: kein Vorschlag, keine Fehleranzeige, kein Wiederholungsversuch.
 *
 * - Einsatzkräfte: `verdichte(personal, [], []).staerke.gesamt`.
 * - Betreute: Kopfzahl „in Betreuung“ zum Beginn (`ladeBelegungKopfzahl`).
 * - Sonderkost (LLH-1612, design.md D7): die Kostformen der Registrierten ohne Personenbezug
 *   (`loadKostformZaehlung`, Stand jetzt), nur wenn jemand registriert ist und mindestens eine
 *   Sonderkost belegt ist; vorgeschlagen werden nur die belegten Kostformen.
 *
 * Vorbelegt wird nur beim ANLEGEN (Sache des Dialogs). `vonAt` ist ein Wire-String (UTC ohne
 * Zone), nur über `dayjs.utc` gelesen und unverändert als `zeitpunkt` an die Kopfzahl gegeben.
 */
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { ladeBelegungKopfzahl } from '../api/betreuung';
import { loadKostformZaehlung } from '../api/betreuungRegistrierung';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import type { BelegungKopfzahl, Kostform, KostformZaehlung, ModulFreigaben } from '../api/types';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { verdichte } from '../kraefte/kraeftebild';
import { KOSTFORMEN } from './verpflegungText';

dayjs.extend(utc);

/** Ein Vorschlag für ein Bedarfsfeld. */
export interface Vorschlag {
  /** Vorbelegung; `null` = kein Vorschlag, das Feld bleibt leer (nie 0 als Ersatz). */
  wert: number | null;
  /** Sichtbare Beschriftung mit Herkunft; `null` = nichts anzuzeigen (Quelle nicht
   *  zugänglich, lädt noch oder abgelehnt). */
  hinweis: string | null;
}

/** Vorschlag für die Sonderkost-Felder: nur belegte Kostformen, die übrigen bleiben leer. */
export interface SonderkostVorschlag {
  /** `null` = kein Vorschlag. */
  werte: Partial<Record<Kostform, number>> | null;
  hinweis: string | null;
}

export interface Bedarfsvorschlag {
  kraefte: Vorschlag;
  betreute: Vorschlag;
  sonderkost: SonderkostVorschlag;
}

export interface BedarfsvorschlagArgs {
  einsatzId: number;
  /** Beginn des Zeitfensters als Wire-String (UTC ohne Zonenkennung); ohne Beginn gilt die
   *  Kopfzahl „jetzt“. */
  vonAt: string | undefined;
  /**
   * Modul-Freigaben des Servers (LFH-669). `undefined` heißt „noch unbekannt“ und sperrt beide
   * Quellen (`istKeyFreigegeben` gibt dann nichts frei), damit kein Abruf ein 403 riskiert.
   */
  freigaben: ModulFreigaben | undefined;
  /** Uhr für „liegt der Beginn in der Zukunft?“ — die Seite reicht `useJetzt()` durch. */
  jetzt?: Dayjs;
}

const LEER: Vorschlag = { wert: null, hinweis: null };
const KEINE_SONDERKOST: SonderkostVorschlag = { werte: null, hinweis: null };

/**
 * Reine Ableitung des Sonderkost-Vorschlags (design.md D7): ohne Registrierte oder nur mit
 * Normalkost kein Vorschlag und kein Hinweis. Die Zählung ist der Stand jetzt, nicht zum Beginn.
 */
export function sonderkostVorschlag(k: KostformZaehlung): SonderkostVorschlag {
  const belegt = KOSTFORMEN.filter((f) => k.sonderkost[f] > 0);
  if (k.registriert <= 0 || belegt.length === 0) return KEINE_SONDERKOST;
  return {
    werte: Object.fromEntries(belegt.map((f) => [f, k.sonderkost[f]])),
    hinweis: `Vorschlag: aus ${k.registriert} Registrierten, Stand jetzt`,
  };
}

/** Reine Ableitung des Betreuungsvorschlags aus der Kopfzahl. */
function betreuteVorschlag(
  k: BelegungKopfzahl,
  vonAt: string | undefined,
  jetzt: Dayjs,
  /** Uhrzeit des Abrufs in der Anzeigezone — „Stand“ heißt in beiden Feldern eine Uhrzeit. */
  stand: string,
): Vorschlag {
  // `stellen` führt auch Stellen OHNE Meldung: „nichts gemeldet“ heißt „keine Stelle mit Meldung“,
  // nicht `stellen.length === 0`. Eine gemeldete 0 ist ein Wert.
  if (!k.stellen.some((s) => s.belegt != null)) {
    return { wert: null, hinweis: 'keine Belegung gemeldet' };
  }
  const von = vonAt ? dayjs.utc(vonAt) : null;
  const zukunft = !von || !von.isValid() || von.valueOf() > jetzt.valueOf();
  const herkunft = !vonAt
    ? `Vorschlag: in Betreuung, Stand ${stand}`
    : zukunft
      ? `Vorschlag: in Betreuung, Stand ${stand}, nicht zum Beginn`
      : 'Vorschlag: in Betreuung zum Beginn';
  const n = k.stellen_ohne_meldung;
  const untergrenze =
    n > 0 ? ` · Untergrenze, ${n} ${n === 1 ? 'Stelle' : 'Stellen'} ohne Meldung` : '';
  return { wert: k.summe, hinweis: herkunft + untergrenze };
}

export function useBedarfsvorschlag({
  einsatzId,
  vonAt,
  freigaben,
  jetzt,
}: BedarfsvorschlagArgs): Bedarfsvorschlag {
  const gueltig = Number.isFinite(einsatzId);
  const personalFrei = gueltig && istKeyFreigegeben('personal', freigaben);
  const betreuungFrei = gueltig && istKeyFreigegeben('betreuung', freigaben);
  const { konventionen } = useAnzeigeKonventionen();

  const personalQ = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personalFrei,
    retry: false,
  });
  const kopfzahlQ = useQuery({
    queryKey: einsatzKeys.betreuungKopfzahl(einsatzId, vonAt),
    queryFn: () => ladeBelegungKopfzahl(einsatzId, vonAt),
    enabled: betreuungFrei,
    retry: false,
  });
  const kostformQ = useQuery({
    queryKey: einsatzKeys.betreuungKostformen(einsatzId),
    queryFn: () => loadKostformZaehlung(einsatzId),
    enabled: betreuungFrei,
    retry: false,
  });

  // „Stand“ ist in beiden Feldern die Zeit des Abrufs in der Anzeigezone, wie jede andere
  // Zeit im Dialog (LFH-692), in der Rolle „kurz“ (LLH-1061); vorher stand beim Betreuten-Feld
  // „Stand jetzt“ (LFH-948).
  const standVon = (ms: number) => zeitKurz(dayjs(ms), konventionen);

  let kraefte = LEER;
  // Ein Fehler lässt die Quelle leer; `data` eines früheren Erfolgs bliebe bei einem
  // Refetch-Fehler stehen — deshalb zusätzlich `isError`.
  if (personalFrei && personalQ.data && !personalQ.isError) {
    const gesamt = verdichte(personalQ.data, [], []).staerke.gesamt;
    if (gesamt > 0) {
      kraefte = {
        wert: gesamt,
        hinweis: `Vorschlag: Personal im Einsatz, Stand ${standVon(personalQ.dataUpdatedAt)}`,
      };
    }
  }

  let betreute = LEER;
  if (betreuungFrei && kopfzahlQ.data && !kopfzahlQ.isError) {
    betreute = betreuteVorschlag(
      kopfzahlQ.data,
      vonAt,
      jetzt ?? dayjs(),
      standVon(kopfzahlQ.dataUpdatedAt),
    );
  }

  const sonderkost =
    betreuungFrei && kostformQ.data && !kostformQ.isError
      ? sonderkostVorschlag(kostformQ.data)
      : KEINE_SONDERKOST;

  return { kraefte, betreute, sonderkost };
}
