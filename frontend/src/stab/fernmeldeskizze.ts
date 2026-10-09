import type { AbrufZustand } from '../api/abrufZustand';
import type {
  Betriebsart,
  EinsatzFahrzeug,
  Komponentenart,
  Schriftfeld,
  SkizzenBezug,
  SkizzenLage,
  Sprechgruppe,
  Stabsfunktion,
  Stellenart,
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
  Verkehrsart,
} from '../api/types';
import { kommunikationsmittelLabel } from '../components/kommunikationsmittel';
import {
  baueFuehrungsorganisation,
  type OrgKnoten,
} from '../pages/einsatzabschnitte/fuehrungsorganisation';
import { baueTzProps, type TzProps } from '../pages/lagekarte/taktischesZeichen';
import {
  einheitDetailPfad,
  einsatzabschnittePfad,
  einsatzdatenPfad,
  kommunikationsplanPfad,
} from '../routing/deeplinks';
import { fuehrungsstelleErfasst } from './fuehrungsstelle';
import { ZUSTAND_GRUND } from './funkplan';
import { STELLENART_LABEL } from './kommunikationsplan';
import {
  type Quelle,
  abschnitteOhneSprechgruppe,
  einheitenOhneSprechgruppe,
  kanalbelegung,
  leitstelleOhneVerbindung,
  lokaleSprechgruppenOhneZuordnung,
  schienenMitEinemTeilnehmer,
  verbindungenOhneGemeinsameSprechgruppe,
  type KanalQuellen,
  type KanalTeilnehmer,
  type Luecke,
} from './luecken';
import { SACHGEBIETE } from './sachgebiete';
import { bedingungszeichenText, komponentenartWort, leitungsBeschreibung } from './skizzenZeichen';
import { vergleicheSprechgruppen } from './sprechgruppenOrdnung';
import type { Herkunft } from './sprechgruppenplan';

/**
 * Das Netz der taktischen Fernmeldeskizze nach BBK „Taktische Zeichen im Bevölkerungsschutz“,
 * Anhang J.5: Teilnehmer an gemeinsamen Kanälen statt Kanten je Eltern-Kind-Paar. Die eine
 * Quelle für Bild, Lücken am Element, Druck und Übernahme (`stab/funkplan.ts`).
 *
 * - **Stellen** `fs`, `ab-<id>`, `eh-<id>`, `ks-<id>` (externe Stelle des Kommunikationsplans,
 *   nie eine Führungsfunktion), `ko-<id>` (Komponente), in Fokusfolge: Führungsstelle, Baum der
 *   Führungsorganisation, externe Stellen, Komponenten (D6).
 * - **Schienen** `sg-<id>` aus der Kanalbelegung (`stab/luecken.ts:kanalbelegung`): jede
 *   Sprechgruppe, die eine Stelle oder Komponente trägt, jede einsatzlokale und jede mit
 *   Lagezeile, TMO vor DMO. Je Schiene die Stichleitungen mit Status (D7).
 * - **Verbindungen** `vb-<id>` und **Bereiche** `be-<id>` aus den Skizzendaten (D3).
 * - **Lücken je Element** ausschließlich über `stab/luecken.ts` (D11): das Bild zählt dieselben
 *   Treffer wie das Paneel.
 * - **Ausstattung je Kasten** (LFH-1029): Führungsmittel und Funktionen als kleine Zeichen in
 *   Führungsstelle und Abschnitt, keine Elemente (keine Lage, Stichleitung, Lücke, kein Fokus).
 *   Die der Führungsstelle zugeordneten Fahrzeuge stehen in ihrem Kasten (LFH-1106).
 *
 * Die Führungsorganisation (`baueFuehrungsorganisation`) ist nur noch Vorlage für Auto-Layout und
 * Fokusfolge (`baum`). Verwaiste Bezüge (Verbindung, Lagezeile auf ein fehlendes Element) fallen
 * weg; eine fehlende Quelle wird benannt und ist nie eine leere. Erreichbarkeit und Rufnummern
 * kommen nicht ins Modell, Personennamen auch nicht.
 *
 * Herleitung: `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md` (D2, D7, D8, D11);
 * Ausstattung: Spec `stab-fernmeldeskizze`, „Führungsmittel und Funktionen im Kasten“ (LFH-1029).
 */

