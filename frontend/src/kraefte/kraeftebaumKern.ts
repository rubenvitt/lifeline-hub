import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  Staerke,
  StaerkePosition,
} from '../api/types';
import { staerkeText } from '../anzeige/staerke';
import { type BesatzungsUrteil, type EinheitStaerkeUrteil } from '../theme/statusFarben';
import type { StaerkeSumme } from './kraeftebild';
// Ausfall zählt die eine Material-Zählung (LLH-1093, design.md D10), nicht der Kern.
import { materialAusfall } from './materialVerdichtungKern';
import { ortVon } from './materialPosten';

/**
 * Der Kräftebaum — EINE Baumlogik der Kräfte (LLH-1025, Spec `kraeftebaum`), rein.
 *
 * Gliederung: Einheit → Untereinheiten als echte Kinder; je Einheit ihre Fahrzeuge mit Besatzung,
 * ihr Personal ohne Fahrzeug und ihr Material; Kräfte ohne (bekannte) Einheit unter einer letzten
 * Wurzel „Ohne Einheit“ mit derselben Unterstruktur. Der Kern liefert immer den VOLLEN Baum,
 * Aufrufer bilden nur ab: das Meldebild (`meldebildRaster.ts`), der Lagebericht-Text
 * (`kraeftebild.ts`), später die Einheiten-Seite (LLH-1029) und die Einheit-Ansicht (LLH-1036).
 *
 * JEDE KRAFT GENAU EINMAL: eine Person bleibt bei ihrer Einheit. Sitzt sie auf einem Fahrzeug,
 * das nicht in ihrem Zweig steht (fremde Einheit oder weggefiltert), steht sie unter „Ohne
 * Fahrzeug“ und „fährt auf <Funkrufname>“; der Name kommt aus der UNGEFILTERTEN Fahrzeugliste.
 * Die Besatzung Ist eines Fahrzeugs zählt dagegen alle Kräfte mit seiner `fahrzeug_id` (eine
 * Ist-Zahl je Fahrzeug wie auf der Fahrzeugseite) und nennt die fremden als „davon n aus …“.
 *
 * REIHENFOLGE (D7): eigene Mittel vor Untereinheiten — Fahrzeuge (Funkrufname, natürlich
 * sortiert) → „Ohne Fahrzeug“ → Material → Untereinheiten (Abschnittsrang, dann Eingabefolge).
 * Personen: Einheitsführer (EF), dann F, UF, M, ohne Position, dann Name.
 *
 * STÄRKE kumuliert {@link accumulateStaerke} über eine übergebene Eigenstärke: der Kern zählt keine Köpfe
 * selbst, die Zählung bleibt bei `verdichte` (Heimat der Kräftezahl, `frontend/AGENTS.md`).
 */

// ── Aktive Kräfte ─────────────────────────────────────────────────────────────

/**
 * Nur aktive Kräfte (LLH-1079, Spec `kraefte-entlassung`): eine entlassene oder stornierte Person,
 * ein entlassenes oder storniertes Fahrzeug, herausgenommenes Material (alle `beendet_at`) und eine
 * aufgelöste Einheit (`aufgeloest_at`) stehen in keinem Baum und keiner Stärke; Entlassene führt
 * der Block „Entlassen“ (`entlassene.ts`). Der Server liefert die Listen schon gefiltert, der Kern
 * lässt sie trotzdem aus, damit ein ungefilterter Aufrufer auffällt (design.md D9). Eine Einheit,
 * deren Über-Einheit aufgelöst ist, wird in {@link einheitenBaum} Wurzel wie jede Waise.
 */
export function filterAktive<T extends object>(liste: readonly T[]): T[] {
  return liste.filter((x) => {
    const z = x as { beendet_at?: string | null; aufgeloest_at?: string | null };
    return !z.beendet_at && !z.aufgeloest_at;
  });
}

// ── Abschnitte ────────────────────────────────────────────────────────────────

/**
 * Reihenfolge der Abschnitte: Tiefensuche über `ueber_abschnitt_id`, Eltern vor Kindern, sonst
 * Eingabereihenfolge. Ein Abschnitt ohne vorhandenes Elternteil wird Wurzel.
 */
export function abschnittRang(abschnitte: readonly Einsatzabschnitt[]): Map<number, number> {
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
  const visit = (a: Einsatzabschnitt) => {
    if (rang.has(a.id)) return;
    rang.set(a.id, rang.size);
    for (const k of kinder.get(a.id) ?? []) visit(k);
  };
  for (const a of kinder.get(null) ?? []) visit(a);
  return rang;
}

/**
 * Abschnitt der OBERSTEN Einheit je Einheit (D11, Spec `lage-verdichtung`): eine unterstellte
 * Einheit zählt beim Abschnitt ihrer obersten Einheit. Fehlt die Obereinheit in der Liste, ist
 * die Einheit selbst die oberste (Waise). In einem Zyklus gilt die zuletzt erreichte Einheit vor
 * der Wiederholung.
 */
