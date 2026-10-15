import type {
  Einheit,
  EinsatzPersonal,
  EinsatzFahrzeug,
  EinsatzMaterial,
  Einsatzabschnitt,
  Staerke,
  StatusKategorie,
  StaerkePosition,
  MaterialStatus,
} from '../api/types';
import { kraefteText, staerkeText } from '../anzeige/staerke';
import {
  abschnittDerObersten,
  besatzungText,
  einheitenBaum,
  filterAktive,
  needsOhneFahrzeugKnoten,
  fremdText,
  mittelDerEinheit,
  type MittelDerEinheit,
  type MittelQuelle,
  type PersonImBaum,
  type EinheitKnoten,
} from './kraeftebaumKern';
import type { BeendeteKraft, MeldebildNachweis } from './entlassene';
import { funktionText } from './einsatzfunktionKern';
import { AUFGEBRAUCHT, isAufgebraucht, ortVon } from './materialPosten';
import { materialAusfall } from './materialVerdichtungKern';

export interface StaerkeSumme {
  fuehrer: number;
  unterfuehrer: number;
  mannschaft: number;
  gesamt: number;
}
export interface StatusVerteilung {
  verfuegbar: number;
  gebunden: number;
  nicht_verfuegbar: number;
  ohne: number;
}
export type ZeilenArt = 'abschnitt' | 'einheit' | 'mittel';
/** `ohne-fahrzeug` und `material-gruppe` sind Gruppenzeilen des Kräftebaums (D5, D6). */
export type MittelArt = 'fahrzeug' | 'person' | 'material' | 'ohne-fahrzeug' | 'material-gruppe';

/** Eine Zeile im Meldebild-Baum (antd-Table `children`-fähig). */
export interface MeldebildZeile {
  key: string;
  art: ZeilenArt;
  mittelArt: MittelArt | null;
  bezeichnung: string;
  detail: string | null;
  staerke: StaerkeSumme;
  soll: StaerkeSumme | null;
  statusKategorie: StatusKategorie | null;
  statusLabel: string | null;
  menge: number | null;
  personalVerteilung: StatusVerteilung | null;
  fahrzeugVerteilung: StatusVerteilung | null;
  /** Nachsatz im Text: Besatzung am Fahrzeug, „fährt auf …“ an der Person. */
  zusatz?: string | null;
  children?: MeldebildZeile[];
}

interface Verdichtung {
  staerke: StaerkeSumme;
  soll: StaerkeSumme | null;
  personalStatus: StatusVerteilung;
  fahrzeugStatus: StatusVerteilung;
  /** Posten je Status; ein aufgebrauchtes Verbrauchsgut zählt unter `aufgebraucht` (LLH-1224). */
  materialStatus: Record<MaterialStatus | 'aufgebraucht', number>;
  anzahlPersonal: number;
  anzahlFahrzeuge: number;
  anzahlMaterialPositionen: number;
}

interface Kraeftebild {
  baum: MeldebildZeile[];
  verdichtung: Verdichtung;
}

export const OHNE_ABSCHNITT_KEY = 'ab-ohne';
export const OHNE_EINHEIT_KEY_PREFIX = 'eh-ohne';

// ── Helfer ───────────────────────────────────────────────────────────────────

// Person ohne Stärke-Position zählt als Mannschaft, damit die Summe der Köpfe
// stets der Personenzahl entspricht (Stärkenachweis-Invariante).
const POS_NULL_FALLBACK: StaerkePosition = 'mannschaft';

const leereStaerke = (): StaerkeSumme => ({
  fuehrer: 0,
  unterfuehrer: 0,
  mannschaft: 0,
  gesamt: 0,
});

const leereVert = (): StatusVerteilung => ({
  verfuegbar: 0,
  gebunden: 0,
  nicht_verfuegbar: 0,
  ohne: 0,
});

function addPosition(s: StaerkeSumme, pos: StaerkePosition | null | undefined): void {
  const k = pos ?? POS_NULL_FALLBACK;
  s[k] += 1;
  s.gesamt += 1;
}

function addStaerke(z: StaerkeSumme, q: StaerkeSumme): void {
  z.fuehrer += q.fuehrer;
  z.unterfuehrer += q.unterfuehrer;
  z.mannschaft += q.mannschaft;
  z.gesamt += q.gesamt;
}

function addKategorie(v: StatusVerteilung, k: StatusKategorie | null | undefined): void {
  if (k === 'verfuegbar') v.verfuegbar++;
  else if (k === 'gebunden') v.gebunden++;
  else if (k === 'nicht_verfuegbar') v.nicht_verfuegbar++;
  else v.ohne++;
}

function addVerteilung(z: StatusVerteilung, q: StatusVerteilung): void {
  z.verfuegbar += q.verfuegbar;
  z.gebunden += q.gebunden;
  z.nicht_verfuegbar += q.nicht_verfuegbar;
  z.ohne += q.ohne;
}

