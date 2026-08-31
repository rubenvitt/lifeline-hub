// frontend/src/command-palette/datensaetze.ts
import {
  auftragLabel, kuerze, meldungLabel, personLabel, schadenLabel, uhsLabel,
} from '../chat/bezug';
import { istModulFreigegeben, modulRegistry } from '../einsatz/modulRegistry';
import {
  auftraegePfad, einheitDetailPfad, etbPfad, fahrzeugePfad, meldungenPfad, personDetailPfad,
  personalPfad, schadenDetailPfad, uhsDetailPfad,
} from '../routing/deeplinks';
import { textStufe, UNBEWERTET, type Treffer } from './fuzzy';
import {
  DATENSATZ_MINDESTZEICHEN, PALETTE_MODI, QUELLE_MODUL,
  type Befehl, type DatensatzQuelle, type PaletteModus,
} from './typen';
import type {
  Auftrag, BenutzerAnzeige, Einheit, EinsatzFahrzeug, EinsatzPersonal, EtbEintragAnzeige,
  Meldung, ModulOverrides, Person, Schaden, Uhs,
} from '../api/types';

/**
 * Der REINE Trefferkern des Datensatz-Finders (LFH-391 · C1).
 *
 * Eingabe sind FERTIG GELADENE Listen, ein Suchbegriff und die `einsatzId` — kein `useQuery`,
 * kein Hook, kein `fetch`. Nur so ist der Kern ohne Netz und ohne Render prüfbar; die
 * Beschaffung liegt daneben in `useDatensaetze.ts`.
 *
 * KEINE API-ADRESSE UND KEIN PFAD ENTSTEHEN HIER VON HAND: `routing/inlinePfade.guard.test.ts`
 * ist auf `command-palette/` gescopt, und sein Muster trifft nicht nur Routen, sondern auch
 * API-Adressen — in `/api/einsaetze/<id>/personen` steckt dieselbe Zeichenfolge. Jedes Ziel
 * kommt aus `routing/deeplinks.ts`, jeder Abruf über die Clients in `api/*.ts`.
 *
 * Der Guard liest ROHTEXT, kein AST: er trifft auch einen KOMMENTAR. Die Adresse oben steht
 * deshalb mit `<id>` statt mit einer Interpolationsklammer da (im Bauen einmal getreten).
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
   * Antwort des ETB-CURSORS (`before_lfd_nr = n + 1, limit = 1`). Sie geht ausschliesslich
   * in den Zahlenzweig und wird dort gegen die gesuchte Nummer GEPRÜFT: `before_lfd_nr`
   * filtert strikt `<` bei `ORDER BY lfd_nr DESC`, bei einer Nummernlücke liefert der Cursor
   * also den nächstälteren Eintrag. Ohne den Gleichheitsvergleich böte die Palette still den
   * falschen Eintrag an — und kein anderer Test sähe das.
   */
  etbNummer?: EtbEintragAnzeige[];
  /**
   * SERVERSEITIG per `q` bestätigte ETB-Volltexttreffer. Sie gehen ohne zweiten lokalen
   * Filter durch: `fts_query` sucht über inhalt/von/an/veranlassung, die Fundstelle steht
   * also regelmässig NICHT im Label — ein Nachfiltern über das Label würfe genau diese
   * Treffer weg.
   */
  etbText?: EtbEintragAnzeige[];
}