export function abschnittDerObersten(einheiten: readonly Einheit[]): Map<number, number | null> {
  const nachId = new Map(einheiten.map((e) => [e.id, e]));
  const ergebnis = new Map<number, number | null>();
  for (const e of einheiten) {
    let cur = e;
    const gesehen = new Set<number>([e.id]);
    while (cur.ueber_einheit_id != null) {
      const eltern = nachId.get(cur.ueber_einheit_id);
      if (!eltern || gesehen.has(eltern.id)) break;
      gesehen.add(eltern.id);
      cur = eltern;
    }
    ergebnis.set(e.id, cur.abschnitt_id ?? null);
  }
  return ergebnis;
}

/**
 * Was {@link abschnittDerEinheit} von einer Einheit braucht; auch die Empfängerliste der
 * Verpflegung (`EmpfaengerEinheit`, LLH-1055) trägt es.
 */
export type AbschnittTraeger = Pick<
  Einheit,
  'id' | 'ueber_einheit_id' | 'abschnitt_id' | 'abschnitt_name'
>;

/** Der Abschnitt, den eine Einheit anzeigt: ID und Name aus `abschnitt_name` der tragenden Einheit. */
export interface EinheitAbschnitt {
  id: number;
  name: string | null;
}

/**
 * Abschnitt je Einheit für die ANZEIGE (LLH-1073, design.md D4): der eigene Abschnitt der
 * Einheit, sonst der des nächsten Vorfahren mit Abschnitt; ohne Abschnitt in der Kette `null`.
 * Der Name kommt aus `abschnitt_name` der Einheit, die ihn trägt. Zyklen und fehlende
 * Obereinheiten brechen den Aufstieg ab. Gelesen von {@link einheitenBaum}, der Abschnitt-Spalte
 * der Fahrzeugliste und dem FMS-Tableau; Filter und Stärke bleiben bei
 * {@link abschnittDerObersten} (Spec `lage-verdichtung`).
 */
export function abschnittDerEinheit(
  einheiten: readonly AbschnittTraeger[],
): Map<number, EinheitAbschnitt | null> {
  const nachId = new Map(einheiten.map((e) => [e.id, e]));
  const ergebnis = new Map<number, EinheitAbschnitt | null>();
  for (const e of einheiten) {
    let cur: AbschnittTraeger | undefined = e;
    let treffer: EinheitAbschnitt | null = null;
    const gesehen = new Set<number>();
    while (cur && !gesehen.has(cur.id)) {
      if (cur.abschnitt_id != null) {
        treffer = { id: cur.abschnitt_id, name: cur.abschnitt_name ?? null };
        break;
      }
      gesehen.add(cur.id);
      cur = cur.ueber_einheit_id != null ? nachId.get(cur.ueber_einheit_id) : undefined;
    }
    ergebnis.set(e.id, treffer);
  }
  return ergebnis;
}

// ── Einheit-Hierarchie ────────────────────────────────────────────────────────

/** Ein Knoten der Einheit-Hierarchie (ohne Mittel). */
export interface EinheitKnoten {
  einheit: Einheit;
  /** Der eigene Abschnitt, sonst der geerbte (Spalte und Rang). */
  abschnittId: number | null;
  kinder: EinheitKnoten[];
}

/**
 * Die Einheit-Hierarchie: Wurzeln sind Einheiten ohne vorhandene Obereinheit (Waisen
 * eingeschlossen), Geschwister nach Abschnittsrang, dann Eingabefolge. Zyklen verlieren keine
 * Einheit: was nach dem Abstieg von den Wurzeln fehlt, wird in Eingabefolge selbst Wurzel.
 */
export function einheitenBaum(
  einheiten: readonly Einheit[],
  abschnitte: readonly Einsatzabschnitt[],
): EinheitKnoten[] {
  const rang = abschnittRang(abschnitte);
  const nachId = new Map(einheiten.map((x) => [x.id, x]));
  const kinderJe = new Map<number, Einheit[]>();
  const wurzeln: Einheit[] = [];
  for (const x of einheiten) {
    if (x.ueber_einheit_id != null && nachId.has(x.ueber_einheit_id)) {
      const l = kinderJe.get(x.ueber_einheit_id);
      if (l) l.push(x);
      else kinderJe.set(x.ueber_einheit_id, [x]);
    } else {
      wurzeln.push(x);
    }
  }

  // Abschnitt einer Einheit: der eigene, sonst der geerbte (eine Lesart mit Spalte und Tableau).
  const abschnittJe = abschnittDerEinheit(einheiten);
  const abschnittVon = (x: Einheit): number | null => abschnittJe.get(x.id)?.id ?? null;
  const rangVon = (x: Einheit) => {
    const a = abschnittVon(x);
    return a != null && rang.has(a) ? rang.get(a)! : Number.MAX_SAFE_INTEGER;
  };
  const sortByRang = (liste: readonly Einheit[]) =>
    liste
      .map((x, i) => ({ x, i }))
      .sort((p, q) => rangVon(p.x) - rangVon(q.x) || p.i - q.i)
      .map((p) => p.x);

  const besucht = new Set<number>();
  const build = (x: Einheit): EinheitKnoten => {
    besucht.add(x.id);
    const kinder = sortByRang((kinderJe.get(x.id) ?? []).filter((k) => !besucht.has(k.id)));
    // Erst alle Kinder markieren, dann absteigen: ein Kind darf nicht über ein Geschwister
    // zweimal erreicht werden.
    for (const k of kinder) besucht.add(k.id);
    return { einheit: x, abschnittId: abschnittVon(x), kinder: kinder.map(build) };
  };
  const baum = sortByRang(wurzeln).map(build);
  // Zyklen (a ↔ b) hätten keine Wurzel — sie dürfen trotzdem nicht verschwinden.
  for (const x of einheiten) if (!besucht.has(x.id)) baum.push(build(x));
  return baum;
}

