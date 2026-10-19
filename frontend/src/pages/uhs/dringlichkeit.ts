import type { Sichtungskategorie, TransportPrioritaet, UhsBelegung } from '../../api/types';
import { alsZeitpunkt } from '../../anzeige/zeitEingabe';
import { SK_REIHE, TRANSPORT_PRIORITAET_REIHE, transportRang } from '../../personen/personMeta';

/**
 * Dringlichkeit in der Unfallhilfsstelle (LLH-1135): wer als Nächstes auf einen freien Platz
 * kommt. Rein, damit Wartebereich und Zuweisung im Grundriss (`Grundriss.tsx`) und die
 * Patientenliste des UHS-Tablets (`geraet/GeraetPatientenPage.tsx`) dieselbe Folge lesen.
 *
 * Reihe: ungesichtet (muss gesichtet werden), SK I bis SK IV, tot, unverletzt; innerhalb einer
 * Kategorie die Transportpriorität (sofort, dringlich, normal, ohne; LLH-1325, design.md D10),
 * dann die längste Wartezeit zuerst. Ungesichtete stehen vorn, weil sie am Ende untergingen.
 * Die Kategorien folgen `SK_REIHE` (eine Quelle mit der Sichtungswahl, LLH-1083); hier kommt
 * nur „ungesichtet“ davor.
 */
export type Dringlichkeitsstufe = 'ungesichtet' | Sichtungskategorie;

export const DRINGLICHKEITS_REIHE: readonly Dringlichkeitsstufe[] = ['ungesichtet', ...SK_REIHE];

/**
 * Was die Folge braucht: die aktuelle Sichtung, die Transportpriorität und seit wann die Person
 * wartet (Wire, UTC). Die Priorität ist Pflichtangabe (auch `null`), damit kein Aufrufer sie
 * vergisst.
 */
export interface DringlichkeitsMerkmale {
  sichtung: Sichtungskategorie | null | undefined;
  prioritaet: TransportPrioritaet | null | undefined;
  seit: string | null | undefined;
}

/** Platz in der Reihe, 0 = ungesichtet. */
export function dringlichkeitsRang(sichtung: Sichtungskategorie | null | undefined): number {
  return DRINGLICHKEITS_REIHE.indexOf(sichtung ?? 'ungesichtet');
}

/** Die Reihe der Transportpriorität steht bei den Personen (`personen/personMeta.ts`). */
export { transportRang };

/** Millisekunden seit der Epoche, `null` bei fehlendem oder unlesbarem Zeitpunkt. */
function zeitMs(seit: string | null | undefined): number | null {
  return alsZeitpunkt(seit)?.valueOf() ?? null;
}

/**
 * Vergleich zweier Personen: Kategorie, dann Transportpriorität, dann der frühere Beginn (längere
 * Wartezeit) zuerst; ohne Beginn hinten in der Stufe. Gleiche liefern 0, die stabile Sortierung
 * hält ihre Folge.
 */
export function compareDringlichkeit(a: DringlichkeitsMerkmale, b: DringlichkeitsMerkmale) {
  const abstand = dringlichkeitsRang(a.sichtung) - dringlichkeitsRang(b.sichtung);
  if (abstand !== 0) return abstand;
  const prio = transportRang(a.prioritaet) - transportRang(b.prioritaet);
  if (prio !== 0) return prio;
  const za = zeitMs(a.seit);
  const zb = zeitMs(b.seit);
  if (za == null || zb == null) return za == null && zb == null ? 0 : za == null ? 1 : -1;
  return za - zb;
}

/** Neue Liste in der Folge der Dringlichkeit; die Eingabe bleibt unverändert. */
export function nachDringlichkeit<T>(
  liste: readonly T[],
  merkmale: (eintrag: T) => DringlichkeitsMerkmale,
): T[] {
  return [...liste].sort((a, b) => compareDringlichkeit(merkmale(a), merkmale(b)));
}

/** Abstand je Priorität: größer als jeder Zeitpunkt in Millisekunden (Jahr 2286 ≈ 1e13). */
const PRIO_SCHRITT = 1e13;

/** Abstand je Kategorie: Platz für alle Prioritätsstufen samt „ohne“ (Summe bleibt < 2^53). */
const RANG_SCHRITT = PRIO_SCHRITT * (TRANSPORT_PRIORITAET_REIHE.length + 1);

