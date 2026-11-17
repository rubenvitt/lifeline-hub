/**
 * Ableitungen des Führungsüberblicks. Die Seite entscheidet über Form, diese Datei über Bedeutung
 * (wie `pages/lage-dashboard/lagebild.ts`). Alles ist rein und nimmt die Uhr als Argument `jetzt`:
 * die Seite tickt, der Test stellt die Zeit.
 *
 * Der Basename ist bewusst nicht `ueberblick.ts` neben `UeberblickPage.tsx` (Kollisionsregel
 * `direkteinstiegKern`).
 *
 * Zeit: jeder Wire-String ist UTC ohne Zonenkennung. Verglichen wird nur über {@link zeitpunkt}
 * (`dayjs.utc`), nie über `dayjs(s)` — das läse Ortszeit und verschöbe das 60-Minuten-Fenster still
 * um den Zonenversatz.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type {
  Abloesung,
  AbschnittLagezustand,
  Auftrag,
  Einheit,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  Erinnerung,
  EtbEintragAnzeige,
  Gefahrengebiet,
  LetzteRueckmeldung,
  PegelAnzeige,
  Programmpunkt,
  Rueckmeldungen,
  Warnstufe,
  WetterWarnstufe,
} from '../../api/types';
import { staerkeText } from '../../anzeige/staerke';
import type { KennzahlTon } from '../../components/instrument';
import {
  OHNE_ABSCHNITT_KEY,
  OHNE_EINHEIT_KEY_PREFIX,
  baueKraeftebild,
  type MeldebildZeile,
  type StaerkeSumme,
} from '../../kraefte/kraeftebild';
import { verdichteGefahrengebiete } from '../lage-dashboard/lageVerdichtung';
import {
  letzteImTeilbaum,
  rueckmeldungJeEinheit,
  rueckmeldungUeberfaelligSeit,
  rueckmeldungZustand,
} from '../../meldungen/rueckmeldung';
import { type ToenungsGrund } from '../../kraefte/meldebildRaster';
import { prognoseOffen, wasserstandMeter } from '../../pegel/pegelKennzahl';
import { ausfallJeEinheit, OHNE_EINHEIT } from '../../lage/ausfallJeEinheit';
import {
  dauerText,
  lagebesprechungUeberfaellig,
} from '../../lagebesprechung/lagebesprechungZustand';
import { abloesungsMarken } from '../../abloesung/einstufung';
import { ERINNERUNG_FAELLIG, erinnerungZustand } from '../../erinnerung/erinnerungZustand';
import { istUnwetter, paarSchluessel, unwetterMarkenText } from '../../wetter/unwetter';
import { warnstufeKennzahl, type Statusrolle } from '../../theme/statusFarben';
import { mitBesetzung } from '../../fuehrung/funktionsOptionenKern';
import { einsatzRechteGrund } from '../../components/nurAnsicht';
import { UNBESTAETIGT, istBeurteilt } from '../gefahren/beurteilung';

dayjs.extend(utc);

/** Das Fenster „in 60 min" / „der letzten Stunde". */
const FENSTER_MINUTEN = 60;
/** Ab hier gilt eine Marke als knapp (Ton `achtung`). */
const KNAPP_MINUTEN = 30;
/** Wie viele Entscheidungen der Rückfall zeigt, wenn die letzte Stunde leer ist. */
const ENTSCHEIDUNGEN_RUECKFALL = 5;
/** Wie viele Marken das Seitenfeld trägt; der Rest wird gezählt, nicht verschwiegen. */
const MARKEN_MAX = 6;

/** Wire-Zeit (UTC ohne Zone) → Zeitpunkt; `null` bei fehlendem oder unlesbarem Wert. */
export function zeitpunkt(wire: string | null | undefined): Dayjs | null {
  if (!wire) return null;
  const d = dayjs.utc(wire);
  return d.isValid() ? d : null;
}

function ms(wire: string | null | undefined): number | null {
  return zeitpunkt(wire)?.valueOf() ?? null;
}

// ── Kennzahlen ──────────────────────────────────────────────────────────────────

/**
 * Statusrolle → Ton der Kennzahl, exhaustiv, damit eine neue Rolle den Build bricht. `normal` und
 * `bedien` bleiben hier neutral: „keine Gefahr" ist die neutrale Zahl, und eine Warnstufe ist keine
 * Bedienbeziehung.
 */