// ── Einheit-Auswahl ───────────────────────────────────────────────────────────

/** Eine wählbare Einheit (LLH-1073, design.md D3): Pfad über die Obereinheiten, Tiefe im Baum. */
export interface EinheitOption {
  id: number;
  name: string;
  /** „Zug 1 › Staffel A“ — die Obereinheiten in Baumfolge, dann die Einheit selbst. */
  pfad: string;
  tiefe: number;
  abschnitt: EinheitAbschnitt | null;
}

/** Eine Gruppe der Einheit-Auswahl: ein Abschnitt oder „ohne Abschnitt“. */
export interface EinheitOptionGruppe {
  /** Abschnitt-ID als Text, `ohne` für Einheiten ohne Abschnitt. */
  schluessel: string;
  titel: string;
  optionen: EinheitOption[];
}

/**
 * Die wählbaren Einheiten in der Folge von {@link einheitenBaum} (Regel „Eine Baumlogik der
 * Kräfte“, kein eigener Baum): nur aktive, Untereinheiten mit Pfad, je Einheit der Abschnitt nach
 * {@link abschnittDerEinheit}.
 */
export function buildEinheitOptions(
  einheiten: readonly Einheit[],
  abschnitte: readonly Einsatzabschnitt[],
): EinheitOption[] {
  const aktive = filterAktive(einheiten);
  const abschnittJe = abschnittDerEinheit(aktive);
  const optionen: EinheitOption[] = [];
  const walk = (k: EinheitKnoten, vorfahren: readonly string[]) => {
    const pfad = [...vorfahren, k.einheit.name];
    optionen.push({
      id: k.einheit.id,
      name: k.einheit.name,
      pfad: pfad.join(' › '),
      tiefe: vorfahren.length,
      abschnitt: abschnittJe.get(k.einheit.id) ?? null,
    });
    for (const kind of k.kinder) walk(kind, pfad);
  };
  for (const w of einheitenBaum(aktive, abschnitte)) walk(w, []);
  return optionen;
}

/**
 * Gruppiert die Auswahl nach Abschnitt: Gruppen in der Folge ihres ersten Auftretens im Baum,
 * „ohne Abschnitt“ zuletzt, Optionen in Baumfolge. Trägt keine Einheit einen Abschnitt, gibt es
 * keine Gruppen (`[]`) — die Auswahl bleibt dann eine flache Liste.
 */
export function groupEinheitOptions(optionen: readonly EinheitOption[]): EinheitOptionGruppe[] {
  if (!optionen.some((o) => o.abschnitt)) return [];
  const gruppen = new Map<string, EinheitOptionGruppe>();
  const ohne: EinheitOptionGruppe = { schluessel: 'ohne', titel: 'ohne Abschnitt', optionen: [] };
  for (const o of optionen) {
    if (!o.abschnitt) {
      ohne.optionen.push(o);
      continue;
    }
    const schluessel = String(o.abschnitt.id);
    let g = gruppen.get(schluessel);
    if (!g) {
      g = { schluessel, titel: o.abschnitt.name ?? `Abschnitt ${o.abschnitt.id}`, optionen: [] };
      gruppen.set(schluessel, g);
    }
    g.optionen.push(o);
  }
  const liste = [...gruppen.values()];
  if (ohne.optionen.length > 0) liste.push(ohne);
  return liste;
}

// ── Besatzung ─────────────────────────────────────────────────────────────────

/**
 * Ist-Besatzungsstärke aus den Stärke-Positionen der zugeordneten Kräfte, bewusst orthogonal zur
 * Einheiten-Stärke. Eine Kraft ohne F/UF-Position ist trotzdem auf dem Fahrzeug und zählt als
 * Mannschaft (Sammeltopf), sodass Σ die tatsächliche Kopfzahl bleibt.
 */
export function besatzungsStaerke(crew: readonly EinsatzPersonal[]): Staerke {
  const s: Staerke = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };
  for (const m of crew) {
    if (m.staerke_position === 'fuehrer') s.fuehrer += 1;
    else if (m.staerke_position === 'unterfuehrer') s.unterfuehrer += 1;
    else s.mannschaft += 1;
  }
  return s;
}