/** Backend-Stärke (F/UF/M, ohne gesamt) → StaerkeSumme. */
function staerkeAusBackend(s: Staerke): StaerkeSumme {
  return {
    fuehrer: s.fuehrer,
    unterfuehrer: s.unterfuehrer,
    mannschaft: s.mannschaft,
    gesamt: s.fuehrer + s.unterfuehrer + s.mannschaft,
  };
}

function addSoll(acc: StaerkeSumme | null, add: StaerkeSumme): StaerkeSumme {
  if (acc === null) return { ...add };
  return {
    fuehrer: acc.fuehrer + add.fuehrer,
    unterfuehrer: acc.unterfuehrer + add.unterfuehrer,
    mannschaft: acc.mannschaft + add.mannschaft,
    gesamt: acc.gesamt + add.gesamt,
  };
}

// ── Mittel über den Kern (D10) ────────────────────────────────────────────────

/** Liefert die geordneten Mittel eines Zweigs; `null` sind die Mittel ohne Einheit. */
type MittelVon = (einheitId: number | null) => MittelDerEinheit;

const leereMittelZeile = (): Omit<
  MeldebildZeile,
  'key' | 'mittelArt' | 'bezeichnung' | 'detail'
> => ({
  art: 'mittel',
  staerke: leereStaerke(),
  soll: null,
  statusKategorie: null,
  statusLabel: null,
  menge: null,
  personalVerteilung: null,
  fahrzeugVerteilung: null,
});

function personMittelZeile(x: PersonImBaum): MeldebildZeile {
  const ep = x.person;
  const ps = leereStaerke();
  addPosition(ps, ep.staerke_position);
  return {
    ...leereMittelZeile(),
    key: `ep-${ep.id}`,
    mittelArt: 'person',
    bezeichnung: ep.name,
    detail: [x.isFuehrer ? 'EF' : null, funktionText(ep)].filter(Boolean).join(' · ') || null,
    staerke: ps,
    statusKategorie: ep.status_kategorie ?? null,
    statusLabel: ep.status_label ?? null,
    zusatz: x.faehrtAuf ? `fährt auf ${x.faehrtAuf}` : null,
  };
}

/**
 * Die Mittelzeilen eines Zweigs in der Folge des Kerns (D7): Fahrzeuge mit ihrer Besatzung und
 * Beladung (LLH-1225 D14) als Unterpunkten → „Ohne Fahrzeug“ (nur neben Fahrzeugen, D5; sonst die Personen direkt) →
 * Material als Gruppe mit Posten und Ausfall (D6). Dieselbe Gliederung wie das Raster am Schirm
 * (`meldebildRaster.ts`), damit Lagebericht und Meldebild nicht zwei Lesarten zeigen.
 */
function mittelZeilen(m: MittelDerEinheit, zweig: string): MeldebildZeile[] {
  const zeilen: MeldebildZeile[] = m.fahrzeuge.map((f) => {
    const ef = f.fahrzeug;
    // Nach der Besatzung die Beladung (LLH-1225 D14): „Beladung: 2 Posten, 1 Ausfall“.
    const kinder = [
      ...f.besatzung.map(personMittelZeile),
      ...(f.beladung.length > 0
        ? [materialGruppe(`bel-${ef.id}`, 'Beladung', f.beladung, f.beladungAusfall)]
        : []),
    ];
    const ist = f.urteil === 'nicht_erfasst' ? besatzungText(f) : `Besatzung ${besatzungText(f)}`;
    return {
      ...leereMittelZeile(),
      key: `ef-${ef.id}`,
      mittelArt: 'fahrzeug',
      bezeichnung: ef.funkrufname,
      detail: ef.fahrzeugtyp ?? null,
      statusKategorie: ef.status_kategorie ?? null,
      statusLabel: ef.status_label ?? null,
      zusatz: [ist, fremdText(f)].filter(Boolean).join(', '),
      children: kinder.length > 0 ? kinder : undefined,
    };
  });
  const personen = m.ohneFahrzeug.map(personMittelZeile);
  if (needsOhneFahrzeugKnoten(m)) {
    zeilen.push({
      ...leereMittelZeile(),
      key: `ofz-${zweig}`,
      mittelArt: 'ohne-fahrzeug',
      bezeichnung: 'Ohne Fahrzeug',
      detail: kraefteText(personen.length),
      children: personen,
    });
  } else {
    zeilen.push(...personen);
  }
  if (m.material.length > 0) {
    // Die Gruppe zählt nur ihre Posten; `m.materialAusfall` trägt auch die Beladung (D14).
    zeilen.push(
      materialGruppe(`mtl-${zweig}`, 'Material', m.material, materialAusfall(m.material)),
    );
  }
  return zeilen;
}

