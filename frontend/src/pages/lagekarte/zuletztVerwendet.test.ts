import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { serializeAnySpec } from '@einsatzzeichen/core';
import type { AnySpec } from '@einsatzzeichen/schema';
import type { FreiesZeichenUpdate } from '../../api/types';
import { freiesZeichen } from '../../zeichen/freiesZeichen';
import {
  ZULETZT_MAX,
  abonniereZuletztVerwendet,
  leseZuletztVerwendet,
  merkeZuletztVerwendet,
} from './zuletztVerwendet';

// Das globale afterEach räumt localStorage; hier zusätzlich vor jedem Test, damit die Reihenfolge
// der Dateien keine Rolle spielt.
beforeEach(() => localStorage.clear());

const V2 = 'lfh:lagekarte:zeichen-zuletzt-v2';
const ALT = 'lfh:lagekarte:zeichen-zuletzt';

const spec = (s: AnySpec) => serializeAnySpec(s);
const wert = (s: AnySpec, rest: Partial<FreiesZeichenUpdate> = {}): FreiesZeichenUpdate => ({
  zeichen_spec: spec(s),
  ...rest,
});

describe('zuletztVerwendet — Reihenfolge und Deckel', () => {
  it('liefert leer, solange nichts gemerkt wurde', () => {
    expect(leseZuletztVerwendet()).toEqual([]);
  });

  it('stellt das jüngste nach vorn', () => {
    merkeZuletztVerwendet(wert({ kind: 'person' }));
    merkeZuletztVerwendet(wert({ kind: 'hazard' }));
    merkeZuletztVerwendet(wert({ kind: 'vehicle-land' }));
    expect(leseZuletztVerwendet()).toEqual([
      spec({ kind: 'vehicle-land' }),
      spec({ kind: 'hazard' }),
      spec({ kind: 'person' }),
    ]);
  });

  it('legt ein erneut benutztes Zeichen nicht doppelt ab, sondern hebt es nach vorn', () => {
    merkeZuletztVerwendet(wert({ kind: 'person' }));
    merkeZuletztVerwendet(wert({ kind: 'hazard' }));
    merkeZuletztVerwendet(wert({ kind: 'person' }));
    expect(leseZuletztVerwendet()).toEqual([spec({ kind: 'person' }), spec({ kind: 'hazard' })]);
  });

  it('unterscheidet Zeichen, die sich nur in einem Merkmal unterscheiden', () => {
    merkeZuletztVerwendet(wert({ kind: 'person', bodyMarks: ['fire-fighting'] }));
    merkeZuletztVerwendet(wert({ kind: 'person', bodyMarks: ['medical-service'] }));
    expect(leseZuletztVerwendet()).toHaveLength(2);
  });

  it(`hält höchstens ${ZULETZT_MAX} und wirft das älteste weg`, () => {
    const sieben: AnySpec[] = [
      { kind: 'person' },
      { kind: 'hazard' },
      { kind: 'vehicle-land' },
      { kind: 'formation' },
      { kind: 'event' },
      { kind: 'circle-12' },
      { kind: 'building' },
    ];
    for (const s of sieben) merkeZuletztVerwendet(wert(s));
    const liste = leseZuletztVerwendet();
    // Sechs als Literal, nicht `ZULETZT_MAX`: aus der geprüften Konstante gelesen prüfte die Zeile
    // sich selbst.
    expect(liste).toHaveLength(6);
    expect(ZULETZT_MAX).toBe(6);
    expect(liste[0]).toBe(spec({ kind: 'building' }));
    // Das älteste ist raus: das Neue verdrängt das Alte, statt selbst abgewiesen zu werden.
    expect(liste).not.toContain(spec({ kind: 'person' }));
  });
});

describe('zuletztVerwendet — was gemerkt wird', () => {
  it('merkt das ZEICHEN, nicht die einzelne Platzierung (kein Name, keine Ansicht, kein Ort)', () => {
    merkeZuletztVerwendet({
      ...wert({ kind: 'person' }, { label: 'EA Nord', ansicht_id: 7 }),
      lat: 50.1,
      lon: 8.6,
    } as FreiesZeichenUpdate);
    expect(JSON.parse(localStorage.getItem(V2)!)).toEqual([{ spec: spec({ kind: 'person' }) }]);
  });

  it('zählt zwei gleich gezeichnete Platzierungen mit verschiedenem Namen als EIN Eintrag', () => {
    merkeZuletztVerwendet(wert({ kind: 'person' }, { label: 'EA Nord' }));
    merkeZuletztVerwendet(wert({ kind: 'person' }, { label: 'EA Süd' }));
    expect(leseZuletztVerwendet()).toHaveLength(1);
  });

  it('behält die Farbe — sie gehört zum Zeichen (in der Spec)', () => {
    merkeZuletztVerwendet(wert({ kind: 'hazard', technicalFill: 'rot' }));
    expect(leseZuletztVerwendet()).toEqual([spec({ kind: 'hazard', technicalFill: 'rot' })]);
  });

  it('legt eine gleichwertige Spec kanonisch ab (Feldreihenfolge zählt nicht)', () => {
    merkeZuletztVerwendet({
      zeichen_spec: '{"v":1,"spec":{"organization":"thw","kind":"person"}}',
    });
    merkeZuletztVerwendet({
      zeichen_spec: '{"v":1,"spec":{"kind":"person","organization":"thw"}}',
    });
    expect(leseZuletztVerwendet()).toEqual([spec({ kind: 'person', organization: 'thw' })]);
  });
});