/** Wie die eigene Führungsstelle in der Skizze heißt (Spec „Einsatzleitung ohne erfundene
 * Gegenstelle“). */
export const EINSATZLEITUNG = 'Einsatzleitung';

/** Das Recht, das ein Element am Datensatz braucht (D5, D8). */
export type Rechtsquelle = 'einsatzabschnitte' | 'einheiten' | 'verwaltung' | 'stab';

/** Welche Rechte die Person im Einsatz hat; fehlt eines, ist es nicht da. */
export type NetzRechte = Partial<Record<Rechtsquelle, boolean>>;

export type ElementLueckeArt =
  | 'ohne-sprechgruppe'
  | 'keine-gemeinsame'
  | 'lokal-ohne-zuordnung'
  | 'ein-teilnehmer'
  | 'leitstelle';

/** Das Wort am Element; Bedeutung nie nur über Farbe (D12). */
export const LUECKE_TEXT: Record<ElementLueckeArt, string> = {
  'ohne-sprechgruppe': 'keine Sprechgruppe',
  'keine-gemeinsame': 'keine gemeinsame Sprechgruppe',
  'lokal-ohne-zuordnung': 'ohne Zuordnung',
  'ein-teilnehmer': 'nur ein Teilnehmer',
  leitstelle: 'Leitstelle: keine Verbindung erfasst',
};

export interface ElementLuecke {
  art: ElementLueckeArt;
  text: string;
  /** Bei `keine-gemeinsame`: die übergeordnete Stelle, mit der der Kanal fehlt. */
  gegenstelle?: string;
}

/** Wie ein Ausstattungszeichen gezeichnet wird (`stab/skizze/SkizzenElemente.tsx:AusstattungsZeichenBild`). */
export type AusstattungsZeichen =
  /** Führungsfahrzeug: Zeichen aus `baueTzProps`, Einstufung wie auf der Lagekarte. */
  | { art: 'tz'; tz: TzProps }
  /** Funktionsfassung aus BBK Anhang D. */
  | { art: 'rolle'; rolle: 'incident-section-commander' | 'incident-subsection-commander' }
  /** Person der Führung mit Kürzel; der Katalog hat für S1–S6 keine Fassung. */
  | { art: 'kuerzel'; kuerzel: string };

/**
 * Ein kleines Zeichen im Führungsstellen-Kasten (LFH-1029): Funktion oder Führungsmittel. Kein
 * Element; nie ein Personenname.
 */
export interface SkizzenAusstattung {
  art: 'funktion' | 'fuehrungsmittel';
  /** Eindeutig im Kasten: `eal`, `ueal`, `s1`…`s6`, `fz-<id>`. */
  schluessel: string;
  /** Steht unter dem Zeichen; die Bedeutung hängt nie am Zeichen allein. */
  text: string;
  /** Ausgeschrieben, für `<title>`. */
  titel: string;
  zeichen: AusstattungsZeichen;
}

interface NetzStelleBasis {
  /** `fs` | `ab-<id>` | `eh-<id>` | `ks-<id>` | `ko-<id>`. */
  key: string;
  /** Datenbank-ID — nur für Deeplinks und Schreibaufrufe, nie für die Anzeige. */
  id: number | null;
  bezeichnung: string;
  /** Führungsstelle: Rufname · Abschnitt: Kurzbezeichnung · Einheit: Funkrufname. Nie geraten. */
  rufname: string | null;
  /** Wo der Datensatz gepflegt wird; `null`, wenn er nur in der Skizze lebt (Komponente). */
  ziel: string | null;
  /** Das Recht für Zuordnen und Ändern am Datensatz (D8). */
  recht: Rechtsquelle;
  schreibbar: boolean;
  luecken: ElementLuecke[];
}

