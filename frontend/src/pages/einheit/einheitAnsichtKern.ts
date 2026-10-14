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
import { filterAktive } from '../../kraefte/kraeftebaumKern';
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
   * „Aus Einheit lösen“ und „Einheit auflösen“.
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
  /** Schreiben + Einheiten + Material: „Material zuordnen …“. */
  canZuordnenMaterial: boolean;
  /** Freigabe Personal: der Name einer Person als Link. */
  hasPersonalLink: boolean;
  /** Freigabe Fahrzeuge: der Funkrufname eines Fahrzeugs als Link. */
  hasFahrzeugLink: boolean;
  /**
   * Freigabe Personal UND Fahrzeuge: die Besatzung erscheint (Entscheidung 13.10.2026 Punkt 2,
   * D5). Ohne sie stehen Fahrzeuge und Mitglieder flach, ohne Besatzungswege und FMS-Wahl.
   */
  hasBesatzung: boolean;
  /** Freigabe Material: die Materialliste des Einsatzes wird abgefragt (Ausfall, freie Posten). */
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
    canZuordnenMaterial: einheiten && isOffen('material'),
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

// ── Zuordnen aus Einsatz und Stamm (D7, D8) ───────────────────────────────────

/**
 * Woher eine gewählte Kraft kommt. Einsatz- und Stamm-IDs kollidieren (`einsatz_personal.id`
 * gegen `personal.id`), deshalb trägt jeder Wert seine Quelle: `einsatz:<id>`, `stamm:<id>`.
 */
export type ZuordnenQuelle = 'einsatz' | 'stamm';

export interface ZuordnenWahl {
  quelle: ZuordnenQuelle;
  id: number;
}

export function parseZuordnenWert(wert: string): ZuordnenWahl | null {
  const treffer = /^(einsatz|stamm):(\d+)$/.exec(wert);
  return treffer ? { quelle: treffer[1] as ZuordnenQuelle, id: Number(treffer[2]) } : null;
}

export interface ZuordnenEintrag {
  wert: string;
  label: string;
  /** Text, über den das Feld sucht (Suchtext aus LLH-1100). */
  suchtext: string;
}

/** Eine Gruppe der Auswahl; `demo` sind Demo-Stammdaten, gesammelt hinter allen echten. */
export interface ZuordnenGroup {
  key: 'einsatz' | 'stamm' | 'demo';
  titel: string;
  eintraege: ZuordnenEintrag[];
}

interface ZuordnenEingabe<E, S> {
  /** Die disponierten Kräfte des Einsatzes (auch mit Einheit: sie sind vergeben). */
  einsatz: readonly E[];
  /** Entlassene des Einsatzes: auch sie fehlen im Stamm, der Sammelweg lehnte sie ab. */
  entlassene?: readonly E[];
  /** Stamm im Dienst. */
  stamm: readonly S[];
  canEinsatz: boolean;
  canStamm: boolean;
}

interface ZuordnenArt<E, S> {
  stammId: (e: E) => number | null | undefined;
  einsatzLabel: (e: E) => string;
  einsatzSuchtext: (e: E) => string;
  stammLabel: (s: S) => string;
  stammSuchtext: (s: S) => string;
}

const ohneLeere = (teile: readonly (string | null | undefined)[]) =>
  teile.filter((t): t is string => !!t && t.trim() !== '').join(' ');

function buildZuordnenGroups<
  E extends { id: number; einheit_id?: number | null },
  S extends { id: number; ist_demo: boolean },
