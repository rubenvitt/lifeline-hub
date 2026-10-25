import type { CSSProperties } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import type { EtbEintragAnzeige, EtbTyp, EtbZaehler } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { inZone, type AnzeigeKonventionen } from '../anzeige/format';
import { uhrzeit, zeitKurz } from '../anzeige/zeitDarstellung';
import type { EtbZeile } from './etbZeile';
import { istNachgetragen } from './typFarben';

/** Zahl je Typ aus der serverseitigen Zählung (LFH-612). */
type EtbTypZaehler = EtbZaehler['je_typ'];

/**
 * Reine Ableitungen der ETB-Zeitachse — ohne Darstellung, ohne Hook, ohne Render prüfbar.
 *
 * Das Suffix `Modell` ist Pflicht: `EtbZeitachse.tsx` liegt daneben, und ein gleichlautender
 * Basename schattete unter Vite (`.ts` vor `.tsx`) still die Komponente.
 */

// ── Stundengruppen ──────────────────────────────────────────────────────────────────

/** Die Zeit, nach der eine Zeile einsortiert wird: Ereigniszeit bzw. lokale Erfassungszeit. */
function zeilenZeit(z: EtbZeile): string {
  return z.art === 'eintrag' ? z.eintrag.ereigniszeit : z.puffer.erstellt_at;
}

interface Stundengruppe {
  /** `YYYY-MM-DD HH` in der Anzeigezone. */
  schluessel: string;
  /** Beginn der Stunde in der Rolle „kurz“: heute `1400`, sonst `231400` ({@link stundenKopf}). */
  etikett: string;
  zeilen: EtbZeile[];
}

/**
 * Kopf einer Stundengruppe: der Beginn der Stunde in der Rolle „kurz“ des Formatkerns (LLH-1061,
 * Spec `zeitdarstellung`) — taktisch heute `1400`, sonst `231400`, bei „Datum und Uhrzeit“
 * `14:00` bzw. `23.05. 14:00`. Gerechnet in der Anzeigezone wie der Schlüssel.
 */
export function stundenKopf(
  utc: string,
  konv: AnzeigeKonventionen,
  jetzt: number = Date.now(),
): string {
  return zeitKurz(inZone(utc, konv).startOf('hour'), konv, jetzt);
}

/**
 * Ein Kopf je angefangener Stunde, Tag UND Stunde im Schlüssel — sonst fielen „gestern
 * 14 Uhr" und „heute 14 Uhr" zusammen.
 *
 * Der Schlüssel entsteht in der ANZEIGEZONE (`stundeVon`, vom Aufrufer aus den
 * Anzeigekonventionen gebaut); aus dem UTC-Wirestring geschnitten stünden die Köpfe um den
 * Zonenversatz neben den Uhrzeiten darunter.
 *
 * Gruppen erscheinen in Antreffreihenfolge — in der Zeitachse die Funkprotokoll-Ordnung aus
 * `funkprotokollFolge` (`components/useFunkprotokollLauf.ts`), älteste zuerst. Eine Zeile, deren Stunde schon einmal vorkam, aber
 * nicht direkt davor, eröffnet bewusst eine NEUE Gruppe: die Reihenfolge der Beweiskette gewinnt
 * gegen die Gruppierung.
 */
export function gruppiereNachStunde(
  zeilen: readonly EtbZeile[],
  stundeVon: (utc: string) => string,
  kopfVon: (utc: string) => string,
): Stundengruppe[] {
  const gruppen: Stundengruppe[] = [];
  for (const z of zeilen) {
    const schluessel = stundeVon(zeilenZeit(z));
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.schluessel === schluessel) {
      letzte.zeilen.push(z);
    } else {
      gruppen.push({ schluessel, etikett: kopfVon(zeilenZeit(z)), zeilen: [z] });
    }
  }
  return gruppen;
}

// ── Folgen von Systemeinträgen (LLH-1106) ─────────────────────────────────────────────