export type NetzStelle =
  | (NetzStelleBasis & {
      art: 'fuehrungsstelle';
      id: null;
      erfasst: boolean;
      /** Warum keine Gegenstelle dasteht, sonst `null`. */
      hinweis: string | null;
      tz: TzProps;
      kommunikationsmittel: string | null;
      ausstattung: SkizzenAusstattung[];
    })
  | (NetzStelleBasis & {
      art: 'abschnitt';
      id: number;
      tz: TzProps;
      /** Die übergeordnete Stelle im Baum: `fs` oder `ab-<id>`. */
      oben: string | null;
      kommunikationsmittel: string | null;
      ausstattung: SkizzenAusstattung[];
    })
  | (NetzStelleBasis & {
      art: 'einheit';
      id: number;
      tz: TzProps;
      /** Die übergeordnete Stelle im Baum: `fs`, `ab-<id>`, `eh-<id>`; `null` = ohne Abschnitt. */
      oben: string | null;
      kommunikationsmittel: string | null;
    })
  | (NetzStelleBasis & {
      art: 'extern';
      id: number;
      stellenart: Exclude<Stellenart, 'funktion'>;
    })
  | (NetzStelleBasis & {
      art: 'komponente';
      id: number;
      komponentenart: Komponentenart;
    });

export interface NetzSchiene {
  /** `sg-<id>`. */
  key: string;
  id: number;
  betriebsart: Betriebsart;
  bezeichnung: string;
  /** Inhalt des Bedingungszeichens, z. B. „TMO BN_BOS“ (`stab/skizzenZeichen.tsx`). */
  zeichen: string;
  /** Stehen mit dem Hinweis unter dem Bedingungszeichen (D12, LFH-1030). */
  netz: string | null;
  sicherheit: string | null;
  /** Steht unter dem Bedingungszeichen (D12). */
  hinweis: string | null;
  herkunft: Herkunft;
  /** Die Stichleitungen, je auf ein Element aus `stellen`. */
  teilnehmer: KanalTeilnehmer[];
  luecken: ElementLuecke[];
}

export interface NetzVerbindung {
  /** `vb-<id>`. */
  key: string;
  id: number;
  von: string;
  nach: string;
  art: Verbindungsart;
  medium: Verbindungsmedium;
  status: Verbindungsstatus;
  verkehr: Verkehrsart | null;
  hinweis: string | null;
  /** Art, Medium und Status in Worten, z. B. „Daten, leitergebunden, geplant“. */
  beschreibung: string;
}

export interface NetzBereich {
  /** `be-<id>`. */
  key: string;
  id: number;
  bezeichnung: string;
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  version: number;
}

/** Der Baum der Führungsorganisation als Schlüssel: Vorlage für Auto-Layout und Fokusfolge. */
export interface NetzBaumKnoten {
  /** `ab-<id>`, `eh-<id>` oder `sammel` (Einheiten ohne Abschnitt, kein Element). */
  key: string;
  kinder: NetzBaumKnoten[];
}

type NetzQuelle =
  | 'abschnitte'
  | 'einheiten'
  | 'fahrzeuge'
  | 'besetzung'
  | 'fuehrungsstelle'
  | 'sprechgruppen'
  | 'stellen'
  | 'skizze';

export const NETZ_QUELLEN_NAME: Record<NetzQuelle, string> = {
  abschnitte: 'Abschnitte',
  einheiten: 'Einheiten',
  fahrzeuge: 'Fahrzeuge',
  besetzung: 'Stab-Besetzung',
  fuehrungsstelle: 'Führungsstelle',
  sprechgruppen: 'Sprechgruppen',
  stellen: 'Externe Stellen',
  skizze: 'Daten der Skizze',
};

export interface FehlendeNetzQuelle {
  quelle: NetzQuelle;
  name: string;
  zustand: Exclude<AbrufZustand, 'daten'>;
}

export interface NetzLuecken {
  schienenMitEinemTeilnehmer: Luecke<Sprechgruppe>;
  /** `element`: die Leitstelle, an der die Lücke steht; `null`, wenn es keine gibt. */
  leitstelle: { zustand: AbrufZustand; fehlt: boolean; element: string | null };
}

