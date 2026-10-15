import { ApiError } from '../api/client';
import { SAMMEL_MAX } from '../api/eingabegrenzen';
import type {
  AusVorlageEingabe,
  Einheit,
  VorlageVorschau,
  VorschauFahrzeug,
  VorschauPersonal,
  VorschauZustand,
  ZeilenArt,
} from '../api/types';

/**
 * Reiner Kern der Seite „Einheit aus Vorlage bilden“ (LLH-1049, Spec `einheit-vorlagen`, „Seite
 * zum Bilden aus der Vorlage“, Change `h997wi4l-einheit-aus-vorlage` D4, D7, D14, D15): Vorgaben
 * der Häkchen je Zustand, die Wahl je Stamm-ID über Abgleiche hinweg, „ohne Fahrzeug“, die
 * Zusammenfassung am Knopf, Deckel, Namenswarnung, der Anfrage-Body und die Gründe je Zeile.
 *
 * Maßgeblich ist der Server: er plant beim Absenden neu und lehnt mit Gründen je Zeile ab. Der
 * Kern entscheidet nichts, was der Server anders sähe; er zeigt nur vorab, was kommt.
 */

/** Wahl einer Zeile: angehakt, und ob das Häkchen an einer gebundenen Kraft gesetzt wurde. */
export interface WahlEintrag {
  an: boolean;
  /**
   * Nur wahr, wenn das Häkchen gesetzt wurde, während die Kraft gebunden war (D3, D14): eine
   * erst danach gebunden gewordene Kraft wird nicht still umgehängt, der Server nennt den Grund.
   */
  umhaengen: boolean;
}

/** Wahl je Stamm-ID; Fahrzeug- und Personen-IDs kollidieren, deshalb zwei Karten. */
export interface Wahl {
  fahrzeuge: ReadonlyMap<number, WahlEintrag>;
  personal: ReadonlyMap<number, WahlEintrag>;
}

export const LEERE_WAHL: Wahl = { fahrzeuge: new Map(), personal: new Map() };

type Zeile = VorschauFahrzeug | VorschauPersonal;

/**
 * Gesperrt: außer Dienst. Ein entlassenes Fahrzeug ebenso, solange der Server es nicht erneut
 * disponiert (LLH-1079 Teil II); er lehnt es mit „entlassen“ ab. Personen kommen erneut.
 */
export function isGesperrt(art: ZeilenArt, zustand: VorschauZustand): boolean {
  if (zustand === 'ausser_dienst') return true;
  return art === 'fahrzeug' && zustand === 'entlassen';
}

/** Vorgabe des Häkchens (D4): Fahrzeuge „neu“ und „im Einsatz“ an, Personen nie (Vorschlag). */
export function vorgabeAn(art: ZeilenArt, zustand: VorschauZustand): boolean {
  return art === 'fahrzeug' && (zustand === 'neu' || zustand === 'frei');
}

export function alleFahrzeuge(v: VorlageVorschau): VorschauFahrzeug[] {
  return v.knoten.flatMap((k) => k.fahrzeuge);
}

export function allePersonen(v: VorlageVorschau): VorschauPersonal[] {
  return v.knoten.flatMap((k) => k.personal);
}

/**
 * Gleicht die Wahl mit einer (neuen) Vorschau ab: getroffene Wahl bleibt, eine neu erscheinende
 * Zeile bekommt ihre Vorgabe (D14).
 */
export function reconcileWahl(wahl: Wahl, v: VorlageVorschau): Wahl {
  const ergaenze = <T extends Zeile>(
    alt: ReadonlyMap<number, WahlEintrag>,
    zeilen: T[],
    art: ZeilenArt,
    id: (z: T) => number,
  ) => {
    const neu = new Map(alt);
    for (const z of zeilen) {
      if (!neu.has(id(z))) neu.set(id(z), { an: vorgabeAn(art, z.zustand), umhaengen: false });
    }
    return neu;
  };
  return {
    fahrzeuge: ergaenze(wahl.fahrzeuge, alleFahrzeuge(v), 'fahrzeug', (f) => f.fahrzeug_id),
    personal: ergaenze(wahl.personal, allePersonen(v), 'personal', (p) => p.personal_id),
  };
}

function idVon(art: ZeilenArt, z: Zeile): number {
  return art === 'fahrzeug'
    ? (z as VorschauFahrzeug).fahrzeug_id
    : (z as VorschauPersonal).personal_id;
}

