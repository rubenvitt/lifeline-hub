import type {
  Auftrag,
  Einheit,
  EinheitStatus,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  FahrzeugStatus,
  StatusKategorie,
  StatusWert,
} from '../api/types';
import { tonVonRolle, type StatusTon } from '../components/instrument/statusFlaeche';
import { materialStatus, statusKategorie } from '../theme/statusFarben';
import { verdichte, type StaerkeSumme, type Rohdaten } from './kraeftebild';
import { KATEGORIE_REIHENFOLGE, OHNE_STATUS, type KategorieOderOhne } from './statusAchse';

/**
 * Das Meldebild als STATUSRASTER (Neuentwurf S6, 21.09.2026) — reine Ableitungen.
 *
 * ── WAS DIE FRAGE IST ───────────────────────────────────────────────────────────
 *
 * „Wie steht jede Einheit da?" — eine Zeile je Einheit, verglichen über Abschnitt, Stärke,
 * Status und Auftrag. Die Mittel (Fahrzeuge, Personal, Material) sind DETAIL und hängen als
 * aufklappbare Kinder an ihrer Einheit. Der Abschnitt ist deshalb eine SPALTE und keine
 * Baumebene mehr: der alte Baum Abschnitt → Einheit → Mittel hat die Einheiten zwei Ebenen
 * tief vergraben, und zwei Einheiten verschiedener Abschnitte standen nie untereinander.
 *
 * ── KEINE KRAFT DARF VERSCHWINDEN ───────────────────────────────────────────────
 *
 * Jede Einheit ist eine eigene Zeile — auch Untereinheiten, und zwar mit ihren EIGENEN
 * Mitteln und ihrer EIGENEN Stärke. Kumuliert wird hier nichts: sonst zählte eine Kraft
 * einer Untereinheit in zwei Zeilen, und die Spalte „Stärke" summierte sich nicht mehr auf
 * den Seitenkopf. Mittel ohne `einheit_id` sammelt die Zeile „Ohne Einheit" — die Brücke
 * aus `baueKraeftebild` (Catch-all), in der flachen Welt. Der Test
 * „jede Kraft genau einmal" pinnt beides.
 *
 * ── STATUSTON NUR AUS DER KATEGORIE ─────────────────────────────────────────────
 *
 * Der Entwurf färbt „am Einsatzort" blau (`bedien`). Das wird hier NICHT übernommen: der
 * FMS-Katalog ist mandantengepflegt, `fms_anker` ist nullable und laut Bedien-Leitlinie
 * Sortier-Anker, nicht tragende Bedienform. Eine Abbildung Anker → Rolle wäre eine harte
 * Tabelle über fremde Daten, und derselbe Status stünde auf der Fahrzeugseite (die über
 * `statusKategorie` färbt) gelb und hier blau — zwei Farbbehandlungen desselben Werts. Der
 * Ton kommt deshalb aus dem einen Vertrag: verfügbar `normal`, gebunden `achtung`, nicht
 * verfügbar `alarm`. `S<fms_anker>` ist reine Beschriftung.
 */

export type RasterArt = 'einheit' | 'fahrzeug' | 'person' | 'material';

/** Verdichtete Mittelverteilung einer Einheit (Fahrzeuge + Personal, ohne Material). */
export interface MittelVerteilung {
  bereit: number;
  gebunden: number;
  ausfall: number;
  ohne: number;
}

/** Status eines einzelnen Mittels als Chip-Beschreibung. */
export interface MittelStatus {
  ton: StatusTon;
  /** Zweiter Kanal — das Wort neben der Farbe. */
  wort: string;
  /** FMS-Code („S4"), nur bei Fahrzeugen mit `fms_anker`. */
  code: string | null;
}

/** Der jüngste offene Auftrag an eine Einheit. */
export interface AuftragKurz {
  id: number;
  nr: number | null;
  text: string;
  inArbeit: boolean;
  ueberfaellig: boolean;
}

/** Eingaben für das taktische Zeichen einer Einheit (gerendert in der Seite). */
export interface TzEinheit {
  typLabel: string | null;
  fachaufgabe: string | null;
  organisation: string | null;
}

