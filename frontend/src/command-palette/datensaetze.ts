import {
  auftragLabel,
  kuerze,
  meldungLabel,
  personLabel,
  schadenLabel,
  uhsLabel,
} from '../chat/bezug';
import { istModulFreigegeben, modulRegistry } from '../einsatz/modulRegistry';
import { gefahrengebietName } from '../api/gefahren';
import { kettenKoepfe } from '../lageberichte/ketten';
import {
  auftraegePfad,
  einheitDetailPfad,
  einsatzabschnittePfad,
  etbPfad,
  fahrzeugePfad,
  gefahrenPfad,
  lageberichtDetailPfad,
  meldungenPfad,
  personDetailPfad,
  personalPfad,
  schadenDetailPfad,
  uhsDetailPfad,
} from '../routing/deeplinks';
import { textStufe, UNBEWERTET, type Treffer } from './fuzzy';
import {
  DATENSATZ_MINDESTZEICHEN,
  PALETTE_MODI,
  QUELLE_MODUL,
  sprungZu,
  type Befehl,
  type DatensatzQuelle,
  type Oeffnung,
  type PaletteModus,
  type VorschauZiel,
} from './typen';
import type {
  Auftrag,
  BenutzerAnzeige,
  Einheit,
  Einsatzabschnitt,
  EinsatzFahrzeug,
  EtbAnzahl,
  Gefahrengebiet,
  LageberichtAnzeige,
  EinsatzPersonal,
  EtbEintragAnzeige,
  Meldung,
  ModulOverrides,
  Person,
  Schaden,
  Uhs,
} from '../api/types';

/**
 * Der REINE Trefferkern des Datensatz-Finders: Eingabe sind fertig geladene Listen, ein
 * Suchbegriff und die `einsatzId`, kein Hook, kein `fetch`. Die Beschaffung liegt in
 * `useDatensaetze.ts`.
 *
 * Kein Pfad und keine API-Adresse entstehen hier von Hand: jedes Ziel kommt aus
 * `routing/deeplinks.ts`, jeder Abruf über `api/*.ts`. `routing/inlinePfade.guard.test.ts` liest
 * ROHTEXT und trifft auch Kommentare; Adressen stehen hier deshalb mit `<id>` statt
 * Interpolationsklammer.
 */

/** Sortenbuchstabe einer gedruckten Kennung: R-042 ist eine Person, S-042 ein Schaden. */
export type Nummernsorte = 'person' | 'schaden';

export interface DatensatzQuellen {
  personen?: Person[];
  schaeden?: Schaden[];
  uhs?: Uhs[];
  meldungen?: Meldung[];
  auftraege?: Auftrag[];
  fahrzeuge?: EinsatzFahrzeug[];
  personal?: EinsatzPersonal[];
  einheiten?: Einheit[];
  /**
   * Antwort des ETB-CURSORS (`before_lfd_nr = n + 1, limit = 1`), nur für den Zahlenzweig und
   * dort gegen die gesuchte Nummer GEPRÜFT: bei einer Nummernlücke liefert der Cursor den
   * nächstälteren Eintrag, ohne Gleichheitsvergleich böte die Palette still den falschen an.
   */
  etbNummer?: EtbEintragAnzeige[];
  /**
   * SERVERSEITIG per `q` bestätigte ETB-Volltexttreffer, ohne zweiten lokalen Filter:
   * `fts_query` sucht über inhalt/von/an/veranlassung, die Fundstelle steht oft NICHT im Label.
   */
  etbText?: EtbEintragAnzeige[];
  /**
   * Trefferzahl des ETB-Volltexts OHNE Seitendeckel (`GET …/etb/anzahl`). Trägt den Sammeltreffer
   * „Alle Einträge zu …“; die Einzeltreffer sind auf fünf gedeckelt, die Zahl nicht.
   */
  etbAnzahl?: EtbAnzahl;
  /** Lageberichte (im Kern auf die Kettenköpfe reduziert), Gefahrengebiete, Abschnitte. */
  lageberichte?: LageberichtAnzeige[];
  gefahrengebiete?: Gefahrengebiet[];
  abschnitte?: Einsatzabschnitt[];
}