/** Gruppe mit Posten: „Material“ eines Zweigs oder „Beladung“ eines Fahrzeugs. */
function materialGruppe(
  key: string,
  bezeichnung: 'Material' | 'Beladung',
  material: readonly EinsatzMaterial[],
  ausfall: number,
): MeldebildZeile {
  return {
    ...leereMittelZeile(),
    key,
    mittelArt: 'material-gruppe',
    bezeichnung,
    detail: [`${material.length} Posten`, ...(ausfall > 0 ? [`${ausfall} Ausfall`] : [])].join(
      ', ',
    ),
    children: material.map((em) => ({
      ...leereMittelZeile(),
      key: `em-${em.id}`,
      mittelArt: 'material' as const,
      bezeichnung: em.bezeichnung,
      detail: null,
      statusLabel: isAufgebraucht(em) ? AUFGEBRAUCHT : em.status,
      menge: em.menge,
    })),
  };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

interface EinheitResult {
  zeile: MeldebildZeile;
  gesammeltesSoll: StaerkeSumme | null;
}

/**
 * Baut einen Einheiten-Knoten (samt Untereinheiten und Mittelzeilen); liefert die Zeile plus
 * das kumulierte Soll dieser Einheit und aller Nachfahren.
 */
function baueEinheitZeile(
  knoten: EinheitKnoten,
  personalByEinheit: Map<number | null, EinsatzPersonal[]>,
  fahrzeugeByEinheit: Map<number | null, EinsatzFahrzeug[]>,
  mittelVon: MittelVon,
): EinheitResult {
  const einheit = knoten.einheit;
  const staerke = leereStaerke();
  const personalVert = leereVert();
  const fahrzeugVert = leereVert();

  // Die Zeilen der eigenen Mittel kommen aus dem Kern; gezählt wird weiter über die Listen.
  const children: MeldebildZeile[] = mittelZeilen(mittelVon(einheit.id), String(einheit.id));

  for (const ep of personalByEinheit.get(einheit.id) ?? []) {
    addPosition(staerke, ep.staerke_position);
    addKategorie(personalVert, ep.status_kategorie);
  }
  for (const ef of fahrzeugeByEinheit.get(einheit.id) ?? []) {
    addKategorie(fahrzeugVert, ef.status_kategorie);
  }

  let gesammeltesSoll: StaerkeSumme | null = null;
  for (const kind of knoten.kinder) {
    const kindResult = baueEinheitZeile(kind, personalByEinheit, fahrzeugeByEinheit, mittelVon);
    addStaerke(staerke, kindResult.zeile.staerke);
    addVerteilung(personalVert, kindResult.zeile.personalVerteilung ?? leereVert());
    addVerteilung(fahrzeugVert, kindResult.zeile.fahrzeugVerteilung ?? leereVert());
    if (kindResult.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, kindResult.gesammeltesSoll);
    }
    children.push(kindResult.zeile);
  }

  const eigenesSoll = einheit.soll != null ? staerkeAusBackend(einheit.soll) : null;
  if (eigenesSoll !== null) {
    gesammeltesSoll = addSoll(gesammeltesSoll, eigenesSoll);
  }

  const detail = [einheit.typ_label, einheit.fuehrer_name].filter(Boolean).join(' · ') || null;

  const zeile: MeldebildZeile = {
    key: `eh-${einheit.id}`,
    art: 'einheit',
    mittelArt: null,
    bezeichnung: einheit.name,
    detail,
    staerke,
    // Bewusst das eigene Soll (nicht kumuliert): der Knoten zeigt nur das eigene; das kumulierte
    // fließt in die Verdichtung.
    soll: eigenesSoll,
    statusKategorie: null,
    statusLabel: null,
    menge: null,
    personalVerteilung: personalVert,
    fahrzeugVerteilung: fahrzeugVert,
    children: children.length > 0 ? children : undefined,
  };

  return { zeile, gesammeltesSoll };
}

/** Baut einen Abschnitts-Knoten rekursiv. */
function baueAbschnittZeile(
  abschnitt: Einsatzabschnitt,
  kindAbschnitte: Einsatzabschnitt[],
  abschnittKinderMap: Map<number, Einsatzabschnitt[]>,
  wurzelnByAbschnitt: Map<number | null, EinheitKnoten[]>,
  personalByEinheit: Map<number | null, EinsatzPersonal[]>,
  fahrzeugeByEinheit: Map<number | null, EinsatzFahrzeug[]>,
  mittelVon: MittelVon,
): { zeile: MeldebildZeile; gesammeltesSoll: StaerkeSumme | null } {
  const staerke = leereStaerke();
  const personalVert = leereVert();
  const fahrzeugVert = leereVert();
  const children: MeldebildZeile[] = [];
  let gesammeltesSoll: StaerkeSumme | null = null;

  for (const knoten of wurzelnByAbschnitt.get(abschnitt.id) ?? []) {
    const result = baueEinheitZeile(knoten, personalByEinheit, fahrzeugeByEinheit, mittelVon);
    addStaerke(staerke, result.zeile.staerke);
    addVerteilung(personalVert, result.zeile.personalVerteilung ?? leereVert());
    addVerteilung(fahrzeugVert, result.zeile.fahrzeugVerteilung ?? leereVert());
    if (result.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
    }
    children.push(result.zeile);
  }

  for (const kindAbschnitt of kindAbschnitte) {
    const kindAbschnittKinder = abschnittKinderMap.get(kindAbschnitt.id) ?? [];
    const result = baueAbschnittZeile(
      kindAbschnitt,
      kindAbschnittKinder,
      abschnittKinderMap,
      wurzelnByAbschnitt,
      personalByEinheit,
      fahrzeugeByEinheit,
      mittelVon,
    );
    addStaerke(staerke, result.zeile.staerke);
    addVerteilung(personalVert, result.zeile.personalVerteilung ?? leereVert());
    addVerteilung(fahrzeugVert, result.zeile.fahrzeugVerteilung ?? leereVert());
    if (result.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
    }
    children.push(result.zeile);
  }

  const zeile: MeldebildZeile = {
    key: `ab-${abschnitt.id}`,
    art: 'abschnitt',
    mittelArt: null,
    bezeichnung: abschnitt.name,
    detail: null,
    staerke,
    soll: null,
    statusKategorie: null,
    statusLabel: null,
    menge: null,
    personalVerteilung: personalVert,
    fahrzeugVerteilung: fahrzeugVert,
    children: children.length > 0 ? children : undefined,
  };

  return { zeile, gesammeltesSoll };
}

