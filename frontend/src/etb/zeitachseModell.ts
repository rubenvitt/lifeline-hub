import type { CSSProperties } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import type { EtbEintragAnzeige, EtbTyp } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import type { EtbZeile } from './etbZeile';

/**
 * Reine Ableitungen der ETB-Zeitachse (Neuentwurf S4, 21.09.2026) — ohne Darstellung,
 * ohne Hook, ohne Render prüfbar.
 *
 * Der Dateiname trägt das Suffix `Modell`: `EtbZeitachse.tsx` liegt daneben, und ein
 * gleichlautender Basename schattete unter Vite (`.ts` vor `.tsx`) still die Komponente
 * (CLAUDE.md, `direkteinstiegKern`).
 */

// ── Stundengruppen ──────────────────────────────────────────────────────────────────

/** Die Zeit, nach der eine Zeile einsortiert wird: Ereigniszeit bzw. lokale Erfassungszeit. */
export function zeilenZeit(z: EtbZeile): string {
  return z.art === 'eintrag' ? z.eintrag.ereigniszeit : z.puffer.erstellt_at;
}

export interface Stundengruppe {
  /** `YYYY-MM-DD HH` in der Anzeigezone. */
  schluessel: string;
  /** „23.05. · 14 Uhr". */
  etikett: string;
  zeilen: EtbZeile[];
}

/** „2026-05-23 14" → „23.05. · 14 Uhr". */
export function stundenEtikett(schluessel: string): string {
  return `${schluessel.slice(8, 10)}.${schluessel.slice(5, 7)}. · ${schluessel.slice(11, 13)} Uhr`;
}

/**
 * Ein Kopf je angefangener Stunde, Tag UND Stunde im Schlüssel — sonst fielen „gestern
 * 14 Uhr" und „heute 14 Uhr" zusammen, und ein Tagebuch über Mitternacht ist der
 * Normalfall.
 *
 * Der Schlüssel entsteht in der ANZEIGEZONE (`stundeVon`, vom Aufrufer aus den
 * Anzeigekonventionen gebaut). Die Vorgängerin schnitt ihn aus dem UTC-Wirestring und
 * beschriftete ihn als Ortsstunde: die Köpfe standen um den Zonenversatz neben den
 * Uhrzeiten darunter.
 *
 * Gruppen erscheinen in Antreffreihenfolge — die ist die Serverordnung (neueste zuerst).
 * Eine Zeile, deren Stunde schon einmal vorkam, aber nicht direkt davor, eröffnet
 * bewusst eine NEUE Gruppe statt in die alte zurückzuspringen: die Reihenfolge der
 * Beweiskette gewinnt gegen die Gruppierung (ein Nachtrag mit alter Ereigniszeit steht
 * dort, wo der Server ihn einordnet).
 */
export function gruppiereNachStunde(
  zeilen: readonly EtbZeile[],
  stundeVon: (utc: string) => string,
): Stundengruppe[] {
  const gruppen: Stundengruppe[] = [];
  for (const z of zeilen) {
    const schluessel = stundeVon(zeilenZeit(z));
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.schluessel === schluessel) {
      letzte.zeilen.push(z);
    } else {
      gruppen.push({ schluessel, etikett: stundenEtikett(schluessel), zeilen: [z] });
    }
  }
  return gruppen;
}

// ── Berichtigungsverknüpfung ────────────────────────────────────────────────────────

