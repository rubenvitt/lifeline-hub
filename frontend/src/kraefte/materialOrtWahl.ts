import type {
  Bereitstellungsraum,
  EinsatzFahrzeug,
  EinsatzMaterial,
  ModulFreigaben,
  Uhs,
} from '../api/types';
import { filterAktive, type EinheitOption } from './kraeftebaumKern';
import {
  mengeText,
  OHNE_ORT,
  OHNE_ORT_WERT,
  ortText,
  ortVon,
  toOrtValue,
  uhsName,
  ZUGEORDNET,
  type MaterialOrtArt,
  type MaterialOrtRef,
  type OrtNamen,
} from './materialPosten';

/**
 * Die Auswahl, der Filter und die Gruppierung des EINEN Orts eines Materialpostens (LLH-1225,
 * design.md D3, D4, D7), rein: Spalte „Ort“, Gruppierung der Liste und beide Disponier-Dialoge
 * bauen aus denselben Funktionen; LLH-1226 („Als Material übernehmen“) ebenso.
 */

/** Was die Auswahl anbietet; eine fehlende Liste heißt „nicht geladen“ und gibt keine Gruppe. */
export interface OrtWahlQuellen {
  /** Aktive Einheiten in Baumfolge mit Pfad (`buildEinheitOptions`, „Eine Baumlogik der Kräfte“). */
  einheiten?: readonly EinheitOption[];
  fahrzeuge?: readonly Pick<EinsatzFahrzeug, 'id' | 'funkrufname' | 'beendet_at'>[];
  uhs?: readonly Pick<Uhs, 'id' | 'bezeichnung' | 'status' | 'storniert_at'>[];
  br?: readonly Pick<Bereitstellungsraum, 'id' | 'bezeichnung' | 'status' | 'storniert_at'>[];
  /** Freigaben des Einsatzes; ohne Lesezugriff fehlt die Gruppe, unbekannt heißt offen. */
  freigaben?: ModulFreigaben;
}

export interface OrtOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface OrtOptionGruppe {
  key: string;
  label: string;
  title: string;
  options: OrtOption[];
}

/** Das Modul, dessen Leserecht eine Ortsart zeigt (Schlüssel der Freigaben). */
export const ORT_MODUL: Record<MaterialOrtArt, string> = {
  einheit: 'einheiten',
  fahrzeug: 'fahrzeuge',
  uhs: 'unfallhilfsstellen',
  bereitstellungsraum: 'bereitstellungsraeume',
};

/** Lesart wie `istSprungGesperrt`: nur ein ausdrückliches `zugriff: false` sperrt. */
export function isOrtLesbar(art: MaterialOrtArt, freigaben: ModulFreigaben | undefined): boolean {
  return freigaben?.[ORT_MODUL[art]]?.zugriff !== false;
}

const nachText = (a: OrtOption, b: OrtOption) =>
  a.label.localeCompare(b.label, 'de', { numeric: true });

/** Geplant oder aktiv und nicht storniert: dorthin lässt sich Material legen (LLH-1224 D8). */
const isVerortbar = (o: { status: string; storniert_at?: string | null }) =>
  !o.storniert_at && (o.status === 'geplant' || o.status === 'aktiv');

/**
 * Die Optionen der Ort-Auswahl (D3): „ohne Ort“ zuerst, dann je Ortsart eine Gruppe — Einheiten in
 * Baumfolge mit Pfad, aktive Fahrzeuge nach Funkrufname, geplante und aktive Unfallhilfsstellen
 * („UHS Turnhalle“) und Bereitstellungsräume. Eine Gruppe erscheint nur mit Leserecht auf ihr Modul
 * und mit mindestens einem Eintrag. Ein `aktuell`er Ort, der nicht (mehr) wählbar ist (aufgelöste
 * UHS, kein Leserecht), steht gesperrt vorn mit seinem Text, damit die Auswahl ihn nennt statt des
 * rohen Werts.
 */