export interface DatensatzKontext {
  einsatzId: number;
  /** Der Rest hinter einem eventuellen Präfix, nicht die rohe Eingabe. */
  suche: string;
  /**
   * Der Präfixmodus, der die Quellenmenge einschränkt (LFH-391 · C3).
   *
   * PFLICHTFELD, kein optionales mit Vorgabe 'alles': ein vergessener Modus liefe still in
   * die volle Menge, und genau das ist der Fehler, den man nicht sieht.
   */
  modus: PaletteModus;
  benutzer: BenutzerAnzeige | null;
  overrides?: ModulOverrides;
  /**
   * Modulschlüssel der Seite, auf der die Palette geöffnet wurde — `null` ausserhalb eines
   * Moduls (LFH-391 · C4, Arbeitspunkt 3 des Tickets).
   *
   * Er kommt aus `modulAusPfad` (`einsatz/modulRegistry.ts`), also aus der AKTUELLEN ROUTE,
   * und beantwortet die Frage, die das Ticket stellt: wer im Kräfte-Modul einen
   * Funkrufnamen tippt, meint mit hoher Wahrscheinlichkeit ein Fahrzeug und nicht die
   * gleichnamige Person. Wie weit der Vorteil reicht, steht am Sortierschlüssel in
   * {@link baueDatensatzTreffer}.
   *
   * PFLICHTFELD wie `modus`: ein vergessener Kontext ist von „steht in keinem Modul" nicht
   * zu unterscheiden, und das ist genau der Fall, den niemand bemerkt.
   */
  aktuellerModulKey: string | null;
  navigate: (pfad: string) => void;
  quellen: DatensatzQuellen;
}

/**
 * Höchstens so viele TEXT-Treffer je Quelle …
 *
 * Beide Deckel greifen NACH dem Ordnen (siehe `baueDatensatzTreffer`): die Stufe entscheidet,
 * wer hineinkommt, nicht die Reihenfolge, in der der Server die Liste geliefert hat.
 */
const DECKEL_JE_QUELLE = 5;
/** … und so viele Datensatz-Treffer insgesamt. Nummerntreffer zählen mit, fallen aber nie weg. */
const DECKEL_GESAMT = 15;

/**
 * Liest eine gedruckte Kennung als Zahl (LFH-391 · C1).
 *
 * Fuse über eine Zahl ist unbelegbar: bei `threshold: 0.4` und zweistelligem Muster hängt das
 * Ergebnis an der Bitap-Fehlertoleranz, und '42' träfe R-142, R-420 und R-421 gleichrangig mit.
 * Bei einer Registriernummer ist das keine Unschärfe, sondern ein falscher Patient. Eine
 * gedruckte Kennung wird abgetippt, nicht erraten — deshalb ein EXAKTER Zahlenvergleich.
 *
 * Führende Nullen fallen weg: `registrier_nr` IST eine Zahl, `R-042` nur ihre Anzeige
 * (`registrierAnzeige`). Wer vom Papier abtippt, tippt die Nullen mit.
 *
 * Der Sortenbuchstabe BINDET ('R-42' findet die Person 42, nicht den Schaden 42) — er ist
 * genau die Information, die auf dem Papier steht, und kostet nichts. '#' und die blanke Zahl
 * binden nicht. ('#' ist hier bewusst schon zugelassen: bekommt die Palette später den
 * ETB-Modus '#', zerlegt `parsePraefix` die Eingabe vorher, und diese Stelle sieht die Zahl
 * ohne Zeichen — beide Wege bleiben damit gültig.)
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

/** Eine auf ihre suchbaren Merkmale reduzierte Zeile — eine Form für alle neun Entitäten. */
interface Kandidat {
  modulKey: string;
  id: number;
  /** Nummernfeld, `null` wenn die Entität keines hat oder es nicht gesetzt ist. */
  nummer: number | null;
  basisLabel: string;
  ziel: string;
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
  },
  extra: { sorte?: Nummernsorte; serverGefiltert?: boolean } = {},
): Quelle {
  // Der Modulschlüssel wird NICHT je Zeile hingeschrieben, sondern aus `QUELLE_MODUL`
  // gezogen — dieselbe Tabelle, an der auch der Abruf seine Rechte prüft.
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
    })),
  };
}

