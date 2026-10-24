import { ApiError } from '../../api/client';
import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Fahrzeug,
  ModulFreigaben,
  Personal,
} from '../../api/types';
import type { MenueEintrag } from '../../components/MenueAusloeser';
import {
  MODUL_FAHRZEUGE_GESPERRT,
  MODUL_PERSONAL_GESPERRT,
  MODULE_PERSONAL_FAHRZEUGE_GESPERRT,
} from '../../components/nurAnsicht';
import { istSprungGesperrt } from '../../einsatz/modulRegistry';
import { personLabel } from '../../kraefte/einsatzfunktionKern';
import {
  filterAktive,
  mittelDerEinheit,
  type MittelDerEinheit,
} from '../../kraefte/kraeftebaumKern';
import {
  fahrzeugLabel,
  fahrzeugSuchtext,
  gruendeJeKraft,
  personalLabel,
  personalSuchtext,
} from '../../kraefte/sammelDisposition';
import { DEMO_GROUP, splitDemo } from '../../stammdaten/demoAuswahl';

/**
 * Reiner Kern der Einheit-Ansicht (LLH-1036, design.md D6 und D15): was die Bauteile unter
 * `pages/einheit/` ableiten, ohne React. Das Suffix `Kern` ist Pflicht (`frontend/AGENTS.md`,
 * „Direkteinstieg“).
 */

/**
 * Die Einheit selbst und alle ihre Nachfahren: wer darunter hängt, kann nicht ihre Über-Einheit
 * werden, sonst entstünde ein Kreis. Ein Kreis im Bestand bricht die Suche nicht.
 */