/** Ab so vielen direkt aufeinanderfolgenden schlichten Systemeinträgen steht eine Bündelzeile. */
export const BUENDEL_SCHWELLE = 3;

/** Eine Bündelzeile: die gesendeten Systemeinträge darin, älteste zuerst. */
export interface SystemBuendel {
  art: 'buendel';
  /** Nach dem ÄLTESTEN Eintrag: die Folge wächst unten, der Schlüssel (und „offen“) bleibt. */
  schluessel: string;
  zeilen: Extract<EtbZeile, { art: 'eintrag' }>[];
}

export type Zeitachsenposten = EtbZeile | SystemBuendel;

/**
 * Bündelt in einer Stundengruppe (Funkprotokoll-Ordnung, älteste zuerst) jede Folge von
 * mindestens {@link BUENDEL_SCHWELLE} direkt aufeinanderfolgenden SCHLICHTEN Systemeinträgen
 * (Spec `etb-zeitachse-darstellung`, „Folgen von Systemeinträgen gebündelt“). Schlicht heißt:
 * nicht berichtigt, nicht nachgetragen, ohne Anhang, Dokument und Rückverweis — ein solcher
 * Eintrag hat etwas zu sagen und bricht die Folge. Gepufferte Zeilen bündeln nie.
 *
 * `aus` unter `typ=system` und einer Volltextsuche: dort sucht jemand genau diese Einträge.
 * `brichtNach` beendet eine Folge nach der Zeile (die Lesemarke darf nicht im Bündel stehen).
 * Ob ein Bündel offen ist, entscheidet die Zeitachse im Render, nicht diese Funktion.
 */
export function buendleSystemfolgen(
  zeilen: readonly EtbZeile[],
  optionen: {
    aus?: boolean;
    hatDokument?: (eintragId: number) => boolean;
    brichtNach?: (z: EtbZeile) => boolean;
  },
): Zeitachsenposten[] {
  if (optionen.aus) return [...zeilen];
  const posten: Zeitachsenposten[] = [];
  let folge: SystemBuendel['zeilen'] = [];
  const schliessen = () => {
    if (folge.length >= BUENDEL_SCHWELLE) {
      posten.push({ art: 'buendel', schluessel: `buendel-${folge[0].schluessel}`, zeilen: folge });
    } else {
      posten.push(...folge);
    }
    folge = [];
  };
  for (const z of zeilen) {
    if (z.art === 'eintrag' && istSchlichterSystemeintrag(z.eintrag, optionen.hatDokument)) {
      folge.push(z);
    } else {
      schliessen();
      posten.push(z);
    }
    if (optionen.brichtNach?.(z)) schliessen();
  }
  schliessen();
  return posten;
}

function istSchlichterSystemeintrag(
  e: EtbEintragAnzeige,
  hatDokument?: (eintragId: number) => boolean,
): boolean {
  return (
    e.typ === 'system' &&
    (e.berichtigt_durch ?? []).length === 0 &&
    !istNachgetragen(e.ereigniszeit, e.received_at) &&
    e.anhaenge.length === 0 &&
    !hatVerknuepfung(e) &&
    !hatDokument?.(e.id)
  );
}

// ── Berichtigungsverknüpfung ────────────────────────────────────────────────────────

interface Verweis {
  id: number;
  lfd_nr: number;
}

export interface Berichtigungsindex {
  /** Berichtigung → ihr Grundeintrag (lfd_nr nur, wenn der Grundeintrag geladen ist). */
  grundeintrag: (e: EtbEintragAnzeige) => { id: number; lfd_nr: number | null } | null;
  /** Grundeintrag → die Berichtigung(en), die ihn korrigieren (nur geladene). */
  berichtigtDurch: (e: EtbEintragAnzeige) => Verweis[];
}

