import { describe, expect, it } from 'vitest';
import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS, einsatzKeys } from './queryKeys';

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
  });
});

describe('EINSATZ_STREAM_EVENTS (LFH-122)', () => {
  // F01/LFH-227: `person` und `personal` sind getrennte Wire-Events. Vorher trug EIN
  // `person`-Tag beide ID-Räume (betroffene Person vs. einsatz_personal-Disposition) und
  // musste deshalb ×5 fan-outen; getrennt kann das Backend die Module getrennt gaten.
  it('bildet person nur auf die Personen-Registrierung ab', () => {
    expect(EINSATZ_STREAM_EVENTS.person).toEqual([EINSATZ_KEYS.personen]);
  });

  it('bildet personal auf den Dispositions-Fan-out in exakter Reihenfolge ab', () => {
    expect(EINSATZ_STREAM_EVENTS.personal).toEqual([
      EINSATZ_KEYS.personal,
      EINSATZ_KEYS.einheiten,
      EINSATZ_KEYS.abschnitte,
      EINSATZ_KEYS.fuehrungskraefte,
    ]);
  });

  it('bildet einheit auf den ×5-Fan-out in exakter Reihenfolge ab', () => {
    expect(EINSATZ_STREAM_EVENTS.einheit).toEqual([
      EINSATZ_KEYS.einheiten,
      EINSATZ_KEYS.fuehrungskraefte,
      EINSATZ_KEYS.personal,
      EINSATZ_KEYS.fahrzeuge,
      EINSATZ_KEYS.material,
    ]);
  });

  it('bildet die 1:1-Events auf genau einen Key ab', () => {
    expect(EINSATZ_STREAM_EVENTS.uhs).toEqual([EINSATZ_KEYS.uhs]);
    expect(EINSATZ_STREAM_EVENTS.schaden).toEqual([EINSATZ_KEYS.schaeden]);
    expect(EINSATZ_STREAM_EVENTS.tier).toEqual([EINSATZ_KEYS.tiere]);
    expect(EINSATZ_STREAM_EVENTS.karte_bild).toEqual([EINSATZ_KEYS.kartenbilder]);
  });

  it('bildet die Cross-Modul-Fan-outs korrekt ab', () => {
    expect(EINSATZ_STREAM_EVENTS.lage_zone).toEqual([EINSATZ_KEYS.zonen, EINSATZ_KEYS.gefahrengebiete]);
    expect(EINSATZ_STREAM_EVENTS.gefahr).toEqual([EINSATZ_KEYS.gefahrenmatrix, EINSATZ_KEYS.gefahrengebiete]);
    expect(EINSATZ_STREAM_EVENTS.meldung).toEqual([EINSATZ_KEYS.meldungen, EINSATZ_KEYS.lagemeldungen]);
    expect(EINSATZ_STREAM_EVENTS.bereitstellungsraum).toEqual([EINSATZ_KEYS.br, EINSATZ_KEYS.brDetail]);
  });

  it('mappt jedes Wire-Event auf mindestens einen Key', () => {
    for (const [ev, keys] of Object.entries(EINSATZ_STREAM_EVENTS)) {
      expect(keys.length, ev).toBeGreaterThan(0);
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
  });

  it('baut die 3-elementigen Detail-Keys als [prefix, einsatzId, id]', () => {
    expect(einsatzKeys.person(1, 2)).toEqual(['einsatz-person', 1, 2]);
    // null reicht unverändert durch (enabled-Guard-Queries; wie das bisherige Inline-Literal):
    expect(einsatzKeys.person(1, null)).toEqual(['einsatz-person', 1, null]);
    expect(einsatzKeys.einsatz(null)).toEqual(['einsatz', null]);
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
    expect(einsatzKeys.chatNachrichtenKanal(1, null)).toEqual(['einsatz-chat-nachrichten', 1, null]);
    expect(einsatzKeys.meldungenListe(1, 'alle')).toEqual(['einsatz-meldungen', 1, 'alle']);
    expect(einsatzKeys.meldungenListe(1, 'eingehend')).toEqual(['einsatz-meldungen', 1, 'eingehend']);
    expect(einsatzKeys.auftraegeListe(1, 'alle', 'alle')).toEqual(['einsatz-auftraege', 1, 'alle', 'alle']);
    expect(einsatzKeys.tiereHalter(1, 2)).toEqual(['einsatz-tiere', 1, 'halter', 2]);
    expect(einsatzKeys.schaedenGeschaedigt(1, 2)).toEqual(['einsatz-schaeden', 1, 'geschaedigt', 2]);
    expect(einsatzKeys.etbListe(1, { typ: 'x' })).toEqual(['etb', 1, { typ: 'x' }]);
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
