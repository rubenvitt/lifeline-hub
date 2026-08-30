// frontend/src/command-palette/datensaetze.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  baueDatensatzTreffer, etbVolltextMoeglich, sichtbareDatensaetze, zahlAusSuche,
  type DatensatzKontext,
} from './datensaetze';
import { filtereBefehle, ordneTreffer, praefixStufe, type Treffer } from './fuzzy';
import type { Befehl, PaletteModus } from './typen';
import type {
  Auftrag, BenutzerAnzeige, Einheit, EinsatzFahrzeug, EinsatzPersonal, EtbEintragAnzeige,
  Meldung, ModulOverride, Person, Schaden, Uhs,
} from '../api/types';

/**
 * FIXTUREN ALS TEILOBJEKTE mit `as`-Cast (Bauform `offline/ereignisse.test.ts:8`), nicht als
 * vollständige Wire-Objekte wie in `lageVerdichtung.test.ts`: der Kern liest je Entität zwei
 * bis drei Felder, neun vollständige DTOs wären rund dreihundert Zeilen Rauschen und machten
 * keine einzige Aussage schärfer. Dass die gelesenen Felder wirklich existieren, hält der
 * Typcheck an der PRODUKTIVSEITE fest — dort steht der echte Typ ohne Cast.
 */
const person = (o: Partial<Person>): Person =>
  ({ id: 1, einsatz_id: 5, registrier_nr: 1, status: 'erfasst', name: null, vorname: null, ...o }) as Person;
const schaden = (o: Partial<Schaden>): Schaden =>
  ({ id: 1, einsatz_id: 5, registrier_nr: 1, typ: 'sachschaden', ort: 'Hauptstr', ...o }) as Schaden;
const uhs = (o: Partial<Uhs>): Uhs =>
  ({ id: 1, einsatz_id: 5, bezeichnung: 'BHP 1', typ: 'behandlungsplatz', ...o }) as Uhs;
const meldung = (o: Partial<Meldung>): Meldung =>
  ({ id: 1, einsatz_id: 5, lfd_nr: 1, absender: 'Leitstelle', inhalt: 'x', ...o }) as Meldung;
const auftrag = (o: Partial<Auftrag>): Auftrag =>
  ({ id: 1, einsatz_id: 5, lfd_nr: 1, auftrag_text: 'Abschnitt erkunden', ...o }) as Auftrag;
const fahrzeug = (o: Partial<EinsatzFahrzeug>): EinsatzFahrzeug =>
  ({ id: 1, einsatz_id: 5, funkrufname: 'Florian 1', ...o }) as EinsatzFahrzeug;
const personal = (o: Partial<EinsatzPersonal>): EinsatzPersonal =>
  ({ id: 1, einsatz_id: 5, name: 'Meier', ...o }) as EinsatzPersonal;
const einheit = (o: Partial<Einheit>): Einheit =>
  ({ id: 1, einsatz_id: 5, name: 'SEG 1', ...o }) as Einheit;
const etb = (o: Partial<EtbEintragAnzeige>): EtbEintragAnzeige =>
  ({ id: 1, lfd_nr: 1, inhalt: 'Lage erkundet', typ: 'lage', ...o }) as EtbEintragAnzeige;

const fuehrungskraft: BenutzerAnzeige = {
  id: 1, anzeigename: 'EL', benutzername: 'el', system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '', totp_aktiviert: false,
};

/** Vollständiges ModulOverride bauen (Bauform `befehle.test.ts:19`). */
function ueberschreibung(felder: Partial<ModulOverride>): ModulOverride {
  return {
    einsatz_id: 5, modul_key: 'personen', sichtbar: true, benoetigte_rolle: null,
    geaendert_at: null, geaendert_von: null, ...felder,
  };
}

function kontext(over: Partial<DatensatzKontext> = {}): DatensatzKontext {
  return {
    einsatzId: 5, suche: '', modus: 'alles', benutzer: fuehrungskraft, overrides: undefined,
    aktuellerModulKey: null, navigate: vi.fn(), quellen: {}, ...over,
  };
}

const ids = (t: Treffer[]) => t.map((x) => x.befehl.id);
const labels = (t: Treffer[]) => t.map((x) => x.befehl.label);