/**
 * Beide Richtungen der Verknüpfung „berichtigt Nr. n" ↔ „berichtigt durch Nr. m".
 *
 * Die Richtung Berichtigung → Grundeintrag steht im Eintrag selbst (`berichtigt_eintrag_id`)
 * und gilt auch, wenn der Grundeintrag noch nicht geladen ist — dann fehlt nur seine Nummer
 * (`lfd_nr: null`), und der Aufrufer darf sie nicht erfinden. Die Gegenrichtung kennt nur,
 * was geladen ist.
 *
 * Der Server liefert die Gegenrichtung vollständig am Eintrag (`berichtigt_durch`, LFH-689). Die
 * Zeitachse und die Palette-Vorschau lesen sie dort (LLH-1099, Entscheidung 17.10.2026: ein
 * berichtigter Eintrag ist auch unter Filter als berichtigt zu sehen). Druck und Bilanz bilden sie
 * weiter hier, über die Einträge, die sie selbst geladen haben.
 */
export function berichtigungsindex(eintraege: readonly EtbEintragAnzeige[]): Berichtigungsindex {
  const lfdNrVonId = new Map(eintraege.map((e) => [e.id, e.lfd_nr]));
  const durch = new Map<number, Verweis[]>();
  for (const e of eintraege) {
    if (e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null) {
      const liste = durch.get(e.berichtigt_eintrag_id) ?? [];
      liste.push({ id: e.id, lfd_nr: e.lfd_nr });
      durch.set(e.berichtigt_eintrag_id, liste);
    }
  }
  return {
    grundeintrag: (e) =>
      e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null
        ? { id: e.berichtigt_eintrag_id, lfd_nr: lfdNrVonId.get(e.berichtigt_eintrag_id) ?? null }
        : null,
    berichtigtDurch: (e) => durch.get(e.id) ?? [],
  };
}

/** Die jüngsten Berichtigungen unter den geladenen Einträgen, neueste zuerst. */
export function letzteBerichtigungen(
  eintraege: readonly EtbEintragAnzeige[],
  anzahl = 3,
): EtbEintragAnzeige[] {
  // Die Serverordnung IST neueste zuerst — hier wird nicht umsortiert.
  return eintraege.filter((e) => e.typ === 'berichtigung').slice(0, anzahl);
}

// ── Bilanz ──────────────────────────────────────────────────────────────────────────

/** Die Reihenfolge der Bilanz — wie die Typ-Segmente, System nur bei Bedarf (s. u.). */
const BILANZ_TYPEN: readonly EtbTyp[] = [
  'meldung',
  'anordnung',
  'entscheidung',
  'lage',
  'berichtigung',
];

interface BilanzZeile {
  typ: EtbTyp;
  anzahl: number;
}

/**
 * Die Bilanzzeilen aus der serverseitigen Zählung (LFH-612) — exakt über die Menge, die der
 * Filter trifft, nicht über das geladene Fenster.
 *
 * `system` erscheint nur, wenn es vorkommt: der Typ ist nicht erfassbar und hat kein
 * Filtersegment, eine dauerhafte Nullzeile wäre Rauschen.
 */
export function typBilanz(jeTyp: EtbTypZaehler): BilanzZeile[] {
  const zeilen: BilanzZeile[] = BILANZ_TYPEN.map((typ) => ({ typ, anzahl: jeTyp[typ] }));
  if (jeTyp.system > 0) zeilen.push({ typ: 'system', anzahl: jeTyp.system });
  return zeilen;
}

/**
 * Seitenkopf-Meta: die exakte Zahl vom Server (LFH-612) — „n Einträge" ohne, „n Treffer" unter
 * einem Filter. Ohne Zählung (lädt, gescheitert) steht NICHTS: eine Zahl aus dem geladenen
 * Fenster behauptete eine Vollständigkeit, die es nicht gibt.
 */
export function kopfMeta(args: {
  gesamt: number | undefined;
  filterAktiv: boolean;
}): string | undefined {
  const { gesamt, filterAktiv } = args;
  if (gesamt === undefined) return undefined;
  if (filterAktiv) return gesamt === 1 ? '1 Treffer' : `${gesamt} Treffer`;
  return gesamt === 1 ? '1 Eintrag' : `${gesamt} Einträge`;
}