export interface DatensatzKontext {
  einsatzId: number;
  /** Der Rest hinter einem eventuellen Präfix, nicht die rohe Eingabe. */
  suche: string;
  /**
   * Der Präfixmodus, der die Quellenmenge einschränkt. PFLICHTFELD: ein vergessener Modus liefe
   * still in die volle Menge.
   */
  modus: PaletteModus;
  benutzer: BenutzerAnzeige | null;
  overrides?: ModulOverrides;
  /**
   * Modulschlüssel der Seite, auf der die Palette geöffnet wurde (`modulAusPfad`), `null` außerhalb
   * eines Moduls. Wer im Kräfte-Modul einen Funkrufnamen tippt, meint eher das Fahrzeug als die
   * gleichnamige Person; wie weit der Vorteil reicht, steht in {@link baueDatensatzTreffer}.
   * PFLICHTFELD wie `modus`: ein vergessener Kontext sähe aus wie „in keinem Modul“.
   */
  aktuellerModulKey: string | null;
  /** `oeffnung` fehlt = im aktuellen Tab. */
  navigate: (pfad: string, oeffnung?: Oeffnung) => void;
  quellen: DatensatzQuellen;
}

/**
 * Höchstens so viele TEXT-Treffer je Quelle … Beide Deckel greifen NACH dem Ordnen: die Stufe
 * entscheidet, wer hineinkommt, nicht die Lieferreihenfolge des Servers.
 */
const DECKEL_JE_QUELLE = 5;
/** … und so viele Datensatz-Treffer insgesamt. Nummerntreffer zählen mit, fallen aber nie weg. */
const DECKEL_GESAMT = 15;

/**
 * Liest eine gedruckte Kennung als Zahl, für einen EXAKTEN Zahlenvergleich: Fuse über eine Zahl
 * träfe bei '42' auch R-142 und R-420; bei einer Registriernummer wäre das ein falscher Patient.
 *
 * Führende Nullen fallen weg (`R-042` ist nur die Anzeige der Zahl). Der Sortenbuchstabe BINDET
 * ('R-42' findet die Person 42, nicht den Schaden 42); '#' und die blanke Zahl binden nicht.
 */