const ROLLE_ALS_TON: Record<Statusrolle, KennzahlTon> = {
  alarm: 'alarm',
  achtung: 'achtung',
  normal: 'neutral',
  neutral: 'neutral',
  bedien: 'neutral',
  marke: 'neutral',
};

interface WarnstufeKennzahl {
  stufe: Warnstufe;
  /** Das Wort — der zweite Kanal neben der Farbe. */
  wort: string;
  ton: KennzahlTon;
  anzahlAktiv: number;
  /** Gebiete ohne bestätigte Beurteilung (LLH-1090): ihr „keine“ hat niemand geprüft. */
  nichtBeurteilt: number;
}

/**
 * Höchste Warnstufe über alle Gefahrengebiete — über `warnstufeKennzahl`, nicht `warnstufeKarte`
 * (Begründung in `lagebild.ts`).
 */
export function warnstufeKennzahlVon(gebiete: Gefahrengebiet[]): WarnstufeKennzahl {
  const v = verdichteGefahrengebiete(gebiete);
  const d = warnstufeKennzahl[v.hoechste];
  return {
    stufe: v.hoechste,
    wort: d.label,
    ton: ROLLE_ALS_TON[d.rolle],
    anzahlAktiv: v.anzahlAktiv,
    nichtBeurteilt: gebiete.filter((g) => !istBeurteilt(g)).length,
  };
}

/**
 * Notiz der Warnstufen-Kennzahl: die Gebietszahl, dahinter die unbestätigten Gebiete
 * (LLH-1090, nur wenn es welche gibt) und die Pegel-Notiz (`pegelNotizKurz`). Angehängt statt
 * ersetzt: die Gebietszahl begründet den Wert, „unbestätigt“ schränkt ihn ein, der Pegel ist
 * die Lage daneben. Ohne festgelegten Pegel (`null`) fehlt er.
 */
export function warnstufeNotiz(
  anzahlAktiv: number,
  pegelNotiz: string | null,
  nichtBeurteilt = 0,
): string {
  const gebiete =
    anzahlAktiv === 1
      ? '1 Gefahrengebiet mit Warnstufe'
      : `${anzahlAktiv} Gefahrengebiete mit Warnstufe`;
  const offen = nichtBeurteilt > 0 ? `${nichtBeurteilt} ${UNBESTAETIGT}` : null;
  return [gebiete, offen, pegelNotiz].filter(Boolean).join(' · ');
}

function sortiereAbschnitte(abschnitte: Einsatzabschnitt[]): Einsatzabschnitt[] {
  return [...abschnitte].sort((a, b) => a.sortier - b.sortier || a.id - b.id);
}

// ── Aufträge ────────────────────────────────────────────────────────────────────

/** Offen im Sinne des Überblicks: `offen` oder `in_arbeit` — dieselbe Menge wie `ist_offen()`
 *  im Modulzähler des Servers (`src/auftrag/mod.rs`). Das gemeinsame Fixture
 *  `tests/fixtures/verdichtung/regeln.json` hält beide gleich (LFH-550). */
export function istOffen(a: Pick<Auftrag, 'bearbeitungsstatus'>): boolean {
  return a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit';
}

/**
 * Offene Aufträge in Lesefolge: überfällige zuerst, dann nach Frist; ohne Frist ans Ende. Bei
 * Gleichstand nach Erteilung, zuletzt nach id — ein Live-Refetch liefert dieselbe Folge.
 */
export function offeneAuftraege(auftraege: Auftrag[]): Auftrag[] {
  return auftraege.filter(istOffen).sort((a, b) => {
    if (a.ist_ueberfaellig !== b.ist_ueberfaellig) return a.ist_ueberfaellig ? -1 : 1;
    const fa = ms(a.frist_at);
    const fb = ms(b.frist_at);
    if (fa !== fb) {
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb;
    }
    const ea = ms(a.erteilt_at) ?? 0;
    const eb = ms(b.erteilt_at) ?? 0;
    return ea - eb || a.id - b.id;
  });
}

/**
 * „an …" — die Empfängernamen, wie beim Erteilen festgehalten; `null`, wenn keiner (die Seite
 * schreibt dann „ohne Empfänger"). Ein Sachgebiet trägt dahinter die aktuelle Besetzung, wenn der
 * Server sie aufgelöst hat (LFH-549).
 */