// ── Puffer ──────────────────────────────────────────────────────────────────────────

export type PufferZustand =
  | { art: 'uebertragen' }
  | { art: 'ausstehend'; ausstehend: number }
  | { art: 'abgelehnt'; abgelehnt: number; ausstehend: number };

/**
 * Zustand der Offline-Warteschlange. Abgelehnt gewinnt: ein abgelehnter Eintrag verlangt
 * eine Handlung, ein ausstehender nur Geduld (dieselbe Rangfolge wie in `baueZeilen`).
 */
export function pufferZustand(
  ausstehend: readonly AusstehenderEintrag[],
  abgelehnt: readonly AbgelehnterEintrag[],
): PufferZustand {
  if (abgelehnt.length > 0) {
    return { art: 'abgelehnt', abgelehnt: abgelehnt.length, ausstehend: ausstehend.length };
  }
  if (ausstehend.length > 0) return { art: 'ausstehend', ausstehend: ausstehend.length };
  return { art: 'uebertragen' };
}

// ── Typfilter ───────────────────────────────────────────────────────────────────────

export type TypSegment = EtbTyp | 'alle';

/**
 * Die Segmente der Typleiste. `system` hat kein eigenes Segment — System-Einträge stehen unter
 * „Alle". Steht `typ=system` trotzdem in der URL, bekommt die Leiste das Segment dazu: sonst
 * zeigte sie „Alle" gewählt über einer gefilterten Liste.
 */
export function typSegmente(aktiv: EtbTyp | undefined): TypSegment[] {
  const basis: TypSegment[] = [
    'alle',
    'meldung',
    'anordnung',
    'entscheidung',
    'lage',
    'berichtigung',
  ];
  return aktiv === 'system' ? [...basis, 'system'] : basis;
}

/**
 * Der Filter nach einem Segmentwechsel; „alle" nimmt `typ` heraus, der Rest bleibt. Das Segment
 * `system` hebt den Ausschluss der Systemeinträge auf (LFH-958).
 */
export function filterMitTyp(filter: EtbFilterWerte, segment: TypSegment): EtbFilterWerte {
  const { typ: _alt, ...rest } = filter;
  void _alt;
  if (segment === 'alle') return rest;
  return filterZusammenfuehren(rest, { typ: segment });
}

/**
 * Führt eine Teiländerung in den bestehenden Filter und wirft leere Werte heraus.
 *
 * Grund ist ein Wettlauf über eine Komponentengrenze: die Filterleiste meldet ihre Suche
 * entprellt, die Typleiste sofort. Meldete die Leiste den GANZEN Filter aus ihrer eigenen
 * Kopie, überschriebe ein Nachläufer der Suchfrist den eben gewählten Typ. Sie meldet deshalb
 * nur ihre eigenen Schlüssel, zusammengeführt wird hier gegen den AKTUELLEN Stand.
 */
export function filterZusammenfuehren(
  aktuell: EtbFilterWerte,
  teil: Partial<EtbFilterWerte>,
): EtbFilterWerte {
  const neu: EtbFilterWerte = { ...aktuell, ...teil };
  (Object.keys(neu) as (keyof EtbFilterWerte)[]).forEach((k) => {
    if (neu[k] === undefined || neu[k] === '') delete neu[k];
  });
  // `typ: 'system'` und der Ausschluss heben sich auf (LFH-958): der Server wiese die
  // Kombination mit 422 ab. Es gilt, was diese Änderung gesetzt hat.
  if (neu.typ === 'system' && neu.ohne_system) {
    if (teil.ohne_system) delete neu.typ;
    else delete neu.ohne_system;
  }
  return neu;
}

// ── Zufluss (Sammelbanner) ──────────────────────────────────────────────────────────

/**
 * Der Stand, auf dem die Zeitachse eingefroren ist: die gezeigten Schlüssel plus die
 * höchste gezeigte laufende Nummer (Wassermarke). `lfd_nr` wächst je Einsatz streng — ein
 * Eintrag darüber ist NEU, einer darunter ist ÄLTER (nachgeladene Seite) und kann unter
 * dem Cursor nicht springen, weil er unten ankommt.
 */