/**
 * Die neun Module in EINER Tabelle — Rechteschlüssel, Nummernfeld, Beschriftung und Ziel je
 * Zeile beieinander. Verteilt auf neun Zweige wäre jede der vier Regeln neunmal zu prüfen.
 *
 * DIE REIHENFOLGE IST NUR GLEICHSTANDSACHSE, keine Rangfolge: über die Stufe deckelt
 * `baueDatensatzTreffer`, die sichtbare Ordnung macht `ordneTreffer`. Sie folgt der
 * Erfassungshäufigkeit wie
 * `SCHNELLAKTIONEN` (befehle.ts) — im Einsatz wird nach Personen, ETB-Einträgen und Schäden
 * gesucht, nach Einheiten am seltensten.
 *
 * DIE BESCHRIFTUNG IST WIEDERVERWENDET, nicht neu erfunden: `personLabel` behandelt den
 * NULLBAREN Namen (MANV ohne Identität) bereits richtig und fällt auf 'R-042' zurück,
 * `schadenLabel`/`meldungLabel` bringen die formatierte Nummer über
 * `schadenRegistrierAnzeige`/`registrierAnzeige` mit. Die vier fehlenden (ETB, Fahrzeug,
 * Personal, Einheit) entstehen hier und NICHT in `chat/bezug.ts`: dessen Typen hängen am
 * `BezugTyp`-Union mit genau sechs Mitgliedern, und diese vier sind keine Bezugstypen — sie
 * dort einzutragen hiesse, den Chat-Wire-Kontrakt für ein Palettenlabel zu verbreitern.
 */
function quellen(k: DatensatzKontext): Quelle[] {
  const q = k.quellen;
  const e = k.einsatzId;
  return [
    baueQuelle('personen', 'beide', q.personen, e, {
      id: (p) => p.id,
      nummer: (p) => p.registrier_nr,
      label: personLabel,
      ziel: (id, p) => personDetailPfad(id, p.id),
    }, { sorte: 'person' }),
    // Zwei ETB-Quellen, zwei Verträge — siehe `DatensatzQuellen`. Der Cursorzweig steht
    // zuerst, damit ein Eintrag, den beide Abfragen liefern, als NUMMERNtreffer gilt.
    baueQuelle('etbNummer', 'zahl', q.etbNummer, e, {
      id: (x) => x.id,
      nummer: (x) => x.lfd_nr,
      label: etbLabel,
      ziel: (id, x) => etbPfad(id, { eintrag: x.id }),
    }),
    baueQuelle('etbText', 'text', q.etbText, e, {
      id: (x) => x.id,
      label: etbLabel,
      ziel: (id, x) => etbPfad(id, { eintrag: x.id }),
    }, { serverGefiltert: true }),
    baueQuelle('schaeden', 'beide', q.schaeden, e, {
      id: (s) => s.id,
      nummer: (s) => s.registrier_nr,
      label: schadenLabel,
      ziel: (id, s) => schadenDetailPfad(id, s.id),
    }, { sorte: 'schaden' }),
    baueQuelle('uhs', 'text', q.uhs, e, {
      id: (u) => u.id,
      label: uhsLabel,
      ziel: (id, u) => uhsDetailPfad(id, u.id),
    }),
    baueQuelle('meldungen', 'beide', q.meldungen, e, {
      id: (m) => m.id,
      nummer: (m) => m.lfd_nr,
      label: meldungLabel,
      ziel: (id, m) => meldungenPfad(id, { meldung: m.id }),
    }),
    baueQuelle('auftraege', 'beide', q.auftraege, e, {
      id: (a) => a.id,
      // `AuftragAnzeige.lfd_nr` ist NULLBAR (per ADD COLUMN eingeführt). Ohne diesen Riegel
      // fiele `null` im Vergleich auf `0` oder matchte jede Zahl, je nach Schreibweise.
      nummer: (a) => a.lfd_nr ?? null,
      label: auftragZeile,
      ziel: (id, a) => auftraegePfad(id, { auftrag: a.id }),
    }),
    baueQuelle('fahrzeuge', 'text', q.fahrzeuge, e, {
      id: (f) => f.id,
      // Der Funkrufname trägt NUR das Fahrzeug — Personal und Einheit haben `name`.
      label: (f) => f.funkrufname,
      ziel: (id, f) => fahrzeugePfad(id, { fahrzeug: f.id }),
    }),
    baueQuelle('personal', 'text', q.personal, e, {
      id: (p) => p.id,
      label: (p) => p.name,
      ziel: (id, p) => personalPfad(id, { personal: p.id }),
    }),
    baueQuelle('einheiten', 'text', q.einheiten, e, {
      id: (x) => x.id,
      label: (x) => x.name,
      ziel: (id, x) => einheitDetailPfad(id, x.id),
    }),
  ];
}

