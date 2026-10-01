import { describe, expect, it } from 'vitest';
import type { KarteMarker } from '../pages/lagekarte/marker';
import { schleuse, wartendText } from './kartenSchleuse';

function m(id: number, teil: Partial<KarteMarker> = {}): KarteMarker {
  return {
    schluessel: `person-${id}`,
    typ: 'person',
    id,
    lat: 52 + id / 1000,
    lon: 9 + id / 1000,
    label: `R-${id} · SK III`,
    kurzzeichen: 'III',
    sichtung: 'sk3',
    farbe: '#0a0',
    ...teil,
  };
}

describe('schleuse (LFH-668)', () => {
  it('offen: der frische Stand geht unverändert durch, nichts wartet', () => {
    const frisch = [m(1), m(2)];
    const r = schleuse(null, frisch);
    expect(r.gezeigt).toBe(frisch);
    expect(r.wartend).toEqual({ neu: 0, verlegt: 0, entfallen: 0 });
  });

  it('ein Zugang wartet und steht NICHT auf der Karte', () => {
    const r = schleuse([m(1)], [m(1), m(2)]);
    expect(r.gezeigt.map((x) => x.schluessel)).toEqual(['person-1']);
    expect(r.wartend).toEqual({ neu: 1, verlegt: 0, entfallen: 0 });
  });

  it('eine Verlegung wartet: der Marker behält die gehaltene Lage', () => {
    const r = schleuse([m(1)], [m(1, { lat: 53, lon: 10 })]);
    expect(r.gezeigt[0]).toMatchObject({ lat: 52.001, lon: 9.001 });
    expect(r.wartend).toEqual({ neu: 0, verlegt: 1, entfallen: 0 });
  });

  it('ein Wegfall wartet: der Marker bleibt mit seinem letzten Inhalt stehen', () => {
    const gehalten = [m(1), m(2, { label: 'R-2 · SK I' })];
    const r = schleuse(gehalten, [m(1)]);
    expect(r.gezeigt.map((x) => x.schluessel)).toEqual(['person-1', 'person-2']);
    expect(r.gezeigt[1].label).toBe('R-2 · SK I');
    expect(r.wartend).toEqual({ neu: 0, verlegt: 0, entfallen: 1 });
  });

  it('der Inhalt fließt: neue Sichtung an der gehaltenen Lage, und das wartet nicht', () => {
    const frisch = m(1, {
      lat: 52.5,
      lon: 9.5,
      label: 'R-1 · SK I',
      kurzzeichen: 'I',
      sichtung: 'sk1',
      farbe: '#f00',
    });
    const r = schleuse([m(1)], [frisch]);
    expect(r.gezeigt[0]).toMatchObject({
      label: 'R-1 · SK I',
      kurzzeichen: 'I',
      sichtung: 'sk1',
      farbe: '#f00',
      lat: 52.001,
      lon: 9.001,
    });
    // Die Lage zählt als Verlegung; der Inhalt allein nicht.
    expect(r.wartend).toEqual({ neu: 0, verlegt: 1, entfallen: 0 });
    expect(schleuse([m(1)], [m(1, { kurzzeichen: 'I' })]).wartend).toEqual({
      neu: 0,
      verlegt: 0,
      entfallen: 0,
    });
  });

  it('die Folge bleibt die gehaltene, auch wenn der frische Stand umsortiert ist', () => {
    const r = schleuse([m(1), m(2), m(3)], [m(3), m(1), m(2)]);
    expect(r.gezeigt.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('ohne jede Änderung gibt sie den gehaltenen Stand selbst zurück (keine neue Referenz)', () => {
    const gehalten = [m(1), m(2)];
    const r = schleuse(gehalten, [m(1), m(2)]);
    expect(r.gezeigt).toBe(gehalten);
  });
});

describe('wartendText (LFH-668)', () => {
  it('nennt nur Teile über 0, in fester Folge', () => {
    expect(wartendText({ neu: 2, verlegt: 1, entfallen: 0 })).toBe('2 neu · 1 verlegt');
    expect(wartendText({ neu: 0, verlegt: 0, entfallen: 1 })).toBe('1 entfallen');
    expect(wartendText({ neu: 1, verlegt: 3, entfallen: 2 })).toBe(
      '1 neu · 3 verlegt · 2 entfallen',
    );
  });

  it('ohne Wartendes: null', () => {
    expect(wartendText({ neu: 0, verlegt: 0, entfallen: 0 })).toBeNull();
  });
});