export function empfaengerText(a: Auftrag): string | null {
  const namen = (a.empfaenger ?? [])
    .filter((e) => e.snap_anzeige.trim())
    .map((e) => mitBesetzung(e.snap_anzeige.trim(), e.aktuelle_besetzung));
  return namen.length > 0 ? namen.join(', ') : null;
}

export function folgeText(anzahl: number): string | null {
  if (anzahl <= 0) return null;
  return anzahl === 1 ? '1 Auftrag' : `${anzahl} Aufträge`;
}

// ── Einsatzabschnitte ───────────────────────────────────────────────────────────

/** Einheiten je Kategorie ihres Status. */
export interface EinheitenVerteilung {
  bereit: number;
  gebunden: number;
  /** Einheiten mit Status „nicht verfügbar“ — nicht „Ausfall“: den zählt das Meldebild an den
   *  Mitteln (LLH-1739, {@link AbschnittZeile.ausfallMittel}). */
  nichtVerfuegbar: number;
  /**
   * Einheiten ohne Kategorie — ohne Status oder „gemischt" über Kategorien hinweg; gezählt,
   * damit die drei Zellen nicht mehr behaupten.
   */
  ohne: number;
}

export interface AbschnittZeile {
  key: string;
  /** `null` nur für die Sammelzeile „Ohne Abschnitt" — sie hat keinen Deeplink. */
  abschnittId: number | null;
  name: string;
  leiter: string | null;
  /** Alle Einheiten im Teilbaum, auch untergeordnete Einheiten und Unterabschnitte. */
  einheiten: number;
  unterabschnitte: number;
  staerke: StaerkeSumme;
  staerkeText: string;
  einheitenStatus: EinheitenVerteilung;
  /** Offene Aufträge an diesen Abschnitt (oder einen Unterabschnitt), jüngste zuerst. */
  auftraege: Auftrag[];
  /**
   * Stehen die Rückmeldungen fest? `false` beim Laden, bei 403 und bei Fehler — dann zeigt die
   * Zeile nichts dazu, auch kein „—": ein Strich behauptete „keine Rückmeldung".
   */
  rueckmeldungBekannt: boolean;
  /** Jüngste Rückmeldung im Teilbaum (Abschnitte direkt UND Einheiten darin); `null`, wenn
   *  keine vorliegt oder {@link rueckmeldungBekannt} `false` ist. */
  letzteRueckmeldung: LetzteRueckmeldung | null;
  /**
   * Letzte Rückmeldung JE Einheit des Teilbaums (`null` = nie zurückgemeldet), damit eine frische
   * Meldung einer Einheit eine andere, die schweigt, nicht verdeckt (LLH-1739). `null`, solange
   * {@link rueckmeldungBekannt} `false` ist. Das Urteil hängt an der Uhr: {@link abschnittGruende}.
   */
  einheitenRueckmeldung: (LetzteRueckmeldung | null)[] | null;
  /** Ausfall der Mittel und des Materials der Einheiten im Teilbaum, gezählt wie die Gründe der
   *  Tönung im Meldebild (`toenungsGruende`, eine Heimat je Zahl). */
  ausfallMittel: number;
  ausfallMaterial: number;
  /**
   * Alle Aufträge an den Teilbaum; erledigt = vollzogen oder abgenommen. Eine Zählung, in der
   * jeder Auftrag gleich wiegt; die Lage selbst trägt der Lagezustand.
   */
  auftragsbilanz: { erledigt: number; gesamt: number };
  /**
   * Die folgenden drei gehören dem obersten Abschnitt selbst, nicht dem Teilbaum: eine Beurteilung
   * lässt sich nicht aufsummieren. `null` = nicht gepflegt.
   */
  kurzbezeichnung: string | null;
  lagezustand: AbschnittLagezustand | null;
  abschnittsauftrag: string | null;
  /**
   * Schlechtester Lagezustand eines Unterabschnitts, nur wenn schlechter als der eigene — damit ein
   * kritischer Unterabschnitt nicht hinter einer grünen Kante verschwindet.
   */
  unterLage: AbschnittLagezustand | null;
}