/** ETB-Zeile: laufende Nummer plus gekürzter Inhalt, Form wie `meldungLabel`. */
function etbLabel(x: EtbEintragAnzeige): string {
  return `#${x.lfd_nr} · ${kuerze(x.inhalt)}`;
}

/**
 * Auftragszeile: laufende Nummer plus gekürzter Auftragstext (Review-Befund zu C1).
 *
 * `auftragLabel` (chat/bezug.ts) ist NUR der gekürzte Text. Wer die auf Papier stehende
 * Nummer 42 abtippte, bekam „Aufträge/Befehle · Abschnitt erkunden" — die gesuchte 42 stand
 * nirgends in der Antwort, der Treffer war nicht nachprüfbar. Und zwei Aufträge mit
 * gleichlautendem Text („Lage melden", „Rückmeldung" sind im Betrieb üblich) ergaben zwei
 * identische Zeilen.
 *
 * `chat/bezug.ts` bleibt unverändert: dort speist `auftragLabel` die Bezug-Optionen des
 * Chats, wo der Typ schon gewählt ist und keine gedruckte Nummer abgetippt wird — das wäre
 * eine eigene Entscheidung, kein Nebenprodukt dieses Fixes. Die Kürzung kommt trotzdem aus
 * derselben Funktion, damit nicht zwei Grenzen nebeneinanderstehen.
 *
 * `lfd_nr` ist NULLBAR (per ADD COLUMN eingeführt) — ohne Nummer bleibt die reine Textzeile
 * stehen statt eines „#null".
 */
function auftragZeile(a: Auftrag): string {
  return a.lfd_nr == null ? auftragLabel(a) : `#${a.lfd_nr} · ${auftragLabel(a)}`;
}

/**
 * Bildet die geladenen Listen auf Treffer der Gruppe `datensaetze` ab.
 *
 * ZWEI DURCHGÄNGE, in dieser Reihenfolge: erst der Zahlenzweig über alle nummerierten
 * Quellen, dann der Textzweig. Ein Datensatz, den beide finden, steht damit als
 * Nummerntreffer da — die stärkere Aussage gewinnt.
 *
 * DIE RECHTEACHSE IST DIE LESEACHSE `istModulFreigegeben`, nicht `darfImEinsatzSchreiben`:
 * ein Beobachter darf lesen und behält seine Suche. Sie wird JE MODUL gefragt — 'Kräfte'
 * zerfällt in `fahrzeuge`, `personal` und `einheiten`, die in der Registry drei getrennte
 * Einträge mit eigener Sichtbarkeits- und Rollenschranke sind; ein Sammelbegriff wäre eine
 * vierte, erfundene Achse.
 *
 * `score` ist für alle Treffer {@link UNBEWERTET}: sie sind nicht durch Fuse gelaufen, es
 * gibt also keine Bewertung, die man hochreichen könnte — und eine 0 hätte für sie den
 * BESTMÖGLICHEN Wert behauptet. Die Ordnung tragen Stufe und, bei gleicher Stufe, der
 * bewertete Befehl. Begründung am Konstantenkopf in `fuzzy.ts`.
 *
 * DER MODUSFILTER STEHT HIER EIN ZWEITES MAL, obwohl `useDatensaetze` die gesperrten Listen
 * gar nicht erst holt — und der Grund ist gemessen (`useDatensaetze.test.tsx`, „hält die
 * Antwort einer abgeschalteten Query im Cache"): TanStack schaltet mit `enabled: false` das
 * NACHLADEN ab, nicht die AUSLIEFERUNG. Wer 'meier' ohne Präfix tippt und danach '@'
 * davorsetzt, hat die Schadensliste im Cache; ohne diesen Riegel stünde sie im Kräfte-Modus
 * weiter in der Liste, und das Präfix wäre von „wirkungslos" nicht zu unterscheiden.
 */