// ── Filter ────────────────────────────────────────────────────────────────────

export interface Rohdaten {
  abschnitte: Einsatzabschnitt[];
  einheiten: Einheit[];
  personal: EinsatzPersonal[];
  fahrzeuge: EinsatzFahrzeug[];
  material: EinsatzMaterial[];
}

export interface FilterWerte {
  abschnittId: number | null;
  traeger: string | null;
  kategorie: StatusKategorie | null;
  suche: string;
}

export function filtereKraefte(alles: Rohdaten, f: FilterWerte): Rohdaten {
  // Zuerst nur aktive Kräfte (LLH-1079): Meldebild, Statusband und Kumulierung zählen keine
  // Entlassenen, und eine Untereinheit einer aufgelösten Über-Einheit ist ihre eigene oberste.
  const roh: Rohdaten = {
    ...alles,
    einheiten: filterAktive(alles.einheiten),
    personal: filterAktive(alles.personal),
  };
  const s = f.suche.trim().toLowerCase();
  const treffer = (txt: (string | null | undefined)[]) =>
    !s || txt.some((t) => t?.toLowerCase().includes(s));
  // Eine Untereinheit zählt beim Abschnitt ihrer OBERSTEN Einheit (D11, LLH-1025; Spec
  // `lage-verdichtung`): eine Gruppe ohne eigenen Abschnitt bleibt unter ihrem Zug, und keine
  // Kraft steht in zwei Abschnitten. Über die ungefilterte Einheitenliste.
  const obersterAbschnitt = abschnittDerObersten(roh.einheiten);
  const einheitErlaubt = (e: Einheit) =>
    f.abschnittId == null || obersterAbschnitt.get(e.id) === f.abschnittId;
  const erlaubteEinheiten = new Set(roh.einheiten.filter(einheitErlaubt).map((e) => e.id));
  const abschnittOk = (einheit_id: number | null | undefined) =>
    f.abschnittId == null || (einheit_id != null && erlaubteEinheiten.has(einheit_id));
  const traegerOk = (traeger: string | null | undefined) => !f.traeger || traeger === f.traeger;
  const fahrzeugEinheit = new Map(roh.fahrzeuge.map((x) => [x.id, x.einheit_id ?? null]));
  const einheitDesOrts = (em: EinsatzMaterial): number | null => {
    const ort = ortVon(em);
    if (ort?.art === 'einheit') return ort.id;
    if (ort?.art === 'fahrzeug') return fahrzeugEinheit.get(ort.id) ?? null;
    return null;
  };
  const passt = (
    einheit_id: number | null | undefined,
    traeger: string | null | undefined,
    kat: StatusKategorie | null | undefined,
    txt: (string | null | undefined)[],
  ) =>
    abschnittOk(einheit_id) &&
    traegerOk(traeger) &&
    (!f.kategorie || kat === f.kategorie) &&
    treffer(txt);
  return {
    abschnitte:
      f.abschnittId == null ? roh.abschnitte : roh.abschnitte.filter((a) => a.id === f.abschnittId),
    einheiten: roh.einheiten.filter(einheitErlaubt),
    personal: roh.personal.filter((x) =>
      passt(x.einheit_id, x.traegerorganisation, x.status_kategorie, [
        x.name,
        x.funktion,
        x.einsatzfunktion,
      ]),
    ),
    fahrzeuge: roh.fahrzeuge.filter((x) =>
      passt(x.einheit_id, x.traegerorganisation, x.status_kategorie, [
        x.funkrufname,
        x.fahrzeugtyp,
      ]),
    ),
    // Material hat keine `status_kategorie` (eigene Achse) → nicht nach Kategorie filtern. Der
    // Abschnitt über die Einheit seines Orts (LLH-1225 D14): Fahrzeug → dessen Einheit; an UHS
    // oder Bereitstellungsraum hat es keine und fällt bei einem Abschnittsfilter heraus.
    material: roh.material.filter(
      (x) =>
        abschnittOk(einheitDesOrts(x)) &&
        traegerOk(x.traegerorganisation) &&
        treffer([x.bezeichnung]),
    ),
  };
}

