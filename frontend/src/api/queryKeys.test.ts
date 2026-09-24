import { describe, expect, it } from 'vitest';
import { ZAEHLER_LISTEN_KEYS } from '../einsatz/useModulZaehler';
import {
  EINSATZ_KEYS,
  EINSATZ_STREAM_EVENTS,
  einsatzKeys,
  istRueckmeldungenKey,
} from './queryKeys';

// LFH-122: Das deklarative Event→Keys-Registry ist die EINE Quelle, aus der
// useEinsatzLiveStream Listener, Invalidierung und den lagged-Vollabgleich ableitet.
// Diese Tests pinnen die Zuordnung, damit ein neues Live-Modul = ein Map-Eintrag bleibt.

describe('EINSATZ_KEYS', () => {
  it('trägt wire-korrekte Prefix-Strings (erstes Query-Key-Element)', () => {
    expect(EINSATZ_KEYS.uhs).toBe('einsatz-uhs');
    expect(EINSATZ_KEYS.personen).toBe('einsatz-personen');
    expect(EINSATZ_KEYS.gefahrengebiete).toBe('gefahrengebiete');
    expect(EINSATZ_KEYS.gefahrenmatrix).toBe('gefahrenmatrix');
    expect(EINSATZ_KEYS.br).toBe('einsatz-br');
    expect(EINSATZ_KEYS.brDetail).toBe('einsatz-br-detail');
    // LFH-46: als HANDGESCHRIEBENES Literal, nicht über `EINSATZ_KEYS.stab` — sonst prüfte
    // der Pin die Konstante gegen sich selbst. Ein geänderter Query-Key bricht nichts, er
    // trifft still ein anderes Cache-Fach: kein Fehler, kein roter Test, kein auffälliger
    // Request. Der Byte-Pin ist die einzige Stelle, die das bemerkt.
    expect(EINSATZ_KEYS.stab).toBe('einsatz-stab');
    expect(EINSATZ_KEYS.modulZaehler).toBe('einsatz-modul-zaehler');
    // LFH-632: ebenfalls als Literal gepinnt.
    expect(EINSATZ_KEYS.dokumente).toBe('einsatz-dokumente');
    // LFH-635: handgeschriebenes Literal, nicht über EINSATZ_KEYS.
    expect(EINSATZ_KEYS.abloesungen).toBe('einsatz-abloesungen');
    // LFH-639: handgeschriebenes Literal, nicht über EINSATZ_KEYS.
    expect(EINSATZ_KEYS.betreuung).toBe('einsatz-betreuung');
    // LFH-634: handgeschriebenes Literal, nicht über EINSATZ_KEYS.
    expect(EINSATZ_KEYS.verpflegung).toBe('einsatz-verpflegung');
  });
});