export function baueDatensatzTreffer(k: DatensatzKontext): Treffer[] {
  const suche = k.suche.trim();
  // Ohne Begriff entstehen keine Treffer: die Startansicht ist kuratiert (LFH-337 · M11),
  // und `''`-Teilzeichenketten passten ohnehin auf jede Zeile jeder Liste.
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
   * Der Heimvorteil des Moduls, in dem der Benutzer gerade steht (LFH-391 · C4) — 0 gewinnt.
   *
   * Er sitzt in BEIDEN Sortierschlüsseln unten an derselben Stelle: hinter der Stufe, vor der
   * Quellenreihenfolge. Vor der Stufe wäre er kein Rangvorteil mehr, sondern ein Modulfilter
   * — jeder beliebige Teiltreffer des eigenen Moduls stünde dann vor dem, was wirklich so
   * heisst. Und hinter der Quelle wäre er wirkungslos, denn die Quelle ist bei zwei
   * verschiedenen Modulen nie gleich.
   */
  const heim = (kand: Kandidat): 0 | 1 => (kand.modulKey === k.aktuellerModulKey ? 0 : 1);
  /** Nummerntreffer mit ihren Ordnungsachsen — gedeckelt werden sie nie, geordnet schon. */
  const nummerRoh: { treffer: Treffer; heim: 0 | 1; quelle: number; index: number }[] = [];
  /** Alle Texttreffer UNGEDECKELT — gedeckelt wird erst nach dem Ordnen, siehe unten. */
  const roh: { treffer: Treffer; heim: 0 | 1; quelle: number; stufe: 0 | 1 | 2 | 3; index: number }[] = [];

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
        // Stufe 0 — die Suche IST die Kennung. Aus dem Label liesse sie sich nicht ablesen
        // (dort steht 'Personen · R-042 · Müller'), und ein Fuzzy-Treffer auf Stufe 2
        // stünde sonst VOR dem exakten Nummerntreffer. Siehe `Treffer.stufe`.
        nummerRoh.push({ treffer: alsTreffer(kand, 0), heim: heim(kand), quelle: qi, index: nummerRoh.length });
      }
    }
  }

  for (const [qi, qu] of offen.entries()) {
    if (qu.zweig === 'zahl') continue;
    for (const kand of qu.kandidaten) {
      if (gesehen.has(schluessel(kand))) continue;
      // Teilzeichenkette ohne Rücksicht auf Groß-/Kleinschreibung — dieselbe Regel wie die
      // Suchachse der `Datensicht` (Datensicht.tsx:475-479). Gesucht wird über das
      // BASISLABEL: was in der Zeile steht, danach kann man suchen.
      if (!qu.serverGefiltert && !kand.basisLabel.toLowerCase().includes(klein)) continue;
      // Die Stufe kommt aus dem Basislabel OHNE die Modulherkunft davor: mit ihr ergäbe die
      // Suche 'personen' für JEDEN Personendatensatz Stufe 1 („Label beginnt damit") — die
      // ganze Liste stünde damit auf der Stufe der Modulseite und über allem, was wirklich
      // so heisst. Die Herkunft ist Beschriftung, keine Suchachse.
      const stufe = textStufe(kand.basisLabel, suche);
      roh.push({ treffer: alsTreffer(kand, stufe), heim: heim(kand), quelle: qi, stufe, index: roh.length });
    }
  }

  // ERST ORDNEN, DANN DECKELN (Review-Befund zu C1). Vorher schnitten beide Deckel in
  // LISTENreihenfolge, und wer hineinkam, hing daran, in welcher Reihenfolge der Server die
  // Zeilen geliefert hat: fünf „Obermeier" (Stufe 3) füllten die Personenquelle und
  // verdrängten den gesuchten „Meier" (Stufe 2) — Nachtippen half nicht, weil 'meier'
  // ebenfalls Teilzeichenkette von 'Obermeier' ist. Am Gesamtdeckel dasselbe eine Etage
  // höher: drei randvolle Quellen auf Stufe 2 liessen für das Fahrzeug „Nord 1" auf Stufe 1
  // keinen Platz. Die Stufe entscheidet jetzt, WER in den Deckel kommt.
  //
  // Der Quellenrang ist TIEBREAK, nicht Primärachse — er hält bei gleicher Stufe die
  // Erfassungshäufigkeit aus der Quellentabelle. Der Eingabeindex darunter macht die Ordnung
  // unabhängig von der Stabilität von `sort`, wie in `ordneTreffer`.
  //
  // Der Heimvorteil (LFH-391 · C4) steht zwischen Stufe und Quelle und erbt damit dieselbe
  // Wirkung auf den Deckel: die Einheiten stehen in der Quellentabelle zuletzt, und wer im
  // Modul „Einheiten" steht und einen Einheitennamen tippt, bekam den Treffer bei drei
  // randvollen Quellen davor gar nicht zu sehen. Eine Umsortierung NACH dem Deckeln könnte
  // das nicht heilen — deshalb sitzt er im Schlüssel und nicht dahinter.
  roh.sort((a, b) => a.stufe - b.stufe || a.heim - b.heim || a.quelle - b.quelle || a.index - b.index);

  // Nummerntreffer werden NIE weggedeckelt: sie sind eine exakte Gleichheit auf einer
  // eindeutigen Kennung, ihre Zahl ist strukturell klein (höchstens eine je Quelle). Geordnet
  // werden sie trotzdem — sie stehen alle auf Stufe 0, die Herkunft ist dort die einzige
  // Achse, die '42' in Person, Meldung und Auftrag noch auseinanderhalten kann.
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
  return [...nummerTreffer, ...textTreffer];
}