export interface RasterZeile {
  key: string;
  art: RasterArt;
  /** Nur Einheiten-Zeilen; `null` auch für „Ohne Einheit". */
  einheitId: number | null;
  bezeichnung: string;
  /** Typ, Funktion oder übergeordnete Einheit — Nebentext unter der Bezeichnung. */
  zusatz: string | null;
  funkrufname: string | null;
  abschnitt: string | null;
  staerke: StaerkeSumme | null;
  verteilung: MittelVerteilung | null;
  /** Mittel: ihr Einzelstatus. Einheit: ihr Status als Anzeige (LFH-609). */
  status: MittelStatus | EinheitStatusAnzeige | null;
  /**
   * Status der EINHEIT (LFH-609) — abgeleitet aus ihren Fahrzeugen oder von Hand; nur
   * Einheitenzeilen, `null` für „Ohne Einheit“ und Mittel. Der Serverstand, nicht aus den
   * gefilterten Listen gerechnet: sonst wechselte der Status einer Einheit mit dem Filter.
   */
  einheitStatus: EinheitStatus | null;
  /**
   * Die Einheit hat kein Fahrzeug und führt ihren Status deshalb von Hand (LFH-609). Mit
   * Fahrzeugen lehnt der Server einen Handstatus ab (422) — dort gibt es keinen Auslöser.
   */
  handStatus: boolean;
  /** „Seit“ (UTC) — Einheit: aus `einheitStatus.seit`, Fahrzeug: `status_seit`. */
  seit: string | null;
  auftrag: AuftragKurz | null;
  tz: TzEinheit | null;
  children?: RasterZeile[];
}

export const OHNE_EINHEIT_SCHLUESSEL = 'eh-ohne';

// ── Status einzelner Mittel ───────────────────────────────────────────────────

function tonAusKategorie(k: StatusKategorie | null | undefined): StatusTon {
  if (!k) return 'neutral';
  return tonVonRolle(statusKategorie[k].rolle) ?? 'neutral';
}

/**
 * Der Katalogtext trägt die FMS-Ziffer oft selbst („4 – Am Einsatzort"). Steht davor
 * genau der Anker, fällt das Präfix weg — sonst läse der Chip „S4 4 – Am Einsatzort".
 * Ein anderer Text bleibt unangetastet.
 */
export function fmsWort(label: string, anker: number | null | undefined): string {
  if (anker == null) return label;
  const m = /^\s*(\d+)\s*[–-]\s*(.+)$/.exec(label);
  return m && Number(m[1]) === anker ? m[2] : label;
}

export function fahrzeugStatus(
  ef: EinsatzFahrzeug,
  katalog: ReadonlyMap<number, FahrzeugStatus>,
): MittelStatus {
  const eintrag = ef.status_id != null ? katalog.get(ef.status_id) : undefined;
  const kategorie = eintrag?.kategorie ?? ef.status_kategorie ?? null;
  const label = eintrag?.label ?? ef.status_label ?? null;
  if (label == null && kategorie == null) {
    return { ton: 'neutral', wort: OHNE_STATUS.label, code: null };
  }
  const anker = eintrag?.fms_anker ?? null;
  return {
    ton: tonAusKategorie(kategorie),
    wort: label != null ? fmsWort(label, anker) : statusKategorie[kategorie!].label,
    code: anker != null ? `S${anker}` : null,
  };
}

function codeVon(w: StatusWert | null | undefined): string | null {
  return w?.fms_anker != null ? `S${w.fms_anker}` : null;
}

/** Ein Katalogeintrag als Chip-Beschreibung (Ton nur aus der Kategorie). */
export function statusWertAnzeige(w: StatusWert): MittelStatus {
  return {
    ton: tonAusKategorie(w.kategorie),
    wort: fmsWort(w.label, w.fms_anker),
    code: codeVon(w),
  };
}

/** Der Status einer Einheit als Chip plus — bei „gemischt“ — die Verteilung als Text. */
export interface EinheitStatusAnzeige extends MittelStatus {
  /** „2× S4 · 1× S3 · 1× ohne Status“ — nur bei `gemischt`, sonst `null`. */
  verteilung: string | null;
}

/**
 * Der Einheitenstatus als Anzeige (LFH-609). `gemischt` erfindet keinen Status: das Wort
 * sagt „gemischt“, die Verteilung steht daneben, und der Ton kommt nur aus einer
 * GEMEINSAMEN Kategorie (S3 + S4 → gebunden), sonst bleibt er neutral.
 */