/** Soll gilt als erfüllt, wenn Ist in JEDER Position (F/UF/M) ≥ Soll ist (Überbesetzung zählt mit). */
function isSollErfuellt(ist: Staerke, soll: Staerke): boolean {
  return (
    ist.fuehrer >= soll.fuehrer &&
    ist.unterfuehrer >= soll.unterfuehrer &&
    ist.mannschaft >= soll.mannschaft
  );
}

/**
 * Das Urteil über die Besatzung. „nicht erfasst“ geht vor allem anderen: ohne zugeordnete Kraft
 * gibt es kein Ist, das man am Soll messen könnte (LFH-962, das Personal läuft oft über die
 * Einheit).
 */
export function besatzungsUrteilVon(
  anzahlKraefte: number,
  ist: Staerke,
  soll: Staerke | null,
): BesatzungsUrteil {
  if (anzahlKraefte === 0) return 'nicht_erfasst';
  if (!soll) return 'kein_soll';
  return isSollErfuellt(ist, soll) ? 'erfuellt' : 'unterbesetzt';
}

/**
 * Das Urteil über die Stärke einer Einheit (LLH-1029): Ist KUMULIERT gegen Soll, je Achse wie die
 * Besatzung. Anders als dort gibt es kein „nicht erfasst“: das Personal läuft über die Einheit
 * selbst, null Kräfte bei gesetztem Soll ist unterbesetzt. Die Einheit-Ansicht (LLH-1036) nutzt
 * dasselbe Urteil.
 */
export function einheitStaerkeUrteilVon(ist: Staerke, soll: Staerke | null): EinheitStaerkeUrteil {
  if (!soll) return 'kein_soll';
  return isSollErfuellt(ist, soll) ? 'erfuellt' : 'unterbesetzt';
}

// ── Mittel einer Einheit ──────────────────────────────────────────────────────

export interface PersonImBaum {
  person: EinsatzPersonal;
  /** Einheitsführer (`Einheit.fuehrer_id`), die Marke „EF“. */
  isFuehrer: boolean;
  /** Funkrufname eines Fahrzeugs außerhalb dieses Zweigs, auf dem die Person sitzt. */
  faehrtAuf: string | null;
}

export interface FremdeBesatzung {
  /** Name der Einheit, „ohne Einheit“ ohne (bekannte) Einheit. */
  einheit: string;
  anzahl: number;
}

export interface FahrzeugImBaum {
  fahrzeug: EinsatzFahrzeug;
  /** Nur Kräfte DIESES Zweigs (eigene Einheit), sortiert. */
  besatzung: PersonImBaum[];
  /** Alle Kräfte mit dieser `fahrzeug_id`, auch fremde und weggefilterte. */
  ist: Staerke;
  soll: Staerke | null;
  urteil: BesatzungsUrteil;
  /** Die mitgezählten Kräfte anderer Einheiten — „davon n aus …“. */
  fremd: FremdeBesatzung[];
  /** Material auf diesem Fahrzeug (Ort Fahrzeug, LLH-1225 D14), Gruppe „Beladung“. */
  beladung: EinsatzMaterial[];
  beladungAusfall: number;
}

export interface MittelDerEinheit {
  fahrzeuge: FahrzeugImBaum[];
  /** Personal ohne Fahrzeug in diesem Zweig, auch „fährt auf …“. */
  ohneFahrzeug: PersonImBaum[];
  /** Die Gruppe „Material“: nur Posten mit Ort bei dieser Einheit (ohne Einheit: ohne Ort). */
  material: EinsatzMaterial[];
  /**
   * Ausfall der eigenen Gruppe „Material“ UND der Beladung der eigenen Fahrzeuge (LLH-1225 D14):
   * das eigene Fahrzeug ist ein eigenes Mittel, eine defekte Beladung tönt die Einheit.
   */
  materialAusfall: number;
}

/**
 * Wo ein Posten im Kräftebaum steht (LLH-1225, design.md D14), allein über seinen Ort: Einheit →
 * Gruppe „Material“ der Einheit, Fahrzeug → Gruppe „Beladung“ unter dem Fahrzeug, ohne Ort →
 * Gruppe „Material“ unter „Ohne Einheit“. `null`: nicht im Baum — Material an UHS oder
 * Bereitstellungsraum (die Wurzel zeigt Kräfte ohne Einheit, nicht das Lager einer UHS) und
 * Beladung eines Fahrzeugs, das nicht unter `fahrzeuge` steht.
 */
export type MaterialImBaum =
  | { art: 'einheit'; einheitId: number }
  | { art: 'fahrzeug'; fahrzeugId: number }
  | { art: 'ohne-einheit' };