describe('EINSATZ_STREAM_EVENTS (LFH-122)', () => {
  // F01/LFH-227: `person` und `personal` sind getrennte Wire-Events. Vorher trug EIN
  // `person`-Tag beide ID-Räume (betroffene Person vs. einsatz_personal-Disposition) und
  // musste deshalb ×5 fan-outen; getrennt kann das Backend die Module getrennt gaten.
  it('bildet person nur auf die Personen-Registrierung ab', () => {
    expect(EINSATZ_STREAM_EVENTS.person).toEqual([
      EINSATZ_KEYS.personen,
      EINSATZ_KEYS.modulZaehler,
    ]);
  });

  it('bildet personal auf den Dispositions-Fan-out in exakter Reihenfolge ab', () => {
    expect(EINSATZ_STREAM_EVENTS.personal).toEqual([
      EINSATZ_KEYS.personal,
      EINSATZ_KEYS.einheiten,
      EINSATZ_KEYS.abschnitte,
      EINSATZ_KEYS.fuehrungskraefte,
      EINSATZ_KEYS.modulZaehler,
    ]);
  });

  it('fahrzeug invalidiert auch die Einheiten — deren Status ist aus den Fahrzeugen abgeleitet (LFH-609)', () => {
    expect(EINSATZ_STREAM_EVENTS.fahrzeug).toEqual([
      EINSATZ_KEYS.fahrzeuge,
      EINSATZ_KEYS.einheiten,
      // Die Einheitenliste ist eine gezählte Menge (LFH-612) — wer sie invalidiert, zieht
      // den Modulzähler mit.
      EINSATZ_KEYS.modulZaehler,
    ]);
  });

  it('bildet einheit auf den ×6-Fan-out in exakter Reihenfolge ab', () => {
    expect(EINSATZ_STREAM_EVENTS.einheit).toEqual([
      EINSATZ_KEYS.einheiten,
      EINSATZ_KEYS.fuehrungskraefte,
      EINSATZ_KEYS.personal,
      EINSATZ_KEYS.fahrzeuge,
      EINSATZ_KEYS.material,
      EINSATZ_KEYS.modulZaehler,
      // LFH-635: Einheitsname und Auflösung wirken auf die Ablösungsschichten.
      EINSATZ_KEYS.abloesungen,
    ]);
  });

  it('bildet abschnitt auf Abschnitte, Führungskräfte, Modulzähler, Ablösung und Betreuung ab (LFH-612/635/639)', () => {
    // Ohne Guard (design.md D10 a): Bezirke und Stellen tragen den Abschnittsnamen per Join.
    // Umbenennen oder Löschen eines Abschnitts feuert nur `abschnitt` — fehlt die Betreuung
    // hier, zeigt die Seite still den alten Namen.
    expect(EINSATZ_STREAM_EVENTS.abschnitt).toEqual([
      EINSATZ_KEYS.abschnitte,
      EINSATZ_KEYS.fuehrungskraefte,
      EINSATZ_KEYS.modulZaehler,
      EINSATZ_KEYS.abloesungen,
      EINSATZ_KEYS.betreuung,
    ]);
  });

  it('bildet die 1:1-Events auf genau einen Key ab', () => {
    expect(EINSATZ_STREAM_EVENTS.uhs).toEqual([EINSATZ_KEYS.uhs]);
    expect(EINSATZ_STREAM_EVENTS.schaden).toEqual([EINSATZ_KEYS.schaeden]);
    expect(EINSATZ_STREAM_EVENTS.tier).toEqual([EINSATZ_KEYS.tiere]);
    expect(EINSATZ_STREAM_EVENTS.karte_bild).toEqual([EINSATZ_KEYS.kartenbilder]);
    // LFH-634 (design.md D6): das DTO trägt keine Nachforderungsdaten, also kein Fan-out.
    expect(EINSATZ_STREAM_EVENTS.verpflegung).toEqual([EINSATZ_KEYS.verpflegung]);
  });

  it('bildet die Cross-Modul-Fan-outs korrekt ab', () => {
    expect(EINSATZ_STREAM_EVENTS.lage_zone).toEqual([
      EINSATZ_KEYS.zonen,
      EINSATZ_KEYS.gefahrengebiete,
    ]);
    expect(EINSATZ_STREAM_EVENTS.gefahr).toEqual([
      EINSATZ_KEYS.gefahrenmatrix,
      EINSATZ_KEYS.gefahrengebiete,
    ]);
    expect(EINSATZ_STREAM_EVENTS.meldung).toEqual([
      EINSATZ_KEYS.meldungen,
      EINSATZ_KEYS.lagemeldungen,
      EINSATZ_KEYS.modulZaehler,
    ]);
    expect(EINSATZ_STREAM_EVENTS.bereitstellungsraum).toEqual([
      EINSATZ_KEYS.br,
      EINSATZ_KEYS.brDetail,
    ]);
  });

  it('mappt jedes Wire-Event auf mindestens einen Key', () => {
    for (const [ev, keys] of Object.entries(EINSATZ_STREAM_EVENTS)) {
      expect(keys.length, ev).toBeGreaterThan(0);
    }
  });

  // LFH-612: Vollständigkeit ist eine REGEL, keine Liste. Wer die Liste eines gezählten
  // Moduls invalidiert, hat eine gezählte Menge verändert — ohne den Modulzähler stünde im
  // Navigationsrahmen still eine alte Zahl. Die gezählten Listen-Keys kommen aus dem Hook
  // selbst (`ZAEHLER_LISTEN_KEYS`), nicht aus einer Kopie hier.
  it('invalidiert den Modulzähler bei jedem Ereignis, das eine gezählte Liste invalidiert', () => {
    const gezaehlt = new Set<string>(Object.values(ZAEHLER_LISTEN_KEYS));
    const betroffen = Object.entries(EINSATZ_STREAM_EVENTS).filter(([, keys]) =>
      (keys as readonly string[]).some((k) => gezaehlt.has(k)),
    );
    // Gegenprobe gegen eine leere Menge — sonst wäre die Schleife trivial grün.
    expect(betroffen.map(([ev]) => ev)).toEqual(
      expect.arrayContaining([
        'etb',
        'person',
        'einheit',
        // Seit LFH-609 leitet sich der Einheitenstatus aus den Fahrzeugen ab: das
        // `fahrzeug`-Ereignis invalidiert die Einheitenliste und damit eine gezählte Menge.
        'fahrzeug',
        'abschnitt',
        'meldung',
        'auftrag',
        'erinnerung',
        'chat',
      ]),
    );
    for (const [ev, keys] of betroffen) {
      expect(keys, ev).toContain(EINSATZ_KEYS.modulZaehler);
    }
  });

  it('enthält KEIN sofortmeldung (Seiteneffekt) und KEIN lagged (abgeleitet)', () => {
    expect(EINSATZ_STREAM_EVENTS).not.toHaveProperty('sofortmeldung');
    expect(EINSATZ_STREAM_EVENTS).not.toHaveProperty('lagged');
  });
});