export interface Fernmeldenetz {
  einsatzId: number;
  /** Ohne Abschnitte keine Fläche, nur der Grund (Spec „Fehlende Quellen werden benannt“). */
  darstellbar: boolean;
  /** Die Rechte, aus denen `schreibbar` folgt; die Fläche braucht `stab` für Skizzeneigenes (D8). */
  rechte: NetzRechte;
  /**
   * Alle geladenen Sprechgruppen des Einsatzes (Katalog und einsatzlokal), TMO vor DMO: die
   * Einträge der Palette, auch ohne Schiene (Spec „Schiene aus der Palette“).
   */
  sprechgruppen: Sprechgruppe[];
  stellen: NetzStelle[];
  schienen: NetzSchiene[];
  verbindungen: NetzVerbindung[];
  bereiche: NetzBereich[];
  baum: NetzBaumKnoten[];
  /** Gespeicherte Lagen, nur für vorhandene Stellen und Schienen. */
  lage: Map<string, SkizzenLage>;
  /** `null`, solange die Skizzendaten fehlen. */
  schriftfeld: Schriftfeld | null;
  stand: string | null;
  fehlend: FehlendeNetzQuelle[];
  luecken: NetzLuecken;
}

export interface FernmeldenetzQuellen extends KanalQuellen {
  einsatzId: number;
  /** Disponierte Fahrzeuge: die Führungsfahrzeuge stehen im Kasten (LFH-1029). */
  fahrzeuge: Quelle<EinsatzFahrzeug>;
  /** Stab-Besetzung: die besetzten Sachgebiete stehen im Kasten der Einsatzleitung (LFH-1029). */
  besetzung: Quelle<Stabsfunktion>;
  /** Fehlt es, ist die Skizze schreibgeschützt. */
  rechte?: NetzRechte;
}

const BEZUG_PRAEFIX: Record<Exclude<SkizzenBezug['art'], 'fuehrungsstelle'>, string> = {
  abschnitt: 'ab',
  einheit: 'eh',
  stelle: 'ks',
  komponente: 'ko',
};

/** Der Schlüssel eines Skizzen-Bezugs (D3), wie die Elemente ihn tragen. */
export function bezugSchluessel(b: SkizzenBezug): string | null {
  if (b.art === 'fuehrungsstelle') return 'fs';
  return b.id == null ? null : `${BEZUG_PRAEFIX[b.art]}-${b.id}`;
}

const vergleiche = (a: string, b: string) =>
  a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });

/** Führungsmittel im Kasten: nach Wort, dann Funkrufname (D4). */
const vergleicheMittel = (a: SkizzenAusstattung, b: SkizzenAusstattung) =>
  vergleiche(a.text, b.text) || vergleiche(a.titel, b.titel);

/**
 * Ein disponiertes Fahrzeug ist Führungsmittel eines Abschnitts, wenn sein Zeichen die Fachaufgabe
 * Führung trägt: dieselbe Regel wie die Lagekarte (`baueTzProps`), ein manuelles
 * `tz_fachaufgabe` gewinnt. Ein der eigenen Führungsstelle zugeordnetes Fahrzeug ist es ohne diese
 * Bedingung (`nurFuehrung = false`, LFH-1106): die Zuordnung ist selbst die Aussage.
 */
function fuehrungsmittel(f: EinsatzFahrzeug, nurFuehrung = true): SkizzenAusstattung | null {
  const tz = baueTzProps({
    objekttyp: 'fahrzeug',
    fachaufgabe: f.tz_fachaufgabe,
    organisation: f.tz_organisation,
    fahrzeugtyp: f.fahrzeugtyp,
    opta: f.opta,
    traegerorganisation: f.traegerorganisation,
  });
  if (nurFuehrung && tz.fachaufgabe !== 'fuehrung') return null;
  const typ = f.fahrzeugtyp?.trim() || null;
  return {
    art: 'fuehrungsmittel',
    schluessel: `fz-${f.id}`,
    text: typ ?? f.funkrufname,
    titel: typ ? `${typ} · ${f.funkrufname}` : f.funkrufname,
    zeichen: { art: 'tz', tz },
  };
}

