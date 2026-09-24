/**
 * Verpflegung (LFH-634) — Bedarfsvorschläge für ein Zeitfenster (design.md D8).
 *
 * Zwei Quellen, beide nur, wenn das Quellmodul für die Person BEDIENBAR ist
 * (`istKeyFreigegeben`: fertig, sichtbar und nicht per Rolle gesperrt). Sichtbar allein reicht
 * nicht — der Server antwortet auch bei einer Rollensperre mit 403. Kommt trotzdem ein Fehler
 * (etwa ein Override, der sich während der Sitzung ändert), gilt die Quelle als leer: kein
 * Vorschlag, keine Fehleranzeige, kein Wiederholungsversuch.
 *
 * - Einsatzkräfte: `verdichte(personal, [], []).staerke.gesamt` — jede Personalzeile einmal.
 * - Betreute: Kopfzahl „in Betreuung“ zum Beginn (`ladeBelegungKopfzahl`).
 *
 * Der Hook folgt seiner Quelle. Dass ein gespeicherter Bedarf bei späterem Personalzuwachs
 * stehen bleibt, entscheidet der Dialog: er belegt nur beim ANLEGEN vor.
 *
 * ZEIT: `vonAt` ist ein Wire-String (UTC ohne Zonenkennung) und wird nur über `dayjs.utc`
 * gelesen; derselbe String geht unverändert als `zeitpunkt` an die Kopfzahl.
 */
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ladeBelegungKopfzahl } from '../api/betreuung';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import type { BelegungKopfzahl, BenutzerAnzeige, ModulOverrides } from '../api/types';
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
  benutzer: BenutzerAnzeige | null;
  /**
   * Modul-Overrides des Einsatzes. ACHTUNG, anders als bei `istModulSichtbar`: `undefined`
   * heißt hier „noch unbekannt“ und sperrt beide Quellen — ein Aufrufer reicht
   * `overridesQuery.data` durch, und solange die lädt, soll kein Abruf ein 403 riskieren.
   * „Keine Overrides“ ist `{}`.
   */
  overrides: ModulOverrides | undefined;
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
  // `stellen` führt auch Stellen OHNE Meldung (`belegt` fehlt, `src/betreuung/repo.rs`):
  // „nichts gemeldet“ heißt deshalb „keine Stelle mit Meldung“, nicht `stellen.length === 0`.
  // Eine gemeldete 0 ist dagegen ein Wert.
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
  benutzer,
  overrides,
  jetzt,
}: BedarfsvorschlagArgs): Bedarfsvorschlag {
  const bekannt = Number.isFinite(einsatzId) && overrides !== undefined;
  const personalFrei = bekannt && istKeyFreigegeben('personal', benutzer, overrides);
  const betreuungFrei = bekannt && istKeyFreigegeben('betreuung', benutzer, overrides);

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
  // Ein Fehler (403 oder sonst) lässt die Quelle leer; `data` eines früheren Erfolgs bliebe
  // bei einem Refetch-Fehler stehen — deshalb zusätzlich `isError`.
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