export interface Verweis {
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
 * Die Richtung Berichtigung → Grundeintrag steht im Eintrag selbst
 * (`berichtigt_eintrag_id`) und gilt deshalb auch, wenn der Grundeintrag auf einer noch
 * nicht geladenen Seite liegt — nur seine laufende Nummer fehlt dann (`lfd_nr: null`),
 * und der Aufrufer darf sie nicht erfinden. Die Gegenrichtung kennt nur, was geladen ist.
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
export const BILANZ_TYPEN: readonly EtbTyp[] = [
  'meldung',
  'anordnung',
  'entscheidung',
  'lage',
  'berichtigung',
];

export interface BilanzZeile {
  typ: EtbTyp;
  anzahl: number;
}

/**
 * Zähler je Typ ÜBER DIE GELADENEN EINTRÄGE — keine Tages-, keine Gesamtzahl.
 *
 * Der Server liefert weder eine Gesamtzahl noch Summen je Typ (LFH-612); was hier steht,
 * ist die Zählung des geladenen Fensters und wird vom Aufrufer auch so beschriftet.
 * `system` erscheint nur, wenn es vorkommt: der Typ ist nicht erfassbar und hat kein
 * Filtersegment, eine dauerhafte Nullzeile wäre Rauschen.
 */
export function typBilanz(eintraege: readonly EtbEintragAnzeige[]): BilanzZeile[] {
  const zaehler = new Map<EtbTyp, number>();
  for (const e of eintraege) zaehler.set(e.typ, (zaehler.get(e.typ) ?? 0) + 1);
  const zeilen: BilanzZeile[] = BILANZ_TYPEN.map((typ) => ({
    typ,
    anzahl: zaehler.get(typ) ?? 0,
  }));
  const system = zaehler.get('system') ?? 0;
  if (system > 0) zeilen.push({ typ: 'system', anzahl: system });
  return zeilen;
}

/**
 * Was die Zählung umfasst — der Wortlaut, der sie ehrlich macht.
 *
 * Vollständig ist sie nur ohne Filter und ohne weitere Seite; dann (und nur dann) darf
 * sie „alle" sagen.
 */
export function bilanzUmfang(args: {
  geladen: number;
  weitereSeiten: boolean;
  filterAktiv: boolean;
}): string {
  const { geladen, weitereSeiten, filterAktiv } = args;
  const menge = geladen === 1 ? '1 geladenen Eintrag' : `${geladen} geladenen Einträgen`;
  if (filterAktiv) return `in ${menge}, die zum Filter passen`;
  if (weitereSeiten) return `in ${menge} — ältere sind nicht mitgezählt`;
  return geladen === 1 ? 'im einzigen Eintrag des Tagebuchs' : `in allen ${geladen} Einträgen`;
}

/**
 * Seitenkopf-Meta: die Zahl, die die Seite wirklich kennt.
 *
 * Ohne weitere Seite und ohne Filter ist die geladene Menge das ganze Tagebuch — dann
 * steht dort schlicht „n Einträge". Sonst „geladen", weil die Gesamtzahl serverseitig
 * fehlt (LFH-612).
 */
export function kopfMeta(args: {
  geladen: number;
  weitereSeiten: boolean;
  filterAktiv: boolean;
}): string {
  const { geladen, weitereSeiten, filterAktiv } = args;
  const n = geladen === 1 ? '1 Eintrag' : `${geladen} Einträge`;
  if (weitereSeiten) return `${n} geladen · ältere vorhanden`;
  if (filterAktiv) return geladen === 1 ? '1 Treffer' : `${geladen} Treffer`;
  return n;
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
 * Die Segmente der Typleiste. `system` hat kein eigenes Segment (Entwurf S4: Alle ·
 * Meldung · Anordnung · Entscheidung · Lage · Berichtigung) — System-Einträge stehen
 * unter „Alle". Steht `typ=system` trotzdem in der URL (Deeplink, Hand), bekommt die
 * Leiste das Segment dazu: sonst zeigte sie „Alle" gewählt über einer gefilterten Liste.
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

/** Der Filter nach einem Segmentwechsel; „alle" nimmt `typ` heraus, der Rest bleibt. */
export function filterMitTyp(filter: EtbFilterWerte, segment: TypSegment): EtbFilterWerte {
  const { typ: _alt, ...rest } = filter;
  void _alt;
  return segment === 'alle' ? rest : { ...rest, typ: segment };
}

/**
 * Führt eine Teiländerung in den bestehenden Filter und wirft leere Werte heraus.
 *
 * Der Grund für die Funktion ist ein Wettlauf über eine Komponentengrenze: die
 * Filterleiste meldet ihre Suche entprellt (300 ms), die Typleiste sofort. Meldete die
 * Leiste den GANZEN Filter aus ihrer eigenen Kopie, überschriebe ein Nachläufer der
 * Suchfrist den eben gewählten Typ. Sie meldet deshalb nur ihre eigenen Schlüssel, und
 * zusammengeführt wird hier — gegen den AKTUELLEN Stand, nicht gegen den, den eine
 * Schließung beim Start der Frist gesehen hat.
 */
export function filterZusammenfuehren(
  aktuell: EtbFilterWerte,
  teil: Partial<EtbFilterWerte>,
): EtbFilterWerte {
  const neu: EtbFilterWerte = { ...aktuell, ...teil };
  (Object.keys(neu) as (keyof EtbFilterWerte)[]).forEach((k) => {
    if (neu[k] === undefined || neu[k] === '') delete neu[k];
  });
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
 * WCAG 3.2.5): solange die Zeitachse eingefroren ist, bleiben NEUE fremde Einträge — über
 * der Wassermarke — zurück und werden gezählt. Alles andere steht sofort:
 *
 * - **Ältere** (unter der Wassermarke): eine nachgeladene Seite, etwa weil der Deeplink
 *   `?eintrag=` einen Grundeintrag sucht. Die Vorgängerin hielt jede Zeile außerhalb des
 *   Einfrier-Satzes zurück — das Banner meldete die alten Einträge als „neu", und der
 *   Sprung fand seine Zeile nicht (Review 22.09.2026, Befund A).
 * - **Eigene** (`erfasser_id` = angemeldete Person): der eben gesendete Eintrag wechselt
 *   den Schlüssel (`ausstehend-<queueId>` → `eintrag-<dbId>`); zurückgehalten wäre er in
 *   diesem Moment nirgends zu sehen — der teuerste Fehlermodus (Befund B).
 * - **Gepufferte**: sie sind die eigenen, noch nicht gesendeten.
 *
 * Entfallene fallen sofort weg (eine nicht mehr vorhandene Zeile kann man nicht zeigen).
 * Die Reihenfolge bleibt die frische: neue Einträge kommen oben an, die gezeigten
 * behalten ihre relative Folge, also wandert unter dem Cursor nichts.
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
 * keine Steuerhöhe (LFH-396, gemessen 17 px in jeder Stufe). Er bekommt deshalb den Boden
 * aus `controlHeight` (30 / 48 / 72) — `inline-flex`, damit er im Fließtext der Zeile
 * bleibt. Rein und exportiert nach dem Muster von `bedienzielStil`.
 */
export function verweisStil(token: { controlHeight: number }): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', minHeight: token.controlHeight };
}