export function einheitStatusAnzeige(s: EinheitStatus): EinheitStatusAnzeige {
  if ((s.quelle === 'fahrzeuge' || s.quelle === 'hand') && s.status) {
    return { ...statusWertAnzeige(s.status), verteilung: null };
  }
  if (s.quelle === 'gemischt') {
    const verteilung = s.verteilung
      .map((a) => {
        const was = a.status
          ? (codeVon(a.status) ?? fmsWort(a.status.label, a.status.fms_anker))
          : OHNE_STATUS.label;
        return `${a.anzahl}× ${was}`;
      })
      .join(' · ');
    return { ton: tonAusKategorie(s.kategorie), wort: 'gemischt', code: null, verteilung };
  }
  return { ton: 'neutral', wort: OHNE_STATUS.label, code: null, verteilung: null };
}

function personStatus(ep: EinsatzPersonal): MittelStatus {
  const k = ep.status_kategorie ?? null;
  const wort = ep.status_label ?? (k ? statusKategorie[k].label : OHNE_STATUS.label);
  return { ton: tonAusKategorie(k), wort, code: null };
}

function materialZustand(em: EinsatzMaterial): MittelStatus {
  const d = materialStatus[em.status];
  return { ton: tonVonRolle(d.rolle) ?? 'neutral', wort: `${d.label} ×${em.menge}`, code: null };
}

// ── Auftragszuordnung ─────────────────────────────────────────────────────────

/**
 * Jüngster OFFENER Auftrag je Einheit — offen heißt `offen` oder `in_arbeit`; vollzogene
 * und abgenommene Aufträge beschreiben nicht mehr, was die Einheit gerade tut. Zugeordnet
 * über `empfaenger[].einheit_id`; ein Auftrag an mehrere Einheiten zählt bei jeder.
 * „Jüngst" nach `erteilt_at`, bei Gleichstand die höhere `id` (später angelegt).
 */
export function offeneAuftraegeJeEinheit(auftraege: readonly Auftrag[]): Map<number, AuftragKurz> {
  const beste = new Map<number, Auftrag>();
  for (const a of auftraege) {
    if (a.bearbeitungsstatus !== 'offen' && a.bearbeitungsstatus !== 'in_arbeit') continue;
    for (const e of a.empfaenger ?? []) {
      if (e.einheit_id == null) continue;
      const bisher = beste.get(e.einheit_id);
      if (
        !bisher ||
        a.erteilt_at > bisher.erteilt_at ||
        (a.erteilt_at === bisher.erteilt_at && a.id > bisher.id)
      ) {
        beste.set(e.einheit_id, a);
      }
    }
  }
  const ergebnis = new Map<number, AuftragKurz>();
  for (const [einheitId, a] of beste) {
    ergebnis.set(einheitId, {
      id: a.id,
      nr: a.lfd_nr ?? null,
      text: a.auftrag_text,
      inArbeit: a.bearbeitungsstatus === 'in_arbeit',
      ueberfaellig: a.ist_ueberfaellig,
    });
  }
  return ergebnis;
}

// ── Funkrufname ───────────────────────────────────────────────────────────────

/**
 * Der Funkrufname einer Einheit — NUR, wenn er eindeutig ist: genau ein Fahrzeug in der
 * Einheit. Bei null oder mehreren Fahrzeugen gibt es keinen Rufnamen der EINHEIT; ihn zu
 * raten (erstes Fahrzeug, Führungsfahrzeug) wäre eine erfundene Angabe. Ein eigener
 * Rufname je Einheit ist LFH-614.
 *
 * Gelesen aus `Einheit.fahrzeug_mitglieder` (Serverstand), NICHT aus der gefilterten
 * Fahrzeugliste: sonst wechselte der Rufname einer Einheit mit dem Statusfilter.
 */
export function eindeutigerFunkrufname(
  fahrzeuge: readonly { funkrufname: string }[] | null | undefined,
): string | null {
  if (!fahrzeuge) return null;
  return fahrzeuge.length === 1 ? fahrzeuge[0].funkrufname : null;
}

// ── Aufbau ────────────────────────────────────────────────────────────────────