export function buildOrtOptions(
  q: OrtWahlQuellen,
  aktuell?: { ort: MaterialOrtRef | null; text: string },
): (OrtOption | OrtOptionGruppe)[] {
  const lesbar = (art: MaterialOrtArt) => isOrtLesbar(art, q.freigaben);
  const gruppen: OrtOptionGruppe[] = [];
  const gruppe = (key: string, label: string, options: OrtOption[]) => {
    if (options.length > 0) gruppen.push({ key, label, title: label, options });
  };
  if (lesbar('einheit') && q.einheiten) {
    gruppe(
      'einheiten',
      'Einheiten',
      q.einheiten.map((e) => ({ value: toOrtValue({ art: 'einheit', id: e.id }), label: e.pfad })),
    );
  }
  if (lesbar('fahrzeug') && q.fahrzeuge) {
    gruppe(
      'fahrzeuge',
      'Fahrzeuge',
      q.fahrzeuge
        .filter((f) => !f.beendet_at)
        .map((f) => ({ value: toOrtValue({ art: 'fahrzeug', id: f.id }), label: f.funkrufname }))
        .sort(nachText),
    );
  }
  if (lesbar('uhs') && q.uhs) {
    gruppe(
      'uhs',
      'Unfallhilfsstellen',
      q.uhs
        .filter(isVerortbar)
        .map((u) => ({ value: toOrtValue({ art: 'uhs', id: u.id }), label: uhsName(u) }))
        .sort(nachText),
    );
  }
  if (lesbar('bereitstellungsraum') && q.br) {
    gruppe(
      'br',
      'Bereitstellungsräume',
      q.br
        .filter(isVerortbar)
        .map((b) => ({
          value: toOrtValue({ art: 'bereitstellungsraum', id: b.id }),
          label: b.bezeichnung,
        }))
        .sort(nachText),
    );
  }
  const ohne: OrtOption = { value: OHNE_ORT_WERT, label: OHNE_ORT };
  const wert = aktuell ? toOrtValue(aktuell.ort) : null;
  const vorhanden =
    wert == null ||
    wert === OHNE_ORT_WERT ||
    gruppen.some((g) => g.options.some((o) => o.value === wert));
  const gesperrt: OrtOption[] =
    vorhanden || !aktuell ? [] : [{ value: wert, label: aktuell.text, disabled: true }];
  return [...gesperrt, ohne, ...gruppen];
}

type OrtSpalten = Parameters<typeof ortVon>[0];

const ART_WORT: Record<MaterialOrtArt, string> = {
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  uhs: 'UHS',
  bereitstellungsraum: 'Bereitstellungsraum',
};

/** Folge der Ortsarten in Filter und Gruppierung (D4). */
const ART_FOLGE: readonly MaterialOrtArt[] = ['einheit', 'fahrzeug', 'uhs', 'bereitstellungsraum'];

/**
 * Schlüssel und Text eines Orts für Filter und Gruppe: mit Leserecht der Ort selbst
 * ({@link toOrtValue}), ohne fasst `einheit:*` „Einheit zugeordnet“ die ganze Art zusammen.
 */
function ortSchluessel(
  ort: MaterialOrtRef | null,
  namen: OrtNamen,
): { value: string; text: string } {
  const text = ortText(ort, namen);
  if (ort == null) return { value: OHNE_ORT_WERT, text };
  return text === ZUGEORDNET
    ? { value: toOrtValue(ort).replace(/:\d+$/, ':*'), text: `${ART_WORT[ort.art]} zugeordnet` }
    : { value: toOrtValue(ort), text };
}

/**
 * Die Orte der Posten je Ortsart, Schlüssel → Text; die Arten in der Folge von {@link ART_FOLGE},
 * innerhalb einer Art nach Text.
 */
function orteJeArt(posten: readonly OrtSpalten[], namen: OrtNamen) {
  const je = new Map<MaterialOrtArt, Map<string, string>>(ART_FOLGE.map((a) => [a, new Map()]));
  for (const p of posten) {
    const ort = ortVon(p);
    if (ort == null) continue;
    const w = ortSchluessel(ort, namen);
    je.get(ort.art)!.set(w.value, w.text);
  }
  return je;
}

const sortiert = (m: Map<string, string>) =>
  [...m]
    .map(([value, text]) => ({ value, text }))
    .sort((a, b) => a.text.localeCompare(b.text, 'de', { numeric: true }));

/**
 * Filter der Spalte „Ort“ (Spec `material-liste`): „ohne Ort“, je Einheit, je Fahrzeug, je UHS, je
 * Bereitstellungsraum der aktuellen Liste; ein Posten trifft genau einen Wert. Dieselben Schlüssel
 * wie {@link buildOrtGruppierung}.
 */
export function ortFilter(posten: readonly OrtSpalten[], namen: OrtNamen) {
  const je = orteJeArt(posten, namen);
  return {
    werte: [
      { value: OHNE_ORT_WERT, text: OHNE_ORT },
      ...ART_FOLGE.flatMap((a) => sortiert(je.get(a)!)),
    ],
    trifft: (p: OrtSpalten, wert: string) => ortSchluessel(ortVon(p), namen).value === wert,
  };
}

