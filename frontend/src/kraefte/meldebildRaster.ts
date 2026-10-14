import type {
  Auftrag,
  Einheit,
  EinheitStatus,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  FahrzeugStatus,
  LetzteRueckmeldung,
  Rueckmeldungen,
  Staerke,
  StaerkePosition,
  StatusKategorie,
  StatusWert,
} from '../api/types';
import type { Dayjs } from 'dayjs';
import {
  RUECKMELDUNG_WORT,
  ohneRueckmeldung,
  rueckmeldungZustand,
  type RueckmeldungZustand,
} from '../meldungen/rueckmeldung';
import { tonVonRolle, type StatusTon } from '../components/instrument/statusFlaeche';
import { statusKategorie, type BesatzungsUrteil } from '../theme/statusFarben';
import { isAufgebraucht, materialDarstellung, mengeText } from './materialPosten';
import { verdichte, type StaerkeSumme, type Rohdaten } from './kraeftebild';
import {
  needsOhneFahrzeugKnoten,
  kraeftebaum,
  accumulateStaerke,
  schluesselBisStufe,
  type FremdeBesatzung,
  type KraeftebaumKnoten,
  type MittelDerEinheit,
  type MittelQuelle,
  type PersonImBaum,
} from './kraeftebaumKern';
import { KATEGORIE_REIHENFOLGE, OHNE_STATUS, type KategorieOderOhne } from './statusAchse';
import { funktionText } from './einsatzfunktionKern';

/**
 * Das Meldebild als STATUSRASTER über dem KRÄFTEBAUM — reine Ableitungen.
 *
 * Die Frage ist „Wie steht jede Einheit da?": eine Zeile je Einheit, verglichen über Abschnitt,
 * Stärke, Status und Auftrag. Seit LLH-1025 ist das Raster ein Baum aus EINER Baumlogik
 * (`kraeftebaumKern.ts`): Untereinheiten hängen als echte Kinder unter ihrer Einheit, darunter
 * die eigenen Mittel als Zeilenarten — Fahrzeug mit Besatzung, „Ohne Fahrzeug“ (nur neben
 * Fahrzeugen), Material als Gruppenzeile. Der Abschnitt bleibt eine SPALTE, keine Baumebene,
 * damit Einheiten verschiedener Abschnitte untereinander stehen.
 *
 * KEINE KRAFT DARF VERSCHWINDEN, KEINE DOPPELT ZÄHLEN: jede Kraft steht genau einmal im Baum,
 * Mittel ohne bekannte Einheit unter der letzten Wurzel „Ohne Einheit". Die STÄRKE der
 * Elternzeile ist KUMULIERT (eigen + Σ Untereinheiten, Lesart wie Lagebericht und Soll der
 * Einheit: „Zug 1/3/18//22“); jedes Kind zeigt seine eigene Teilsumme. Damit summieren sich die
 * WURZELN, nicht alle Zeilen, auf den Seitenkopf. Gerechnet über die GEFILTERTEN Listen
 * (`verdichte`), weil `ist_kumuliert` des Servers den Filter nicht kennt. Fahrzeug-, Personen- und
 * Gruppenzeilen tragen keine Stärke; ein Fahrzeug trägt seine Besatzung Ist/Soll. Die Tests
 * „jede Kraft genau einmal" und „Σ Wurzeln = Kopf" pinnen beides.
 *
 * MITTELVERTEILUNG UND TÖNUNG BLEIBEN EIGEN (D3): sonst trügen Zug und Gruppe denselben Ausfall
 * doppelt. Die Vorgabestufe „Einheiten“ hält die Problemzeile der Gruppe sichtbar.
 *
 * STATUSTON NUR AUS DER KATEGORIE: der FMS-Katalog ist mandantengepflegt und `fms_anker`
 * nullable; eine Abbildung Anker → Rolle wäre eine harte Tabelle über fremde Daten und färbte
 * denselben Status hier anders als auf der Fahrzeugseite. Verfügbar `normal`, gebunden
 * `achtung`, nicht verfügbar `alarm`; `S<fms_anker>` ist reine Beschriftung.
 */

export type RasterArt =
  'einheit' | 'fahrzeug' | 'person' | 'material' | 'ohne-fahrzeug' | 'material-gruppe';

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