function gruppiere<T extends { einheit_id?: number | null }>(liste: readonly T[]) {
  const m = new Map<number | null, T[]>();
  for (const x of liste) {
    const k = x.einheit_id ?? null;
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function verteilungAus(personal: EinsatzPersonal[], fahrzeuge: EinsatzFahrzeug[]) {
  const v = verdichte(personal, fahrzeuge, []);
  const verteilung: MittelVerteilung = {
    bereit: v.personalStatus.verfuegbar + v.fahrzeugStatus.verfuegbar,
    gebunden: v.personalStatus.gebunden + v.fahrzeugStatus.gebunden,
    ausfall: v.personalStatus.nicht_verfuegbar + v.fahrzeugStatus.nicht_verfuegbar,
    ohne: v.personalStatus.ohne + v.fahrzeugStatus.ohne,
  };
  return { staerke: v.staerke, verteilung };
}

function mittelZeilen(
  personal: EinsatzPersonal[],
  fahrzeuge: EinsatzFahrzeug[],
  material: EinsatzMaterial[],
  katalog: ReadonlyMap<number, FahrzeugStatus>,
): RasterZeile[] {
  const leer = {
    einheitId: null,
    funkrufname: null,
    abschnitt: null,
    staerke: null,
    verteilung: null,
    einheitStatus: null,
    handStatus: false,
    seit: null,
    auftrag: null,
    tz: null,
  };
  return [
    ...fahrzeuge.map((ef): RasterZeile => ({
      ...leer,
      key: `ef-${ef.id}`,
      art: 'fahrzeug',
      bezeichnung: ef.funkrufname,
      zusatz: ef.fahrzeugtyp ?? null,
      status: fahrzeugStatus(ef, katalog),
      seit: ef.status_seit ?? null,
    })),
    ...personal.map((ep): RasterZeile => ({
      ...leer,
      key: `ep-${ep.id}`,
      art: 'person',
      bezeichnung: ep.name,
      zusatz: ep.funktion ?? null,
      status: personStatus(ep),
    })),
    ...material.map((em): RasterZeile => ({
      ...leer,
      key: `em-${em.id}`,
      art: 'material',
      bezeichnung: em.bezeichnung,
      zusatz: null,
      status: materialZustand(em),
    })),
  ];
}

/**
 * Reihenfolge der Abschnitte: Tiefensuche über `ueber_abschnitt_id`, Eltern vor Kindern,
 * sonst in Eingabereihenfolge (der Server liefert nach `sortier`). Ein Abschnitt, dessen
 * Elternteil fehlt, wird Wurzel — wie in `baueKraeftebild`.
 */
function abschnittRang(abschnitte: readonly Einsatzabschnitt[]): Map<number, number> {
  const ids = new Set(abschnitte.map((a) => a.id));
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const k =
      a.ueber_abschnitt_id != null && ids.has(a.ueber_abschnitt_id) ? a.ueber_abschnitt_id : null;
    const l = kinder.get(k);
    if (l) l.push(a);
    else kinder.set(k, [a]);
  }
  const rang = new Map<number, number>();
  const besuche = (a: Einsatzabschnitt) => {
    if (rang.has(a.id)) return;
    rang.set(a.id, rang.size);
    for (const k of kinder.get(a.id) ?? []) besuche(k);
  };
  for (const a of kinder.get(null) ?? []) besuche(a);
  return rang;
}

export interface RasterEingabe extends Rohdaten {
  /** Fahrzeug-Statuskatalog (Code und Sortierung). Leer ist erlaubt. */
  statusKatalog: readonly FahrzeugStatus[];
  /** Aufträge mit Empfängern. Leer, wenn nicht abrufbar. */
  auftraege: readonly Auftrag[];
}

export function baueMeldebildRaster(e: RasterEingabe): RasterZeile[] {
  const katalog = new Map(e.statusKatalog.map((s) => [s.id, s]));
  const personalJe = gruppiere(e.personal);
  const fahrzeugeJe = gruppiere(e.fahrzeuge);
  const materialJe = gruppiere(e.material);
  const auftragJe = offeneAuftraegeJeEinheit(e.auftraege);
  const rang = abschnittRang(e.abschnitte);
  const abschnittName = new Map(e.abschnitte.map((a) => [a.id, a.name]));

  const einheitIds = new Set(e.einheiten.map((x) => x.id));
  const nachId = new Map(e.einheiten.map((x) => [x.id, x]));
  const kinderJe = new Map<number, Einheit[]>();
  const wurzeln: Einheit[] = [];
  for (const x of e.einheiten) {
    if (x.ueber_einheit_id != null && einheitIds.has(x.ueber_einheit_id)) {
      const l = kinderJe.get(x.ueber_einheit_id);
      if (l) l.push(x);
      else kinderJe.set(x.ueber_einheit_id, [x]);
    } else {
      wurzeln.push(x);
    }
  }

  // Abschnitt einer Einheit: der eigene, sonst der geerbte (v1-Annahme aus `filtereKraefte`).
  const abschnittVon = (x: Einheit): number | null => {
    let cur: Einheit | undefined = x;
    const gesehen = new Set<number>();
    while (cur && !gesehen.has(cur.id)) {
      if (cur.abschnitt_id != null) return cur.abschnitt_id;
      gesehen.add(cur.id);
      cur = cur.ueber_einheit_id != null ? nachId.get(cur.ueber_einheit_id) : undefined;
    }
    return null;
  };
  const rangVon = (x: Einheit) => {
    const a = abschnittVon(x);
    return a != null && rang.has(a) ? rang.get(a)! : Number.MAX_SAFE_INTEGER;
  };
  const sortierteWurzeln = wurzeln
    .map((x, i) => ({ x, i }))
    .sort((p, q) => rangVon(p.x) - rangVon(q.x) || p.i - q.i)
    .map((p) => p.x);

  const zeilen: RasterZeile[] = [];
  const besucht = new Set<number>();
  const besuche = (x: Einheit) => {
    if (besucht.has(x.id)) return;
    besucht.add(x.id);
    const personal = personalJe.get(x.id) ?? [];
    const fahrzeuge = fahrzeugeJe.get(x.id) ?? [];
    const material = materialJe.get(x.id) ?? [];
    const { staerke, verteilung } = verteilungAus(personal, fahrzeuge);
    const aId = abschnittVon(x);
    const ueber = x.ueber_einheit_id != null ? nachId.get(x.ueber_einheit_id) : undefined;
    const kinder = mittelZeilen(personal, fahrzeuge, material, katalog);
    zeilen.push({
      key: `eh-${x.id}`,
      art: 'einheit',
      einheitId: x.id,
      bezeichnung: x.name,
      zusatz: ueber ? `in ${ueber.name}` : (x.typ_label ?? null),
      funkrufname: eindeutigerFunkrufname(x.fahrzeug_mitglieder),
      abschnitt: aId != null ? (abschnittName.get(aId) ?? x.abschnitt_name ?? null) : null,
      staerke,
      verteilung,
      status: x.status ? einheitStatusAnzeige(x.status) : null,
      einheitStatus: x.status ?? null,
      handStatus: (x.fahrzeug_mitglieder ?? []).length === 0,
      seit: x.status?.seit ?? null,
      auftrag: auftragJe.get(x.id) ?? null,
      tz: {
        typLabel: x.typ_label ?? null,
        fachaufgabe: x.tz_fachaufgabe ?? null,
        organisation: x.tz_organisation ?? null,
      },
      children: kinder.length > 0 ? kinder : undefined,
    });
    for (const k of kinderJe.get(x.id) ?? []) besuche(k);
  };
  for (const w of sortierteWurzeln) besuche(w);
  // Zyklen (a ↔ b) hätten keine Wurzel — sie dürfen trotzdem nicht verschwinden.
  for (const x of e.einheiten) besuche(x);

  // Mittel ohne Einheit — und Mittel, deren Einheit nicht in der Liste steht.
  const ohneP = e.personal.filter((x) => x.einheit_id == null || !einheitIds.has(x.einheit_id));
  const ohneF = e.fahrzeuge.filter((x) => x.einheit_id == null || !einheitIds.has(x.einheit_id));
  const ohneM = e.material.filter((x) => x.einheit_id == null || !einheitIds.has(x.einheit_id));
  if (ohneP.length + ohneF.length + ohneM.length > 0) {
    const { staerke, verteilung } = verteilungAus(ohneP, ohneF);
    zeilen.push({
      key: OHNE_EINHEIT_SCHLUESSEL,
      art: 'einheit',
      einheitId: null,
      bezeichnung: 'Ohne Einheit',
      zusatz: 'nicht zugeordnete Mittel',
      funkrufname: null,
      abschnitt: null,
      staerke,
      verteilung,
      status: null,
      einheitStatus: null,
      handStatus: false,
      seit: null,
      auftrag: null,
      tz: null,
      children: mittelZeilen(ohneP, ohneF, ohneM, katalog),
    });
  }
  return zeilen;
}

/**
 * Eine Einheiten-Zeile mit Ausfall ist eine Problemzeile (Tönung + Zahl als zweiter Kanal)
 * — ein Ausfall unter ihren Mitteln ODER ein Einheitenstatus der Kategorie „nicht
 * verfügbar“ (LFH-609: eine Einheit ohne Fahrzeug meldet S6 nur über den Handstatus).
 */
export function istProblemZeile(z: RasterZeile): boolean {
  return (z.verteilung?.ausfall ?? 0) > 0 || z.einheitStatus?.kategorie === 'nicht_verfuegbar';
}

/** Alle Schlüssel mit Kindern — das „alles aufklappen" des Druckpfads. */
export function aufklappbareSchluessel(zeilen: readonly RasterZeile[]): string[] {
  return zeilen.flatMap((z) =>
    z.children && z.children.length > 0 ? [z.key, ...aufklappbareSchluessel(z.children)] : [],
  );
}

// ── Statusband ────────────────────────────────────────────────────────────────

export interface BandZelle {
  schluessel: string;
  /** „S4", sonst ein Kurztext der Kategorie. */
  code: string;
  wert: number;
  /** Beschriftung unter der Zahl — der zweite Kanal. */
  wort: string;
  ton: StatusTon;
}

/** Code einer Einheitenzelle ohne FMS-Anker — die Art statt einer erfundenen Ziffer. */
const EINHEIT_KURZ = 'Einh.';

/**
 * Einheiten je Status (Entwurf S6 `statusStufen`, LFH-609) — eine Zelle je Katalogstatus
 * mit mindestens einer Einheit, in `sortier`-Folge; Fahrzeug- und Handstatus zählen
 * gleich, es ist derselbe FMS-Katalog. Danach „gemischt“ und „ohne Status“, wenn belegt —
 * jede Einheit genau einmal, damit sich das Band auf die Einheitenzahl summiert.
 *
 * „ohne Status“ ist ECHTE Datenlage und NICHT die Kachel „keine Rückmeldung“ des
 * Entwurfs: die bräuchte einen Zeitpunkt der letzten Rückmeldung (LFH-610).
 */
export function einheitBand(einheiten: readonly Einheit[]): BandZelle[] {
  const je = new Map<number, { wert: StatusWert; anzahl: number }>();
  let gemischt = 0;
  let ohne = 0;
  for (const e of einheiten) {
    const s = e.status;
    if (s && (s.quelle === 'fahrzeuge' || s.quelle === 'hand') && s.status) {
      const bisher = je.get(s.status.status_id);
      if (bisher) bisher.anzahl += 1;
      else je.set(s.status.status_id, { wert: s.status, anzahl: 1 });
    } else if (s?.quelle === 'gemischt') {
      gemischt += 1;
    } else {
      ohne += 1;
    }
  }
  const zellen: BandZelle[] = [...je.values()]
    .sort((a, b) => a.wert.sortier - b.wert.sortier || a.wert.status_id - b.wert.status_id)
    .map(({ wert, anzahl }) => {
      const a = statusWertAnzeige(wert);
      return {
        schluessel: `eh-${wert.status_id}`,
        code: a.code ?? EINHEIT_KURZ,
        wert: anzahl,
        wort: a.wort,
        ton: a.ton,
      };
    });
  if (gemischt > 0) {
    zellen.push({
      schluessel: 'eh-gemischt',
      code: EINHEIT_KURZ,
      wert: gemischt,
      wort: 'gemischt',
      ton: 'neutral',
    });
  }
  if (ohne > 0) {
    zellen.push({
      schluessel: 'eh-ohne',
      code: EINHEIT_KURZ,
      wert: ohne,
      wort: OHNE_STATUS.label,
      ton: 'neutral',
    });
  }
  return zellen;
}

/** Personal je Statuskategorie — vier Eimer in fester Folge, nur die belegten. */
export function personalBand(personal: readonly EinsatzPersonal[]): BandZelle[] {
  const zaehler = new Map<KategorieOderOhne, number>();
  for (const ep of personal) {
    const k: KategorieOderOhne = ep.status_kategorie ?? 'ohne';
    zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
  }
  return KATEGORIE_REIHENFOLGE.filter((k) => (zaehler.get(k) ?? 0) > 0).map((k) => ({
    schluessel: `pers-${k}`,
    code: 'Pers.',
    wert: zaehler.get(k)!,
    wort: k === 'ohne' ? OHNE_STATUS.label : statusKategorie[k].label,
    ton: k === 'ohne' ? 'neutral' : tonAusKategorie(k),
  }));
}