/**
 * Ein Zahlwert in derselben Folge, aufsteigend, für `sortWert` der `Datensicht` (die nur einen
 * Wert je Zeile vergleicht): Kategorie, darin die Priorität als Zwischenschritt, darin die Zeit.
 * Ohne Beginn das Ende der eigenen Stufe.
 */
export function dringlichkeitsWert(m: DringlichkeitsMerkmale): number {
  return (
    dringlichkeitsRang(m.sichtung) * RANG_SCHRITT +
    transportRang(m.prioritaet) * PRIO_SCHRITT +
    (zeitMs(m.seit) ?? PRIO_SCHRITT - 1)
  );
}

/**
 * Folge hinter der Schleuse des Wartebereichs und der Zuweisung (LLH-1135, `frontend/AGENTS.md`,
 * „Live-Updates springen nicht unter dem Cursor“): solange gehalten wird (`gehalten` ≠ `null`),
 * stehen die bekannten Einträge in der gehaltenen Folge, mit frischem Inhalt. Entfallenes fällt
 * weg; Neues steht hinten an, damit nichts darüber rückt und eine eigene Ablage (Ziehen in den
 * Wartebereich) sofort sichtbar ist. Offen gilt die frische Folge, referenzgleich.
 */
export function gehalteneFolge<T, K>(
  gehalten: readonly K[] | null,
  frisch: readonly T[],
  schluessel: (eintrag: T) => K,
): readonly T[] {
  if (gehalten === null) return frisch;
  const nachSchluessel = new Map(frisch.map((e) => [schluessel(e), e]));
  const bekannt = new Set(gehalten);
  return [
    ...gehalten.flatMap((k) => {
      const e = nachSchluessel.get(k);
      return e === undefined ? [] : [e];
    }),
    ...frisch.filter((e) => !bekannt.has(schluessel(e))),
  ];
}

/** Die Felder einer Belegung, aus denen sich der Beginn ergibt. */
type Belegungsschritt = Pick<UhsBelegung, 'id' | 'person_id' | 'art' | 'platz_id' | 'zeitpunkt_at'>;

/**
 * Seit wann eine Person in der UHS wartet, aus der Belegungsreihe (`uhs.belegungen`): ab dem
 * jüngsten Eintritt; kam sie danach von einem Platz in den Wartebereich zurück (`wechsel` ohne
 * Platz), ab der letzten solchen Rückkehr. Wer aus einer anderen UHS herüberwechselt, hat hier
 * keinen Eintritt: sein erster Wechsel ist die Ankunft. Nach einem Austritt oder ohne Belegung
 * `null`.
 * Gleiche Zeitpunkte ordnet die Kennung (der Server liefert neueste zuerst).
 */
export function wartetSeit(
  personId: number,
  belegungen: readonly Belegungsschritt[],
): string | null {
  const reihe = belegungen
    .filter((b) => b.person_id === personId)
    .sort((a, b) =>
      a.zeitpunkt_at === b.zeitpunkt_at ? a.id - b.id : a.zeitpunkt_at < b.zeitpunkt_at ? -1 : 1,
    );
  let beginn: string | null = null;
  for (const schritt of reihe) {
    if (schritt.art === 'eintritt') beginn = schritt.zeitpunkt_at;
    else if (schritt.art === 'austritt') beginn = null;
    // Ein Wechsel ohne Aufenthalt davor kommt aus einer anderen UHS: er ist die Ankunft.
    else if (beginn == null || schritt.platz_id == null) beginn = schritt.zeitpunkt_at;
  }
  return beginn;
}

/** Volle Minuten zwischen Beginn und jetzt, nie negativ; `null` bei unlesbarem Beginn. */
export function wartezeitMinuten(seit: string, jetztMs: number): number | null {
  const beginn = zeitMs(seit);
  if (beginn == null) return null;
  return Math.max(0, Math.floor((jetztMs - beginn) / 60_000));
}

/** „12 min“, ab einer Stunde „1 h 05 min“. */
export function wartezeitText(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  return `${Math.floor(minuten / 60)} h ${String(minuten % 60).padStart(2, '0')} min`;
}
