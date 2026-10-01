/**
 * Verpflegung — Bedarfsvorschläge für ein Zeitfenster.
 *
 * Zwei Quellen, beide nur, wenn das Quellmodul laut Server-Freigabe BEDIENBAR ist
 * (`istKeyFreigegeben`) — sichtbar allein reicht nicht, eine Rollensperre ist 403. Ein Fehler
 * lässt die Quelle leer: kein Vorschlag, keine Fehleranzeige, kein Wiederholungsversuch.
 *
 * - Einsatzkräfte: `verdichte(personal, [], []).staerke.gesamt`.
 * - Betreute: Kopfzahl „in Betreuung“ zum Beginn (`ladeBelegungKopfzahl`).
 *
 * Vorbelegt wird nur beim ANLEGEN (Sache des Dialogs). `vonAt` ist ein Wire-String (UTC ohne
 * Zone), nur über `dayjs.utc` gelesen und unverändert als `zeitpunkt` an die Kopfzahl gegeben.
 */
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ladeBelegungKopfzahl } from '../api/betreuung';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import type { BelegungKopfzahl, ModulFreigaben } from '../api/types';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { verdichte } from '../kraefte/kraeftebild';

dayjs.extend(utc);

/** Ein Vorschlag für ein Bedarfsfeld. */
export interface Vorschlag {
  /** Vorbelegung; `null` = kein Vorschlag, das Feld bleibt leer (nie 0 als Ersatz). */
  wert: number | null;
  /** Sichtbare Beschriftung mit Herkunft; `null` = nichts anzuzeigen (Quelle nicht
   *  zugänglich, lädt noch oder abgelehnt). */
  hinweis: string | null;
}

export interface Bedarfsvorschlag {
  kraefte: Vorschlag;
  betreute: Vorschlag;
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

/** Reine Ableitung des Betreuungsvorschlags aus der Kopfzahl. */
function betreuteVorschlag(
  k: BelegungKopfzahl,
  vonAt: string | undefined,
  jetzt: Dayjs,
): Vorschlag {
  // `stellen` führt auch Stellen OHNE Meldung: „nichts gemeldet“ heißt „keine Stelle mit Meldung“,
  // nicht `stellen.length === 0`. Eine gemeldete 0 ist ein Wert.
  if (!k.stellen.some((s) => s.belegt != null)) {
    return { wert: null, hinweis: 'keine Belegung gemeldet' };
  }
  const von = vonAt ? dayjs.utc(vonAt) : null;
  const zukunft = !von || !von.isValid() || von.valueOf() > jetzt.valueOf();
  const herkunft = !vonAt
    ? 'Vorschlag: in Betreuung, Stand jetzt'
    : zukunft
      ? 'Vorschlag: in Betreuung, Stand jetzt, nicht zum Beginn'
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

  let kraefte = LEER;
  // Ein Fehler lässt die Quelle leer; `data` eines früheren Erfolgs bliebe bei einem
  // Refetch-Fehler stehen — deshalb zusätzlich `isError`.
  if (personalFrei && personalQ.data && !personalQ.isError) {
    const gesamt = verdichte(personalQ.data, [], []).staerke.gesamt;
    if (gesamt > 0) {
      const stand = dayjs(personalQ.dataUpdatedAt).format('HH:mm');
      kraefte = { wert: gesamt, hinweis: `Vorschlag: Personal im Einsatz, Stand ${stand}` };
    }
  }

  let betreute = LEER;
  if (betreuungFrei && kopfzahlQ.data && !kopfzahlQ.isError) {
    betreute = betreuteVorschlag(kopfzahlQ.data, vonAt, jetzt ?? dayjs());
  }

  return { kraefte, betreute };
}