/** Setzt das Häkchen einer Zeile; an einer gebundenen Kraft heißt es „umhängen“. */
export function setWahl(wahl: Wahl, art: ZeilenArt, zeile: Zeile, an: boolean): Wahl {
  const eintrag: WahlEintrag = { an, umhaengen: an && zeile.zustand === 'gebunden' };
  const id = idVon(art, zeile);
  if (art === 'fahrzeug') return { ...wahl, fahrzeuge: new Map(wahl.fahrzeuge).set(id, eintrag) };
  return { ...wahl, personal: new Map(wahl.personal).set(id, eintrag) };
}

/**
 * Trägt die Zeile das Häkchen „umhängen“? Ja bei einer gebundenen Kraft, außer sie wurde erst
 * nach dem Anhaken gebunden: dann steht das alte Häkchen, und der Server nennt den Grund (D14).
 */
export function showsUmhaengen(zeile: Zeile, eintrag: WahlEintrag | undefined): boolean {
  return zeile.zustand === 'gebunden' && (!eintrag?.an || eintrag.umhaengen);
}

/**
 * Braucht die Zeile den Griff „umhängen“ (LLH-1237)? Ja, wenn die Kraft erst nach dem Anhaken
 * gebunden wurde: das Häkchen steht ohne „umhängen“, und das Bilden würde wieder abgelehnt. Ein
 * Klick auf den Griff ist die ausdrückliche Wahl (`setWahl`), nichts wird still umgehängt (D14).
 */
export function offersUmhaengen(zeile: Zeile, eintrag: WahlEintrag | undefined): boolean {
  return zeile.zustand === 'gebunden' && eintrag?.an === true && !eintrag.umhaengen;
}

/** „umhängen aus «2. Zug»“ bzw. „umhängen von «83-4»“; `null` an einer nicht gebundenen Kraft. */
export function umhaengenText(_art: ZeilenArt, zeile: Zeile): string | null {
  if (zeile.zustand !== 'gebunden') return null;
  if (zeile.einheit_name) return `umhängen aus «${zeile.einheit_name}»`;
  const fahrzeug = (zeile as VorschauPersonal).fahrzeug_name;
  return fahrzeug ? `umhängen von «${fahrzeug}»` : 'umhängen';
}

/** Der Zustand einer Zeile als Wort (D4). */
export function zustandWort(_art: ZeilenArt, zeile: Zeile): string {
  switch (zeile.zustand) {
    case 'neu':
      return 'neu';
    case 'frei':
      return 'im Einsatz';
    case 'ausser_dienst':
      return 'außer Dienst';
    case 'entlassen':
      return 'entlassen';
    case 'gebunden': {
      if (zeile.einheit_name) return `in «${zeile.einheit_name}»`;
      const fahrzeug = (zeile as VorschauPersonal).fahrzeug_name;
      return fahrzeug ? `auf «${fahrzeug}»` : 'gebunden';
    }
  }
}

/** Kommt das Fahrzeug mit? Angehakt, nicht gesperrt, und gebunden nur mit „umhängen“. */
export function kommtMit(f: VorschauFahrzeug, wahl: Wahl): boolean {
  const e = wahl.fahrzeuge.get(f.fahrzeug_id);
  if (!e?.an || isGesperrt('fahrzeug', f.zustand)) return false;
  return f.zustand !== 'gebunden' || e.umhaengen;
}

function fahrzeugKommtMit(v: VorlageVorschau, fahrzeugId: number, wahl: Wahl): boolean {
  const f = alleFahrzeuge(v).find((x) => x.fahrzeug_id === fahrzeugId);
  return f != null && kommtMit(f, wahl);
}

/** „ohne Fahrzeug“: die Person hat in der Vorlage ein Fahrzeug, und es kommt nicht mit (D4). */
export function ohneFahrzeug(p: VorschauPersonal, v: VorlageVorschau, wahl: Wahl): boolean {
  return p.fahrzeug_id != null && !fahrzeugKommtMit(v, p.fahrzeug_id, wahl);
}

/**
 * Eine gewählte Person ohne Einheit, die schon auf ihrem Vorlagen-Fahrzeug sitzt („im
 * Einsatz“), verlässt es, wenn es nicht mitkommt (Entscheidung 14.10.2026; das ETB nennt „von
 * «…»“). Liefert den Funkrufnamen, sonst `null`.
 */
export function verlaesstFahrzeug(
  p: VorschauPersonal,
  v: VorlageVorschau,
  wahl: Wahl,
): string | null {
  if (p.zustand !== 'frei' || p.ef_id == null || !p.fahrzeug_name) return null;
  if (!wahl.personal.get(p.personal_id)?.an) return null;
  return ohneFahrzeug(p, v, wahl) ? p.fahrzeug_name : null;
}