// ── Formatierung ──────────────────────────────────────────────────────────────

// „F/UF/M//Ges" kommt aus der EINEN Formatierung `anzeige/staerke.ts:staerkeText` (LFH-550).

// ── Markdown-Renderer ─────────────────────────────────────────────────────────

/**
 * Die Art des Mittels als KURZWORT, nicht als Emoji: der Markdown landet in einem Lagebericht,
 * der gedruckt und als Text weitergegeben wird, wo ein Emoji nichts trägt. Die Kürzel folgen
 * der Kennzahlenzeile („Mtl. defekt"). Der Test pinnt sie als LITERAL, nicht über diese
 * Konstante.
 */
const MITTEL_MARKE = { person: 'Pers.', fahrzeug: 'Fzg.', material: 'Mtl.' } as const;

function rendereMeldebildZeileMarkdown(zeile: MeldebildZeile, tiefe: number): string {
  const zeilen: string[] = [];
  // Ein Einzug für Einheiten und Mittel: zwei Leerzeichen je Ebene unter dem Abschnitt, damit
  // Untereinheit, Fahrzeug und Besatzung als verschachtelte Liste lesbar bleiben.
  const einzug = '  '.repeat(Math.max(0, tiefe - 1));
  const klammer = zeile.detail ? ` (${zeile.detail})` : '';
  const nachsatz = zeile.zusatz ? ` — ${zeile.zusatz}` : '';

  if (zeile.art === 'abschnitt') {
    // Abschnitte tragen keinen Einzug — die Tiefe steckt in der Heading-Hierarchie (## / ###).
    const prefix = tiefe === 0 ? '##' : '###';
    zeilen.push(`${prefix} ${zeile.bezeichnung}`);
    zeilen.push(`Stärke (F/UF/M//Ges): ${staerkeText(zeile.staerke)}`);
  } else if (zeile.art === 'einheit') {
    zeilen.push(
      `${einzug}- **${zeile.bezeichnung}**${klammer} — Stärke: ${staerkeText(zeile.staerke)}`,
    );
  } else if (zeile.mittelArt === 'ohne-fahrzeug' || zeile.mittelArt === 'material-gruppe') {
    // Gruppenzeile: „Ohne Fahrzeug: 2 Kräfte“, „Material: 3 Posten, 1 Ausfall“.
    zeilen.push(`${einzug}- ${zeile.bezeichnung}${zeile.detail ? `: ${zeile.detail}` : ''}`);
  } else if (zeile.mittelArt === 'person' || zeile.mittelArt === 'fahrzeug') {
    const status = zeile.statusLabel ?? zeile.statusKategorie ?? '';
    zeilen.push(
      `${einzug}- ${MITTEL_MARKE[zeile.mittelArt]} ${zeile.bezeichnung}${klammer}${status ? ` [${status}]` : ''}${nachsatz}`,
    );
  } else {
    const menge = zeile.menge != null ? ` ×${zeile.menge}` : '';
    const status = zeile.statusLabel ?? '';
    zeilen.push(
      `${einzug}- ${MITTEL_MARKE.material} ${zeile.bezeichnung}${menge}${status ? ` [${status}]` : ''}`,
    );
  }

  if (zeile.children) {
    for (const kind of zeile.children) {
      zeilen.push(rendereMeldebildZeileMarkdown(kind, tiefe + 1));
    }
  }

  return zeilen.join('\n');
}

type MittelMarke = (typeof MITTEL_MARKE)[keyof typeof MITTEL_MARKE];

/** Zeilen einer Art im Nachweis, nach Zeitpunkt des Endes; `null` sagt „nicht geladen“. */
function nachweisZeilen(
  marke: MittelMarke,
  eintraege: readonly BeendeteKraft[] | null,
  dtg: (iso: string) => string,
): string[] {
  if (eintraege === null) return [`- ${marke} — nicht geladen`];
  return [...eintraege]
    .sort((a, b) => (a.beendetAt ?? '').localeCompare(b.beendetAt ?? ''))
    .map(
      (k) =>
        `- ${marke} ${k.name}${k.zusatz ? ` (${k.zusatz})` : ''}${k.beendetAt ? ` — ${dtg(k.beendetAt)}` : ''}`,
    );
}

/** Ein Nachweis-Block: leer ohne Einträge, „— nicht geladen“, wenn keine seiner Listen da ist. */
function nachweisBlock(
  titel: string,
  arten: readonly [MittelMarke, readonly BeendeteKraft[] | null][],
  dtg: (iso: string) => string,
): string[] {
  if (arten.every(([, e]) => e === null)) return [`## ${titel}`, '', '— nicht geladen', ''];
  const zeilen = arten.flatMap(([marke, e]) => nachweisZeilen(marke, e, dtg));
  return zeilen.length === 0 ? [] : [`## ${titel}`, '', ...zeilen, ''];
}