// ─────────────────────────────────────────────────────────────────────────────
describe('zahlAusSuche', () => {
  /**
   * Die drei Schreibweisen des Akzeptanzkriteriums plus die Sortenbindung. Führende Nullen
   * fallen weg, weil `registrier_nr` eine Zahl ist und `R-042` nur ihre ANZEIGE
   * (`registrierAnzeige`) — wer die gedruckte Kennung abtippt, tippt die Nullen mit.
   */
  it.each([
    ['42', 42, null],
    ['042', 42, null],
    ['R-042', 42, 'person'],
    ['r-42', 42, 'person'],
    ['S-3', 3, 'schaden'],
    ['#214', 214, null],
    ['  42  ', 42, null],
    ['R042', 42, 'person'],
    ['R 42', 42, 'person'],
  ])('liest %s als Nummer %i mit Sorte %s', (eingabe, nummer, sorte) => {
    expect(zahlAusSuche(eingabe as string)).toEqual({ nummer, sorte });
  });

  /** Gegenaussage: ohne sie wäre jede Eingabe eine Nummer und der Textzweig tot. */
  it.each(['', 'Müller', '4a', 'R-', 'R-4-2', '4.2', '-42'])('erkennt %s NICHT als Nummer', (e) => {
    expect(zahlAusSuche(e)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — die drei Akzeptanzkriterien', () => {
  it('findet eine Person über die Registriernummer und navigiert auf personDetailPfad', () => {
    const k = kontext({ suche: '42', quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] } });
    const t = baueDatensatzTreffer(k);
    expect(ids(t)).toEqual(['datensatz:personen:7']);
    t[0].befehl.ausfuehren();
    // Literal-Pin auf den Builder-Ausgang (Bestandskonvention `befehle.test.ts:36`):
    // ein `personDetailPfad(5, 7)` auf beiden Seiten prüfte den Builder gegen sich selbst.
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/personen/7');
  });

  it('findet dieselbe Person über R-042, 042 und 42', () => {
    const quellen = { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] };
    for (const suche of ['R-042', '042', '42']) {
      expect(ids(baueDatensatzTreffer(kontext({ suche, quellen })))).toEqual(['datensatz:personen:7']);
    }
  });

  it('findet ein Fahrzeug über den Funkrufnamen und navigiert auf fahrzeugePfad', () => {
    const k = kontext({ suche: 'florian', quellen: { fahrzeuge: [fahrzeug({ id: 7, funkrufname: 'Florian 1' })] } });
    const t = baueDatensatzTreffer(k);
    expect(ids(t)).toEqual(['datensatz:fahrzeuge:7']);
    t[0].befehl.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/fahrzeuge?fahrzeug=7');
  });

  it('findet einen ETB-Eintrag über die lfd. Nr. und navigiert auf etbPfad', () => {
    const k = kontext({ suche: '99', quellen: { etbNummer: [etb({ id: 12, lfd_nr: 99 })] } });
    const t = baueDatensatzTreffer(k);
    expect(ids(t)).toEqual(['datensatz:etb:12']);
    t[0].befehl.ausfuehren();
    // `?eintrag=` trägt die DB-`id`, nicht die laufende Nummer (Deeplink-Muster LFH-25);
    // `EtbPage` liest sie über `parseRouteId(searchParams.get('eintrag'))`.
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/etb?eintrag=12');
  });

  /**
   * Die übrigen fünf Ziele als Literal-Pin. Die Auswahl des Builders ist eine ENTSCHEIDUNG,
   * keine Mechanik: die Einheit ist seit LFH-339 · C4 auf das Item-Route-Muster gewechselt,
   * `einheitenPfad(id, { einheit })` existiert daneben weiter — ein Griff zum falschen
   * Builder führte auf eine gültige Seite und fiele niemandem auf.
   */
  it.each([
    ['schaeden', { schaeden: [schaden({ id: 7, registrier_nr: 42 })] }, '/einsaetze/5/schaeden/7'],
    ['unfallhilfsstellen', { uhs: [uhs({ id: 7, bezeichnung: 'BHP 42' })] }, '/einsaetze/5/unfallhilfsstellen/7'],
    ['meldungen', { meldungen: [meldung({ id: 7, lfd_nr: 42 })] }, '/einsaetze/5/meldungen?meldung=7'],
    ['auftraege', { auftraege: [auftrag({ id: 7, lfd_nr: 42 })] }, '/einsaetze/5/auftraege?auftrag=7'],
    ['personal', { personal: [personal({ id: 7, name: 'Nr 42' })] }, '/einsaetze/5/personal?personal=7'],
    ['einheiten', { einheiten: [einheit({ id: 7, name: 'SEG 42' })] }, '/einsaetze/5/einheiten/7'],
  ])('führt %s auf den Builder aus routing/deeplinks.ts', (_modul, quellen, ziel) => {
    const k = kontext({ suche: '42', quellen });
    const t = baueDatensatzTreffer(k);
    expect(t).toHaveLength(1);
    t[0].befehl.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith(ziel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Rangfolge', () => {
  /**
   * DIE Aussage, die zwischen Etappe A und C hindurchzufallen drohte.
   *
   * `praefixStufe` rechnet die Stufe aus dem LABEL. Ein Personenlabel „Personen · R-042 ·
   * Müller" liefert bei der Suche '42' Stufe 3 — dieselbe Stufe wie reines Fuse-Rauschen.
   * Ein Einsatz namens „Einsatz 42" steht dagegen auf Stufe 2 (ein WORT beginnt mit '42')
   * und läge damit VOR dem exakten Nummerntreffer: das zentrale Akzeptanzkriterium des
   * Tickets, still gekippt. Deshalb trägt ein Nummerntreffer seine Stufe selbst.
   *
   * Die Vorabprüfung auf den Fuse-Lauf ist nötig: fände Fuse den Einsatz gar nicht,
   * wäre die Ordnungsaussage trivial grün.
   */
  it('stellt einen Nummerntreffer vor einen Fuzzy-Treffer, der ein Wort mit der Zahl trägt', () => {
    const einsatzBefehl: Befehl = {
      id: 'einsatz:9', gruppe: 'einsaetze', label: 'Einsatz 42', ausfuehren: () => {},
    };
    const rauschen = filtereBefehle([einsatzBefehl], '42');
    expect(rauschen, 'Fuse findet den Einsatz — sonst prüft der Test nichts').toHaveLength(1);

    const nummer = baueDatensatzTreffer(kontext({
      suche: '42', quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] },
    }));
    expect(nummer[0].stufe, 'Nummerntreffer tragen die beste Stufe').toBe(0);

    expect(ordneTreffer([...rauschen, ...nummer], '42').map((b) => b.id)[0])
      .toBe('datensatz:personen:7');
  });

  /**
   * Die andere Richtung, und der Grund, warum die Stufe eines TEXTtreffers aus dem
   * BASISLABEL kommt und nicht aus dem fertigen Label mit der Modulherkunft davor.
   *
   * Mit dem vollen Label „Personen · R-042 · Personendorf" ergäbe die Suche 'person' Stufe 1
   * („Label beginnt damit") — gleichauf mit dem Modulbefehl „Personen". Die ganze
   * Personenliste stünde damit auf der Stufe der Modulseite und über allem, was wirklich so
   * heisst. Die Modulherkunft ist Beschriftung, keine Suchachse.
   *
   * Gesucht wird 'person' und NICHT 'personen': bei Gleichheit mit dem Modullabel stünde das
   * Modul auf Stufe 0 und gewänne in jeder Fassung — der Test wäre nicht rot zu bekommen.
   */
  it('lässt den Modulbefehl vorn, wenn die Suche den Modulnamen trifft', () => {
    const modul: Befehl = { id: 'modul:personen', gruppe: 'module', label: 'Personen', ausfuehren: () => {} };
    const modulTreffer = filtereBefehle([modul], 'person');
    expect(modulTreffer).toHaveLength(1);
    const datensatz = baueDatensatzTreffer(kontext({
      suche: 'person', quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Personendorf' })] },
    }));
    expect(datensatz, 'der Datensatz wird gefunden — sonst prüft der Test nichts').toHaveLength(1);

    expect(ordneTreffer([...datensatz, ...modulTreffer], 'person').map((b) => b.id)[0])
      .toBe('modul:personen');
  });

  /**
   * Dieselbe Frage EINE STUFE TIEFER — und sie ist die eigentliche (Review-Befund zu C).
   *
   * Der Test darüber hält nur, weil das Modullabel dem Suchbegriff näher steht als das
   * Datensatzlabel (Stufe 1 gegen Stufe 2). Trägt ein Datensatzlabel dasselbe PRÄFIX wie
   * sein Modul („Einheit Nord" unter dem Modul „Einheiten"), stehen beide auf Stufe 1 — und
   * dann entscheidet der Score. Ein Datensatz-Treffer ist nie durch Fuse gelaufen; ein Score
   * von 0 behauptet für ihn den bestmöglichen Wert und verdrängte den bewerteten
   * Modultreffer. Gemessen stand der Modulbefehl hinter fünf Einheiten-Datensätzen, und
   * Enter öffnete einen Datensatz statt der Modulseite.
   *
   * Die Erwartung folgt der Bedienabsicht: wer einen MODULNAMEN tippt, will das Modul; wer
   * eine Nummer oder einen Funkrufnamen tippt, will den Datensatz — und der steht dann auf
   * einer BESSEREN Stufe, nicht auf derselben.
   *
   * Der Datensatz steht in der Eingabe VORN: sonst rettete ihn der Eingabeindex, und der
   * Test wäre auch ohne die Score-Achse grün.
   */
  it('lässt den Modulbefehl vorn, wenn ein Datensatzlabel dasselbe Präfix trägt', () => {
    const modul: Befehl = { id: 'modul:einheiten', gruppe: 'module', label: 'Einheiten', ausfuehren: () => {} };
    const modulTreffer = filtereBefehle([modul], 'einheit');
    expect(modulTreffer, 'Fuse findet das Modul — sonst prüft der Test nichts').toHaveLength(1);
    expect(praefixStufe(modul, 'einheit'), 'der Modultreffer steht auf Stufe 1').toBe(1);

    const datensatz = baueDatensatzTreffer(kontext({
      suche: 'einheit', quellen: { einheiten: [einheit({ id: 3, name: 'Einheit Nord' })] },
    }));
    expect(datensatz[0]?.stufe, 'GLEICHE Stufe — sonst entschiede die Stufe und nicht der Score').toBe(1);

    expect(ordneTreffer([...datensatz, ...modulTreffer], 'einheit').map((b) => b.id)[0])
      .toBe('modul:einheiten');
  });

  /**
   * Die Gegenrichtung, damit die Score-Achse den Zahlenzweig nicht mitnimmt: ein
   * Nummerntreffer steht auf Stufe 0, und die Stufe ist die ERSTE Achse — sie schlägt jeden
   * Score. Ohne diese Hälfte wäre „Befehl vor Datensatz bei gleicher Stufe" auch dann grün,
   * wenn die Regel den exakten Nummerntreffer mit erschlüge.
   */
  it('hält den Nummerntreffer vor dem bewerteten Modultreffer', () => {
    const modul: Befehl = { id: 'modul:personen', gruppe: 'module', label: 'Personen 42', ausfuehren: () => {} };
    const modulTreffer = filtereBefehle([modul], '42');
    expect(modulTreffer, 'Fuse findet das Modul — sonst prüft der Test nichts').toHaveLength(1);
    const nummer = baueDatensatzTreffer(kontext({
      suche: '42', quellen: { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] },
    }));
    expect(ordneTreffer([...modulTreffer, ...nummer], '42').map((b) => b.id)[0])
      .toBe('datensatz:personen:7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Der Heimvorteil des Moduls, in dem der Benutzer gerade steht (LFH-391 · C4, AP3).
 *
 * Fahrzeug und Personal tragen beide einen NACKTEN Namen als Basislabel und stehen deshalb
 * auf derselben Stufe — nur so ist die Aussage überhaupt prüfbar: entschiede die Stufe,
 * wäre der Heimvorteil an der Reihenfolge nicht abzulesen. (Die Personenliste taugt dafür
 * nicht: ihr Label trägt die Registriernummer vorn und landet bei einem Namenssuchbegriff
 * eine Stufe tiefer — genau das prüft der Test darunter.)
 */
describe('baueDatensatzTreffer — Heimvorteil des aktuellen Moduls', () => {
  const gleichnamig = {
    fahrzeuge: [fahrzeug({ id: 7, funkrufname: 'Florian 1' })],
    personal: [personal({ id: 8, name: 'Florian 1' })],
  };

  /**
   * BEIDE Richtungen als Paar: die Fahrzeug-Hälfte allein wäre auch ohne Heimvorteil grün,
   * weil die Quellentabelle die Fahrzeuge ohnehin vor das Personal stellt.
   */
  it('stellt bei gleicher Stufe den Treffer aus dem Modul voran, in dem man steht', () => {
    const gleich = baueDatensatzTreffer(kontext({ suche: 'florian', quellen: gleichnamig }));
    expect(gleich.map((t) => t.stufe), 'GLEICHE Stufe — sonst entschiede sie und nicht die Herkunft')
      .toEqual([1, 1]);

    expect(ids(baueDatensatzTreffer(kontext({
      suche: 'florian', quellen: gleichnamig, aktuellerModulKey: 'personal',
    })))).toEqual(['datensatz:personal:8', 'datensatz:fahrzeuge:7']);

    expect(ids(baueDatensatzTreffer(kontext({
      suche: 'florian', quellen: gleichnamig, aktuellerModulKey: 'fahrzeuge',
    })))).toEqual(['datensatz:fahrzeuge:7', 'datensatz:personal:8']);
  });

  /**
   * DIE GRENZE DES VORTEILS: er ist Tiebreak NACH der Stufe, nicht vor ihr.
   *
   * Wer in „Personen" steht und 'florian' tippt, bekommt trotzdem zuerst das Fahrzeug
   * „Florian 1" — dessen Label BEGINNT mit dem Suchwort (Stufe 1), das Personenlabel trägt
   * es hinter der Registriernummer (Stufe 2). Ein Heimvorteil vor der Stufe machte aus dem
   * Rangvorteil einen Modulfilter: jeder beliebige Teiltreffer des eigenen Moduls stünde vor
   * dem, was wirklich so heisst.
   */
  it('lässt die Stufe über dem Heimvorteil stehen', () => {
    const quellen = {
      personen: [person({ id: 3, registrier_nr: 3, name: 'Florian' })],
      fahrzeuge: [fahrzeug({ id: 7, funkrufname: 'Florian 1' })],
    };
    const t = baueDatensatzTreffer(kontext({
      suche: 'florian', quellen, aktuellerModulKey: 'personen',
    }));
    // Als MENGE geprüft, nicht als Folge: sonst schlüge diese Zeile bei einem umsortierten
    // Ergebnis zuerst an und verdeckte die Aussage, um die es geht.
    expect(new Set(t.map((x) => x.stufe)), 'ungleiche Stufen — sonst prüft der Test nichts')
      .toEqual(new Set([1, 2]));
    expect(ids(t)).toEqual(['datensatz:fahrzeuge:7', 'datensatz:personen:3']);
  });

  /**
   * Der Zahlenzweig folgt derselben Regel: '42' trifft im Betrieb gleichzeitig eine Person,
   * eine Meldung und einen Auftrag mit dieser laufenden Nummer. Alle drei sind exakte
   * Kennungstreffer auf Stufe 0 — welche zuerst steht, ist genau die Frage, die der Kontext
   * beantworten kann.
   */
  it('zieht den Nummerntreffer des aktuellen Moduls nach vorn', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })],
      meldungen: [meldung({ id: 9, lfd_nr: 42, absender: 'Leitstelle' })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen }))))
      .toEqual(['datensatz:personen:7', 'datensatz:meldungen:9']);
    expect(ids(baueDatensatzTreffer(kontext({
      suche: '42', quellen, aktuellerModulKey: 'meldungen',
    })))).toEqual(['datensatz:meldungen:9', 'datensatz:personen:7']);
  });

  /**
   * Der Vorteil entscheidet nicht nur über die Reihenfolge, sondern über das ÜBERLEBEN am
   * Gesamtdeckel — und das ist der Grund, warum er im Sortierschlüssel steht und nicht in
   * einer Umsortierung danach.
   *
   * Fünfzehn Plätze, sechzehn gleichstufige Treffer: die Einheit steht in der Quellentabelle
   * zuletzt und fiel ohne Kontext heraus. Wer im Modul „Einheiten" steht und einen
   * Einheitennamen tippt, bekam ihn also gar nicht zu sehen.
   */
  it('rettet den Treffer des aktuellen Moduls über den Gesamtdeckel', () => {
    const quellen = {
      uhs: Array.from({ length: 5 }, (_, i) => uhs({ id: 40 + i, bezeichnung: 'Nord' })),
      fahrzeuge: Array.from({ length: 5 }, (_, i) => fahrzeug({ id: 60 + i, funkrufname: 'Nord 1' })),
      // Kein Label ist mit dem Suchwort IDENTISCH — sonst stünde es auf Stufe 0 und die
      // Aussage hinge an der Stufe statt an der Herkunft.
      personal: Array.from({ length: 5 }, (_, i) => personal({ id: 80 + i, name: 'Nord 3' })),
      einheiten: [einheit({ id: 99, name: 'Nord 2' })],
    };
    const ohne = baueDatensatzTreffer(kontext({ suche: 'nord', quellen }));
    expect(new Set(ohne.map((t) => t.stufe)), 'alle sechzehn auf derselben Stufe').toEqual(new Set([1]));
    expect(ohne, 'der Gesamtdeckel bleibt bei fünfzehn').toHaveLength(15);
    expect(ids(ohne)).not.toContain('datensatz:einheiten:99');

    const mit = baueDatensatzTreffer(kontext({ suche: 'nord', quellen, aktuellerModulKey: 'einheiten' }));
    expect(mit).toHaveLength(15);
    expect(ids(mit)[0]).toBe('datensatz:einheiten:99');
  });

  /**
   * DIE ZWEITE GRENZE: der Vorteil ordnet die DATENSÄTZE untereinander und greift nicht in
   * die gruppenübergreifende Rangfolge ein.
   *
   * Wer im Modul „Einheiten" steht und „einheit" tippt, meint die Modulseite — der
   * Bestandsvertrag aus Etappe C („Befehl vor unbewertetem Datensatz bei gleicher Stufe")
   * bleibt gültig, obwohl der Datensatz jetzt einen Heimvorteil trägt. Er wirkt in
   * `ordneTreffer` gar nicht: dort entscheidet nach der Stufe der Score, und der ist für
   * jeden Datensatz-Treffer UNBEWERTET.
   */
  it('lässt den Modulbefehl vorn, auch wenn man in diesem Modul steht', () => {
    const modul: Befehl = { id: 'modul:einheiten', gruppe: 'module', label: 'Einheiten', ausfuehren: () => {} };
    const modulTreffer = filtereBefehle([modul], 'einheit');
    expect(modulTreffer, 'Fuse findet das Modul — sonst prüft der Test nichts').toHaveLength(1);
    const datensatz = baueDatensatzTreffer(kontext({
      suche: 'einheit', quellen: { einheiten: [einheit({ id: 3, name: 'Einheit Nord' })] },
      aktuellerModulKey: 'einheiten',
    }));
    expect(datensatz[0]?.stufe, 'GLEICHE Stufe wie der Modultreffer').toBe(1);

    expect(ordneTreffer([...datensatz, ...modulTreffer], 'einheit').map((b) => b.id)[0])
      .toBe('modul:einheiten');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Sortenbindung und Nullbarkeit', () => {
  /** PAAR: die negative Hälfte allein wäre auch grün, wenn gar nichts gefunden würde. */
  it('bindet R- an die Person und S- an den Schaden', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42 })],
      schaeden: [schaden({ id: 8, registrier_nr: 42 })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ suche: 'R-042', quellen })))).toEqual(['datensatz:personen:7']);
    expect(ids(baueDatensatzTreffer(kontext({ suche: 'S-042', quellen })))).toEqual(['datensatz:schaeden:8']);
    // Ohne Sortenbuchstaben zählt die Zahl allein — beide Sorten stehen dann da.
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen }))).sort())
      .toEqual(['datensatz:personen:7', 'datensatz:schaeden:8']);
  });

  /**
   * MANV ohne Identität: `name`/`vorname` sind nullbar (Wire), `registrier_nr` ist Pflicht.
   * Genau dafür fällt `personLabel` (chat/bezug.ts) auf die Nummer zurück — der Test pinnt
   * die WIEDERVERWENDUNG statt einer zweiten Label-Wahrheit.
   */
  it('hält eine Person ohne Namen über ihre Nummer auffindbar', () => {
    const t = baueDatensatzTreffer(kontext({
      suche: '42', quellen: { personen: [person({ id: 7, registrier_nr: 42, name: null, vorname: null })] },
    }));
    expect(labels(t)).toEqual(['Personen · R-042']);
  });

  /** `AuftragAnzeige.lfd_nr` ist nullbar (per ADD COLUMN eingeführt); `null` darf nie matchen. */
  it('lässt einen Auftrag ohne lfd. Nr. aus dem Zahlenzweig fallen', () => {
    const mitNr = { auftraege: [auftrag({ id: 7, lfd_nr: 42 })] };
    const ohneNr = { auftraege: [auftrag({ id: 7, lfd_nr: null })] };
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen: mitNr })))).toEqual(['datensatz:auftraege:7']);
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen: ohneNr })))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Auftragszeile trägt ihre lfd. Nr. (Review-Befund zu C).
 *
 * `auftragLabel` (chat/bezug.ts) ist der gekürzte Auftragstext und sonst nichts. Wer die auf
 * Papier stehende Nummer 42 abtippte, bekam „Aufträge/Befehle · Abschnitt erkunden" — die 42
 * stand nirgends in der Antwort, es war nicht nachprüfbar, ob der richtige Auftrag getroffen
 * war. Und zwei Aufträge mit gleichlautendem Text („Lage melden", „Rückmeldung" sind im
 * Betrieb üblich) ergaben zwei ununterscheidbare Zeilen.
 *
 * Die Form ist die von `meldungLabel`/`etbLabel`: `#<nr> · <Text>`.
 */