function schluessel(kand: Kandidat): string {
  return `datensatz:${kand.modulKey}:${kand.id}`;
}

/**
 * Die Umkehr von {@link schluessel} — Modulschlüssel eines Datensatz-Treffers, `null` für
 * jeden anderen Befehl.
 *
 * DIREKT NEBEN DEM ERZEUGER, damit die Form an EINER Stelle steht; getrennt wären es zwei
 * Meinungen über dieselbe Zeichenkette. Die Herkunft aus dem `Treffer` zu lesen wäre
 * hübscher, kostete aber ein neues Feld an `fuzzy.ts:Treffer` — das trägt jeder Befehl der
 * Palette, und 42 statische Befehle haben keine Datenquelle.
 */
function modulKeyAusId(befehlId: string): string | null {
  const t = /^datensatz:([^:]+):\d+$/.exec(befehlId);
  return t ? t[1] : null;
}

/**
 * Mirror von `fts_query` (src/etb/repo.rs): trägt die Eingabe überhaupt ein Token, auf das
 * der ETB-Volltext antworten KANN? (Review-Befund 6 zu Etappe C.)
 *
 * Das Backend wirft je Token alles weg, was kein einziges alphanumerisches Zeichen trägt —
 * und lässt den MATCH-Filter GANZ WEG, wenn danach nichts übrig ist (`.filter(|s|
 * !s.is_empty())`). Auf '??' (ebenso '--', '...', '<>', zwei Emoji) kam damit gemessen die
 * ungefilterte Liste der fünf jüngsten Einträge zurück, und die Palette bot sie als Treffer
 * an: Treffer für eine Suche, die niemand beantwortet hat. Der Riegel liegt im FRONTEND,
 * weil die Route ihren Vertrag hält — ein leerer Filter ist für die ETB-Seite (Blättern ohne
 * Suchbegriff) genau richtig.
 *
 * `\p{Alphabetic}` + `\p{N}` spiegeln Rusts `char::is_alphanumeric` (Alphabetic-Eigenschaft
 * ODER Zahlkategorie), nicht das engere `\p{L}` der Wortgrenze in `fuzzy.ts`: eine Kopie,
 * die weniger durchlässt als das Original, hielte eine Anfrage zurück, die der Server
 * beantwortet hätte.
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
 * Die Riegel an der ANZEIGE (Review-Befunde 4, 5 und 6 zu Etappe C).
 *
 * DIESELBEN Riegel wie am Abruf (`datensatzAbrufAktiv`, `enabled`) — und sie stehen hier ein
 * zweites Mal, weil eine anstehende Trefferliste kein Beleg dafür ist, dass die AKTUELLE
 * Eingabe sie rechtfertigt. Zwei gemessene Wege, wie sie auseinanderlaufen:
 *
 *  - **der warme Cache**: `enabled: false` schaltet das Nachladen ab, nicht die Auslieferung
 *    (`useDatensaetze.test.tsx`, „hält die Antwort einer abgeschalteten Query im Cache"). Wer
 *    '@meier' tippt und per Rücktaste auf '@m' kürzt, bekam eine Ein-Zeichen-Suche über den
 *    warmen Cache — im Kräfte-Modus sind die statischen Befehle ausgefiltert, die Liste
 *    bestand also AUSSCHLIESSLICH daraus, und die Aufforderung „Mindestens 2 Zeichen"
 *    erschien nicht, weil sie am leeren Zweig hängt.
 *  - **die Entprellung**: der Stand, aus dem die Treffer gebaut wurden, hinkt der Eingabe um
 *    bis zu 300 ms hinterher. In '>meier' stand deshalb eine Personenzeile unter der Marke
 *    „Nur Aktionen" — markierbar und per Enter ausführbar, also ein Weg aus dem Modus heraus.
 *
 * Gefiltert wird über die QUELLENMENGE des Modus, nicht bloss über „zeigt dieser Modus
 * überhaupt Datensätze": sonst überlebte ein Nachläufer jeden Wechsel INNERHALB der
 * Datensatz-Modi ('@meier' → '#meier'). Für den Aktionen-Modus ist die Menge leer, damit
 * fällt sein Fall als Sonderfall weg.
 *
 * Rein und exportiert nach dem Repo-Muster von `bedienzielStil`: nur so ist die Zusicherung
 * ohne Render prüfbar — und nur so steht sie an EINER Stelle statt in drei Bedingungen im
 * JSX.
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
    // Kein Datensatz-Schlüssel: nicht unsere Achse. Still wegzuwerfen, was wir nicht
    // einordnen können, verstecke einen Fehler, statt ihn zu zeigen.
    if (modulKey === null) return true;
    if (erlaubteModule !== null && !erlaubteModule.has(modulKey)) return false;
    // Beide ETB-Zweige teilen sich den Modulschlüssel, und keiner kann ohne alphanumerisches
    // Token antworten: der Volltext läuft dort ins Leere (siehe oben), der Zahlenzweig
    // verlangt ohnehin Ziffern.
    return modulKey !== QUELLE_MODUL.etbText || etbOffen;
  });
}

/**
 * Ein Datensatz-Treffer ist ein gewöhnlicher `Befehl` und läuft durch dieselbe
 * `role="option"`-Schleife wie jeder andere — nur so erbt er den Bedienziel-Boden aus
 * `palettenZeilenStil`. Ein eigener Renderzweig verlöre ihn still, und kein Gate sähe das.
 *
 * Die Ikone kommt aus der `modulRegistry`, die Modulherkunft ebenso: eine zweite
 * Namensquelle fällt niemandem auf, weil beide Seiten plausibel aussehen (Befund M14).
 */
function befehlFuer(kand: Kandidat, navigate: (pfad: string) => void): Befehl {
  const m = modulRegistry.find((x) => x.key === kand.modulKey);
  return {
    id: schluessel(kand),
    gruppe: 'datensaetze',
    label: `${m?.label ?? kand.modulKey} · ${kand.basisLabel}`,
    icon: m?.icon,
    ausfuehren: () => navigate(kand.ziel),
  };
}