// LFH-122: Factory-Output-Tests — die Migrations-Sicherung. Jede Funktion muss ihren
// exakten Key liefern; ein falscher Shape hier = stille tote Invalidierung im Produktivcode.
describe('einsatzKeys (Factory-Output)', () => {
  it('baut die 2-elementigen Listen-/Prefix-Keys als [prefix, einsatzId]', () => {
    expect(einsatzKeys.einsatz(1)).toEqual(['einsatz', 1]);
    expect(einsatzKeys.einstellungen(1)).toEqual(['einsatz-einstellungen', 1]);
    expect(einsatzKeys.mitglieder(1)).toEqual(['einsatz-mitglieder', 1]);
    expect(einsatzKeys.sprechgruppen(1)).toEqual(['einsatz-sprechgruppen', 1]);
    expect(einsatzKeys.personen(1)).toEqual(['einsatz-personen', 1]);
    expect(einsatzKeys.personal(1)).toEqual(['einsatz-personal', 1]);
    expect(einsatzKeys.fuehrungskraefte(1)).toEqual(['einsatz-fuehrungskraefte', 1]);
    expect(einsatzKeys.einheiten(1)).toEqual(['einsatz-einheiten', 1]);
    expect(einsatzKeys.abschnitte(1)).toEqual(['einsatz-abschnitte', 1]);
    expect(einsatzKeys.fahrzeuge(1)).toEqual(['einsatz-fahrzeuge', 1]);
    expect(einsatzKeys.material(1)).toEqual(['einsatz-material', 1]);
    expect(einsatzKeys.uhs(1)).toEqual(['einsatz-uhs', 1]);
    expect(einsatzKeys.schaeden(1)).toEqual(['einsatz-schaeden', 1]);
    expect(einsatzKeys.tiere(1)).toEqual(['einsatz-tiere', 1]);
    expect(einsatzKeys.zonen(1)).toEqual(['einsatz-zonen', 1]);
    expect(einsatzKeys.gefahrengebiete(1)).toEqual(['gefahrengebiete', 1]);
    expect(einsatzKeys.lageberichte(1)).toEqual(['einsatz-lageberichte', 1]);
    expect(einsatzKeys.kartenbilder(1)).toEqual(['einsatz-kartenbilder', 1]);
    expect(einsatzKeys.br(1)).toEqual(['einsatz-br', 1]);
    expect(einsatzKeys.befehle(1)).toEqual(['einsatz-befehle', 1]);
    expect(einsatzKeys.chatKanaele(1)).toEqual(['einsatz-chat-kanaele', 1]);
    expect(einsatzKeys.chatNachrichten(1)).toEqual(['einsatz-chat-nachrichten', 1]);
    expect(einsatzKeys.erinnerungen(1)).toEqual(['einsatz-erinnerungen', 1]);
    expect(einsatzKeys.meldungen(1)).toEqual(['einsatz-meldungen', 1]);
    expect(einsatzKeys.lagemeldungen(1)).toEqual(['einsatz-lagemeldungen', 1]);
    expect(einsatzKeys.auftraege(1)).toEqual(['einsatz-auftraege', 1]);
    expect(einsatzKeys.nachforderungen(1)).toEqual(['einsatz-nachforderungen', 1]);
    expect(einsatzKeys.etb(1)).toEqual(['etb', 1]);
    expect(einsatzKeys.stab(1)).toEqual(['einsatz-stab', 1]);
    expect(einsatzKeys.dokumente(1)).toEqual(['einsatz-dokumente', 1]);
    expect(einsatzKeys.pegel(1)).toEqual(['einsatz-pegel', 1]);
    expect(einsatzKeys.pegelVorhersage(1, 7)).toEqual(['einsatz-pegel', 1, 'vorhersage', 7]);
    // LFH-633: Verlauf als Sub-Key des Pegel-Prefix, Wetter als eigener Prefix.
    expect(einsatzKeys.pegelVerlauf(1)).toEqual(['einsatz-pegel', 1, 'verlauf']);
    expect(einsatzKeys.wetter(1)).toEqual(['einsatz-wetter', 1]);
  });

  it('baut die 3-elementigen Detail-Keys als [prefix, einsatzId, id]', () => {
    expect(einsatzKeys.person(1, 2)).toEqual(['einsatz-person', 1, 2]);
    // null reicht unverändert durch (enabled-Guard-Queries; wie das bisherige Inline-Literal):
    expect(einsatzKeys.person(1, null)).toEqual(['einsatz-person', 1, null]);
    expect(einsatzKeys.einsatz(null)).toEqual(['einsatz', null]);
    expect(einsatzKeys.modulOverrides(1)).toEqual(['einsatz-modul-overrides', 1]);
    // null wie bei `einsatz`: das Command-Palette lädt nur im Einsatzkontext (enabled-Guard).
    expect(einsatzKeys.modulOverrides(null)).toEqual(['einsatz-modul-overrides', null]);
    expect(einsatzKeys.personAudit(1, 2)).toEqual(['einsatz-person-audit', 1, 2]);
    expect(einsatzKeys.uhsDetail(1, 2)).toEqual(['einsatz-uhs-detail', 1, 2]);
    expect(einsatzKeys.schaden(1, 2)).toEqual(['einsatz-schaden', 1, 2]);
    expect(einsatzKeys.tier(1, 2)).toEqual(['einsatz-tier', 1, 2]);
    expect(einsatzKeys.brDetail(1, 2)).toEqual(['einsatz-br-detail', 1, 2]);
    expect(einsatzKeys.befehl(1, 2)).toEqual(['einsatz-befehl', 1, 2]);
    expect(einsatzKeys.lagebericht(1, 2)).toEqual(['einsatz-lagebericht', 1, 2]);
  });

  it('baut die variadischen Filter-/Kontext-Keys exakt wie die bisherigen Inline-Literale', () => {
    expect(einsatzKeys.gefahrenmatrix(1, 7)).toEqual(['gefahrenmatrix', 1, 7]);
    expect(einsatzKeys.gefahrenmatrix(1, null)).toEqual(['gefahrenmatrix', 1, null]);
    expect(einsatzKeys.chatNachrichtenKanal(1, 5)).toEqual(['einsatz-chat-nachrichten', 1, 5]);
    expect(einsatzKeys.chatNachrichtenKanal(1, null)).toEqual([
      'einsatz-chat-nachrichten',
      1,
      null,
    ]);
    expect(einsatzKeys.meldungenListe(1, 'alle')).toEqual(['einsatz-meldungen', 1, 'alle']);
    expect(einsatzKeys.meldungenListe(1, 'eingehend')).toEqual([
      'einsatz-meldungen',
      1,
      'eingehend',
    ]);
    expect(einsatzKeys.auftraegeListe(1, 'alle', 'alle')).toEqual([
      'einsatz-auftraege',
      1,
      'alle',
      'alle',
    ]);
    expect(einsatzKeys.tiereHalter(1, 2)).toEqual(['einsatz-tiere', 1, 'halter', 2]);
    expect(einsatzKeys.schaedenGeschaedigt(1, 2)).toEqual([
      'einsatz-schaeden',
      1,
      'geschaedigt',
      2,
    ]);
    // LFH-543: Sub-Key UNTER dem Stab-Prefix — das `stab`-Ereignis invalidiert ihn mit.
    // Als Literal gepinnt: ein geänderter Key bricht nichts, er trifft still ein anderes Fach.
    expect(einsatzKeys.stabLagebesprechungen(1)).toEqual(['einsatz-stab', 1, 'lagebesprechungen']);
    // LFH-635: Liste und Vorgaben UNTER dem Ablösungs-Prefix — das `abloesung`-Ereignis trifft beide.
    expect(einsatzKeys.abloesungen(1)).toEqual(['einsatz-abloesungen', 1]);
    expect(einsatzKeys.abloesungListe(1, 'laufend')).toEqual([
      'einsatz-abloesungen',
      1,
      'liste',
      'laufend',
    ]);
    expect(einsatzKeys.abloesungVorgaben(1)).toEqual(['einsatz-abloesungen', 1, 'vorgaben']);
    // LFH-639: Betreuungs-Prefix als Literal gepinnt.
    expect(einsatzKeys.betreuung(1)).toEqual(['einsatz-betreuung', 1]);
    // LFH-639: Kopfzahl UNTER dem Betreuungs-Prefix — das `betreuung`-Ereignis trifft sie mit.
    // Der Stichtag ist der Wire-String (UTC ohne Zonenkennung), kein Objekt.
    expect(einsatzKeys.betreuungKopfzahl(1, '2026-09-23 12:00:00')).toEqual([
      'einsatz-betreuung',
      1,
      'kopfzahl',
      '2026-09-23 12:00:00',
    ]);
    // Ohne Stichtag („jetzt“) ein fester Platzhalter statt eines sekundengenauen Zeitstempels —
    // sonst entstünde bei jedem Rendern ein neuer Key und damit ein neuer Abruf.
    expect(einsatzKeys.betreuungKopfzahl(1)).toEqual(['einsatz-betreuung', 1, 'kopfzahl', 'jetzt']);
    // LFH-634: Verpflegungs-Prefix als Literal gepinnt.
    expect(einsatzKeys.verpflegung(1)).toEqual(['einsatz-verpflegung', 1]);
    expect(einsatzKeys.etbListe(1, { typ: 'x' })).toEqual(['etb', 1, { typ: 'x' }]);
    // LFH-611: Lesemarke UNTER dem ETB-Prefix — das `etb`-Ereignis invalidiert sie mit.
    expect(einsatzKeys.etbLesemarke(1)).toEqual(['etb', 1, 'lesemarke']);
    // LFH-612: Zählung UNTER dem ETB-Prefix, mit Filter im Key — das `etb`-Ereignis zieht sie mit.
    expect(einsatzKeys.etbZaehler(1, { q: 'x' })).toEqual(['etb', 1, 'zaehler', { q: 'x' }]);
    expect(einsatzKeys.modulZaehler(1)).toEqual(['einsatz-modul-zaehler', 1]);
    // Die gerundeten Koordinaten sind Teil des Keys — Cache-Trefferquote hängt daran.
    expect(einsatzKeys.ortVorschau(1, 52.123, 13.456, 'uhs:5')).toEqual([
      'ort-vorschau',
      1,
      52.123,
      13.456,
      'uhs:5',
    ]);
    expect(einsatzKeys.ortVorschau(1, null, null, null)).toEqual([
      'ort-vorschau',
      1,
      null,
      null,
      null,
    ]);
  });

  it('deckt jeden EINSATZ_KEYS-Prefix mit mindestens einer Factory-Funktion ab', () => {
    const abgedeckt = new Set(
      Object.values(einsatzKeys).map(
        (fn) => (fn as unknown as (...a: unknown[]) => unknown[])(1, 1)[0],
      ),
    );
    for (const prefix of Object.values(EINSATZ_KEYS)) {
      expect(abgedeckt, `kein Factory-Eintrag für Prefix ${prefix}`).toContain(prefix);
    }
  });
});

describe('istRueckmeldungenKey (LFH-610)', () => {
  it('trifft die Rückmeldungen jedes Einsatzes, aber keine Meldungsliste', () => {
    expect(istRueckmeldungenKey(['einsatz-meldungen', 7, 'rueckmeldungen'])).toBe(true);
    expect(istRueckmeldungenKey(['einsatz-meldungen', 7, 'intern'])).toBe(false);
    expect(istRueckmeldungenKey(['einsatz-meldungen', 7])).toBe(false);
    expect(istRueckmeldungenKey(['einsatz-auftraege', 7, 'rueckmeldungen'])).toBe(false);
    expect(einsatzKeys.meldungenRueckmeldungen(7)).toEqual([
      'einsatz-meldungen',
      7,
      'rueckmeldungen',
    ]);
  });
});