>(eingabe: ZuordnenEingabe<E, S>, art: ZuordnenArt<E, S>): ZuordnenGroup[] {
  const gruppen: ZuordnenGroup[] = [];
  if (eingabe.canEinsatz) {
    const frei = filterAktive(eingabe.einsatz).filter((e) => e.einheit_id == null);
    gruppen.push({
      key: 'einsatz',
      titel: 'Im Einsatz frei',
      eintraege: frei.map((e) => ({
        wert: `einsatz:${e.id}`,
        label: art.einsatzLabel(e),
        suchtext: art.einsatzSuchtext(e),
      })),
    });
  }
  if (eingabe.canStamm) {
    // Aktiv disponiert oder entlassen: der Sammelweg lehnte beides ab (LLH-1100).
    const vergeben = new Set(
      [...eingabe.einsatz, ...(eingabe.entlassene ?? [])]
        .map(art.stammId)
        .filter((x): x is number => x != null),
    );
    const { echte, demo } = splitDemo(eingabe.stamm.filter((s) => !vergeben.has(s.id)));
    const eintrag = (s: S): ZuordnenEintrag => ({
      wert: `stamm:${s.id}`,
      label: art.stammLabel(s),
      suchtext: art.stammSuchtext(s),
    });
    gruppen.push({ key: 'stamm', titel: 'Aus dem Stamm', eintraege: echte.map(eintrag) });
    gruppen.push({ key: 'demo', titel: DEMO_GROUP, eintraege: demo.map(eintrag) });
  }
  return gruppen.filter((g) => g.eintraege.length > 0);
}

/** „Person zuordnen …“: freie Kräfte des Einsatzes, Stamm im Dienst, Demo hinten (D7). */
export function buildPersonZuordnenGroups(
  eingabe: ZuordnenEingabe<EinsatzPersonal, Personal>,
): ZuordnenGroup[] {
  return buildZuordnenGroups(eingabe, {
    stammId: (e) => e.personal_id,
    einsatzLabel: personLabel,
    einsatzSuchtext: (e) =>
      ohneLeere([e.name, e.einsatzfunktion, e.funktion, e.traegerorganisation]),
    stammLabel: personalLabel,
    stammSuchtext: personalSuchtext,
  });
}

/** „Fahrzeug zuordnen …“: dieselbe Form (D8). */
export function buildFahrzeugZuordnenGroups(
  eingabe: ZuordnenEingabe<EinsatzFahrzeug, Fahrzeug>,
): ZuordnenGroup[] {
  const label = (f: { funkrufname: string; fahrzeugtyp?: string | null }) =>
    `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}`;
  return buildZuordnenGroups(eingabe, {
    stammId: (e) => e.fahrzeug_id,
    einsatzLabel: label,
    einsatzSuchtext: (e) =>
      ohneLeere([e.funkrufname, e.fahrzeugtyp, e.kennzeichen, e.traegerorganisation]),
    stammLabel: fahrzeugLabel,
    stammSuchtext: fahrzeugSuchtext,
  });
}

/**
 * Der Fehler, den die Auswahl zeigt: lehnt die Sammel-Disposition ab, steht der Grund der einen
 * gewählten Kraft in `ApiError.zeilen` („außer Dienst“), die Meldung selbst ist allgemein. Dann
 * trägt der gezeigte Fehler diesen Grund; sonst bleibt er, wie er ist.
 */
export function fehlerDerKraft(fehler: unknown, art: 'personal' | 'fahrzeug', id: number): unknown {
  const grund = gruendeJeKraft(fehler, art).get(id);
  if (grund == null || !(fehler instanceof ApiError)) return fehler;
  return new ApiError(fehler.status, grund, { vomAnwendungsserver: fehler.vomAnwendungsserver });
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
  const eintraege: MenueEintrag<PersonMenuKey>[] = [];
  if (rechte.canEditEinheit && !person.isFuehrer) {
    eintraege.push({ key: 'fuehrer', label: 'Als Einheitsführer' });
  }
  if (rechte.canEditBesatzung) {
    for (const f of fahrzeuge) {
      if (f.id !== person.fahrzeugId) {
        eintraege.push({ key: `auf:${f.id}`, label: `Auf ${f.funkrufname}` });
      }
    }
    if (person.fahrzeugId != null) {
      eintraege.push({ key: 'vom-fahrzeug', label: 'Vom Fahrzeug lösen', gefahr: true });
    }
  }
  if (rechte.canEditEinheit) {
    eintraege.push({ key: 'aus-einheit', label: 'Aus Einheit lösen', gefahr: true });
  }
  return eintraege;
}