/**
 * Die Sachgebiete, die an der Führungsstelle wahrgenommen werden, in S-Folge: bei der
 * Einsatzleitung, durch disponiertes Personal oder extern besetzt (Spec `stab-fernmeldeskizze`,
 * „Führungsmittel und Funktionen im Kasten“). Rückwärtig und eine nicht mehr disponierte Person
 * zählen nicht.
 */
function stabAusstattung(besetzung: readonly Stabsfunktion[]): SkizzenAusstattung[] {
  return SACHGEBIETE.flatMap(({ sachgebiet, kuerzel }) => {
    const zeile = besetzung.find((b) => b.sachgebiet === sachgebiet);
    if (!zeile || zeile.besetzung_art === 'rueckwaertig') return [];
    if (zeile.besetzung_art === 'personal' && !zeile.personal_noch_disponiert) return [];
    return [
      {
        art: 'funktion' as const,
        schluessel: sachgebiet,
        text: kuerzel,
        titel: `Sachgebiet ${kuerzel}`,
        zeichen: { art: 'kuerzel' as const, kuerzel },
      },
    ];
  });
}

function leitungAusstattung(unterabschnitt: boolean): SkizzenAusstattung {
  return unterabschnitt
    ? {
        art: 'funktion',
        schluessel: 'ueal',
        text: 'UEAL',
        titel: 'Untereinsatzabschnittsleitung',
        zeichen: { art: 'rolle', rolle: 'incident-subsection-commander' },
      }
    : {
        art: 'funktion',
        schluessel: 'eal',
        text: 'EAL',
        titel: 'Einsatzabschnittsleitung',
        zeichen: { art: 'rolle', rolle: 'incident-section-commander' },
      };
}

function baumAus(k: OrgKnoten): NetzBaumKnoten {
  return { key: k.key, kinder: k.kinder.map(baumAus) };
}