export function materialImBaum(
  em: Parameters<typeof ortVon>[0],
  fahrzeuge: readonly Pick<EinsatzFahrzeug, 'id'>[],
): MaterialImBaum | null {
  const ort = ortVon(em);
  if (ort == null) return { art: 'ohne-einheit' };
  switch (ort.art) {
    case 'einheit':
      return { art: 'einheit', einheitId: ort.id };
    case 'fahrzeug':
      return fahrzeuge.some((f) => f.id === ort.id)
        ? { art: 'fahrzeug', fahrzeugId: ort.id }
        : null;
    case 'uhs':
    case 'bereitstellungsraum':
      return null;
  }
}

/**
 * Teilt Material nach {@link materialImBaum}: die Beladung je Fahrzeug und die Posten der Gruppen
 * „Material“ je Schlüssel (`gruppeVon` liefert ihn; `undefined` lässt den Posten weg).
 */
function splitMaterial(
  material: readonly EinsatzMaterial[],
  fahrzeuge: readonly Pick<EinsatzFahrzeug, 'id'>[],
  gruppeVon: (z: Exclude<MaterialImBaum, { art: 'fahrzeug' }>) => number | null | undefined,
): { gruppen: Map<number | null, EinsatzMaterial[]>; beladung: Map<number, EinsatzMaterial[]> } {
  const gruppen = new Map<number | null, EinsatzMaterial[]>();
  const beladung = new Map<number, EinsatzMaterial[]>();
  const push = <K>(m: Map<K, EinsatzMaterial[]>, k: K, em: EinsatzMaterial) => {
    const l = m.get(k);
    if (l) l.push(em);
    else m.set(k, [em]);
  };
  for (const em of material) {
    const z = materialImBaum(em, fahrzeuge);
    if (z == null) continue;
    if (z.art === 'fahrzeug') {
      push(beladung, z.fahrzeugId, em);
      continue;
    }
    const k = gruppeVon(z);
    if (k !== undefined) push(gruppen, k, em);
  }
  return { gruppen, beladung };
}

/** Die ungefilterten Listen: Namensquelle für „fährt auf“ und Zählquelle der Besatzung Ist. */
export interface MittelQuelle {
  fahrzeuge: readonly EinsatzFahrzeug[];
  personal: readonly EinsatzPersonal[];
  einheiten: readonly Einheit[];
}

/** Die gefilterten Listen, aus denen der Baum entsteht. */
export interface MittelListen {
  personal: readonly EinsatzPersonal[];
  fahrzeuge: readonly EinsatzFahrzeug[];
  material: readonly EinsatzMaterial[];
}

/** Namen und Funkrufnamen natürlich sortiert („RTW 2“ vor „RTW 10“); eine Stelle für alle Kräfte-Listen. */
export const COLLATOR = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

const POSITION_RANG: Record<StaerkePosition, number> = {
  fuehrer: 1,
  unterfuehrer: 2,
  mannschaft: 3,
};

/** EF, F, UF, M, ohne Position, dann Name. */
function comparePersonen(a: PersonImBaum, b: PersonImBaum): number {
  const rang = (x: PersonImBaum) =>
    x.isFuehrer ? 0 : x.person.staerke_position ? POSITION_RANG[x.person.staerke_position] : 4;
  return rang(a) - rang(b) || COLLATOR.compare(a.person.name, b.person.name);
}

// ── Texte ─────────────────────────────────────────────────────────────────────

/**
 * Die Besatzung eines Fahrzeugs statt einer Stärke (D4) als Zeilen: [„Ist 1/0/3//4“,
 * „Soll 1/1/7//9“], ohne Soll nur die Ist-Zeile, ohne Kraft und Soll „Besatzung nicht erfasst“.
 * Die Stärkespalte des Meldebilds setzt sie untereinander, {@link besatzungText} hintereinander.
 */
export function besatzungZeilen(b: Pick<FahrzeugImBaum, 'ist' | 'soll' | 'urteil'>): string[] {
  if (b.urteil === 'nicht_erfasst') return ['Besatzung nicht erfasst'];
  return [`Ist ${staerkeText(b.ist)}`, ...(b.soll ? [`Soll ${staerkeText(b.soll)}`] : [])];
}

/**
 * „Ist 1/0/3//4 · Soll 1/1/7//9“ in einer Zeile. Ein Text für Schirm (`KraeftebaumZelle`) und
 * Lagebericht (`kraeftebild.ts`).
 */
export function besatzungText(b: Pick<FahrzeugImBaum, 'ist' | 'soll' | 'urteil'>): string {
  return besatzungZeilen(b).join(' · ');
}

/** „davon 1 aus Gr 2, 2 ohne Einheit“ — die mitgezählten fremden Kräfte eines Fahrzeugs. */
export function fremdText(b: Pick<FahrzeugImBaum, 'fremd'>): string | null {
  if (b.fremd.length === 0) return null;
  return `davon ${b.fremd
    .map((f) =>
      f.einheit === 'ohne Einheit' ? `${f.anzahl} ohne Einheit` : `${f.anzahl} aus ${f.einheit}`,
    )
    .join(', ')}`;
}