/** Eingaben für das taktische Zeichen eines Fahrzeugs (Grundzeichen aus dem Typ, LFH-1120). */
export interface TzFahrzeug {
  fahrzeugtyp: string | null;
  traegerorganisation: string | null;
  opta: string | null;
  fachaufgabe: string | null;
  organisation: string | null;
}

/** Besatzung einer Fahrzeugzeile (D4): Ist über alle Kräfte mit dieser `fahrzeug_id`. */
export interface BesatzungAnzeige {
  ist: Staerke;
  soll: Staerke | null;
  urteil: BesatzungsUrteil;
  fremd: FremdeBesatzung[];
}

/** Angaben einer Personenzeile: Positionsmarke, „EF“ und „fährt auf“. */
export interface PersonAnzeige {
  position: StaerkePosition | null;
  isFuehrer: boolean;
  faehrtAuf: string | null;
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
  /** Mittel: ihr Einzelstatus. Einheit: ihr Status als Anzeige. */
  status: MittelStatus | EinheitStatusAnzeige | null;
  /**
   * Status der EINHEIT — aus ihren Fahrzeugen abgeleitet oder von Hand; `null` für „Ohne
   * Einheit“ und Mittel. Der Serverstand, nicht aus gefilterten Listen gerechnet, sonst wechselte
   * er mit dem Filter.
   */
  einheitStatus: EinheitStatus | null;
  /**
   * Die Einheit hat kein Fahrzeug und führt ihren Status von Hand. Mit Fahrzeugen lehnt der
   * Server einen Handstatus ab (422) — dort gibt es keinen Auslöser.
   */
  handStatus: boolean;
  /** „Seit“ (UTC) — Einheit: aus `einheitStatus.seit`, Fahrzeug: `status_seit`. */
  seit: string | null;
  auftrag: AuftragKurz | null;
  tz: TzEinheit | null;
  /** Kennung des Mittels (Fahrzeug, Person, Material) für den Sprung; sonst `null`. */
  mittelId: number | null;
  /** Nur Fahrzeugzeilen. */
  fahrzeugTz: TzFahrzeug | null;
  besatzung: BesatzungAnzeige | null;
  /** Nur Personenzeilen. */
  person: PersonAnzeige | null;
  /** Nur Gruppenzeilen („Ohne Fahrzeug“, „Material“): Anzahl und Ausfall. */
  gruppe: { anzahl: number; ausfall: number } | null;
  /** Nur Einheitenzeilen: Materialausfall der EIGENEN Posten (D6, tönt die Zeile). */
  materialAusfall: number;
  children?: RasterZeile[];
}

export const OHNE_EINHEIT_SCHLUESSEL = 'eh-ohne';

// ── Status einzelner Mittel ───────────────────────────────────────────────────

function tonAusKategorie(k: StatusKategorie | null | undefined): StatusTon {
  if (!k) return 'neutral';
  return tonVonRolle(statusKategorie[k].rolle) ?? 'neutral';
}

/**
 * Der Katalogtext trägt die FMS-Ziffer oft selbst („4 – Am Einsatzort"). Steht davor genau
 * der Anker, fällt das Präfix weg, sonst läse der Chip „S4 4 – Am Einsatzort".
 */
export function fmsWort(label: string, anker: number | null | undefined): string {
  if (anker == null) return label;
  const m = /^\s*(\d+)\s*[–-]\s*(.+)$/.exec(label);
  return m && Number(m[1]) === anker ? m[2] : label;
}

/**
 * Das EINE Format eines FMS-Status als Text: „S4 · Am Einsatzort“ (LFH-973, Klärungsrunde
 * Welle 4, Entscheidung 2) — im Meldebild, im FMS-Tableau und auf der Fahrzeugseite. Ohne Anker
 * bleibt das Katalogwort. Der Chip (`StatusChip`) setzt Code, Trenner und Wort selbst.
 */