/** Gewählte Zeilen der Vorschau je Art; ein gesperrtes Modul zählt nichts. */
export function gewaehlteZeilen(v: VorlageVorschau, wahl: Wahl) {
  return {
    fahrzeuge: v.fahrzeuge_gesperrt
      ? []
      : alleFahrzeuge(v).filter((f) => wahl.fahrzeuge.get(f.fahrzeug_id)?.an),
    personal: v.personal_gesperrt
      ? []
      : allePersonen(v).filter((p) => wahl.personal.get(p.personal_id)?.an),
  };
}

const zahlWort = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;

/**
 * „1 Zug, 1 Staffel, 3 Fahrzeuge, 6 Kräfte“: Einheiten je Typ in Baumfolge, mehrere eines Typs
 * mit „×“ (den Plural eines Typnamens kennt der Kern nicht); ein gesperrter Teil fehlt.
 */
export function zusammenfassung(v: VorlageVorschau, wahl: Wahl): string {
  const typen = new Map<string, number>();
  for (const k of v.knoten) typen.set(k.typ_label, (typen.get(k.typ_label) ?? 0) + 1);
  const teile = [...typen].map(([typ, n]) => (n === 1 ? `1 ${typ}` : `${n} × ${typ}`));
  const g = gewaehlteZeilen(v, wahl);
  if (!v.fahrzeuge_gesperrt) teile.push(zahlWort(g.fahrzeuge.length, 'Fahrzeug', 'Fahrzeuge'));
  if (!v.personal_gesperrt) teile.push(zahlWort(g.personal.length, 'Kraft', 'Kräfte'));
  return teile.join(', ');
}

/** Deckel je Bildung (D7, `SAMMEL_MAX`): Grund in Worten des Servers, sonst `null`. */
export function deckelGrund(v: VorlageVorschau, wahl: Wahl): string | null {
  const g = gewaehlteZeilen(v, wahl);
  if (g.fahrzeuge.length > SAMMEL_MAX) return `Höchstens ${SAMMEL_MAX} Fahrzeuge je Bildung`;
  if (g.personal.length > SAMMEL_MAX) return `Höchstens ${SAMMEL_MAX} Personen je Bildung`;
  return null;
}

const vergleichsName = (s: string) => s.trim().toLocaleLowerCase('de');

/** Trägt eine aktive Einheit des Einsatzes schon diesen Namen (D15)? Warnt, sperrt nicht. */
export function isNameVergeben(name: string, einheiten: readonly Einheit[]): boolean {
  const n = vergleichsName(name);
  if (n === '') return false;
  return einheiten.some((e) => e.aufgeloest_at == null && vergleichsName(e.name) === n);
}

export interface AnfrageEingabe {
  vorlageId: number;
  name: string;
  abschnittId: number | null | undefined;
  vorschau: VorlageVorschau;
  wahl: Wahl;
}

/** Body des Bildens (D3): gewählte Zeilen der Vorschau in Baumfolge, je mit „umhängen“. */
export function buildAnfrage({
  vorlageId,
  name,
  abschnittId,
  vorschau,
  wahl,
}: AnfrageEingabe): AusVorlageEingabe {
  const g = gewaehlteZeilen(vorschau, wahl);
  return {
    vorlage_id: vorlageId,
    name: name.trim(),
    abschnitt_id: abschnittId ?? null,
    fahrzeuge: g.fahrzeuge.map((f) => ({
      fahrzeug_id: f.fahrzeug_id,
      umhaengen: wahl.fahrzeuge.get(f.fahrzeug_id)?.umhaengen === true,
    })),
    personal: g.personal.map((p) => ({
      personal_id: p.personal_id,
      umhaengen: wahl.personal.get(p.personal_id)?.umhaengen === true,
    })),
  };
}

/** Schlüssel einer Zeile für Gründe und Testkennungen. */
export function zeilenSchluessel(art: ZeilenArt, id: number): string {
  return `${art}-${id}`;
}

/** Gründe je Zeile aus einer Ablehnung (`ApiError.zeilen`, 422), in der Folge der Antwort. */
export function gruendeJeZeile(fehler: unknown): Map<string, string> {
  if (!(fehler instanceof ApiError)) return new Map();
  return new Map(fehler.zeilen.map((z) => [zeilenSchluessel(z.art, z.id), z.grund]));
}