/** Der Knoten „Ohne Fahrzeug“ entsteht nur, wenn die Einheit Fahrzeuge UND Personal ohne hat (D5). */
export function needsOhneFahrzeugKnoten(m: MittelDerEinheit): boolean {
  return m.fahrzeuge.length > 0 && m.ohneFahrzeug.length > 0;
}

/**
 * Ordnet die EIGENEN Mittel eines Zweigs (schon nach Einheit gruppiert): Fahrzeug → Besatzung und
 * Beladung, „Ohne Fahrzeug“, Material. `eigene.material` ist schon die Gruppe „Material“,
 * `beladungJe` die Beladung je Fahrzeug ({@link materialImBaum}). `fuehrerId` markiert den
 * Einheitsführer.
 */
function sortMittel(
  eigene: MittelListen,
  fuehrerId: number | null,
  quelle: MittelQuelle,
  beladungJe: ReadonlyMap<number, readonly EinsatzMaterial[]>,
): MittelDerEinheit {
  const fahrzeugName = new Map(quelle.fahrzeuge.map((f) => [f.id, f.funkrufname]));
  for (const f of eigene.fahrzeuge)
    if (!fahrzeugName.has(f.id)) fahrzeugName.set(f.id, f.funkrufname);
  const einheitName = new Map(quelle.einheiten.map((e) => [e.id, e.name]));
  const eigeneFahrzeuge = new Set(eigene.fahrzeuge.map((f) => f.id));

  const alsPerson = (ep: EinsatzPersonal): PersonImBaum => ({
    person: ep,
    isFuehrer: fuehrerId != null && ep.id === fuehrerId,
    faehrtAuf:
      ep.fahrzeug_id != null && !eigeneFahrzeuge.has(ep.fahrzeug_id)
        ? (fahrzeugName.get(ep.fahrzeug_id) ?? null)
        : null,
  });

  const besatzungJe = new Map<number, PersonImBaum[]>();
  const ohneFahrzeug: PersonImBaum[] = [];
  for (const ep of eigene.personal) {
    const x = alsPerson(ep);
    if (ep.fahrzeug_id != null && eigeneFahrzeuge.has(ep.fahrzeug_id)) {
      const l = besatzungJe.get(ep.fahrzeug_id);
      if (l) l.push(x);
      else besatzungJe.set(ep.fahrzeug_id, [x]);
    } else {
      ohneFahrzeug.push(x);
    }
  }

  // „Gleiche Einheit“ über die BEKANNTEN Einheiten: eine unbekannte zählt wie keine.
  const einheitSchluessel = (id: number | null | undefined) =>
    id != null && einheitName.has(id) ? id : null;

  const fahrzeuge = [...eigene.fahrzeuge]
    .sort((a, b) => COLLATOR.compare(a.funkrufname, b.funkrufname))
    .map((f): FahrzeugImBaum => {
      const alle = quelle.personal.filter((ep) => ep.fahrzeug_id === f.id);
      const ist = besatzungsStaerke(alle);
      const soll = f.soll_besatzung ?? null;
      const fremdJe = new Map<string, number>();
      const eigeneEinheit = einheitSchluessel(f.einheit_id);
      for (const ep of alle) {
        const k = einheitSchluessel(ep.einheit_id);
        if (k === eigeneEinheit) continue;
        const name = k != null ? einheitName.get(k)! : 'ohne Einheit';
        fremdJe.set(name, (fremdJe.get(name) ?? 0) + 1);
      }
      const beladung = [...(beladungJe.get(f.id) ?? [])];
      return {
        fahrzeug: f,
        besatzung: (besatzungJe.get(f.id) ?? []).sort(comparePersonen),
        ist,
        soll,
        urteil: besatzungsUrteilVon(alle.length, ist, soll),
        fremd: [...fremdJe].map(([einheit, anzahl]) => ({ einheit, anzahl })),
        beladung,
        beladungAusfall: materialAusfall(beladung),
      };
    });

  return {
    fahrzeuge,
    ohneFahrzeug: ohneFahrzeug.sort(comparePersonen),
    material: [...eigene.material],
    materialAusfall:
      materialAusfall(eigene.material) + fahrzeuge.reduce((n, f) => n + f.beladungAusfall, 0),
  };
}

function vollQuelle(
  listen: MittelListen & { einheiten: readonly Einheit[] },
  quelle: Partial<MittelQuelle> = {},
): MittelQuelle {
  return {
    fahrzeuge: filterAktive(quelle.fahrzeuge ?? listen.fahrzeuge),
    personal: filterAktive(quelle.personal ?? listen.personal),
    einheiten: filterAktive(quelle.einheiten ?? listen.einheiten),
  };
}

/**
 * Die Mittel EINER Einheit (Einheit-Ansicht LLH-1036, Lagebericht-Text): Fahrzeuge mit
 * Besatzung, Personal ohne Fahrzeug, Material. `einheitId: null` ordnet die Mittel ohne
 * `einheit_id`. `quelle` sind die ungefilterten Listen; ohne sie gelten die übergebenen.
 */