// D10: Die Leiste der Zeit vor der Umstellung wird beim ersten Lesen über den Leseadapter
// übernommen, in Reihenfolge; der alte Schlüssel ist danach weg.
describe('zuletztVerwendet — Übernahme der alten Leiste (D10)', () => {
  it('übernimmt Alteinträge in derselben Reihenfolge als Zeichen nach neuer Darstellung', () => {
    const alt = [
      { grundzeichen: 'gefahr', farbe: '#cc0000' },
      { grundzeichen: 'person', fachaufgabe: 'brandbekaempfung' },
      { grundzeichen: 'taktische-formation', einheit: 'zug', organisation: 'thw' },
    ];
    localStorage.setItem(ALT, JSON.stringify(alt));
    expect(leseZuletztVerwendet()).toEqual(alt.map((a) => serializeAnySpec(freiesZeichen(a).spec)));
    // Geschrieben unter v2, der alte Schlüssel gelöscht.
    expect(localStorage.getItem(ALT)).toBeNull();
    expect(JSON.parse(localStorage.getItem(V2)!)).toHaveLength(3);
  });

  it('lässt einen nicht übersetzbaren Alteintrag fallen, ohne die übrigen zu verlieren', () => {
    localStorage.setItem(
      ALT,
      JSON.stringify([
        { grundzeichen: 'person' },
        // Unbekanntes Symbol: nur der Platzhalter, kein Zeichen der Person.
        { grundzeichen: 'ohne', symbol: 'gibt-es-nicht' },
        { farbe: '#000' },
        42,
        { grundzeichen: 'gibt-es-nicht' },
        { grundzeichen: 'gefahr' },
      ]),
    );
    expect(leseZuletztVerwendet()).toEqual([spec({ kind: 'person' }), spec({ kind: 'hazard' })]);
  });

  it('übernimmt nur einmal: v2 gewinnt, wenn beide da sind', () => {
    localStorage.setItem(V2, JSON.stringify([{ spec: spec({ kind: 'event' }) }]));
    localStorage.setItem(ALT, JSON.stringify([{ grundzeichen: 'person' }]));
    expect(leseZuletztVerwendet()).toEqual([spec({ kind: 'event' })]);
  });

  it('räumt eine kaputte alte Leiste ab und liefert leer', () => {
    localStorage.setItem(ALT, '{kein json');
    expect(leseZuletztVerwendet()).toEqual([]);
    expect(localStorage.getItem(ALT)).toBeNull();
  });
});

describe('zuletztVerwendet — Speicher kann fehlen oder Unsinn tragen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('liefert leer statt zu werfen, wenn der Speicher nicht verfügbar ist', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blockierte Site-Daten');
    });
    expect(leseZuletztVerwendet()).toEqual([]);
  });

  it('wirft beim Merken nicht, wenn der Speicher nicht schreibbar ist', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    expect(() => merkeZuletztVerwendet(wert({ kind: 'person' }))).not.toThrow();
  });

  it('verwirft kaputten Speicherinhalt ganz', () => {
    localStorage.setItem(V2, '{kein json');
    expect(leseZuletztVerwendet()).toEqual([]);
  });

  it('verwirft unlesbare Einträge einzeln, behält die brauchbaren', () => {
    localStorage.setItem(
      V2,
      JSON.stringify([
        { spec: 'kaputt' },
        { spec: spec({ kind: 'person' }) },
        42,
        { farbe: '#000' },
      ]),
    );
    expect(leseZuletztVerwendet()).toEqual([spec({ kind: 'person' })]);
  });
});

describe('zuletztVerwendet — Benachrichtigung', () => {
  it('meldet dem Abonnenten jedes Merken und hört nach dem Abbestellen auf', () => {
    const hoerer = vi.fn();
    const abbestellen = abonniereZuletztVerwendet(hoerer);
    merkeZuletztVerwendet(wert({ kind: 'person' }));
    expect(hoerer).toHaveBeenCalledTimes(1);
    // Gegenaussage: ohne Abbestellen liefe der Hörer nach dem Abhängen der Leiste weiter (setState
    // auf einer toten Komponente).
    abbestellen();
    merkeZuletztVerwendet(wert({ kind: 'hazard' }));
    expect(hoerer).toHaveBeenCalledTimes(1);
  });
});