export function zahlAusSuche(suche: string): { nummer: number; sorte: Nummernsorte | null } | null {
  const treffer = /^(?:([rs#])[-\s]?)?(\d+)$/i.exec(suche.trim());
  if (!treffer) return null;
  const zeichen = treffer[1]?.toLowerCase();
  return {
    nummer: Number(treffer[2]),
    sorte: zeichen === 'r' ? 'person' : zeichen === 's' ? 'schaden' : null,
  };
}

/** Eine auf ihre suchbaren Merkmale reduzierte Zeile, eine Form für alle Entitäten. */
interface Kandidat {
  modulKey: string;
  id: number;
  /** Nummernfeld, `null` wenn die Entität keines hat oder es nicht gesetzt ist. */
  nummer: number | null;
  basisLabel: string;
  ziel: string;
  /** Lese-Vorschau (Taste →); fehlt bei einer Quelle ohne Vorschau. */
  vorschau?: VorschauZiel;
}

type Zweig = 'zahl' | 'text' | 'beide';

interface Quelle {
  /** Abfrageweg — trägt zugleich die Modus-Zuordnung (`PALETTE_MODI[…].quellen`). */
  quelle: DatensatzQuelle;
  modulKey: string;
  zweig: Zweig;
  /** Sortenbuchstabe, der diese Quelle bindet; `null` = nur ohne Buchstabe erreichbar. */
  sorte: Nummernsorte | null;
  /** Der Textzweig filtert diese Quelle NICHT nach — sie kommt bereits gefiltert an. */
  serverGefiltert?: boolean;
  kandidaten: Kandidat[];
}

function baueQuelle<T>(
  quelle: DatensatzQuelle,
  zweig: Zweig,
  liste: T[] | undefined,
  einsatzId: number,
  f: {
    id: (x: T) => number;
    nummer?: (x: T) => number | null | undefined;
    label: (x: T) => string;
    ziel: (einsatzId: number, x: T) => string;
    /**
     * Das Vorschauziel, in DERSELBEN Tabelle wie Beschriftung und Sprungziel, damit die Zuordnung je
     * Quelle an einer Stelle steht und nicht in `befehlFuer`.
     */
    vorschau?: (einsatzId: number, x: T) => VorschauZiel;
  },
  extra: { sorte?: Nummernsorte; serverGefiltert?: boolean } = {},
): Quelle {
  // Der Modulschlüssel kommt aus `QUELLE_MODUL`, derselben Tabelle, an der der Abruf seine Rechte
  // prüft.
  const modulKey: string = QUELLE_MODUL[quelle];
  return {
    quelle,
    modulKey,
    zweig,
    sorte: extra.sorte ?? null,
    serverGefiltert: extra.serverGefiltert,
    kandidaten: (liste ?? []).map((x) => ({
      modulKey,
      id: f.id(x),
      nummer: f.nummer?.(x) ?? null,
      basisLabel: f.label(x),
      ziel: f.ziel(einsatzId, x),
      vorschau: f.vorschau?.(einsatzId, x),
    })),
  };
}

/**
 * Die Module in EINER Tabelle: Rechteschlüssel, Nummernfeld, Beschriftung und Ziel je Zeile
 * beieinander.
 *
 * Die Reihenfolge ist nur Gleichstandsachse (die Ordnung machen Stufe und `ordneTreffer`); sie
 * folgt der Erfassungshäufigkeit wie `SCHNELLAKTIONEN`.
 *
 * Beschriftungen sind wiederverwendet (`personLabel` fällt bei fehlendem Namen auf 'R-042'
 * zurück, `schadenLabel`/`meldungLabel` bringen die Nummer mit). ETB, Fahrzeug, Personal und
 * Einheit entstehen hier und NICHT in `chat/bezug.ts`: das hinge sie an den Chat-Wire-Kontrakt
 * `BezugTyp`.
 */
function quellen(k: DatensatzKontext): Quelle[] {
  const q = k.quellen;
  const e = k.einsatzId;
  return [
    baueQuelle(
      'personen',
      'beide',
      q.personen,
      e,
      {
        id: (p) => p.id,
        nummer: (p) => p.registrier_nr,
        label: personLabel,
        ziel: (id, p) => personDetailPfad(id, p.id),
        vorschau: (einsatzId, p) => ({ art: 'person', einsatzId, id: p.id }),
      },
      { sorte: 'person' },
    ),
    // Zwei ETB-Quellen, zwei Verträge (siehe `DatensatzQuellen`). Der Cursorzweig steht zuerst,
    // damit ein Eintrag, den beide liefern, als NUMMERNtreffer gilt.
    baueQuelle('etbNummer', 'zahl', q.etbNummer, e, {
      id: (x) => x.id,
      nummer: (x) => x.lfd_nr,
      label: etbLabel,
      ziel: (id, x) => etbPfad(id, { eintrag: x.id }),
      vorschau: etbVorschau,
    }),
    baueQuelle(
      'etbText',
      'text',
      q.etbText,
      e,
      {
        id: (x) => x.id,
        label: etbLabel,
        ziel: (id, x) => etbPfad(id, { eintrag: x.id }),
        vorschau: etbVorschau,
      },
      { serverGefiltert: true },
    ),
    baueQuelle(
      'schaeden',
      'beide',
      q.schaeden,
      e,
      {
        id: (s) => s.id,
        nummer: (s) => s.registrier_nr,
        label: schadenLabel,
        ziel: (id, s) => schadenDetailPfad(id, s.id),
        vorschau: (einsatzId, s) => ({ art: 'schaden', einsatzId, id: s.id }),
      },
      { sorte: 'schaden' },
    ),
    baueQuelle('uhs', 'text', q.uhs, e, {
      id: (u) => u.id,
      label: uhsLabel,
      ziel: (id, u) => uhsDetailPfad(id, u.id),
      vorschau: (einsatzId, u) => ({ art: 'uhs', einsatzId, id: u.id }),
    }),
    baueQuelle('meldungen', 'beide', q.meldungen, e, {
      id: (m) => m.id,
      nummer: (m) => m.lfd_nr,
      label: meldungLabel,
      ziel: (id, m) => meldungenPfad(id, { meldung: m.id }),
      vorschau: (einsatzId, m) => ({ art: 'meldung', einsatzId, id: m.id }),
    }),
    baueQuelle('auftraege', 'beide', q.auftraege, e, {
      id: (a) => a.id,
      // `AuftragAnzeige.lfd_nr` ist NULLBAR; ohne diesen Riegel fiele `null` auf `0` oder matchte
      // jede Zahl.
      nummer: (a) => a.lfd_nr ?? null,
      label: auftragZeile,
      ziel: (id, a) => auftraegePfad(id, { auftrag: a.id }),
      vorschau: (einsatzId, a) => ({ art: 'auftrag', einsatzId, id: a.id }),
    }),
    baueQuelle('fahrzeuge', 'text', q.fahrzeuge, e, {
      id: (f) => f.id,
      // Der Funkrufname trägt NUR das Fahrzeug — Personal und Einheit haben `name`.
      label: (f) => f.funkrufname,
      ziel: (id, f) => fahrzeugePfad(id, { fahrzeug: f.id }),
      vorschau: (einsatzId, f) => ({ art: 'fahrzeug', einsatzId, id: f.id }),
    }),
    baueQuelle('personal', 'text', q.personal, e, {
      id: (p) => p.id,
      label: (p) => p.name,
      ziel: (id, p) => personalPfad(id, { personal: p.id }),
      vorschau: (einsatzId, p) => ({ art: 'personal', einsatzId, id: p.id }),
    }),
    baueQuelle('einheiten', 'text', q.einheiten, e, {
      id: (x) => x.id,
      label: (x) => x.name,
      ziel: (id, x) => einheitDetailPfad(id, x.id),
      vorschau: (einsatzId, x) => ({ art: 'einheit', einsatzId, id: x.id }),
    }),
    // Hinten, weil nach Führungsunterlagen seltener gesucht wird. Von einem Lagebericht nur der
    // KETTENKOPF: jede Fortschreibung trägt denselben Titel, eine Zeile spränge auf einen
    // überholten Stand (wie `kettenKoepfe` in der Lageberichte-Liste).
    baueQuelle(
      'lageberichte',
      'text',
      q.lageberichte ? kettenKoepfe(q.lageberichte).map((k) => k.kopf) : undefined,
      e,
      {
        id: (b) => b.id,
        label: (b) => b.titel,
        ziel: (id, b) => lageberichtDetailPfad(id, b.id),
        vorschau: (einsatzId, b) => ({ art: 'lagebericht', einsatzId, id: b.id }),
      },
    ),
    baueQuelle('gefahrengebiete', 'text', q.gefahrengebiete, e, {
      id: (g) => g.id,
      // Derselbe Rückfall wie auf der Gefahrenseite: ein unbenanntes Gebiet heißt „Gefahrengebiet #3“.
      label: (g) => gefahrengebietName(g.label, g.id),
      ziel: (id, g) => gefahrenPfad(id, { gefahrengebiet: g.id }),
      vorschau: (einsatzId, g) => ({ art: 'gefahrengebiet', einsatzId, id: g.id }),
    }),
    baueQuelle('abschnitte', 'text', q.abschnitte, e, {
      id: (a) => a.id,
      label: (a) => a.name,
      ziel: (id, a) => einsatzabschnittePfad(id, { abschnitt: a.id }),
      vorschau: (einsatzId, a) => ({ art: 'abschnitt', einsatzId, id: a.id }),
    }),
  ];
}

/**
 * Vorschauziel eines ETB-Eintrags, mit `lfdNr`, weil kein Fach einen Eintrag über seine `id`
 * adressiert (Nummerncursor, danach `id`-Prüfung). Beide ETB-Quellen teilen es.
 */
function etbVorschau(einsatzId: number, x: EtbEintragAnzeige): VorschauZiel {
  return { art: 'etb', einsatzId, id: x.id, lfdNr: x.lfd_nr };
}

/** ETB-Zeile: laufende Nummer plus gekürzter Inhalt, Form wie `meldungLabel`. */
function etbLabel(x: EtbEintragAnzeige): string {
  return `#${x.lfd_nr} · ${kuerze(x.inhalt)}`;
}

/**
 * Auftragszeile: laufende Nummer plus gekürzter Auftragstext. Ohne Nummer wäre ein Treffer auf
 * die abgetippte 42 nicht nachprüfbar, und gleichlautende Aufträge („Lage melden“) ergäben
 * identische Zeilen. Die Kürzung kommt aus `auftragLabel` (chat/bezug.ts). `lfd_nr` ist NULLBAR,
 * dann bleibt die reine Textzeile.
 */
function auftragZeile(a: Auftrag): string {
  return a.lfd_nr == null ? auftragLabel(a) : `#${a.lfd_nr} · ${auftragLabel(a)}`;
}

/**
 * Bildet die geladenen Listen auf Treffer der Gruppe `datensaetze` ab.
 *
 * ZWEI DURCHGÄNGE: erst der Zahlenzweig, dann der Textzweig; ein Datensatz, den beide finden,
 * steht als Nummerntreffer da.
 *
 * Die Rechteachse ist die LESEACHSE `istModulFreigegeben` je Modul (ein Beobachter behält seine
 * Suche), nicht `darfImEinsatzSchreiben`.
 *
 * `score` ist für alle Treffer {@link UNBEWERTET}: sie liefen nicht durch Fuse, eine 0 behauptete
 * den bestmöglichen Wert (siehe `fuzzy.ts`).
 *
 * DER MODUSFILTER STEHT HIER EIN ZWEITES MAL, obwohl `useDatensaetze` gesperrte Listen gar nicht
 * holt: `enabled: false` schaltet das Nachladen ab, nicht die Auslieferung aus dem Cache. Ohne
 * Riegel stünde nach '@' eine zuvor geladene Schadensliste weiter da.
 */
export function baueDatensatzTreffer(k: DatensatzKontext): Treffer[] {
  const suche = k.suche.trim();
  // Ohne Begriff keine Treffer: die Startansicht ist kuratiert.
  if (!suche) return [];

  const zahl = zahlAusSuche(suche);
  const klein = suche.toLowerCase();
  const erlaubt = PALETTE_MODI[k.modus].quellen;
  const offen = quellen(k).filter((qu) => {
    if (erlaubt !== null && !erlaubt.includes(qu.quelle)) return false;
    const m = modulRegistry.find((x) => x.key === qu.modulKey);
    return m != null && istModulFreigegeben(m, k.benutzer, k.overrides);
  });

  const gesehen = new Set<string>();
  /**
   * Der Heimvorteil des Moduls, in dem der Benutzer steht (0 gewinnt). In BEIDEN
   * Sortierschlüsseln hinter der Stufe und vor der Quellenreihenfolge: davor wäre er ein
   * Modulfilter, dahinter wirkungslos.
   */
  const heim = (kand: Kandidat): 0 | 1 => (kand.modulKey === k.aktuellerModulKey ? 0 : 1);
  /** Nummerntreffer mit ihren Ordnungsachsen — gedeckelt werden sie nie, geordnet schon. */
  const nummerRoh: { treffer: Treffer; heim: 0 | 1; quelle: number; index: number }[] = [];
  /** Alle Texttreffer UNGEDECKELT — gedeckelt wird erst nach dem Ordnen, siehe unten. */
  const roh: {
    treffer: Treffer;
    heim: 0 | 1;
    quelle: number;
    stufe: 0 | 1 | 2 | 3;
    index: number;
  }[] = [];

  const alsTreffer = (kand: Kandidat, stufe: 0 | 1 | 2 | 3): Treffer => {
    gesehen.add(schluessel(kand));
    return { befehl: befehlFuer(kand, k.navigate), score: UNBEWERTET, stufe };
  };

  if (zahl) {
    for (const [qi, qu] of offen.entries()) {
      if (qu.zweig === 'text') continue;
      // Ein Sortenbuchstabe bindet: 'R-42' findet die Person 42, nicht den Schaden 42.
      if (zahl.sorte !== null && zahl.sorte !== qu.sorte) continue;
      for (const kand of qu.kandidaten) {
        if (kand.nummer !== zahl.nummer || gesehen.has(schluessel(kand))) continue;
        // Stufe 0: die Suche IST die Kennung. Aus dem Label ('Personen · R-042 · Müller') ließe sie sich
        // nicht ablesen, ein Fuzzy-Treffer stünde sonst vor dem exakten Nummerntreffer.
        nummerRoh.push({
          treffer: alsTreffer(kand, 0),
          heim: heim(kand),
          quelle: qi,
          index: nummerRoh.length,
        });
      }
    }
  }

  for (const [qi, qu] of offen.entries()) {
    if (qu.zweig === 'zahl') continue;
    for (const kand of qu.kandidaten) {
      if (gesehen.has(schluessel(kand))) continue;
      // Teilzeichenkette ohne Groß-/Kleinschreibung, dieselbe Regel wie die Suchachse der
      // `Datensicht`, über das BASISLABEL.
      if (!qu.serverGefiltert && !kand.basisLabel.toLowerCase().includes(klein)) continue;
      // Die Stufe kommt aus dem Basislabel OHNE Modulherkunft: sonst stünde bei 'personen' jede Person
      // auf Stufe 1 über allem, was wirklich so heißt.
      const stufe = textStufe(kand.basisLabel, suche);
      roh.push({
        treffer: alsTreffer(kand, stufe),
        heim: heim(kand),
        quelle: qi,
        stufe,
        index: roh.length,
      });
    }
  }

  // ERST ORDNEN, DANN DECKELN: sonst verdrängten fünf „Obermeier“ (Stufe 3) den gesuchten „Meier“
  // (Stufe 2), je nach Lieferreihenfolge. Die Stufe entscheidet, WER in den Deckel kommt.
  // Heimvorteil zwischen Stufe und Quelle, Quellenrang als Tiebreak, der Eingabeindex macht die
  // Ordnung unabhängig von der Stabilität von `sort`. Nach dem Deckeln umzusortieren könnte einen
  // verdrängten Heimtreffer nicht zurückholen.
  roh.sort(
    (a, b) => a.stufe - b.stufe || a.heim - b.heim || a.quelle - b.quelle || a.index - b.index,
  );

  // Nummerntreffer werden NIE weggedeckelt (exakte Gleichheit, höchstens einer je Quelle). Geordnet
  // werden sie trotzdem, die Herkunft trennt '42' in Person, Meldung und Auftrag.
  nummerRoh.sort((a, b) => a.heim - b.heim || a.quelle - b.quelle || a.index - b.index);
  const nummerTreffer = nummerRoh.map((x) => x.treffer);
  const platz = Math.max(0, DECKEL_GESAMT - nummerTreffer.length);
  const jeQuelle = new Map<number, number>();
  const textTreffer: Treffer[] = [];
  for (const r of roh) {
    if (textTreffer.length >= platz) break;
    const bisher = jeQuelle.get(r.quelle) ?? 0;
    if (bisher >= DECKEL_JE_QUELLE) continue;
    jeQuelle.set(r.quelle, bisher + 1);
    textTreffer.push(r.treffer);
  }
  const sammel = zahl === null ? etbSammeltreffer(k, suche) : null;
  return [...nummerTreffer, ...textTreffer, ...(sammel ? [sammel] : [])];
}

/** Id des ETB-Sammeltreffers, eine je Suche. */
const ETB_SAMMEL_ID = 'datensatz:etb:suche';

/**
 * Beschriftung des Sammeltreffers. EINE Stelle, weil `sichtbareDatensaetze` sie gegen den
 * lebenden Begriff vergleicht.
 */
function etbSammelLabel(suche: string): string {
  return `Alle Einträge zu „${suche}“`;
}

/**
 * Der ETB-Sammeltreffer „Alle Einträge zu „deich““ mit Trefferzahl.
 *
 * Er steht in der SICHTBAREN Ordnung HINTER allen Einzeltreffern (Stufe 3 plus
 * `UNBEWERTET + 1` ist strikt schlechter als jeder Einzeltreffer) und außerhalb beider Deckel:
 * er ist der Weg zu allen, nicht der beste Treffer; Enter soll auf den gesuchten Eintrag führen.
 *
 * NUR IM TEXTZWEIG (eine gedruckte Nummer fragt der Cursor). Bei null Treffern gibt es keine
 * Zeile.
 */
function etbSammeltreffer(k: DatensatzKontext, suche: string): Treffer | null {
  const erlaubt = PALETTE_MODI[k.modus].quellen;
  if (erlaubt !== null && !erlaubt.includes('etbAnzahl')) return null;
  const n = k.quellen.etbAnzahl?.anzahl ?? 0;
  if (n <= 0) return null;
  const m = modulRegistry.find((x) => x.key === QUELLE_MODUL.etbAnzahl);
  if (!m || !istModulFreigegeben(m, k.benutzer, k.overrides)) return null;
  const ziel = etbPfad(k.einsatzId, { q: suche });
  return {
    befehl: {
      id: ETB_SAMMEL_ID,
      gruppe: 'datensaetze',
      label: etbSammelLabel(suche),
      kontext: `${m.label} · ${n} Treffer`,
      schlagworte: [m.label],
      icon: m.icon,
      ...sprungZu(ziel, k.navigate),
    },
    score: UNBEWERTET + 1,
    stufe: 3,
  };
}

function schluessel(kand: Kandidat): string {
  return `datensatz:${kand.modulKey}:${kand.id}`;
}

/**
 * Die Umkehr von {@link schluessel}: Modulschlüssel eines Datensatz-Treffers, `null` für jeden
 * anderen Befehl. Direkt neben dem Erzeuger, damit die Form an EINER Stelle steht.
 */
function modulKeyAusId(befehlId: string): string | null {
  // `suche` ist der ETB-Sammeltreffer; er unterliegt denselben Riegeln wie jeder ETB-Eintrag.
  const t = /^datensatz:([^:]+):(?:\d+|suche)$/.exec(befehlId);
  return t ? t[1] : null;
}

/**
 * Spiegel von `fts_query` (src/etb/repo.rs): trägt die Eingabe überhaupt ein Token, auf das der
 * ETB-Volltext antworten KANN?
 *
 * Das Backend verwirft Tokens ohne alphanumerisches Zeichen und lässt den MATCH-Filter ganz weg,
 * wenn nichts übrig bleibt; auf '??' kämen die jüngsten Einträge ungefiltert zurück. Der Riegel
 * liegt im Frontend, weil ein leerer Filter für die ETB-Seite richtig ist.
 *
 * `\p{Alphabetic}` + `\p{N}` spiegeln Rusts `char::is_alphanumeric`; eine engere Kopie hielte
 * Anfragen zurück, die der Server beantwortet hätte.
 */
export function etbVolltextMoeglich(suche: string): boolean {
  return suche.split(/\s+/).some((t) => /[\p{Alphabetic}\p{N}]/u.test(t));
}

/** Modulschlüssel, die dieser Modus zeigt; `null` = keine Einschränkung. */
function modulKeysDesModus(modus: PaletteModus): Set<string> | null {
  const quellen = PALETTE_MODI[modus].quellen;
  return quellen === null ? null : new Set(quellen.map((q) => QUELLE_MODUL[q]));
}

/**
 * Die Riegel an der ANZEIGE, dieselben wie am Abruf: eine anstehende Trefferliste belegt nicht,
 * dass die AKTUELLE Eingabe sie rechtfertigt.
 *
 *  - **warmer Cache**: `enabled: false` schaltet das Nachladen ab, nicht die Auslieferung.
 *    Nach dem Kürzen von '@meier' auf '@m' stünde sonst eine Ein-Zeichen-Suche aus dem Cache da.
 *  - **Entprellung**: die Treffer hinken der Eingabe bis zu 300 ms nach; in '>meier' stünde
 *    sonst eine Personenzeile unter „Nur Aktionen“, ausführbar per Enter.
 *
 * Gefiltert wird über die QUELLENMENGE des Modus, sonst überlebte ein Nachläufer den Wechsel
 * '@meier' → '#meier'. Rein und exportiert, damit die Zusicherung ohne Render prüfbar ist.
 */
export function sichtbareDatensaetze(
  treffer: Treffer[],
  modus: PaletteModus,
  rest: string,
): Treffer[] {
  const s = rest.trim();
  if (s.length < DATENSATZ_MINDESTZEICHEN) return [];
  const erlaubteModule = modulKeysDesModus(modus);
  const etbOffen = etbVolltextMoeglich(s);
  return treffer.filter((t) => {
    const modulKey = modulKeyAusId(t.befehl.id);
    // Kein Datensatz-Schlüssel: nicht unsere Achse. Still wegzuwerfen, was wir nicht einordnen
    // können, versteckte einen Fehler.
    if (modulKey === null) return true;
    if (erlaubteModule !== null && !erlaubteModule.has(modulKey)) return false;
    // Der Sammeltreffer trägt seinen Begriff in Beschriftung UND Ziel; aus dem entprellten Stand
    // gebaut, spränge er auf eine veraltete Suche. Er gilt nur für genau den lebenden Begriff.
    if (t.befehl.id === ETB_SAMMEL_ID && t.befehl.label !== etbSammelLabel(s)) return false;
    // Beide ETB-Zweige teilen den Modulschlüssel, und keiner kann ohne alphanumerisches Token
    // antworten.
    return modulKey !== QUELLE_MODUL.etbText || etbOffen;
  });
}

/**
 * Ein Datensatz-Treffer ist ein gewöhnlicher `Befehl` in derselben `role="option"`-Schleife; nur
 * so erbt er den Bedienziel-Boden aus `palettenZeilenStil`. Ikone und Modulherkunft kommen aus
 * der `modulRegistry`, keine zweite Namensquelle.
 */
function befehlFuer(kand: Kandidat, navigate: DatensatzKontext['navigate']): Befehl {
  const m = modulRegistry.find((x) => x.key === kand.modulKey);
  return {
    id: schluessel(kand),
    gruppe: 'datensaetze',
    // Die Modulherkunft steht als KONTEXT rechts und als Schlagwort, damit „personen“ weiter
    // Personen-Datensätze findet.
    label: kand.basisLabel,
    kontext: m?.label ?? kand.modulKey,
    schlagworte: [m?.label ?? kand.modulKey],
    icon: m?.icon,
    ...sprungZu(kand.ziel, navigate),
    // Welche Vorschau-Sorte, sagt die Quellentabelle (`quellen`), nicht diese Stelle.
    ...(kand.vorschau ? { vorschau: kand.vorschau } : {}),
  };
}