export function collectNachfahren(einheiten: readonly Einheit[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const e of einheiten) {
    if (e.ueber_einheit_id != null) {
      if (!kinder.has(e.ueber_einheit_id)) kinder.set(e.ueber_einheit_id, []);
      kinder.get(e.ueber_einheit_id)!.push(e.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

/**
 * Was die Person in der Einheit-Ansicht bedienen darf, je Zielmodul (design.md D6, Entscheidung
 * 13.10.2026 Punkt 2). Ein Bauteil liest nur diese Tabelle, nie selbst die Freigaben: so steht
 * kein Bedienelement da, dessen Modul die Person nicht schreiben darf. Der Server prüft jeden Weg
 * selbst; die Tabelle vermeidet nur, was sicher scheitert.
 */
export interface EinheitRechte {
  /**
   * Schreiben + Einheiten: die Zeilen des Kopfs, Funk, Zeichen, Handstatus, „Als Einheitsführer“,
   * „Aus Einheit lösen“ (Personen, Fahrzeuge) und „Einheit auflösen“.
   */
  canEditEinheit: boolean;
  /** Schreiben + Einheiten + Personal: „Im Einsatz frei“ in „Person zuordnen …“. */
  canZuordnenPersonalEinsatz: boolean;
  /** Schreiben + Einheiten + Personal: „Aus dem Stamm“ in „Person zuordnen …“. */
  canZuordnenPersonalStamm: boolean;
  /** Schreiben + Einheiten + Fahrzeuge: „Im Einsatz frei“ in „Fahrzeug zuordnen …“. */
  canZuordnenFahrzeugEinsatz: boolean;
  /** Schreiben + Einheiten + Fahrzeuge: „Aus dem Stamm“ in „Fahrzeug zuordnen …“. */
  canZuordnenFahrzeugStamm: boolean;
  /** Schreiben + Fahrzeuge: „Auf <Funkrufname>“, „Vom Fahrzeug lösen“, FMS-Status. */
  canEditBesatzung: boolean;
  /**
   * Schreiben: „Material zuordnen …“ steht, ohne Freigabe Material gesperrt mit Grund. Bedient
   * („Material zuordnen …“, „Aus Einheit lösen“, „Ausgeben“) wird nur zusammen mit
   * `hasMaterialListe`, das prüft der Baustein `MaterialAmOrt` (LLH-1225 D9: der Ort gehört dem
   * Material, das Einheitenrecht zählt dafür nicht).
   */
  showMaterialAuswahl: boolean;
  /** Freigabe Personal: der Name einer Person als Link. */
  hasPersonalLink: boolean;
  /** Freigabe Fahrzeuge: der Funkrufname eines Fahrzeugs als Link. */
  hasFahrzeugLink: boolean;
  /**
   * Freigabe Personal UND Fahrzeuge: die Besatzung erscheint (Entscheidung 13.10.2026 Punkt 2,
   * D5). Ohne sie stehen Fahrzeuge und Mitglieder flach, ohne Besatzungswege und FMS-Wahl.
   */
  hasBesatzung: boolean;
  /** Freigabe Material: die Materialliste des Einsatzes wird abgefragt (Angebot der Auswahl). */
  hasMaterialListe: boolean;
}

/**
 * Leitet die Tabelle aus dem Schreibrecht im Einsatz (`darfImEinsatzSchreiben`) und den
 * Modulfreigaben ab. Die Freigabe heißt im Client `zugriff` (Spec `modul-freigabe`) und kennt kein
 * eigenes Leserecht: „Lesen Personal“ und „Schreiben Personal“ fallen hier in dieselbe Freigabe,
 * das Schreiben selbst trägt `darfSchreiben`. Unbekannt heißt offen, wie `istSprungGesperrt`.
 */
export function buildEinheitRechte(
  darfSchreiben: boolean,
  freigaben: ModulFreigaben | undefined,
): EinheitRechte {
  const isOffen = (key: string) => !istSprungGesperrt(key, freigaben);
  const einheiten = darfSchreiben && isOffen('einheiten');
  const personal = isOffen('personal');
  const fahrzeuge = isOffen('fahrzeuge');
  return {
    canEditEinheit: einheiten,
    canZuordnenPersonalEinsatz: einheiten && personal,
    canZuordnenPersonalStamm: einheiten && personal,
    canZuordnenFahrzeugEinsatz: einheiten && fahrzeuge,
    canZuordnenFahrzeugStamm: einheiten && fahrzeuge,
    canEditBesatzung: darfSchreiben && fahrzeuge,
    showMaterialAuswahl: darfSchreiben,
    hasPersonalLink: personal,
    hasFahrzeugLink: fahrzeuge,
    hasBesatzung: personal && fahrzeuge,
    hasMaterialListe: isOffen('material'),
  };
}

/** Die gesperrten Module, ohne die die Besatzung fehlt (D5); `null`, wenn sie erscheint. */
export function besatzungGrund(rechte: EinheitRechte): string | null {
  if (rechte.hasBesatzung) return null;
  if (!rechte.hasPersonalLink && !rechte.hasFahrzeugLink) return MODULE_PERSONAL_FAHRZEUGE_GESPERRT;
  return rechte.hasPersonalLink ? MODUL_FAHRZEUGE_GESPERRT : MODUL_PERSONAL_GESPERRT;
}

/**
 * Die Besatzung, wie das Paneel „Fahrzeuge und Besatzung“ sie zeigt: die Rechnung des Meldebilds
 * (`mittelDerEinheit`), nur mit Freigabe Personal und Fahrzeuge und erst, wenn beide Listen da
 * sind. `null`: Fahrzeuge und Mitglieder stehen flach aus dem Einheit-DTO (D5).
 */
export function buildBesatzungMittel(
  einheit: Einheit,
  einheiten: readonly Einheit[],
  personal: readonly EinsatzPersonal[] | undefined,
  fahrzeuge: readonly EinsatzFahrzeug[] | undefined,
  rechte: EinheitRechte,
): MittelDerEinheit | null {
  return rechte.hasBesatzung && personal && fahrzeuge
    ? mittelDerEinheit(einheit.id, { personal, fahrzeuge, material: [], einheiten })
    : null;
}

/** Die Zeilen des Paneels „Fahrzeuge und Besatzung“ mit ihrer Kennung (Name, Funkrufname). */
export interface VisibleBesatzungRows {
  /** `ep_id` → Name. */
  personen: ReadonlyMap<number, string>;
  /** `ef_id` → Funkrufname. */
  fahrzeuge: ReadonlyMap<number, string>;
}

/**
 * Welche Personen- und Fahrzeugzeilen das Paneel gerade zeigt (LLH-1269): ein Grund, dessen Zeile
 * nicht darunter ist, gehört in den Seitenhinweis (`frontend/AGENTS.md`, „Rückwege und Fehler“).
 * Dieselbe Fallunterscheidung wie das Paneel: ohne Mitglieder im DTO keine Zeile, mit `mittel` die
 * Besatzung, sonst flach.
 */
export function visibleBesatzungRows(
  einheit: Einheit,
  mittel: MittelDerEinheit | null,
): VisibleBesatzungRows {
  if (einheit.fahrzeug_mitglieder.length === 0 && einheit.personal_mitglieder.length === 0) {
    return { personen: new Map(), fahrzeuge: new Map() };
  }
  if (mittel == null) {
    return {
      personen: new Map(einheit.personal_mitglieder.map((m) => [m.ep_id, m.name])),
      fahrzeuge: new Map(einheit.fahrzeug_mitglieder.map((m) => [m.ef_id, m.funkrufname])),
    };
  }
  return {
    personen: new Map(
      [...mittel.fahrzeuge.flatMap((f) => f.besatzung), ...mittel.ohneFahrzeug].map((x) => [
        x.person.id,
        x.person.name,
      ]),
    ),
    fahrzeuge: new Map(mittel.fahrzeuge.map((f) => [f.fahrzeug.id, f.fahrzeug.funkrufname])),
  };
}

// ── Zuordnen aus Einsatz und Stamm (D7, D8) ───────────────────────────────────

/**
 * Woher eine gewählte Kraft kommt. Einsatz- und Stamm-IDs kollidieren (`einsatz_personal.id`
 * gegen `personal.id`), deshalb trägt jeder Wert seine Quelle: `einsatz:<id>`, `stamm:<id>`.
 */
export type ZuordnenSource = 'einsatz' | 'stamm';

export interface ZuordnenSelection {
  source: ZuordnenSource;
  id: number;
}

export function parseZuordnenWert(value: string): ZuordnenSelection | null {
  const match = /^(einsatz|stamm):(\d+)$/.exec(value);
  return match ? { source: match[1] as ZuordnenSource, id: Number(match[2]) } : null;
}

export interface ZuordnenEntry {
  value: string;
  label: string;
  /** Text, über den das Feld sucht (Suchtext aus LLH-1100). */
  suchtext: string;
}

/** Eine Gruppe der Auswahl; `demo` sind Demo-Stammdaten, gesammelt hinter allen echten. */
export interface ZuordnenGroup {
  key: 'einsatz' | 'stamm' | 'demo';
  title: string;
  entries: ZuordnenEntry[];
}

interface ZuordnenInput<E, S> {
  /** Die disponierten Kräfte des Einsatzes (auch mit Einheit: sie sind vergeben). */
  einsatz: readonly E[];
  /** Entlassene des Einsatzes: auch sie fehlen im Stamm, der Sammelweg lehnte sie ab. */
  entlassene?: readonly E[];
  /** Stamm im Dienst. */
  stamm: readonly S[];
  canEinsatz: boolean;
  canStamm: boolean;
}

interface ZuordnenAccessors<E, S> {
  stammId: (e: E) => number | null | undefined;
  einsatzLabel: (e: E) => string;
  einsatzSuchtext: (e: E) => string;
  stammLabel: (s: S) => string;
  stammSuchtext: (s: S) => string;
}

const joinNonEmpty = (parts: readonly (string | null | undefined)[]) =>
  parts.filter((t): t is string => !!t && t.trim() !== '').join(' ');

function buildZuordnenGroups<
  E extends { id: number; einheit_id?: number | null },
  S extends { id: number; ist_demo: boolean },
>(input: ZuordnenInput<E, S>, art: ZuordnenAccessors<E, S>): ZuordnenGroup[] {
  const groups: ZuordnenGroup[] = [];
  if (input.canEinsatz) {
    const frei = filterAktive(input.einsatz).filter((e) => e.einheit_id == null);
    groups.push({
      key: 'einsatz',
      title: 'Im Einsatz frei',
      entries: frei.map((e) => ({
        value: `einsatz:${e.id}`,
        label: art.einsatzLabel(e),
        suchtext: art.einsatzSuchtext(e),
      })),
    });
  }
  if (input.canStamm) {
    // Aktiv disponiert oder entlassen: der Sammelweg lehnte beides ab (LLH-1100).
    const vergeben = new Set(
      [...input.einsatz, ...(input.entlassene ?? [])]
        .map(art.stammId)
        .filter((x): x is number => x != null),
    );
    const { echte, demo } = splitDemo(input.stamm.filter((s) => !vergeben.has(s.id)));
    const toEntry = (s: S): ZuordnenEntry => ({
      value: `stamm:${s.id}`,
      label: art.stammLabel(s),
      suchtext: art.stammSuchtext(s),
    });
    groups.push({ key: 'stamm', title: 'Aus dem Stamm', entries: echte.map(toEntry) });
    groups.push({ key: 'demo', title: DEMO_GROUP, entries: demo.map(toEntry) });
  }
  return groups.filter((g) => g.entries.length > 0);
}

/** „Person zuordnen …“: freie Kräfte des Einsatzes, Stamm im Dienst, Demo hinten (D7). */
export function buildPersonZuordnenGroups(
  input: ZuordnenInput<EinsatzPersonal, Personal>,
): ZuordnenGroup[] {
  return buildZuordnenGroups(input, {
    stammId: (e) => e.personal_id,
    einsatzLabel: personLabel,
    einsatzSuchtext: (e) =>
      joinNonEmpty([e.name, e.einsatzfunktion, e.funktion, e.traegerorganisation]),
    stammLabel: personalLabel,
    stammSuchtext: personalSuchtext,
  });
}

/** „Fahrzeug zuordnen …“: dieselbe Form (D8). */
export function buildFahrzeugZuordnenGroups(
  input: ZuordnenInput<EinsatzFahrzeug, Fahrzeug>,
): ZuordnenGroup[] {
  const label = (f: { funkrufname: string; fahrzeugtyp?: string | null }) =>
    `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}`;
  return buildZuordnenGroups(input, {
    stammId: (e) => e.fahrzeug_id,
    einsatzLabel: label,
    einsatzSuchtext: (e) =>
      joinNonEmpty([e.funkrufname, e.fahrzeugtyp, e.kennzeichen, e.traegerorganisation]),
    stammLabel: fahrzeugLabel,
    stammSuchtext: fahrzeugSuchtext,
  });
}

/**
 * Der Fehler, den die Auswahl zeigt: lehnt die Sammel-Disposition ab, steht der Grund der einen
 * gewählten Kraft in `ApiError.zeilen` („außer Dienst“), die Meldung selbst ist allgemein. Dann
 * trägt der gezeigte Fehler diesen Grund; sonst bleibt er, wie er ist.
 */
export function toKraftError(error: unknown, art: 'personal' | 'fahrzeug', id: number): unknown {
  const reason = gruendeJeKraft(error, art).get(id);
  if (reason == null || !(error instanceof ApiError)) return error;
  return new ApiError(error.status, reason, { vomAnwendungsserver: error.vomAnwendungsserver });
}

// ── Menü je Person (D9) ───────────────────────────────────────────────────────

/** `auf:<ef_id>` setzt die Person auf ein Fahrzeug der Einheit. */
export type PersonMenuKey = 'fuehrer' | 'vom-fahrzeug' | 'aus-einheit' | `auf:${number}`;

/**
 * Die Einträge des Menüs einer Person in der Folge aus D9: „Als Einheitsführer“ (nicht beim EF),
 * „Auf <Funkrufname>“ je anderem Fahrzeug der Einheit, dann rot „Vom Fahrzeug lösen“ (nur wer auf
 * einem Fahrzeug sitzt) und „Aus Einheit lösen“. Den Trenner setzt `MenueAusloeser` vor die
 * roten. Die Besatzungswege brauchen `canEditBesatzung`, die übrigen `canEditEinheit`; der
 * Aufrufer reicht `canEditBesatzung` nur, wenn die Besatzung zu sehen ist (`hasBesatzung`).
 */
export function buildPersonMenuItems(
  person: { isFuehrer: boolean; fahrzeugId: number | null },
  fahrzeuge: readonly { id: number; funkrufname: string }[],
  rechte: Pick<EinheitRechte, 'canEditEinheit' | 'canEditBesatzung'>,
): MenueEintrag<PersonMenuKey>[] {
  const items: MenueEintrag<PersonMenuKey>[] = [];
  if (rechte.canEditEinheit && !person.isFuehrer) {
    items.push({ key: 'fuehrer', label: 'Als Einheitsführer' });
  }
  if (rechte.canEditBesatzung) {
    for (const f of fahrzeuge) {
      if (f.id !== person.fahrzeugId) {
        items.push({ key: `auf:${f.id}`, label: `Auf ${f.funkrufname}` });
      }
    }
    if (person.fahrzeugId != null) {
      items.push({ key: 'vom-fahrzeug', label: 'Vom Fahrzeug lösen', gefahr: true });
    }
  }
  if (rechte.canEditEinheit) {
    items.push({ key: 'aus-einheit', label: 'Aus Einheit lösen', gefahr: true });
  }
  return items;
}