export interface Einfrierstand {
  schluessel: ReadonlySet<string>;
  wassermarke: number;
}

/**
 * Live-Zufluss, der nicht unter dem Cursor springt (Bedien-Leitlinie Festlegung 6,
 * WCAG 3.2.5): solange die Zeitachse eingefroren ist, bleiben NEUE fremde Einträge — über der
 * Wassermarke — zurück und werden gezählt. Alles andere steht sofort:
 *
 * - **Ältere** (unter der Wassermarke): eine nachgeladene Seite, etwa für den Deeplink
 *   `?eintrag=`. Zurückgehalten meldete das Banner sie als „neu", und der Sprung fände seine
 *   Zeile nicht.
 * - **Eigene** (`erfasser_id` = angemeldete Person): der eben gesendete Eintrag wechselt den
 *   Schlüssel (`ausstehend-<queueId>` → `eintrag-<dbId>`); zurückgehalten wäre er in diesem
 *   Moment nirgends zu sehen.
 * - **Gepufferte**: sie sind die eigenen, noch nicht gesendeten.
 *
 * Entfallene fallen sofort weg. Die Reihenfolge bleibt die frische: neue Einträge kommen oben
 * an, die gezeigten behalten ihre relative Folge, also wandert unter dem Cursor nichts.
 */
export function teileZufluss(
  zeilen: readonly EtbZeile[],
  gefroren: Einfrierstand | null,
  eigeneBenutzerId?: number | null,
): { sichtbar: EtbZeile[]; zurueckgehalten: number } {
  if (gefroren == null) return { sichtbar: [...zeilen], zurueckgehalten: 0 };
  const sichtbar: EtbZeile[] = [];
  let zurueckgehalten = 0;
  for (const z of zeilen) {
    const zurueck =
      z.art === 'eintrag' &&
      !gefroren.schluessel.has(z.schluessel) &&
      z.eintrag.lfd_nr > gefroren.wassermarke &&
      (eigeneBenutzerId == null || z.eintrag.erfasser_id !== eigeneBenutzerId);
    if (zurueck) zurueckgehalten += 1;
    else sichtbar.push(z);
  }
  return { sichtbar, zurueckgehalten };
}

/**
 * Friert den gezeigten Stand ein — nur gesendete Einträge. Eine Folge ohne gesendeten
 * Eintrag friert nicht ein: sonst landete die erste Lieferung ganz hinter dem Banner
 * (dieselbe Falle, die `Datensicht` dokumentiert).
 */
export function einfrieren(zeilen: readonly EtbZeile[]): Einfrierstand | null {
  const schluessel = new Set<string>();
  let wassermarke = -Infinity;
  for (const z of zeilen) {
    if (z.art !== 'eintrag') continue;
    schluessel.add(z.schluessel);
    wassermarke = Math.max(wassermarke, z.eintrag.lfd_nr);
  }
  return schluessel.size > 0 ? { schluessel, wassermarke } : null;
}

export function zuflussText(anzahl: number): string {
  return anzahl === 1 ? '1 neuer Eintrag' : `${anzahl} neue Einträge`;
}

// ── Verweise in der Hinweiszeile ────────────────────────────────────────────────────

/**
 * Ein Textverweis (↗) in der Hinweiszeile ist ein handgebautes Bedienziel: ein `<a>` erbt
 * keine Steuerhöhe (LFH-396). Er bekommt deshalb den Boden aus `controlHeight` —
 * `inline-flex`, damit er im Fließtext bleibt. Rein und exportiert wie `bedienzielStil`.
 */
export function verweisStil(token: { controlHeight: number }): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', minHeight: token.controlHeight };
}