export function baueFernmeldenetz(q: FernmeldenetzQuellen): Fernmeldenetz {
  const fehlend: FehlendeNetzQuelle[] = (Object.keys(NETZ_QUELLEN_NAME) as NetzQuelle[]).flatMap(
    (quelle) => {
      const { zustand } = q[quelle];
      return zustand === 'daten' ? [] : [{ quelle, name: NETZ_QUELLEN_NAME[quelle], zustand }];
    },
  );
  const skizze = q.skizze.zustand === 'daten' ? q.skizze.daten : null;
  const schreibbar = (recht: Rechtsquelle) => q.rechte?.[recht] === true;

  const verbindungsQuelle = {
    zustand: q.skizze.zustand,
    daten: skizze?.verbindungen ?? [],
  };
  const leitstelleUrteil = leitstelleOhneVerbindung(q.stellen, verbindungsQuelle);
  const sprechgruppen =
    q.sprechgruppen.zustand === 'daten'
      ? [...q.sprechgruppen.daten].sort(vergleicheSprechgruppen)
      : [];
  const rechte: NetzRechte = { ...q.rechte };
  const ohneFlaeche: Fernmeldenetz = {
    einsatzId: q.einsatzId,
    darstellbar: false,
    rechte,
    sprechgruppen,
    stellen: [],
    schienen: [],
    verbindungen: [],
    bereiche: [],
    baum: [],
    lage: new Map(),
    schriftfeld: skizze?.schriftfeld ?? null,
    stand: skizze?.stand ?? null,
    fehlend,
    luecken: {
      schienenMitEinemTeilnehmer: schienenMitEinemTeilnehmer(q),
      leitstelle: { ...leitstelleUrteil, element: null },
    },
  };
  // Ohne Abschnitte zeigte die Fläche Einheiten ohne ihren Abschnitt (Spec): keine Fläche.
  if (q.abschnitte.zustand !== 'daten') return ohneFlaeche;

  const abschnitte = q.abschnitte.daten;
  const einheiten = q.einheiten.zustand === 'daten' ? q.einheiten.daten : null;
  const org = baueFuehrungsorganisation(abschnitte, einheiten);
  const abschnittJeId = new Map(abschnitte.map((a) => [a.id, a]));
  const einheitJeId = new Map((einheiten ?? []).map((e) => [e.id, e]));

  // ── Stellen: Führungsstelle, Baum, externe Stellen, Komponenten ──────────────────────────────
  const stellen: NetzStelle[] = [];
  const fsDaten = q.fuehrungsstelle.zustand === 'daten' ? q.fuehrungsstelle.daten : null;
  const fsErfasst = fuehrungsstelleErfasst(fsDaten);
  // Die Fahrzeuge der Führungsstelle stehen in ihrem Kasten und in keinem Abschnittskasten
  // (LFH-1106); eine ID ohne geladenes Fahrzeug fällt still weg.
  const fahrzeuge = q.fahrzeuge.zustand === 'daten' ? q.fahrzeuge.daten : [];
  const fsFahrzeugIds = new Set(fsDaten?.fahrzeug_ids ?? []);
  const fsMittel = fahrzeuge
    .filter((f) => fsFahrzeugIds.has(f.id))
    .map((f) => fuehrungsmittel(f, false)!)
    .sort(vergleicheMittel);
  stellen.push({
    art: 'fuehrungsstelle',
    key: 'fs',
    id: null,
    bezeichnung: EINSATZLEITUNG,
    rufname: fsErfasst ? (fsDaten?.rufname ?? null) : null,
    ziel: einsatzdatenPfad(q.einsatzId),
    recht: 'verwaltung',
    schreibbar: schreibbar('verwaltung'),
    luecken: [],
    erfasst: fsErfasst,
    hinweis:
      q.fuehrungsstelle.zustand !== 'daten'
        ? `Gegenstelle ${ZUSTAND_GRUND[q.fuehrungsstelle.zustand]}`
        : fsErfasst
          ? null
          : 'Gegenstelle nicht erfasst',
    tz: baueTzProps({ objekttyp: 'abschnitt' }),
    kommunikationsmittel: fsErfasst
      ? kommunikationsmittelLabel(fsDaten?.kommunikationsmittel)
      : null,
    // Die Besetzung ist eine eigene Angabe: sie steht auch ohne erfasste Gegenstelle.
    ausstattung: [
      ...(q.besetzung.zustand === 'daten' ? stabAusstattung(q.besetzung.daten) : []),
      ...fsMittel,
    ],
  });

  // Führungsmittel je Kasten: das Fahrzeug steht beim nächsten Abschnitt über seiner Einheit.
  const fahrzeugeJeEinheit = new Map<number, SkizzenAusstattung[]>();
  for (const f of fahrzeuge) {
    const mittel = f.einheit_id != null && !fsFahrzeugIds.has(f.id) ? fuehrungsmittel(f) : null;
    if (!mittel) continue;
    fahrzeugeJeEinheit.set(f.einheit_id!, [
      ...(fahrzeugeJeEinheit.get(f.einheit_id!) ?? []),
      mittel,
    ]);
  }
  const mittelJeAbschnitt = new Map<string, SkizzenAusstattung[]>();

  const besuche = (k: OrgKnoten, oben: string | null, abschnittOben: string | null) => {
    if (k.art === 'sammel') {
      for (const c of k.kinder) besuche(c, null, null);
      return;
    }
    if (k.art === 'abschnitt') {
      const a = abschnittJeId.get(k.id)!;
      const ausstattung: SkizzenAusstattung[] =
        a.leiter_id != null ? [leitungAusstattung(abschnittOben != null)] : [];
      mittelJeAbschnitt.set(k.key, ausstattung);
      stellen.push({
        art: 'abschnitt',
        key: k.key,
        id: k.id,
        bezeichnung: k.name,
        rufname: k.rufname,
        ziel: einsatzabschnittePfad(q.einsatzId, { abschnitt: k.id }),
        recht: 'einsatzabschnitte',
        schreibbar: schreibbar('einsatzabschnitte'),
        luecken: [],
        tz: k.tz,
        oben,
        kommunikationsmittel: kommunikationsmittelLabel(a.kommunikationsmittel),
        ausstattung,
      });
    } else {
      const e = einheitJeId.get(k.id)!;
      if (abschnittOben)
        mittelJeAbschnitt.get(abschnittOben)!.push(...(fahrzeugeJeEinheit.get(e.id) ?? []));
      stellen.push({
        art: 'einheit',
        key: k.key,
        id: k.id,
        bezeichnung: k.name,
        rufname: k.rufname,
        ziel: einheitDetailPfad(q.einsatzId, k.id),
        recht: 'einheiten',
        schreibbar: schreibbar('einheiten'),
        luecken: [],
        tz: k.tz,
        oben,
        kommunikationsmittel: kommunikationsmittelLabel(e.kommunikationsmittel),
      });
    }
    for (const c of k.kinder) besuche(c, k.key, k.art === 'abschnitt' ? k.key : abschnittOben);
  };
  for (const w of org.wurzeln) besuche(w, 'fs', null);
  // Funktionen vor Führungsmitteln; Führungsmittel nach Wort, dann Funkrufname (D4).
  for (const liste of mittelJeAbschnitt.values()) {
    const funktionen = liste.filter((x) => x.art === 'funktion');
    const mittel = liste.filter((x) => x.art === 'fuehrungsmittel').sort(vergleicheMittel);
    liste.splice(0, liste.length, ...funktionen, ...mittel);
  }

  for (const st of q.stellen.zustand === 'daten' ? q.stellen.daten : []) {
    if (st.stellenart === 'funktion') continue;
    stellen.push({
      art: 'extern',
      key: `ks-${st.id}`,
      id: st.id,
      bezeichnung: st.bezeichnung?.trim() || STELLENART_LABEL[st.stellenart],
      rufname: null,
      ziel: kommunikationsplanPfad(q.einsatzId),
      recht: 'stab',
      schreibbar: schreibbar('stab'),
      luecken: [],
      stellenart: st.stellenart,
    });
  }
  for (const ko of skizze?.komponenten ?? []) {
    stellen.push({
      art: 'komponente',
      key: `ko-${ko.id}`,
      id: ko.id,
      bezeichnung: ko.bezeichnung?.trim() || komponentenartWort(ko.art),
      rufname: null,
      ziel: null,
      recht: 'stab',
      schreibbar: schreibbar('stab'),
      luecken: [],
      komponentenart: ko.art,
    });
  }
  const stelleJeKey = new Map(stellen.map((s) => [s.key, s]));

  // ── Schienen aus der einen Kanalbelegung ─────────────────────────────────────────────────────
  const schienen: NetzSchiene[] = [...kanalbelegung(q).values()]
    .sort((a, b) => vergleicheSprechgruppen(a.sprechgruppe, b.sprechgruppe))
    .map(({ sprechgruppe: s, teilnehmer }) => ({
      key: `sg-${s.id}`,
      id: s.id,
      betriebsart: s.betriebsart,
      bezeichnung: s.bezeichnung,
      zeichen: bedingungszeichenText(s.betriebsart, s.bezeichnung),
      netz: s.netz?.trim() ? s.netz : null,
      sicherheit: s.sicherheit?.trim() ? s.sicherheit : null,
      hinweis: s.hinweis?.trim() ? s.hinweis : null,
      herkunft: s.einsatz_lokal ? 'einsatzlokal' : 'katalog',
      teilnehmer: teilnehmer.filter((t) => stelleJeKey.has(t.element)),
      luecken: [],
    }));
  const schieneJeKey = new Map(schienen.map((s) => [s.key, s]));

  // ── Lücken je Element, nur über `stab/luecken.ts` (D11) ──────────────────────────────────────
  const haenge = (key: string, art: ElementLueckeArt, gegenstelle?: string) => {
    const element = stelleJeKey.get(key) ?? schieneJeKey.get(key);
    if (!element) return;
    element.luecken.push(
      gegenstelle ? { art, text: LUECKE_TEXT[art], gegenstelle } : { art, text: LUECKE_TEXT[art] },
    );
  };
  for (const a of abschnitteOhneSprechgruppe(q.abschnitte).treffer) {
    haenge(`ab-${a.id}`, 'ohne-sprechgruppe');
  }
  for (const e of einheitenOhneSprechgruppe(q.einheiten).treffer) {
    haenge(`eh-${e.id}`, 'ohne-sprechgruppe');
  }
  for (const v of verbindungenOhneGemeinsameSprechgruppe(
    q.abschnitte,
    q.einheiten,
    q.fuehrungsstelle,
  ).treffer) {
    const unten = `${v.unten.art === 'abschnitt' ? 'ab' : 'eh'}-${v.unten.id}`;
    const oben =
      v.oben.art === 'fuehrungsstelle'
        ? 'fs'
        : `${v.oben.art === 'abschnitt' ? 'ab' : 'eh'}-${v.oben.id}`;
    haenge(unten, 'keine-gemeinsame', oben);
  }
  for (const s of lokaleSprechgruppenOhneZuordnung(
    q.sprechgruppen,
    q.abschnitte,
    q.einheiten,
    q.fuehrungsstelle,
    { stellen: q.stellen, skizze: q.skizze },
  ).treffer) {
    haenge(`sg-${s.id}`, 'lokal-ohne-zuordnung');
  }
  const einTeilnehmer = schienenMitEinemTeilnehmer(q);
  for (const s of einTeilnehmer.treffer) haenge(`sg-${s.id}`, 'ein-teilnehmer');
  // Eine Lücke, nicht eine je Leitstelle: das Paneel nennt sie einmal.
  const ersteLeitstelle =
    stellen.find((s) => s.art === 'extern' && s.stellenart === 'leitstelle')?.key ?? null;
  const leitstelleElement = leitstelleUrteil.fehlt ? ersteLeitstelle : null;
  if (leitstelleElement) haenge(leitstelleElement, 'leitstelle');

  // ── Skizzendaten: verwaiste Bezüge fallen weg (D3) ───────────────────────────────────────────
  const verbindungen: NetzVerbindung[] = (skizze?.verbindungen ?? []).flatMap((v) => {
    const von = bezugSchluessel(v.von);
    const nach = bezugSchluessel(v.nach);
    if (!von || !nach || von === nach || !stelleJeKey.has(von) || !stelleJeKey.has(nach)) return [];
    return [
      {
        key: `vb-${v.id}`,
        id: v.id,
        von,
        nach,
        art: v.art,
        medium: v.medium,
        status: v.status,
        verkehr: v.verkehr,
        hinweis: v.hinweis?.trim() ? v.hinweis : null,
        beschreibung: leitungsBeschreibung({ art: v.art, medium: v.medium, status: v.status }),
      },
    ];
  });
  const bereiche: NetzBereich[] = (skizze?.bereiche ?? []).map((b) => ({
    key: `be-${b.id}`,
    ...b,
  }));
  const lage = new Map(
    (skizze?.lage ?? [])
      .filter((l) => stelleJeKey.has(l.element) || schieneJeKey.has(l.element))
      .map((l) => [l.element, l] as const),
  );

  return {
    einsatzId: q.einsatzId,
    darstellbar: true,
    rechte,
    sprechgruppen,
    stellen,
    schienen,
    verbindungen,
    bereiche,
    baum: org.wurzeln.map(baumAus),
    lage,
    schriftfeld: skizze?.schriftfeld ?? null,
    stand: skizze?.stand ?? null,
    fehlend,
    luecken: {
      schienenMitEinemTeilnehmer: einTeilnehmer,
      leitstelle: { ...leitstelleUrteil, element: leitstelleElement },
    },
  };
}

/**
 * Alle Lücken am Bild, flach: je Element seine Lücken, dazu die Lücke „Leitstelle“ am Netz, wenn
 * keine Leitstelle dasteht (`element: null`). Zählung und Filter „nur Lücken“ lesen hier.
 */
export function lueckenAmBild(
  netz: Fernmeldenetz,
): { element: string | null; luecke: ElementLuecke }[] {
  const amElement = [...netz.stellen, ...netz.schienen].flatMap((x) =>
    x.luecken.map((luecke) => ({ element: x.key as string | null, luecke })),
  );
  const { leitstelle } = netz.luecken;
  return leitstelle.fehlt && leitstelle.element == null
    ? [...amElement, { element: null, luecke: { art: 'leitstelle', text: LUECKE_TEXT.leitstelle } }]
    : amElement;
}