/**
 * Gruppierung der Liste nach Ort (D4): Schlüssel wie der Filter, Etikett der Ortstext, Folge
 * Einheiten (Baumfolge der Einheit-Optionen, unbekannte dahinter), Fahrzeuge, UHS,
 * Bereitstellungsräume (je nach Text), „ohne Ort“ zuletzt.
 */
export function buildOrtGruppierung(
  posten: readonly OrtSpalten[],
  namen: OrtNamen,
  einheitFolge: readonly Pick<EinheitOption, 'id'>[],
) {
  const je = orteJeArt(posten, namen);
  const texte = new Map<string, string>([[OHNE_ORT_WERT, OHNE_ORT]]);
  for (const m of je.values()) for (const [value, text] of m) texte.set(value, text);
  const rang = new Map(einheitFolge.map((e, i) => [toOrtValue({ art: 'einheit', id: e.id }), i]));
  const einheiten = sortiert(je.get('einheit')!).sort(
    (a, b) => (rang.get(a.value) ?? Infinity) - (rang.get(b.value) ?? Infinity),
  );
  const reihenfolge = [
    ...einheiten.map((w) => w.value),
    ...ART_FOLGE.slice(1).flatMap((a) => sortiert(je.get(a)!).map((w) => w.value)),
    OHNE_ORT_WERT,
  ];
  return {
    schluessel: (p: OrtSpalten) => ortSchluessel(ortVon(p), namen).value,
    etikett: (wert: string) => texte.get(wert) ?? wert,
    reihenfolge,
  };
}

/** Ein Posten, wie ihn Filter, Gruppierung und Ort-Angabe lesen. */
export type OrtPosten = Pick<
  EinsatzMaterial,
  'id' | 'einheit_id' | 'einsatz_fahrzeug_id' | 'uhs_id' | 'br_id'
>;

/** Ein Posten, wie ihn „Material zuordnen …“ an einem Ort anbietet. */
export type ZuordnenPosten = OrtPosten &
  Pick<EinsatzMaterial, 'bezeichnung' | 'art' | 'menge' | 'ausgegeben' | 'beendet_at'>;

/**
 * Das Angebot von „Material zuordnen …“ an einem Ort (LLH-1225, design.md D8): Gruppe „Ohne Ort“
 * („Wolldecke · 50“) und Gruppe „An anderem Ort“ mit dem bisherigen Ort im Etikett („Wolldecke ·
 * 30 von 50 übrig · Staffel A“, ohne Leserecht „zugeordnet“), je nach Bezeichnung. Die Posten
 * dieses Orts und herausgenommene fehlen; eine leere Gruppe fehlt. Der Wert ist die Kennung des
 * Postens als Text.
 */
export function buildZuordnenOptions(
  material: readonly ZuordnenPosten[],
  ort: MaterialOrtRef,
  namen: OrtNamen,
): OrtOptionGruppe[] {
  const hier = toOrtValue(ort);
  const ohne: OrtOption[] = [];
  const anderswo: OrtOption[] = [];
  for (const em of filterAktive(material)) {
    const bisher = ortVon(em);
    if (toOrtValue(bisher) === hier) continue;
    const teile = [em.bezeichnung, mengeText(em)];
    if (bisher == null) ohne.push({ value: String(em.id), label: teile.join(' · ') });
    else
      anderswo.push({
        value: String(em.id),
        label: [...teile, ortText(bisher, namen)].join(' · '),
      });
  }
  return (
    [
      ['ohne', 'Ohne Ort', ohne],
      ['anderswo', 'An anderem Ort', anderswo],
    ] as const
  )
    .filter(([, , options]) => options.length > 0)
    .map(([key, label, options]) => ({
      key,
      label,
      title: label,
      options: options.sort(nachText),
    }));
}

/**
 * Der Grund neben einer leeren Auswahl „Material zuordnen …“ (LLH-1255): liegt alles laufende
 * Material schon hier, gibt es kein anderes; gibt es keines, nennt der Grund den Einsatz. „Ohne
 * Ort“ wäre beides Mal falsch, weil die Auswahl auch Posten an anderen Orten anbietet.
 */
export function zuordnenLeerText(material: readonly ZuordnenPosten[]): string {
  return filterAktive(material).length > 0 ? 'Kein anderes Material' : 'Kein Material im Einsatz';
}