export function mittelDerEinheit(
  einheitId: number | null,
  roh: MittelListen & { einheiten: readonly Einheit[] },
  quelle: Partial<MittelQuelle> = {},
): MittelDerEinheit {
  roh = aktiveEingabe(roh);
  const einheit = einheitId != null ? roh.einheiten.find((e) => e.id === einheitId) : undefined;
  const hier = (x: { einheit_id?: number | null }) => (x.einheit_id ?? null) === einheitId;
  const fahrzeuge = roh.fahrzeuge.filter(hier);
  // Material nach seinem Ort (D14): die Gruppe nimmt nur Posten dieser Einheit (ohne Einheit: ohne
  // Ort), die Beladung nur die der eigenen Fahrzeuge.
  const { gruppen, beladung } = splitMaterial(roh.material, fahrzeuge, (z) =>
    (z.art === 'einheit' ? z.einheitId : null) === einheitId ? einheitId : undefined,
  );
  return sortMittel(
    {
      personal: roh.personal.filter(hier),
      fahrzeuge,
      material: gruppen.get(einheitId) ?? [],
    },
    einheit?.fuehrer_id ?? null,
    vollQuelle(roh, quelle),
    beladung,
  );
}

// ── Der ganze Baum ────────────────────────────────────────────────────────────

export interface KraeftebaumKnoten {
  einheit: Einheit;
  abschnittId: number | null;
  mittel: MittelDerEinheit;
  kinder: KraeftebaumKnoten[];
}

/**
 * Wurzeln als Liste mit Art, damit Aufrufer weitere Wurzelarten abbilden können. „Ohne
 * Einheit“ steht als letzte Wurzel und nur, wenn sie etwas trägt.
 */
export type KraeftebaumWurzel =
  { art: 'einheit'; knoten: KraeftebaumKnoten } | { art: 'ohne-einheit'; mittel: MittelDerEinheit };

export interface KraeftebaumEingabe extends MittelListen {
  abschnitte: readonly Einsatzabschnitt[];
  einheiten: readonly Einheit[];
  /** Ungefilterte Listen (Namen für „fährt auf“, Besatzung Ist); ohne sie die gefilterten. */
  quelle?: Partial<MittelQuelle>;
}