/**
 * Rendert ein Kraeftebild als Markdown. Deterministisch — `stand` kommt von außen. Beendete
 * Kräfte stehen als Nachweis darunter (LLH-1079, LLH-1235): „Entlassen“ für Personen und
 * Fahrzeuge, „Aus dem Einsatz genommen“ für Material, je mit Zeitpunkt.
 */
export function rendereMeldebildMarkdown(
  bild: Kraeftebild,
  stand: string,
  nachweis?: MeldebildNachweis,
): string {
  const v = bild.verdichtung;
  const zeilen: string[] = [];

  zeilen.push('# Kräftemeldebild');
  zeilen.push('');
  zeilen.push(`**Stand:** ${stand}`);
  zeilen.push('');

  zeilen.push('## Lagebild gesamt');
  zeilen.push('');
  // Als Liste: Markdown kennt keinen harten Umbruch, Zeilen ohne Leerzeile liefen in der Anzeige
  // zu einem Absatz zusammen (LFH-1153).
  zeilen.push(`- **Gesamtstärke (F/UF/M//Ges):** ${staerkeText(v.staerke)}`);
  zeilen.push(
    `- **Fahrzeuge:** ${v.anzahlFahrzeuge} gesamt (frei: ${v.fahrzeugStatus.verfuegbar}, gebunden: ${v.fahrzeugStatus.gebunden}, n.v.: ${v.fahrzeugStatus.nicht_verfuegbar})`,
  );
  let material = `- **Material (Positionen):** ${v.anzahlMaterialPositionen}`;
  if (v.anzahlMaterialPositionen > 0) {
    const matTeile: string[] = [];
    if (v.materialStatus.einsatzbereit > 0)
      matTeile.push(`einsatzbereit: ${v.materialStatus.einsatzbereit}`);
    if (v.materialStatus.im_einsatz > 0)
      matTeile.push(`im Einsatz: ${v.materialStatus.im_einsatz}`);
    if (v.materialStatus.defekt > 0) matTeile.push(`defekt: ${v.materialStatus.defekt}`);
    if (v.materialStatus.verbraucht > 0)
      matTeile.push(`verbraucht: ${v.materialStatus.verbraucht}`);
    if (v.materialStatus.desinfektion_noetig > 0)
      matTeile.push(`Desinfektion nötig: ${v.materialStatus.desinfektion_noetig}`);
    if (v.materialStatus.aufgebraucht > 0)
      matTeile.push(`${AUFGEBRAUCHT}: ${v.materialStatus.aufgebraucht}`);
    if (matTeile.length > 0) material += ` (${matTeile.join(', ')})`;
  }
  zeilen.push(material);
  zeilen.push('');

  if (bild.baum.length > 0) {
    zeilen.push('## Kräftegliederung');
    zeilen.push('');
    for (const zeile of bild.baum) {
      zeilen.push(rendereMeldebildZeileMarkdown(zeile, 0));
      zeilen.push('');
    }
  }
  if (nachweis) {
    const { personal, fahrzeuge, material, dtg } = nachweis;
    zeilen.push(
      ...nachweisBlock(
        'Entlassen',
        [
          [MITTEL_MARKE.person, personal],
          [MITTEL_MARKE.fahrzeug, fahrzeuge],
        ],
        dtg,
      ),
      ...nachweisBlock('Aus dem Einsatz genommen', [[MITTEL_MARKE.material, material]], dtg),
    );
  }

  return zeilen.join('\n');
}

// ── Öffentliche API ───────────────────────────────────────────────────────────

/** Verdichtung ohne `soll` — der Teil, der sich allein aus den drei Mittel-Listen ergibt. */
type Kurzverdichtung = Omit<Verdichtung, 'soll'>;

/**
 * Kopfzahlen aus den ROHLISTEN, nicht aus dem Baum — gefiltert für die Kopfzahlen der
 * Kräfteübersicht, UNGEFILTERT als Bezugswert daneben (die Gesamtstärke darf beim Anwählen
 * eines Abschnitts nicht verschwinden) und in der Verdichtungszeile der Kräfte-Modulseiten.
 * `soll` fehlt bewusst: es kumuliert über den Einheitenbaum und braucht `baueKraeftebild`.
 * Gezählt wird nur aktives Personal (LLH-1079, Fixture `regeln.json` Abschnitt `kraefte`).
 */