describe('baueDatensatzTreffer — Auftragszeile', () => {
  it('setzt die lfd. Nr. vor den Auftragstext', () => {
    const t = baueDatensatzTreffer(kontext({
      suche: '42', quellen: { auftraege: [auftrag({ id: 7, lfd_nr: 42, auftrag_text: 'Abschnitt erkunden' })] },
    }));
    expect(labels(t)).toEqual(['Aufträge/Befehle · #42 · Abschnitt erkunden']);
  });

  it('unterscheidet zwei gleichlautende Aufträge', () => {
    const quellen = {
      auftraege: [
        auftrag({ id: 7, lfd_nr: 12, auftrag_text: 'Lage melden' }),
        auftrag({ id: 8, lfd_nr: 13, auftrag_text: 'Lage melden' }),
      ],
    };
    const l = labels(baueDatensatzTreffer(kontext({ suche: 'lage melden', quellen })));
    expect(l).toEqual(['Aufträge/Befehle · #12 · Lage melden', 'Aufträge/Befehle · #13 · Lage melden']);
  });

  /** `AuftragAnzeige.lfd_nr` ist NULLBAR — die Zeile bleibt ohne Nummernteil brauchbar,
   *  statt ein „#null" zu tragen. */
  it('lässt einen Auftrag ohne lfd. Nr. ohne Nummernteil stehen', () => {
    const t = baueDatensatzTreffer(kontext({
      suche: 'lage', quellen: { auftraege: [auftrag({ id: 7, lfd_nr: null, auftrag_text: 'Lage melden' })] },
    }));
    expect(labels(t)).toEqual(['Aufträge/Befehle · Lage melden']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Rechte', () => {
  /** PAAR: „kein Treffer" allein wäre trivial grün, auch wenn der Riegel ALLES verwürfe. */
  it('zeigt Personen-Treffer, solange das Modul freigegeben ist', () => {
    const quellen = { personen: [person({ id: 7, registrier_nr: 42 })] };
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen })))).toEqual(['datensatz:personen:7']);
  });
  it('unterdrückt Personen-Treffer, wenn das Personen-Modul ausgeblendet ist', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42 })],
      schaeden: [schaden({ id: 8, registrier_nr: 42 })],
    };
    const overrides = { personen: ueberschreibung({ modul_key: 'personen', sichtbar: false }) };
    // Der Schaden bleibt — der Riegel wirkt je Modul, nicht global.
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen, overrides })))).toEqual(['datensatz:schaeden:8']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Textzweig und ETB', () => {
  it('filtert die acht Listenquellen lokal per Teilzeichenkette, unabhängig von der Schreibweise', () => {
    const quellen = {
      personal: [personal({ id: 7, name: 'Müller' }), personal({ id: 8, name: 'Schmidt' })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ suche: 'MÜLL', quellen })))).toEqual(['datensatz:personal:7']);
  });

  /**
   * Der ETB-Volltext ist SERVERSEITIG entschieden (`fts_query` über inhalt/von/an/veranlassung).
   * Ein zweiter lokaler Filter über das Label würfe genau die Treffer weg, deren Fundstelle
   * gar nicht im Label steht — der Grund, warum diese Quelle getrennt hereinkommt.
   */
  it('nimmt serverseitig bestätigte ETB-Volltexttreffer ohne zweiten lokalen Filter', () => {
    const t = baueDatensatzTreffer(kontext({
      suche: 'brandschutz',
      quellen: { etbText: [etb({ id: 12, lfd_nr: 99, inhalt: 'Lage erkundet', veranlassung: 'Brandschutz gestellt' })] },
    }));
    expect(ids(t)).toEqual(['datensatz:etb:12']);
  });

  /**
   * `before_lfd_nr` filtert STRIKT `<` bei `ORDER BY lfd_nr DESC` — bei einer Nummernlücke
   * liefert der Cursor den nächstälteren Eintrag. Ohne den Gleichheitsvergleich böte die
   * Palette still den falschen Eintrag an.
   */
  it('verwirft eine Cursor-Antwort, deren lfd. Nr. nicht die gesuchte ist', () => {
    const k = kontext({ suche: '99', quellen: { etbNummer: [etb({ id: 12, lfd_nr: 97 })] } });
    expect(ids(baueDatensatzTreffer(k))).toEqual([]);
  });

  it('führt einen ETB-Eintrag, der in beiden Zweigen steckt, nur einmal', () => {
    const eintrag = etb({ id: 12, lfd_nr: 99 });
    const t = baueDatensatzTreffer(kontext({ suche: '99', quellen: { etbNummer: [eintrag], etbText: [eintrag] } }));
    expect(ids(t)).toEqual(['datensatz:etb:12']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('baueDatensatzTreffer — Deckel, Beschriftung, Leerfall', () => {
  it('deckelt auf fünf Treffer je Entität', () => {
    const personen = Array.from({ length: 9 }, (_, i) => person({ id: i + 1, registrier_nr: i + 1, name: `Müller ${i}` }));
    expect(baueDatensatzTreffer(kontext({ suche: 'müller', quellen: { personen } }))).toHaveLength(5);
  });

  /**
   * Der Nummerntreffer liegt hier in der Quelle, die in der Tabelle ERST NACH drei
   * randvollen Textquellen kommt (Personen, Schäden, Unfallhilfsstellen liefern je fünf).
   * Ohne den Vorrang der Nummerntreffer fiele er dem Gesamtdeckel zum Opfer — mit der
   * Quelle an erster Stelle wäre die Aussage nicht zu verlieren gewesen.
   */
  it('deckelt die Gesamtmenge, ohne den Nummerntreffer zu verlieren', () => {
    const personen = Array.from({ length: 9 }, (_, i) => person({ id: i + 1, registrier_nr: 10 + i, name: 'Nord 4' }));
    const schaeden = Array.from({ length: 9 }, (_, i) => schaden({ id: 40 + i, registrier_nr: 40 + i, ort: 'Nord 4' }));
    const uhsListe = Array.from({ length: 9 }, (_, i) => uhs({ id: 60 + i, bezeichnung: 'Nord 4' }));
    const meldungen = [meldung({ id: 90, lfd_nr: 4, absender: 'Zentrale' })];
    const t = baueDatensatzTreffer(kontext({
      suche: '4', quellen: { personen, schaeden, uhs: uhsListe, meldungen },
    }));
    expect(t).toHaveLength(15);
    expect(ids(t)).toContain('datensatz:meldungen:90');
  });

  /**
   * ERST ORDNEN, DANN DECKELN — der Obermeier-Fall (Review-Befund zu C).
   *
   * Gemessen in einer MANV-Personenliste: fünf „Obermeier" tragen die Suchzeichenkette
   * IRGENDWO im Namen (Stufe 3), der gesuchte „Meier" trägt sie am Wortanfang (Stufe 2).
   * Schnitt der Deckel in LISTENreihenfolge, füllten die fünf Obermeier die Quelle und der
   * Meier fiel heraus — und Nachtippen half nicht, weil 'meier' ebenfalls Teilzeichenkette
   * von 'Obermeier' ist. Der gesuchte Datensatz war über den Namensweg unerreichbar.
   *
   * Der Deckel selbst bleibt bei fünf: geprüft wird, WER hineinkommt, nicht WIE VIELE.
   */
  it('nimmt beim Deckel je Quelle die bessere Stufe, nicht die Listenreihenfolge', () => {
    const personen = [
      ...Array.from({ length: 5 }, (_, i) => person({ id: i + 1, registrier_nr: i + 1, name: 'Obermeier' })),
      person({ id: 6, registrier_nr: 6, name: 'Meier' }),
    ];
    const t = baueDatensatzTreffer(kontext({ suche: 'mei', quellen: { personen } }));
    expect(t, 'der Deckel je Quelle bleibt bei fünf').toHaveLength(5);
    expect(ids(t)[0]).toBe('datensatz:personen:6');
  });

  /**
   * Derselbe Fehler am GESAMTdeckel — der Nord-Fall (Review-Befund zu C).
   *
   * Personen („Nordwind"), Schäden („Nordstr") und Unfallhilfsstellen („BHP Nordplatz")
   * stehen alle auf Stufe 2 und füllen mit je fünf Zeilen die fünfzehn Plätze. Das Fahrzeug
   * „Nord 1" steht auf Stufe 1 — sein Label BEGINNT mit dem Suchwort —, kommt in der
   * Quellentabelle aber erst nach den dreien und erschien deshalb gar nicht.
   */
  it('deckelt die Gesamtmenge nach Stufe, nicht nach Quellenreihenfolge', () => {
    const personen = Array.from({ length: 5 }, (_, i) => person({ id: i + 1, registrier_nr: i + 1, name: 'Nordwind' }));
    const schaeden = Array.from({ length: 5 }, (_, i) => schaden({ id: 20 + i, registrier_nr: 20 + i, ort: 'Nordstr' }));
    const uhsListe = Array.from({ length: 5 }, (_, i) => uhs({ id: 40 + i, bezeichnung: 'BHP Nordplatz' }));
    const fahrzeuge = [fahrzeug({ id: 60, funkrufname: 'Nord 1' })];
    const t = baueDatensatzTreffer(kontext({
      suche: 'nord', quellen: { personen, schaeden, uhs: uhsListe, fahrzeuge },
    }));
    expect(t, 'der Gesamtdeckel bleibt bei fünfzehn').toHaveLength(15);
    expect(ids(t)[0]).toBe('datensatz:fahrzeuge:60');
  });

  /** Die Modulherkunft kommt aus `modulRegistry.label`, nicht aus einer zweiten Namensliste. */
  it('trägt die Modulherkunft im Label', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })],
      uhs: [uhs({ id: 8, bezeichnung: 'BHP Nord', typ: 'behandlungsplatz' })],
      meldungen: [meldung({ id: 9, lfd_nr: 42, absender: 'Leitstelle' })],
    };
    expect(labels(baueDatensatzTreffer(kontext({ suche: '42', quellen }))).sort()).toEqual([
      'Meldungen (eingehend) · #42 · Leitstelle',
      'Personen · R-042 · Müller',
    ]);
    expect(labels(baueDatensatzTreffer(kontext({ suche: 'bhp', quellen }))))
      .toEqual(['Unfallhilfsstellen · BHP Nord (behandlungsplatz)']);
  });

  it('legt jeden Treffer in die Gruppe datensaetze', () => {
    const t = baueDatensatzTreffer(kontext({
      suche: '42',
      quellen: { personen: [person({ id: 7, registrier_nr: 42 })], schaeden: [schaden({ id: 8, registrier_nr: 42 })] },
    }));
    expect(t.map((x) => x.befehl.gruppe)).toEqual(['datensaetze', 'datensaetze']);
  });

  /**
   * Ohne Suchbegriff entstehen KEINE Datensatz-Treffer. Die Startansicht ist kuratiert
   * (LFH-337 · M11); ein leerer Begriff, der jede Liste durchreichte, kippte sie in eine
   * Datenhalde — und der Textzweig würde per `''.includes` ohnehin auf ALLES passen.
   */
  it('liefert bei leerer Suche nichts', () => {
    const quellen = { personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })] };
    expect(baueDatensatzTreffer(kontext({ suche: '   ', quellen }))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die zwei Datensatz-Modi (LFH-391 · C3).
 *
 * DER FILTER STEHT HIER UND NICHT NUR IM HOOK, und der Grund ist gemessen (siehe
 * `useDatensaetze.test.tsx`, „hält die Antwort einer abgeschalteten Query im Cache"):
 * eine `useQuery` mit `enabled: false` FEUERT nicht, LIEFERT aber weiterhin ihre
 * zwischengespeicherte Antwort. Wer erst 'meier' ohne Präfix tippt und dann '@' davorsetzt,
 * hat die Schadensliste längst im Cache — ohne diesen Riegel stünde sie im Kräfte-Modus
 * weiter in der Liste, und der Modus wäre von „wirkungslos" nicht zu unterscheiden.
 *
 * DIE MENGE HINTER '@' IST EINE ENTSCHEIDUNG: Personen, Fahrzeuge, Personal, Einheiten —
 * alles, was einen NAMEN als tragendes Suchmerkmal hat. Die übrigen sechs Quellen tragen
 * einen Sachverhalt (Schaden, Meldung, Auftrag, ETB-Eintrag, Unfallhilfsstelle). Der
 * Funkrufname trägt nur das Fahrzeug, Personal und Einheit tragen `name`, die Person ihren
 * über `personLabel` — „hat einen Namen" ist die einzige Beschreibung dieser Menge, die
 * ohne Ausnahme auskommt. Die Personenliste ist im MANV zugleich die längste; ein Präfix,
 * das gerade sie ausspart, spart dort nichts.
 */
describe('baueDatensatzTreffer — Präfixmodi (LFH-391 · C3)', () => {
  const alleQuellen = {
    personen: [person({ id: 7, registrier_nr: 42, name: 'Nord' })],
    fahrzeuge: [fahrzeug({ id: 3, funkrufname: 'Nord 1' })],
    personal: [personal({ id: 4, name: 'Nord Meier' })],
    einheiten: [einheit({ id: 5, name: 'Nord SEG' })],
    schaeden: [schaden({ id: 8, registrier_nr: 42, ort: 'Nordstr' })],
    meldungen: [meldung({ id: 9, lfd_nr: 42, absender: 'Nord' })],
    uhs: [uhs({ id: 10, bezeichnung: 'Nord BHP' })],
    auftraege: [auftrag({ id: 11, lfd_nr: 42, auftrag_text: 'Nord erkunden' })],
    etbText: [etb({ id: 12, lfd_nr: 99, inhalt: 'Nordabschnitt' })],
  };

  it('liefert unter „@" Person, Fahrzeug, Personal und Einheit', () => {
    const t = baueDatensatzTreffer(kontext({ modus: 'kraefte', suche: 'nord', quellen: alleQuellen }));
    expect(ids(t).sort()).toEqual([
      'datensatz:einheiten:5', 'datensatz:fahrzeuge:3', 'datensatz:personal:4', 'datensatz:personen:7',
    ]);
  });

  /** Die negative Hälfte — und sie ist die tragende: ohne sie wäre auch ein Modus grün,
   *  der gar nicht filtert (unpräfigiert liefert dieselbe Menge und mehr). */
  it('liefert unter „@" keinen Schaden, keine Meldung, keine Unfallhilfsstelle, keinen Auftrag und keinen ETB-Eintrag', () => {
    const t = baueDatensatzTreffer(kontext({ modus: 'kraefte', suche: 'nord', quellen: alleQuellen }));
    expect(ids(t).filter((id) => !/personen|fahrzeuge|personal|einheiten/.test(id))).toEqual([]);
    // Gegenprobe im selben Lauf: ohne Präfix stehen sie sehr wohl da.
    const ohne = ids(baueDatensatzTreffer(kontext({ suche: 'nord', quellen: alleQuellen })));
    expect(ohne).toContain('datensatz:schaeden:8');
    expect(ohne).toContain('datensatz:meldungen:9');
  });

  it('liefert unter „#" nur ETB-Einträge', () => {
    const t = baueDatensatzTreffer(kontext({ modus: 'etb', suche: 'nord', quellen: alleQuellen }));
    expect(ids(t)).toEqual(['datensatz:etb:12']);
  });

  /**
   * `#42` wird von `parsePraefix` zu Modus 'etb' mit Rest '42' zerlegt — der Zahlenzweig
   * sieht die nackte Zahl und fände ohne den Modusriegel jede Person und jede Meldung mit
   * der Nummer 42 mit.
   */
  it('liefert unter „#" keine Person, auch wenn ihre Nummer passt', () => {
    const quellen = {
      personen: [person({ id: 7, registrier_nr: 42, name: 'Müller' })],
      etbNummer: [etb({ id: 12, lfd_nr: 42 })],
    };
    expect(ids(baueDatensatzTreffer(kontext({ modus: 'etb', suche: '42', quellen }))))
      .toEqual(['datensatz:etb:12']);
    // Gegenprobe: ohne Präfix findet dieselbe Zahl beide.
    expect(ids(baueDatensatzTreffer(kontext({ suche: '42', quellen }))).sort())
      .toEqual(['datensatz:etb:12', 'datensatz:personen:7']);
  });

  /** Der `>`-Modus zeigt per Definition nur Aktionen — dort gibt es keine Datensatzzeile,
   *  auch nicht aus einem warmen Cache. */
  it('liefert im Aktionen-Modus gar nichts', () => {
    expect(baueDatensatzTreffer(kontext({ modus: 'aktionen', suche: 'nord', quellen: alleQuellen })))
      .toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Die Riegel an der ANZEIGE (Review-Befunde 4, 5 und 6 zu Etappe C).
 *
 * Sie stehen neben den gleichlautenden am Abruf, weil eine ANSTEHENDE Trefferliste kein
 * Beleg dafür ist, dass die aktuelle Eingabe sie rechtfertigt: `enabled: false` schaltet
 * das Nachladen ab, nicht die Auslieferung, und der Stand, aus dem die Treffer gebaut
 * wurden, hinkt der Eingabe um die Entprellungsfrist hinterher. Hier steht die reine
 * Aussage; wie sie sich in der Palette anfühlt, prüft `CommandPalette.test.tsx`.
 */
describe('etbVolltextMoeglich', () => {
  /**
   * Die Wahrheitstafel von `fts_query` (src/etb/repo.rs), Token für Token: was kein
   * alphanumerisches Zeichen trägt, fällt weg — bleibt nichts übrig, lässt das Backend den
   * MATCH-Filter GANZ weg und antwortet mit den jüngsten Einträgen.
   */
  it.each(['??', '--', '...', '<>', '§$%', '🚒🚑', '  ', ''])('verneint %s', (e) => {
    expect(etbVolltextMoeglich(e)).toBe(false);
  });

  /** Die Gegenhälfte, inklusive der gemischten Eingabe: EIN brauchbares Token genügt. */
  it.each(['brand', '42', '?? brand', 'B-2', 'öl'])('bejaht %s', (e) => {
    expect(etbVolltextMoeglich(e)).toBe(true);
  });
});

describe('sichtbareDatensaetze', () => {
  const treffer = (id: string): Treffer => ({
    befehl: { id, gruppe: 'datensaetze', label: id, ausfuehren: () => {} },
    score: 1,
    stufe: 2,
  });
  const person7 = treffer('datensatz:personen:7');
  const schaden8 = treffer('datensatz:schaeden:8');
  const etb12 = treffer('datensatz:etb:12');
  const sichtbar = (t: Treffer[], modus: PaletteModus, rest: string) =>
    sichtbareDatensaetze(t, modus, rest).map((x) => x.befehl.id);

  /**
   * BEFUND 4 als PAAR: derselbe anstehende Treffer, einmal unter der Schwelle und einmal
   * darüber. Die zweite Hälfte ist nötig, sonst wäre auch eine Funktion grün, die immer
   * leer liefert — und der Finder damit tot.
   */
  it('hält anstehende Treffer unter zwei Zeichen zurück, ab zwei Zeichen nicht', () => {
    expect(sichtbar([person7], 'kraefte', 'm')).toEqual([]);
    expect(sichtbar([person7], 'kraefte', 'me')).toEqual(['datensatz:personen:7']);
  });

  /** BEFUND 5: der Aktionen-Modus führt keine einzige Quelle — dort ist die Menge leer. */
  it('verwirft im Aktionen-Modus jeden anstehenden Treffer', () => {
    expect(sichtbar([person7, etb12], 'aktionen', 'meier')).toEqual([]);
  });

  /**
   * Und dieselbe Achse zwischen zwei Datensatz-Modi: gefiltert wird über die QUELLENMENGE,
   * nicht über „zeigt dieser Modus überhaupt Datensätze". Ohne das überlebte ein Nachläufer
   * den Wechsel '@' → '#'.
   */
  it('lässt je Modus genau die Quellen des Modus stehen', () => {
    const alle = [person7, schaden8, etb12];
    expect(sichtbar(alle, 'kraefte', 'meier')).toEqual(['datensatz:personen:7']);
    expect(sichtbar(alle, 'etb', 'meier')).toEqual(['datensatz:etb:12']);
    expect(sichtbar(alle, 'alles', 'meier')).toEqual(alle.map((t) => t.befehl.id));
  });

  /**
   * BEFUND 6 an der Anzeige: der ETB-Nachläufer fällt bei rein nicht-alphanumerischer
   * Eingabe weg, die übrigen Quellen NICHT — '??' kann als Teilzeichenkette sehr wohl in
   * einem Ortsnamen oder einem Meldungstext stehen, dort ist der Treffer bestätigt.
   */
  it('verwirft den ETB-Nachläufer ohne alphanumerisches Token, die übrigen Quellen nicht', () => {
    expect(sichtbar([person7, etb12], 'alles', '??')).toEqual(['datensatz:personen:7']);
    expect(sichtbar([person7, etb12], 'alles', 'no')).toEqual([
      'datensatz:personen:7', 'datensatz:etb:12',
    ]);
  });
});
