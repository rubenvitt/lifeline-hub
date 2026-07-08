import { describe, expect, it } from 'vitest';
import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS } from './queryKeys';

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
  it('bildet person auf den ×5-Fan-out in exakter Reihenfolge ab', () => {
    expect(EINSATZ_STREAM_EVENTS.person).toEqual([
      EINSATZ_KEYS.personen,
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