export function verdichte(
  allesPersonal: EinsatzPersonal[],
  fahrzeuge: EinsatzFahrzeug[],
  material: EinsatzMaterial[],
): Kurzverdichtung {
  const personal = filterAktive(allesPersonal);
  const staerke = leereStaerke();
  const personalStatus = leereVert();
  const fahrzeugStatus = leereVert();
  const materialStatus: Record<MaterialStatus | 'aufgebraucht', number> = {
    einsatzbereit: 0,
    im_einsatz: 0,
    defekt: 0,
    verbraucht: 0,
    desinfektion_noetig: 0,
    aufgebraucht: 0,
  };

  for (const ep of personal) {
    addPosition(staerke, ep.staerke_position);
    addKategorie(personalStatus, ep.status_kategorie);
  }

  for (const ef of fahrzeuge) {
    addKategorie(fahrzeugStatus, ef.status_kategorie);
  }

  for (const em of material) {
    // LLH-1224, design.md D15: aufgebraucht statt unter dem Status, dieselbe Regel wie der Ausfall.
    materialStatus[isAufgebraucht(em) ? AUFGEBRAUCHT : em.status] += 1;
  }

  return {
    staerke,
    personalStatus,
    fahrzeugStatus,
    materialStatus,
    anzahlPersonal: personal.length,
    anzahlFahrzeuge: fahrzeuge.length,
    anzahlMaterialPositionen: material.length,
  };
}