export function fmsEtikett(label: string, anker: number | null | undefined): string {
  return anker != null ? `S${anker} · ${fmsWort(label, anker)}` : label;
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
function statusWertAnzeige(w: StatusWert): MittelStatus {
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
 * Der Einheitenstatus als Anzeige. `gemischt` erfindet keinen Status: das Wort sagt „gemischt“,
 * die Verteilung steht daneben, und der Ton kommt nur aus einer GEMEINSAMEN Kategorie
 * (S3 + S4 → gebunden), sonst neutral.
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

/**
 * Status und Menge eines Postens über `materialPosten.ts` (LLH-1224, design.md D15): „defekt ×1“,
 * „aufgebraucht ×50“, mit Teil-Ausgabe „im Einsatz · 30 von 50 übrig“.
 */
function materialZustand(em: EinsatzMaterial): MittelStatus {
  const d = materialDarstellung(em);
  const menge = em.ausgegeben > 0 && !isAufgebraucht(em) ? ` · ${mengeText(em)}` : ` ×${em.menge}`;
  return { ton: tonVonRolle(d.rolle) ?? 'neutral', wort: `${d.label}${menge}`, code: null };
}

// ── Auftragszuordnung ─────────────────────────────────────────────────────────

/**
 * Jüngster OFFENER Auftrag je Einheit (`offen` oder `in_arbeit`) über
 * `empfaenger[].einheit_id`; ein Auftrag an mehrere Einheiten zählt bei jeder. „Jüngst" nach
 * `erteilt_at`, bei Gleichstand die höhere `id`.
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
 * Der Funkrufname einer Einheit: der gepflegte eigene, sonst NUR der eindeutige (genau ein
 * Fahrzeug in der Einheit) — ihn zu raten wäre eine erfundene Angabe. Aus
 * `Einheit.fahrzeug_mitglieder` (Serverstand), nicht aus der gefilterten Liste.
 */
export function einheitFunkrufname(einheit: {
  funkrufname?: string | null;
  fahrzeug_mitglieder?: readonly { funkrufname: string }[] | null;
}): string | null {
  if (einheit.funkrufname) return einheit.funkrufname;
  const fahrzeuge = einheit.fahrzeug_mitglieder;
  if (!fahrzeuge) return null;
  return fahrzeuge.length === 1 ? fahrzeuge[0].funkrufname : null;
}

// ── Aufbau ────────────────────────────────────────────────────────────────────

function verteilungAus(
  personal: readonly EinsatzPersonal[],
  fahrzeuge: readonly EinsatzFahrzeug[],
) {
  const v = verdichte([...personal], [...fahrzeuge], []);
  const verteilung: MittelVerteilung = {
    bereit: v.personalStatus.verfuegbar + v.fahrzeugStatus.verfuegbar,
    gebunden: v.personalStatus.gebunden + v.fahrzeugStatus.gebunden,
    ausfall: v.personalStatus.nicht_verfuegbar + v.fahrzeugStatus.nicht_verfuegbar,
    ohne: v.personalStatus.ohne + v.fahrzeugStatus.ohne,
  };
  return { staerke: v.staerke, verteilung };
}

/** Alle Personen eines Zweigs (Besatzungen und ohne Fahrzeug). */
function personenVon(m: MittelDerEinheit): EinsatzPersonal[] {
  return [
    ...m.fahrzeuge.flatMap((f) => f.besatzung.map((x) => x.person)),
    ...m.ohneFahrzeug.map((x) => x.person),
  ];
}

const LEER: Omit<RasterZeile, 'key' | 'art' | 'bezeichnung' | 'zusatz' | 'status'> = {
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
  mittelId: null,
  fahrzeugTz: null,
  besatzung: null,
  person: null,
  gruppe: null,
  materialAusfall: 0,
};

function personZeile(x: PersonImBaum): RasterZeile {
  const ep = x.person;
  return {
    ...LEER,
    key: `ep-${ep.id}`,
    art: 'person',
    mittelId: ep.id,
    bezeichnung: ep.name,
    zusatz: funktionText(ep),
    status: personStatus(ep),
    person: {
      position: ep.staerke_position ?? null,
      isFuehrer: x.isFuehrer,
      faehrtAuf: x.faehrtAuf,
    },
  };
}

/**
 * Die Mittelzeilen eines Zweigs in der Folge des Kerns (D7): Fahrzeuge mit Besatzung → „Ohne
 * Fahrzeug“ (nur neben Fahrzeugen, D5; sonst die Personen direkt) → Material als Gruppe.
 * `zweig` macht die Schlüssel der Gruppenzeilen eindeutig (`ofz-<id>`, `mtl-<id>`).
 */
function mittelZeilen(
  m: MittelDerEinheit,
  zweig: string,
  katalog: ReadonlyMap<number, FahrzeugStatus>,
): RasterZeile[] {
  const zeilen: RasterZeile[] = m.fahrzeuge.map((f): RasterZeile => {
    const ef = f.fahrzeug;
    const besatzung = f.besatzung.map(personZeile);
    return {
      ...LEER,
      key: `ef-${ef.id}`,
      art: 'fahrzeug',
      mittelId: ef.id,
      bezeichnung: ef.funkrufname,
      zusatz: ef.fahrzeugtyp ?? null,
      status: fahrzeugStatus(ef, katalog),
      seit: ef.status_seit ?? null,
      fahrzeugTz: {
        fahrzeugtyp: ef.fahrzeugtyp ?? null,
        traegerorganisation: ef.traegerorganisation ?? null,
        opta: ef.opta ?? null,
        fachaufgabe: ef.tz_fachaufgabe ?? null,
        organisation: ef.tz_organisation ?? null,
      },
      besatzung: { ist: f.ist, soll: f.soll, urteil: f.urteil, fremd: f.fremd },
      children: besatzung.length > 0 ? besatzung : undefined,
    };
  });
  const personen = m.ohneFahrzeug.map(personZeile);
  if (needsOhneFahrzeugKnoten(m)) {
    zeilen.push({
      ...LEER,
      key: `ofz-${zweig}`,
      art: 'ohne-fahrzeug',
      bezeichnung: 'Ohne Fahrzeug',
      zusatz: null,
      status: null,
      gruppe: { anzahl: personen.length, ausfall: 0 },
      children: personen,
    });
  } else {
    zeilen.push(...personen);
  }
  if (m.material.length > 0) {
    zeilen.push({
      ...LEER,
      key: `mtl-${zweig}`,
      art: 'material-gruppe',
      bezeichnung: 'Material',
      zusatz: null,
      status: null,
      gruppe: { anzahl: m.material.length, ausfall: m.materialAusfall },
      children: m.material.map((em): RasterZeile => ({
        ...LEER,
        key: `em-${em.id}`,
        art: 'material',
        mittelId: em.id,
        bezeichnung: em.bezeichnung,
        zusatz: null,
        status: materialZustand(em),
      })),
    });
  }
  return zeilen;
}

export interface RasterEingabe extends Rohdaten {
  /** Fahrzeug-Statuskatalog (Code und Sortierung). Leer ist erlaubt. */
  statusKatalog: readonly FahrzeugStatus[];
  /** Aufträge mit Empfängern. Leer, wenn nicht abrufbar. */
  auftraege: readonly Auftrag[];
  /**
   * Ungefilterte Listen: Namen für „fährt auf“ bei weggefilterten Fahrzeugen und die Besatzung
   * Ist (alle Kräfte auf dem Fahrzeug). Ohne sie gelten die gefilterten.
   */
  quelle?: Partial<MittelQuelle>;
}

export function baueMeldebildRaster(e: RasterEingabe): RasterZeile[] {
  const katalog = new Map(e.statusKatalog.map((s) => [s.id, s]));
  const auftragJe = offeneAuftraegeJeEinheit(e.auftraege);
  const abschnittName = new Map(e.abschnitte.map((a) => [a.id, a.name]));
  const wurzeln = kraeftebaum({ ...e, quelle: e.quelle });

  // Eigenstärke je Einheit über die gefilterten Listen, kumuliert über den Baum (D2).
  const eigen = new Map<number, ReturnType<typeof verteilungAus>>();
  const einheitKnoten = wurzeln.flatMap((w) => (w.art === 'einheit' ? [w.knoten] : []));
  const collectEigen = (k: KraeftebaumKnoten) => {
    eigen.set(
      k.einheit.id,
      verteilungAus(
        personenVon(k.mittel),
        k.mittel.fahrzeuge.map((f) => f.fahrzeug),
      ),
    );
    k.kinder.forEach(collectEigen);
  };
  einheitKnoten.forEach(collectEigen);
  const kumuliert = accumulateStaerke(einheitKnoten, (x) => eigen.get(x.id)!.staerke);

  const einheitZeile = (k: KraeftebaumKnoten): RasterZeile => {
    const x = k.einheit;
    const kinder = [
      ...mittelZeilen(k.mittel, String(x.id), katalog),
      ...k.kinder.map(einheitZeile),
    ];
    return {
      ...LEER,
      key: `eh-${x.id}`,
      art: 'einheit',
      einheitId: x.id,
      bezeichnung: x.name,
      zusatz: x.typ_label ?? null,
      funkrufname: einheitFunkrufname(x),
      abschnitt:
        k.abschnittId != null
          ? (abschnittName.get(k.abschnittId) ?? x.abschnitt_name ?? null)
          : null,
      staerke: kumuliert.get(x.id)!,
      verteilung: eigen.get(x.id)!.verteilung,
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
      materialAusfall: k.mittel.materialAusfall,
      children: kinder.length > 0 ? kinder : undefined,
    };
  };

  return wurzeln.map((w): RasterZeile => {
    if (w.art === 'einheit') return einheitZeile(w.knoten);
    const { staerke, verteilung } = verteilungAus(
      personenVon(w.mittel),
      w.mittel.fahrzeuge.map((f) => f.fahrzeug),
    );
    return {
      ...LEER,
      key: OHNE_EINHEIT_SCHLUESSEL,
      art: 'einheit',
      bezeichnung: 'Ohne Einheit',
      zusatz: 'nicht zugeordnete Mittel',
      staerke,
      verteilung,
      status: null,
      materialAusfall: w.mittel.materialAusfall,
      children: mittelZeilen(w.mittel, 'ohne', katalog),
    };
  });
}

/** Alle Einheitenzeilen des Baums in Baumfolge, auch Untereinheiten und „Ohne Einheit“ (D12). */
export function einheitZeilen(zeilen: readonly RasterZeile[]): RasterZeile[] {
  return zeilen.flatMap((z) =>
    z.art === 'einheit' ? [z, ...einheitZeilen(z.children ?? [])] : [],
  );
}

/**
 * Eine Einheiten-Zeile mit Ausfall ist eine Problemzeile (Tönung + Zahl): ein Ausfall unter
 * ihren EIGENEN Mitteln — Fahrzeuge, Personal oder Material (D6) — ODER ein Einheitenstatus
 * „nicht verfügbar“ (eine Einheit ohne Fahrzeug meldet S6 nur über den Handstatus).
 */
export function istProblemZeile(z: RasterZeile): boolean {
  return (
    (z.verteilung?.ausfall ?? 0) > 0 ||
    (z.art === 'einheit' && z.materialAusfall > 0) ||
    z.einheitStatus?.kategorie === 'nicht_verfuegbar'
  );
}

/** Alle Schlüssel mit Kindern — das „alles aufklappen" des Druckpfads (Stufe „alles“). */
export function aufklappbareSchluessel(zeilen: readonly RasterZeile[]): string[] {
  return schluesselBisStufe(zeilen, 'alles');
}

// ── Statusband ────────────────────────────────────────────────────────────────

export interface BandZelle {
  schluessel: string;
  /**
   * FMS-Code („S4"), sonst `null` — dann steht im Statusband das Wort (keine erfundene Ziffer,
   * kein Kürzel „Einh."/„Pers.", das nur die Gruppe wiederholt).
   */
  code: string | null;
  wert: number;
  /** Beschriftung unter der Zahl — der zweite Kanal. */
  wort: string;
  ton: StatusTon;
}

// ── Rückmeldung je Einheit ────────────────────────────────────────────────────

/** Rückmeldung einer Einheitenzeile: der Zustand und — falls vorhanden — die letzte Meldung. */
export interface RueckmeldungAnzeige {
  zustand: RueckmeldungZustand;
  letzte: LetzteRueckmeldung | null;
}

/** Nur echte Einheiten tragen eine Rückmeldung — „Ohne Einheit" ist `art: 'einheit'`, hat aber keine id. */
function istEchteEinheit(z: RasterZeile): z is RasterZeile & { einheitId: number } {
  return z.art === 'einheit' && z.einheitId != null;
}

/**
 * Rückmeldung einer Rasterzeile zum Zeitpunkt `jetzt` — `null` für Mittel und „Ohne Einheit".
 * Nicht in `baueMeldebildRaster`: der Zustand hängt an der Seitenuhr, ein 30-s-Takt soll nicht
 * den ganzen Baum neu bauen.
 * `je` darf nur übergeben werden, wenn die Daten WIRKLICH da sind: eine leere Tabelle heißt
 * „niemand hat je zurückgemeldet" und färbte beim Laden oder bei 403 jede Einheit rot.
 */
export function rueckmeldungDerZeile(
  z: RasterZeile,
  je: ReadonlyMap<number, LetzteRueckmeldung>,
  jetzt: Dayjs,
): RueckmeldungAnzeige | null {
  if (!istEchteEinheit(z)) return null;
  const letzte = je.get(z.einheitId) ?? null;
  return { zustand: rueckmeldungZustand(letzte, jetzt), letzte };
}

/** Überfällig oder nie zurückgemeldet — die Zeile wird getönt wie eine Problemzeile. */
export function istRueckmeldungProblem(r: RueckmeldungAnzeige | null | undefined): boolean {
  return r != null && r.zustand !== 'aktuell';
}

/** Das Wort zur Tönung, wenn die Rückmeldung den Grund liefert. */
const TOENUNG_RUECKMELDUNG: Record<Exclude<RueckmeldungZustand, 'aktuell'>, string> = {
  ueberfaellig: 'Rückm. überfällig',
  keine: 'keine Rückm.',
};

/**
 * Warum eine Zeile getönt ist, als Wörter für die Statusspalte (LFH-973): die Tönung allein
 * trägt die Aussage nicht (WCAG 1.4.1), und Ausfall-Zahl und Rückmeldung stehen in Spalten, die
 * am schmalen Schirm weichen oder hinten liegen. Ein Einheitenstatus „nicht verfügbar“ braucht
 * kein Wort, sein Chip in derselben Spalte nennt ihn schon.
 */
export function toenungsGruende(
  z: RasterZeile,
  r: RueckmeldungAnzeige | null | undefined,
): string[] {
  const gruende: string[] = [];
  const ausfall = z.verteilung?.ausfall ?? 0;
  if (ausfall > 0 && z.einheitStatus?.kategorie !== 'nicht_verfuegbar') {
    gruende.push(`${ausfall} Ausfall`);
  }
  if (z.art === 'einheit' && z.materialAusfall > 0) {
    gruende.push(`${z.materialAusfall} Ausfall Material`);
  }
  if (r != null && r.zustand !== 'aktuell') gruende.push(TOENUNG_RUECKMELDUNG[r.zustand]);
  return gruende;
}

/**
 * Die Kachel „keine Rückmeldung": Einheiten, von denen NIE eine Rückmeldung kam; überfällige
 * zählen nicht (das zeigt ihre Zeile). Gezählt über die GEFILTERTEN Zeilen wie die übrigen
 * Bandzellen, rekursiv samt Untereinheiten (D12). Bei 0 entfällt die Kachel — eine rote Null meldete das Gegenteil.
 */
export function keineRueckmeldungZelle(
  zeilen: readonly RasterZeile[],
  daten: Rueckmeldungen,
): BandZelle | null {
  const ids = einheitZeilen(zeilen)
    .filter(istEchteEinheit)
    .map((z) => z.einheitId);
  const anzahl = ohneRueckmeldung(ids, daten);
  if (anzahl === 0) return null;
  return {
    schluessel: 'rueckmeldung-keine',
    code: null,
    wert: anzahl,
    wort: RUECKMELDUNG_WORT.keine,
    ton: 'alarm',
  };
}

/**
 * Einheiten je Status — eine Zelle je Katalogstatus mit mindestens einer Einheit, in
 * `sortier`-Folge; Fahrzeug- und Handstatus zählen gleich. Danach „gemischt“ und „ohne
 * Status“, wenn belegt — jede Einheit genau einmal, damit das Band sich auf die Einheitenzahl
 * summiert. „ohne Status“ ist echte Datenlage und NICHT die Kachel „keine Rückmeldung“
 * (eigene Gruppe, sonst stünde sie doppelt).
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
        code: a.code,
        wert: anzahl,
        wort: a.wort,
        ton: a.ton,
      };
    });
  if (gemischt > 0) {
    zellen.push({
      schluessel: 'eh-gemischt',
      code: null,
      wert: gemischt,
      wort: 'gemischt',
      ton: 'neutral',
    });
  }
  if (ohne > 0) {
    zellen.push({
      schluessel: 'eh-ohne',
      code: null,
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
    code: null,
    wert: zaehler.get(k)!,
    wort: k === 'ohne' ? OHNE_STATUS.label : statusKategorie[k].label,
    ton: k === 'ohne' ? 'neutral' : tonAusKategorie(k),
  }));
}
