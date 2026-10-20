/**
 * „Unterbringung in Zahlen" der Betreuungsübersicht (LLH-1050) — reine Ableitung aus den Stellen
 * von `GET …/betreuung`. Beantwortet die Leitfrage der Abschnittsleitung Betreuung: wie viele
 * sind untergebracht, wo ist noch Platz, welche Stelle ist voll?
 *
 * Gleiche Festlegungen wie `evakuierungKennzahl.ts` — Abwesenheit statt 0 —, jede in
 * `unterbringungKennzahl.test.ts` gepinnt:
 *  - **In Betreuung** kommt aus {@link inBetreuung} (`betreuungText.ts`), derselben Summe wie die
 *    Detailseite; ohne jede Meldung `null`, nie 0. Die Verpflegung liest dieselbe Belegung über
 *    die Kopfzahl des Servers (`…/betreuung/belegung`), die an derselben Definition „aktuell"
 *    hängt; eine zweite Summe gibt es nicht.
 *  - **Ohne Meldung** sind nur Stellen in Betrieb ohne Belegung — dieselbe Menge, die die Kopfzahl
 *    des Servers zum Stichtag „jetzt" so zählt (LFH-679): eine vorbereitete oder geschlossene
 *    Stelle ohne jede Meldung hatte nichts zu melden.
 *  - **Kapazität** und **Frei** lesen nur nicht geschlossene Stellen. Kapazität summiert nur
 *    Stellen mit Kapazität (die übrigen zählen in `ohneKapazitaet`), ohne jede Kapazität `null`.
 *  - **Frei** summiert {@link freiePlaetze} je Stelle — die eine Rechnung, je Stelle nie negativ:
 *    eine überbelegte Halle nimmt einer anderen keinen Platz weg. Eine Stelle mit Kapazität, aber
 *    ohne Meldung hat unbekannten Platz; sie zählt in `freiOhneMeldung`, nicht als frei oder 0.
 *  - **Voll** zählt voll und überbelegt ({@link volleStellen}), „fast voll" nicht.
 *  - **Davon namentlich** fehlt ohne Personenrecht ganz (die Übersicht liefert dann kein
 *    `namentlich`); ein Hinweis, kein Summand.
 */
import type { Betreuungsstelle, StelleNamentlich } from '../api/types';
import { freiePlaetze, inBetreuung, volleStellen } from './betreuungText';

/** Was die Kennzahl von einer Stelle liest. */
type KennzahlStelle = Pick<Betreuungsstelle, 'status' | 'kapazitaet_personen' | 'belegung'>;

export interface UnterbringungKennzahl {
  /** Σ aktuelle Belegungen; `null`, wenn keine Stelle gemeldet hat. */
  inBetreuung: number | null;
  /** Stellen in Betrieb ohne Belegungsmeldung. */
  ohneMeldung: number;
  /** Σ Kapazität der nicht geschlossenen Stellen mit Kapazität; `null`, wenn keine eine hat. */
  kapazitaet: number | null;
  /** Nicht geschlossene Stellen ohne Kapazität. */
  ohneKapazitaet: number;
  /** Σ freie Plätze der nicht geschlossenen Stellen mit Kapazität und Meldung; `null` ohne solche. */
  frei: number | null;
  /** Nicht geschlossene Stellen mit Kapazität, aber ohne Meldung: ihr Platz ist unbekannt. */
  freiOhneMeldung: number;
  /** Stellen im Status `in_betrieb`. */
  inBetrieb: number;
  /** Alle (nicht stornierten) Stellen der Übersicht. */
  stellen: number;
  /** Stellen, die voll oder überbelegt sind. */
  voll: number;
  /** Σ „davon namentlich"; fehlt ohne Personenrecht. */
  namentlich?: number;
}

/** Kennzahl aus den Stellen; `null` ohne Stelle (dann steht der Leerzustand). Rein. */
export function unterbringungKennzahl(
  stellen: readonly KennzahlStelle[],
  namentlich?: readonly StelleNamentlich[] | null,
): UnterbringungKennzahl | null {
  if (stellen.length === 0) return null;
  const offen = stellen.filter((s) => s.status !== 'geschlossen');
  const mitKapazitaet = offen.filter((s) => s.kapazitaet_personen != null);
  const freiJeStelle = mitKapazitaet
    .map((s) => freiePlaetze(s))
    .filter((n): n is number => n != null);
  return {
    inBetreuung: inBetreuung(stellen),
    ohneMeldung: stellen.filter((s) => s.status === 'in_betrieb' && s.belegung == null).length,
    kapazitaet:
      mitKapazitaet.length === 0
        ? null
        : mitKapazitaet.reduce((n, s) => n + s.kapazitaet_personen!, 0),
    ohneKapazitaet: offen.length - mitKapazitaet.length,
    frei: freiJeStelle.length === 0 ? null : freiJeStelle.reduce((n, f) => n + f, 0),
    freiOhneMeldung: mitKapazitaet.filter((s) => s.belegung == null).length,
    inBetrieb: stellen.filter((s) => s.status === 'in_betrieb').length,
    stellen: stellen.length,
    voll: volleStellen(stellen),
    ...(namentlich != null && { namentlich: namentlich.reduce((n, x) => n + x.anzahl, 0) }),
  };
}