export function baueKraeftebild(
  abschnitte: Einsatzabschnitt[],
  alleEinheiten: Einheit[],
  allesPersonal: EinsatzPersonal[],
  fahrzeuge: EinsatzFahrzeug[],
  material: EinsatzMaterial[],
  /**
   * Ungefilterte Listen (Namen für „fährt auf“, Besatzung Ist, D4); ohne sie gelten die
   * übergebenen. Die Seite übergibt sie, die Übernahme „Eigene Lage“ ist ungefiltert.
   */
  quelle: Partial<MittelQuelle> = {},
): Kraeftebild {
  // Nur aktive Kräfte (LLH-1079): Entlassene führt der Block „Entlassen“ (`entlassene.ts`).
  const einheiten = filterAktive(alleEinheiten);
  const personal = filterAktive(allesPersonal);
  const roh = { einheiten, personal, fahrzeuge, material };
  const mittelVon: MittelVon = (einheitId) => mittelDerEinheit(einheitId, roh, quelle);

  // ── Index nach einheit_id ─────────────────────────────────────────────────
  const personalByEinheit = new Map<number | null, EinsatzPersonal[]>();
  for (const ep of personal) {
    const key = ep.einheit_id ?? null;
    if (!personalByEinheit.has(key)) personalByEinheit.set(key, []);
    personalByEinheit.get(key)!.push(ep);
  }

  const fahrzeugeByEinheit = new Map<number | null, EinsatzFahrzeug[]>();
  for (const ef of fahrzeuge) {
    const key = ef.einheit_id ?? null;
    if (!fahrzeugeByEinheit.has(key)) fahrzeugeByEinheit.set(key, []);
    fahrzeugeByEinheit.get(key)!.push(ef);
  }

  // ── Einheit-Hierarchie aus dem Kern ───────────────────────────────────────
  // `einheitenBaum` (frontend/AGENTS.md, „Eine Baumlogik der Kräfte“): eine Waise (Obereinheit
  // nicht in der Liste) wird Wurzel, ein Zyklus verliert keine Einheit — so zählt die
  // Kräftegliederung dieselben Kräfte wie die Gesamtstärke. Wurzeln je Abschnitt (D11).
  const wurzelnByAbschnitt = new Map<number | null, EinheitKnoten[]>();
  for (const knoten of einheitenBaum(einheiten, abschnitte)) {
    const key = knoten.abschnittId;
    if (!wurzelnByAbschnitt.has(key)) wurzelnByAbschnitt.set(key, []);
    wurzelnByAbschnitt.get(key)!.push(knoten);
  }

  // ── Abschnitte-Index ──────────────────────────────────────────────────────
  // Wurzel ist ein Abschnitt ohne Eltern-Abschnitt ODER dessen Eltern nicht in der Liste stehen
  // (Waisen-Promotion): das hält Tabelle und Kopf konsistent, wenn der Filter nur einen
  // Unter-Abschnitt durchlässt.
  const abschnittIdSet = new Set<number>();
  for (const a of abschnitte) abschnittIdSet.add(a.id);

  const abschnittKinderMap = new Map<number, Einsatzabschnitt[]>();
  const topAbschnitte: Einsatzabschnitt[] = [];

  for (const a of abschnitte) {
    if (a.ueber_abschnitt_id != null && abschnittIdSet.has(a.ueber_abschnitt_id)) {
      if (!abschnittKinderMap.has(a.ueber_abschnitt_id))
        abschnittKinderMap.set(a.ueber_abschnitt_id, []);
      abschnittKinderMap.get(a.ueber_abschnitt_id)!.push(a);
    } else {
      topAbschnitte.push(a);
    }
  }

  // ── Baum ─────────────────────────────────────────────────────────────────
  const baum: MeldebildZeile[] = [];
  let gesammeltesSoll: StaerkeSumme | null = null;

  for (const abschnitt of topAbschnitte) {
    const kindAbschnitte = abschnittKinderMap.get(abschnitt.id) ?? [];
    const result = baueAbschnittZeile(
      abschnitt,
      kindAbschnitte,
      abschnittKinderMap,
      wurzelnByAbschnitt,
      personalByEinheit,
      fahrzeugeByEinheit,
      mittelVon,
    );
    if (result.gesammeltesSoll !== null) {
      gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
    }
    baum.push(result.zeile);
  }

  // ── Auffangknoten „Ohne Abschnitt" ───────────────────────────────────────
  const ohneAbschnittEinheiten = wurzelnByAbschnitt.get(null) ?? [];
  // Mittel ohne `einheit_id`: Pseudo-Einheit „Ohne Einheit".
  const ohneEinheitPersonal = personalByEinheit.get(null) ?? [];
  const ohneEinheitFahrzeuge = fahrzeugeByEinheit.get(null) ?? [];
  // Nur Material ohne Ort (D14): Beladung steht am Fahrzeug, Material an UHS und
  // Bereitstellungsraum nicht im Baum.
  const ohneEinheitMaterial = material.filter((em) => ortVon(em) == null);

  const hasOhne =
    ohneAbschnittEinheiten.length > 0 ||
    ohneEinheitPersonal.length > 0 ||
    ohneEinheitFahrzeuge.length > 0 ||
    ohneEinheitMaterial.length > 0;

  if (hasOhne) {
    const ohneAbschnittStaerke = leereStaerke();
    const ohneAbschnittPersonalVert = leereVert();
    const ohneAbschnittFahrzeugVert = leereVert();
    const ohneAbschnittChildren: MeldebildZeile[] = [];

    for (const knoten of ohneAbschnittEinheiten) {
      const result = baueEinheitZeile(knoten, personalByEinheit, fahrzeugeByEinheit, mittelVon);
      addStaerke(ohneAbschnittStaerke, result.zeile.staerke);
      addVerteilung(ohneAbschnittPersonalVert, result.zeile.personalVerteilung ?? leereVert());
      addVerteilung(ohneAbschnittFahrzeugVert, result.zeile.fahrzeugVerteilung ?? leereVert());
      if (result.gesammeltesSoll !== null) {
        gesammeltesSoll = addSoll(gesammeltesSoll, result.gesammeltesSoll);
      }
      ohneAbschnittChildren.push(result.zeile);
    }

    if (
      ohneEinheitPersonal.length > 0 ||
      ohneEinheitFahrzeuge.length > 0 ||
      ohneEinheitMaterial.length > 0
    ) {
      const ohneEinheitStaerke = leereStaerke();
      const ohneEinheitPersonalVert = leereVert();
      const ohneEinheitFahrzeugVert = leereVert();
      const ohneEinheitChildren = mittelZeilen(mittelVon(null), 'ohne');

      for (const ep of ohneEinheitPersonal) {
        addPosition(ohneEinheitStaerke, ep.staerke_position);
        addKategorie(ohneEinheitPersonalVert, ep.status_kategorie);
      }
      for (const ef of ohneEinheitFahrzeuge) {
        addKategorie(ohneEinheitFahrzeugVert, ef.status_kategorie);
      }

      addStaerke(ohneAbschnittStaerke, ohneEinheitStaerke);
      addVerteilung(ohneAbschnittPersonalVert, ohneEinheitPersonalVert);
      addVerteilung(ohneAbschnittFahrzeugVert, ohneEinheitFahrzeugVert);

      ohneAbschnittChildren.push({
        key: `${OHNE_EINHEIT_KEY_PREFIX}-0`,
        art: 'einheit',
        mittelArt: null,
        bezeichnung: 'Ohne Einheit',
        detail: null,
        staerke: ohneEinheitStaerke,
        soll: null,
        statusKategorie: null,
        statusLabel: null,
        menge: null,
        personalVerteilung: ohneEinheitPersonalVert,
        fahrzeugVerteilung: ohneEinheitFahrzeugVert,
        children: ohneEinheitChildren.length > 0 ? ohneEinheitChildren : undefined,
      });
    }

    baum.push({
      key: OHNE_ABSCHNITT_KEY,
      art: 'abschnitt',
      mittelArt: null,
      bezeichnung: 'Ohne Abschnitt',
      detail: null,
      staerke: ohneAbschnittStaerke,
      soll: null,
      statusKategorie: null,
      statusLabel: null,
      menge: null,
      personalVerteilung: ohneAbschnittPersonalVert,
      fahrzeugVerteilung: ohneAbschnittFahrzeugVert,
      children: ohneAbschnittChildren.length > 0 ? ohneAbschnittChildren : undefined,
    });
  }

  // Verdichtung aus den ROHLISTEN (`verdichte`); `soll` kommt dazu, weil nur der Baumaufbau es
  // kumulieren kann.
  return {
    baum,
    verdichtung: { ...verdichte(personal, fahrzeuge, material), soll: gesammeltesSoll },
  };
}