function groupByEinheit<T extends { einheit_id?: number | null }>(
  liste: readonly T[],
  bekannt: ReadonlySet<number>,
): Map<number | null, T[]> {
  const m = new Map<number | null, T[]>();
  for (const x of liste) {
    const k = x.einheit_id != null && bekannt.has(x.einheit_id) ? x.einheit_id : null;
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Die Eingabe ohne entlassene Kräfte und aufgelöste Einheiten ({@link filterAktive}). */
function aktiveEingabe<T extends MittelListen & { einheiten: readonly Einheit[] }>(e: T): T {
  return {
    ...e,
    einheiten: filterAktive(e.einheiten),
    personal: filterAktive(e.personal),
    fahrzeuge: filterAktive(e.fahrzeuge),
    material: filterAktive(e.material),
  };
}

export function kraeftebaum(eingabe: KraeftebaumEingabe): KraeftebaumWurzel[] {
  const e = aktiveEingabe(eingabe);
  const quelle = vollQuelle(e, e.quelle);
  const bekannt = new Set(e.einheiten.map((x) => x.id));
  const personalJe = groupByEinheit(e.personal, bekannt);
  const fahrzeugeJe = groupByEinheit(e.fahrzeuge, bekannt);
  // Material nach seinem Ort (D14); eine unbekannte Einheit zählt wie keine (wie `groupByEinheit`).
  const { gruppen: materialJe, beladung } = splitMaterial(e.material, e.fahrzeuge, (z) =>
    z.art === 'einheit' && bekannt.has(z.einheitId) ? z.einheitId : null,
  );
  const mittelVon = (id: number | null, fuehrerId: number | null) =>
    sortMittel(
      {
        personal: personalJe.get(id) ?? [],
        fahrzeuge: fahrzeugeJe.get(id) ?? [],
        material: materialJe.get(id) ?? [],
      },
      fuehrerId,
      quelle,
      beladung,
    );
  const mitMitteln = (k: EinheitKnoten): KraeftebaumKnoten => ({
    einheit: k.einheit,
    abschnittId: k.abschnittId,
    mittel: mittelVon(k.einheit.id, k.einheit.fuehrer_id ?? null),
    kinder: k.kinder.map(mitMitteln),
  });
  const wurzeln: KraeftebaumWurzel[] = einheitenBaum(e.einheiten, e.abschnitte).map((k) => ({
    art: 'einheit',
    knoten: mitMitteln(k),
  }));
  const ohne = mittelVon(null, null);
  if (ohne.fahrzeuge.length + ohne.ohneFahrzeug.length + ohne.material.length > 0) {
    wurzeln.push({ art: 'ohne-einheit', mittel: ohne });
  }
  return wurzeln;
}

// ── Stärke ────────────────────────────────────────────────────────────────────

/**
 * Kumulierte Stärke je Einheit (D2): eigen + Σ Kinder, rekursiv. Die Eigenstärke übergibt der
 * Aufrufer (Meldebild: `verdichte` über die GEFILTERTEN Listen, weil `ist_kumuliert` des Servers
 * den Filter nicht kennt).
 */
export function accumulateStaerke<K extends { einheit: Einheit; kinder: readonly K[] }>(
  wurzeln: readonly K[],
  eigen: (e: Einheit) => StaerkeSumme,
): Map<number, StaerkeSumme> {
  const m = new Map<number, StaerkeSumme>();
  const visit = (k: K): StaerkeSumme => {
    const s = { ...eigen(k.einheit) };
    for (const kind of k.kinder) {
      const t = visit(kind);
      s.fuehrer += t.fuehrer;
      s.unterfuehrer += t.unterfuehrer;
      s.mannschaft += t.mannschaft;
      s.gesamt += t.gesamt;
    }
    m.set(k.einheit.id, s);
    return s;
  };
  wurzeln.forEach(visit);
  return m;
}

// ── Ausklappstufen ────────────────────────────────────────────────────────────

/** „Einheiten“ (Vorgabe beim Öffnen) · „mit Fahrzeugen“ · „alles“ (Druck), D8. */
export type Ausklappstufe = 'einheiten' | 'fahrzeuge' | 'alles';

/** Was die Stufen von einer Zeile brauchen: Schlüssel, Art und Kinder. */
export interface StufenZeile {
  key: string;
  art: string;
  children?: readonly StufenZeile[];
}

/**
 * Die offenen Schlüssel einer Stufe, in Baumfolge. „Einheiten“ öffnet jeden Einheitenknoten mit
 * Einheit-Kindern, „mit Fahrzeugen“ jeden Einheitenknoten mit Kindern (auch „Ohne Einheit“),
 * „alles“ jeden Knoten mit Kindern. Die Stufe filtert nie, sie klappt nur.
 */
export function schluesselBisStufe(zeilen: readonly StufenZeile[], stufe: Ausklappstufe): string[] {
  const offen = (z: StufenZeile): boolean => {
    const kinder = z.children ?? [];
    if (kinder.length === 0) return false;
    if (stufe === 'alles') return true;
    if (z.art !== 'einheit') return false;
    return stufe === 'fahrzeuge' || kinder.some((k) => k.art === 'einheit');
  };
  return zeilen.flatMap((z) => [
    ...(offen(z) ? [z.key] : []),
    ...schluesselBisStufe(z.children ?? [], stufe),
  ]);
}

/**
 * Offene Schlüssel für einen Sprung auf die Einheit `ziel` (`?einheit=`, LLH-1049, Spec
 * `kraeftebaum`, „Sprung auf eine Einheit“): ihre Vorfahren und ihr Teilbaum bis zur Stufe „mit
 * Fahrzeugen“, in Baumfolge. `null`, wenn keine Einheitenzeile diesen Schlüssel trägt — dann
 * bleibt die Vorgabestufe.
 */
export function schluesselZumSprung(zeilen: readonly StufenZeile[], ziel: string): string[] | null {
  for (const z of zeilen) {
    if (z.key === ziel) return z.art === 'einheit' ? schluesselBisStufe([z], 'fahrzeuge') : null;
    const tiefer = schluesselZumSprung(z.children ?? [], ziel);
    if (tiefer) return [z.key, ...tiefer];
  }
  return null;
}

/**
 * Die Stufe zu offenen Schlüsseln: zuerst die zuletzt GEWÄHLTE, solange ihre Schlüssel genau
 * offen stehen — sonst zeigten gleiche Schlüsselmengen (ein Zug mit einer Gruppe ohne Mittel)
 * nach einem Klick auf „alles“ weiter „Einheiten“, der Klick wirkte tot. Dann genau „Einheiten“,
 * sonst die weiteste vollständig offene Stufe. Ein einzeln zugeklappter Knoten fällt auf die
 * nächste vollständige Stufe zurück.
 */
export function stufeVon(
  zeilen: readonly StufenZeile[],
  offen: readonly (string | number | bigint)[],
  gewaehlt: Ausklappstufe | null = null,
): Ausklappstufe {
  const ist = new Set(offen.map(String));
  const genau = (stufe: Ausklappstufe) => {
    const soll = schluesselBisStufe(zeilen, stufe);
    return soll.length === ist.size && soll.every((k) => ist.has(k));
  };
  if (gewaehlt && genau(gewaehlt)) return gewaehlt;
  if (genau('einheiten')) return 'einheiten';
  const umfasst = (stufe: Ausklappstufe) =>
    schluesselBisStufe(zeilen, stufe).every((k) => ist.has(k));
  if (umfasst('alles')) return 'alles';
  if (umfasst('fahrzeuge')) return 'fahrzeuge';
  return 'einheiten';
}