/** Ordnung der Lagezustände; „nicht beurteilt" liegt unter allen. */
const LAGE_RANG: Record<AbschnittLagezustand, number> = {
  planmaessig: 1,
  angespannt: 2,
  kritisch: 3,
};
const lageRang = (l: AbschnittLagezustand | null | undefined) => (l ? LAGE_RANG[l] : 0);

interface AbschnittRohdaten {
  abschnitte: Einsatzabschnitt[];
  einheiten: Einheit[];
  personal: EinsatzPersonal[];
  fahrzeuge: EinsatzFahrzeug[];
  material: EinsatzMaterial[];
  auftraege: Auftrag[];
  /** `GET …/meldungen/rueckmeldungen`; `undefined`, solange nicht (oder nie) geladen. */
  rueckmeldungen?: Rueckmeldungen;
}

function abschnittIdAusKey(key: string): number | null {
  const m = /^ab-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** Einheit-id aus dem Meldebild-Schlüssel `eh-<id>`; die Sammelzeilen `eh-ohne-…` fallen
 *  am Muster heraus, weil `ohne` keine Ziffernfolge ist. */
function einheitIdAusKey(key: string): number | null {
  const m = /^eh-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

function zaehleImTeilbaum(zeile: MeldebildZeile): {
  einheiten: number;
  abschnittIds: number[];
  einheitIds: number[];
  /** Hängt die Sammelzeile „Ohne Einheit“ (Mittel ohne Einheit) in diesem Teilbaum? */
  ohneEinheit: boolean;
} {
  let einheiten = 0;
  let ohneEinheit = zeile.art === 'einheit' && zeile.key.startsWith(OHNE_EINHEIT_KEY_PREFIX);
  const abschnittIds: number[] = [];
  const einheitIds: number[] = [];
  const id = abschnittIdAusKey(zeile.key);
  if (zeile.art === 'abschnitt' && id != null) abschnittIds.push(id);
  if (zeile.art === 'einheit' && !zeile.key.startsWith(OHNE_EINHEIT_KEY_PREFIX)) einheiten += 1;
  const einheitId = zeile.art === 'einheit' ? einheitIdAusKey(zeile.key) : null;
  if (einheitId != null) einheitIds.push(einheitId);
  for (const kind of zeile.children ?? []) {
    const k = zaehleImTeilbaum(kind);
    einheiten += k.einheiten;
    abschnittIds.push(...k.abschnittIds);
    einheitIds.push(...k.einheitIds);
    ohneEinheit ||= k.ohneEinheit;
  }
  return { einheiten, abschnittIds, einheitIds, ohneEinheit };
}

/** Einheiten nach der Kategorie ihres Status — „gemischt" zählt mit, wenn die Kategorie gemeinsam ist. */
function einheitenVerteilung(einheiten: readonly (Einheit | undefined)[]): EinheitenVerteilung {
  const v: EinheitenVerteilung = { bereit: 0, gebunden: 0, nichtVerfuegbar: 0, ohne: 0 };
  for (const e of einheiten) {
    switch (e?.status?.kategorie) {
      case 'verfuegbar':
        v.bereit += 1;
        break;
      case 'gebunden':
        v.gebunden += 1;
        break;
      case 'nicht_verfuegbar':
        v.nichtVerfuegbar += 1;
        break;
      default:
        v.ohne += 1;
    }
  }
  return v;
}

/**
 * Eine Zeile je oberstem Abschnitt, Zahlen kumuliert über Unterabschnitte (wie `baueKraeftebild`),
 * so summieren sich die Zeilen zur Einsatzstärke. Die Sammelzeile „Ohne Abschnitt" steht am Ende,
 * wenn sie etwas trägt — sonst gingen diese Kräfte still aus der Summe verloren.
 *
 * Das Raster bereit / gebunden / nicht verfügbar zählt die Einheiten im Teilbaum nach der
 * Kategorie ihres Status (abgeleitet aus den Fahrzeugen oder von Hand). Den Ausfall zählt das
 * Meldebild: dieselben Gründe der Tönung je Einheit, summiert über den Teilbaum (LLH-1739).
 */
export function abschnittZeilen(r: AbschnittRohdaten): AbschnittZeile[] {
  const { baum } = baueKraeftebild(r.abschnitte, r.einheiten, r.personal, r.fahrzeuge, r.material);
  const ausfallJe = ausfallJeEinheit(r);
  const rueckJe = r.rueckmeldungen != null ? rueckmeldungJeEinheit(r.rueckmeldungen) : null;
  const abschnittNachId = new Map(r.abschnitte.map((a) => [a.id, a]));
  const einheitNachId = new Map(r.einheiten.map((e) => [e.id, e]));
  const offen = r.auftraege
    .filter(istOffen)
    .sort((a, b) => (ms(b.erteilt_at) ?? 0) - (ms(a.erteilt_at) ?? 0) || b.id - a.id);

  const zeilen: AbschnittZeile[] = baum.map((knoten) => {
    const id = abschnittIdAusKey(knoten.key);
    const abschnitt = id != null ? abschnittNachId.get(id) : undefined;
    const { einheiten, abschnittIds, einheitIds, ohneEinheit } = zaehleImTeilbaum(knoten);
    // Mittel ohne Einheit zählen wie im Meldebild mit (dort die Zeile „Ohne Einheit“).
    const ausfallIds: (number | typeof OHNE_EINHEIT)[] = ohneEinheit
      ? [...einheitIds, OHNE_EINHEIT]
      : einheitIds;
    const teilbaum = new Set(abschnittIds);
    const anTeilbaum =
      teilbaum.size === 0
        ? []
        : r.auftraege.filter((a) =>
            (a.empfaenger ?? []).some(
              (e) => e.abschnitt_id != null && teilbaum.has(e.abschnitt_id),
            ),
          );
    const bilanzMenge = anTeilbaum.filter((a) => a.bearbeitungsstatus !== 'aufgehoben');
    const eigeneLage = abschnitt?.lagezustand ?? null;
    let unterLage: AbschnittLagezustand | null = null;
    for (const uid of abschnittIds) {
      if (uid === id) continue;
      const l = abschnittNachId.get(uid)?.lagezustand ?? null;
      if (lageRang(l) > lageRang(unterLage)) unterLage = l;
    }
    return {
      key: knoten.key,
      abschnittId: knoten.key === OHNE_ABSCHNITT_KEY ? null : id,
      name: knoten.bezeichnung,
      leiter: abschnitt?.leiter_name ?? null,
      einheiten,
      unterabschnitte: Math.max(0, abschnittIds.length - 1),
      staerke: knoten.staerke,
      staerkeText: staerkeText(knoten.staerke),
      einheitenStatus: einheitenVerteilung(einheitIds.map((eid) => einheitNachId.get(eid))),
      auftraege: offen.filter((a) => anTeilbaum.includes(a)),
      // Ein aufgehobener Auftrag ist weder erledigt noch Teil der Arbeit (LLH-1098).
      auftragsbilanz: {
        erledigt: bilanzMenge.filter((a) => !istOffen(a)).length,
        gesamt: bilanzMenge.length,
      },
      kurzbezeichnung: abschnitt?.kurzbezeichnung ?? null,
      lagezustand: eigeneLage,
      abschnittsauftrag: abschnitt?.abschnittsauftrag ?? null,
      unterLage: lageRang(unterLage) > lageRang(eigeneLage) ? unterLage : null,
      // Kein Kurzschluss auf leeren `teilbaum`: „Ohne Abschnitt" hat keine Abschnitt-ids, ihre
      // Einheiten melden trotzdem zurück.
      rueckmeldungBekannt: r.rueckmeldungen != null,
      letzteRueckmeldung:
        r.rueckmeldungen != null
          ? letzteImTeilbaum(r.rueckmeldungen, teilbaum, new Set(einheitIds))
          : null,
      einheitenRueckmeldung: rueckJe ? einheitIds.map((eid) => rueckJe.get(eid) ?? null) : null,
      ausfallMittel: ausfallIds.reduce<number>(
        (n, eid) => n + (ausfallJe.get(eid)?.mittel ?? 0),
        0,
      ),
      ausfallMaterial: ausfallIds.reduce<number>(
        (n, eid) => n + (ausfallJe.get(eid)?.material ?? 0),
        0,
      ),
    };
  });

  // Oberste Abschnitte in der gepflegten Reihenfolge; „Ohne Abschnitt" bleibt am Ende.
  const rang = new Map(sortiereAbschnitte(r.abschnitte).map((a, i) => [a.id, i]));
  return zeilen.sort((a, b) => {
    if (a.abschnittId == null) return 1;
    if (b.abschnittId == null) return -1;
    return (rang.get(a.abschnittId) ?? 0) - (rang.get(b.abschnittId) ?? 0);
  });
}

/**
 * Gründe, die die Abschnittskarte im Überblick als Etikett in der Alarmrolle nennt (LLH-1739):
 * Ausfall der Mittel und des Materials, überfällige Rückmeldungen (Zahl der Einheiten, längste
 * Dauer) und Einheiten ohne jede Rückmeldung. Gerechnet zur Seitenuhr `jetzt`, nicht im Memo der
 * Zeilen; ohne feststehende Rückmeldungen kein Rückmeldungsgrund. Wortlaut: `grundWort`.
 */
export function abschnittGruende(zeile: AbschnittZeile, jetzt: Dayjs): ToenungsGrund[] {
  const gruende: ToenungsGrund[] = [];
  if (zeile.ausfallMittel > 0) gruende.push({ art: 'ausfall', anzahl: zeile.ausfallMittel });
  if (zeile.ausfallMaterial > 0) {
    gruende.push({ art: 'ausfall_material', anzahl: zeile.ausfallMaterial });
  }
  if (!zeile.rueckmeldungBekannt || zeile.einheitenRueckmeldung == null) return gruende;
  let ueberfaellig = 0;
  let laengste: number | null = null;
  let keine = 0;
  for (const r of zeile.einheitenRueckmeldung) {
    const zustand = rueckmeldungZustand(r, jetzt);
    if (zustand === 'keine') keine += 1;
    if (zustand !== 'ueberfaellig') continue;
    ueberfaellig += 1;
    const seit = rueckmeldungUeberfaelligSeit(r, jetzt);
    if (seit != null && (laengste == null || seit > laengste)) laengste = seit;
  }
  if (ueberfaellig > 0) {
    gruende.push({ art: 'rueckmeldung_ueberfaellig', seitMin: laengste, einheiten: ueberfaellig });
  }
  if (keine > 0) gruende.push({ art: 'rueckmeldung_keine', einheiten: keine });
  return gruende;
}

// ── Entscheidungen ──────────────────────────────────────────────────────────────

interface EntscheidungsAuswahl {
  eintraege: EtbEintragAnzeige[];
  /** `stunde`: die letzte Stunde trug Entscheidungen. `zuletzt`: Rückfall auf die jüngsten. */
  modus: 'stunde' | 'zuletzt';
}

/**
 * Entscheidungen der letzten Stunde, jüngste zuerst. Ist die Stunde leer, die letzten {@link
 * ENTSCHEIDUNGEN_RUECKFALL} — der Modus sagt es, damit die Überschrift nicht lügt.
 */
export function entscheidungenAuswahl(
  eintraege: EtbEintragAnzeige[],
  jetzt: Dayjs,
): EntscheidungsAuswahl {
  const sortiert = eintraege
    .filter((e) => e.typ === 'entscheidung')
    .sort((a, b) => (ms(b.ereigniszeit) ?? 0) - (ms(a.ereigniszeit) ?? 0) || b.lfd_nr - a.lfd_nr);
  const grenze = jetzt.valueOf() - FENSTER_MINUTEN * 60_000;
  const stunde = sortiert.filter((e) => (ms(e.ereigniszeit) ?? -Infinity) >= grenze);
  if (stunde.length > 0) return { eintraege: stunde, modus: 'stunde' };
  return { eintraege: sortiert.slice(0, ENTSCHEIDUNGEN_RUECKFALL), modus: 'zuletzt' };
}

// ── Nächste Marken ──────────────────────────────────────────────────────────────

export type MarkenTon = 'neutral' | 'achtung' | 'alarm';
export type MarkenArt =
  | 'auftrag'
  | 'erinnerung'
  | 'lagebesprechung'
  | 'pegelprognose'
  | 'abloesung'
  | 'unwetter'
  | 'programmpunkt';

export interface Marke {
  key: string;
  art: MarkenArt;
  /**
   * id des Auftrags, der Erinnerung, des Pegels bzw. des Programmpunkts; `null` bei
   * Lagebesprechung, Ablösung (eine
   * Ablösungsmarke fasst mehrere Schichten zusammen) und Unwetter (Warnungen tragen keine id).
   */
  id: number | null;
  zeit: string;
  text: string;
  ton: MarkenTon;
  /** Zweiter Kanal neben der Farbe: „überfällig" · „in 23 min". */
  wort: string;
}

interface MarkenAuswahl {
  marken: Marke[];
  /** Wie viele Marken hinter {@link MARKEN_MAX} nicht gezeigt werden. */
  weitere: number;
}

/**
 * Ton und Wort einer Frist: überfällig `alarm`, unter {@link KNAPP_MINUTEN} `achtung`, sonst
 * `neutral`. Ausnahme ist die überfällige Lagebesprechung: sie liest Ton und Wort aus
 * `lagebesprechungUeberfaellig`, damit die Seite Lagebesprechung und diese Liste denselben Termin
 * gleich zeigen (LFH-859, `lagebesprechung/AGENTS.md`). Ebenso eine verstrichene Erinnerung: sie
 * heißt „fällig“ in Achtung wie im Abschnitt „Erinnerungen“ (`erinnerungZustand`, LLH-1749). Ein Programmpunkt ist keine Frist und
 * bleibt immer `neutral` (LLH-1570, Spec `ablaufplan`: Marke ohne Alarm).
 */
export function markenBewertung(
  zeit: Dayjs,
  jetzt: Dayjs,
  art?: MarkenArt,
  /** Nur Erinnerung: fällig nach `erinnerungZustand` (Server oder Uhr). */
  erinnerungFaellig = false,
): { ton: MarkenTon; wort: string } {
  if (art === 'lagebesprechung') {
    const ueberfaellig = lagebesprechungUeberfaellig(zeit, jetzt);
    if (ueberfaellig) return { ton: ueberfaellig.rolle, wort: ueberfaellig.label };
  }
  const abstand = zeit.valueOf() - jetzt.valueOf();
  if (art === 'erinnerung' && (erinnerungFaellig || abstand <= 0)) {
    return { ton: ERINNERUNG_FAELLIG.ton, wort: ERINNERUNG_FAELLIG.wort };
  }
  if (abstand <= 0) return { ton: 'alarm', wort: 'überfällig' };
  const minuten = Math.floor(abstand / 60_000);
  const wort = abstandText(minuten);
  if (art === 'programmpunkt') return { ton: 'neutral', wort };
  return { ton: minuten < KNAPP_MINUTEN ? 'achtung' : 'neutral', wort };
}

/** „in 23 min“, unter einer Minute „in < 1 min“. */
function abstandText(minuten: number): string {
  return minuten <= 0 ? 'in < 1 min' : `in ${dauerText(minuten)}`;
}

/** „HANN. MÜNDEN (WESER)" — Station mit Gewässer, ohne Gewässer nur die Station. Rein. */
function pegelBezeichnung(p: Pick<PegelAnzeige, 'name' | 'gewaesser'>): string {
  const gewaesser = p.gewaesser?.trim();
  return gewaesser ? `${p.name} (${gewaesser})` : p.name;
}

/**
 * Anstehende Fristen aus sieben Quellen: offene Aufträge, offene Erinnerungen, nächste
 * Lagebesprechung, erwarteter Höchststand an einem maßgeblichen Pegel, fällige Ablösungen,
 * Beginn angekündigter Unwetterwarnungen und Programmpunkte der Veranstaltung (LLH-1570).
 * Aufsteigend nach Zeit, Überfälliges also oben.
 *
 * Pegel-Prognose, Unwetterbeginn und Programmpunkt sind keine Fristen, sondern Erwartungen:
 * verstrichen sind sie vorbei, nicht „überfällig", und fallen vor dem Sortieren heraus. Ein begonnenes Unwetter
 * trägt der Modulzähler weiter (LFH-663). Ablösungen kommen als eigene Quelle (je
 * Abschnitt und Minute zusammengefasst); ihre Auto-Fristen in den Erinnerungen werden deshalb
 * übersprungen, sonst stünde dieselbe Ablösung doppelt.
 */
export function naechsteMarken(
  auftraege: Auftrag[],
  erinnerungen: Erinnerung[],
  naechsteLagebesprechung: string | null | undefined,
  jetzt: Dayjs,
  pegel: readonly PegelAnzeige[] = [],
  abloesungen: readonly Abloesung[] = [],
  unwetter: readonly {
    stufe: WetterWarnstufe;
    ereignis: string;
    beginn?: string | null;
  }[] = [],
  programm: readonly Programmpunkt[] = [],
): MarkenAuswahl {
  const roh: {
    key: string;
    art: MarkenArt;
    id: number | null;
    zeit: string;
    text: string;
    /** Nur Erinnerung: der Server meldet sie fällig (`ist_faellig`), auch wenn die Uhr des Geräts
     *  nachgeht — dieselbe Regel wie der Abschnitt „Erinnerungen“ (`erinnerungZustand`). */
    faellig?: boolean;
  }[] = [];
  for (const a of auftraege) {
    if (istOffen(a) && zeitpunkt(a.frist_at)) {
      roh.push({
        key: `a-${a.id}`,
        art: 'auftrag',
        id: a.id,
        zeit: a.frist_at!,
        text: a.auftrag_text,
      });
    }
  }
  for (const e of erinnerungen) {
    if (
      e.bezug_typ === 'abloesung' ||
      e.bezug_typ === 'abloesung_vorwarnung' ||
      e.bezug_typ === 'abloesung_planung'
    ) {
      continue;
    }
    if (e.status === 'offen' && zeitpunkt(e.faellig_at)) {
      roh.push({
        key: `e-${e.id}`,
        art: 'erinnerung',
        id: e.id,
        zeit: e.faellig_at,
        text: e.titel,
        faellig: erinnerungZustand(e, jetzt.valueOf()).wort === ERINNERUNG_FAELLIG.wort,
      });
    }
  }
  for (const m of abloesungsMarken(abloesungen)) {
    roh.push({ key: m.key, art: 'abloesung', id: null, zeit: m.zeit, text: m.text });
  }
  if (zeitpunkt(naechsteLagebesprechung)) {
    roh.push({
      key: 'lagebesprechung',
      art: 'lagebesprechung',
      id: null,
      zeit: naechsteLagebesprechung!,
      text: 'Lagebesprechung',
    });
  }
  for (const p of pegel) {
    const prognose = p.prognose;
    if (prognose && prognoseOffen(prognose, jetzt.valueOf()) && zeitpunkt(prognose.zeitpunkt)) {
      roh.push({
        key: `p-${p.id}`,
        art: 'pegelprognose',
        id: p.id,
        zeit: prognose.zeitpunkt,
        // Gewässer nur als Zusatz: zwei Pegel am selben Gewässer wären sonst nicht zu
        // unterscheiden.
        text: `Erwarteter Höchststand Pegel ${pegelBezeichnung(p)}: ${wasserstandMeter(prognose.hoechststand_cm)} m`,
      });
    }
  }
  for (const w of unwetter) {
    const beginn = zeitpunkt(w.beginn);
    if (!istUnwetter(w.stufe) || !beginn || !beginn.isAfter(jetzt)) continue;
    const key = `u-${paarSchluessel(w)}-${beginn.valueOf()}`;
    // Zwei Ausgaben derselben Warnung zum selben Beginn sind eine Marke.
    if (roh.some((m) => m.key === key)) continue;
    roh.push({ key, art: 'unwetter', id: null, zeit: w.beginn!, text: unwetterMarkenText(w) });
  }
  for (const p of programm) {
    const zeit = zeitpunkt(p.zeitpunkt_at);
    if (!zeit || !zeit.isAfter(jetzt)) continue;
    roh.push({
      key: `pp-${p.id}`,
      art: 'programmpunkt',
      id: p.id,
      zeit: p.zeitpunkt_at,
      text: p.bezeichnung,
    });
  }
  const sortiert = roh.sort(
    (a, b) => (ms(a.zeit) ?? 0) - (ms(b.zeit) ?? 0) || a.key.localeCompare(b.key),
  );
  const marken = sortiert.slice(0, MARKEN_MAX).map(({ faellig, ...m }) => ({
    ...m,
    ...markenBewertung(zeitpunkt(m.zeit)!, jetzt, m.art, faellig),
  }));
  return { marken, weitere: Math.max(0, sortiert.length - MARKEN_MAX) };
}

/** Grund der fehlenden Schreibberechtigung für ETB-Erfassung und Abschnitte des Überblicks. */
export function ueberblickRechteText(einsatz: Parameters<typeof einsatzRechteGrund>[0]): string {
  return einsatzRechteGrund(einsatz);
}