/**
 * Trägt der Eintrag einen gekoppelten Verweis — rückwärts (Befehl, Lagebericht, Auftrag, der
 * ihn erzeugt hat), vorwärts (Folgeaufträge, LFH-636) oder auf genannte Einheiten (LLH-1266)? EINE Stelle für die Frage, weil
 * `EtbZeitachse` den Verweisblock nur bei `true` einhängt und `EtbBacklinkBadges` sonst nichts
 * rendert: zwei getrennt gepflegte Bedingungen ließen Folgeaufträge ohne Rückverweis still
 * aus der Zeitachse fallen.
 */
export function hatVerknuepfung(
  e: Pick<
    EtbEintragAnzeige,
    | 'befehl_id'
    | 'lagebericht_id'
    | 'auftrag_id'
    | 'folgeauftraege'
    | 'meldung_id'
    | 'nachforderung_id'
    | 'einheiten'
  >,
): boolean {
  return (
    e.befehl_id != null ||
    e.lagebericht_id != null ||
    e.auftrag_id != null ||
    e.meldung_id != null ||
    e.nachforderung_id != null ||
    e.folgeauftraege.length > 0 ||
    // Ein Stand von vor LLH-1266 (Offline-Spiegel) trägt die Liste noch nicht.
    (e.einheiten ?? []).length > 0
  );
}

/**
 * Dokumente der Ablage nach dem ETB-Eintrag, auf den sie sich beziehen (LFH-743). Eine
 * Sammelabfrage (`GET …/dokumente`) statt eines Abrufs je Eintrag; Dokumente ohne ETB-Bezug
 * fallen heraus. Die Reihenfolge innerhalb eines Eintrags ist die der Liste.
 */
export function dokumenteJeEintrag<D extends { bezug_etb_eintrag_id?: number | null }>(
  dokumente: readonly D[],
): ReadonlyMap<number, readonly D[]> {
  const je = new Map<number, D[]>();
  for (const d of dokumente) {
    const bezug = d.bezug_etb_eintrag_id;
    if (bezug == null) continue;
    const liste = je.get(bezug);
    if (liste) liste.push(d);
    else je.set(bezug, [d]);
  }
  return je;
}

/**
 * Titel der Erfassung im Berichtigungsmodus (LLH-1099): „Berichtigung zu Nr. 135“, an einer
 * Berichtigung mit der Kette „(berichtigt Nr. 134)“. Die Nummer des Grundeintrags kennt nur, wer
 * ihn geladen hat; sonst wird keine erfunden.
 */
export function berichtigungTitel(
  zu: Pick<EtbEintragAnzeige, 'lfd_nr' | 'typ'>,
  grundNr: number | null | undefined,
): string {
  const titel = `Berichtigung zu Nr. ${zu.lfd_nr}`;
  if (zu.typ !== 'berichtigung') return titel;
  return grundNr != null
    ? `${titel} (berichtigt Nr. ${grundNr})`
    : `${titel} (berichtigt einen älteren Eintrag)`;
}

/**
 * Der Hinweis an einem Nachtrag (LLH-1088, Spec `etb-zeitachse-darstellung`, „Nachtrag mit Tag“):
 * am selben Kalendertag der Anzeigezone genügt die Uhrzeit („nachgetragen um 1421“), über
 * Mitternacht steht die Erfassung mit Tag („nachgetragen 110020“ bzw. „11.10. 00:20“) — sonst läse
 * „um 0020“ sich wie vor der Ereigniszeit. Ob es ein Nachtrag ist, sagt `istNachgetragen`.
 * Die Form ist die Rolle „kurz“ mit dem Tag der Ereigniszeit als „heute“ (LLH-1061).
 */
export function nachtragText(
  ereigniszeit: string,
  receivedAt: string,
  konv: AnzeigeKonventionen,
): string {
  const ereignis = inZone(ereigniszeit, konv);
  const erfasst = inZone(receivedAt, konv);
  return ereignis.isSame(erfasst, 'day')
    ? `nachgetragen um ${uhrzeit(receivedAt, konv)}`
    : `nachgetragen ${zeitKurz(receivedAt, konv, ereignis)}`;
}
