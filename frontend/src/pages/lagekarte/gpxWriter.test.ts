import { describe, expect, it } from 'vitest';
import type { ExportObjekt } from './geoExport';
import { writeGpx } from './gpxWriter';

const META = { stand: new Date('2026-11-24T09:05:07Z'), einsatzName: 'Hochwasser Nord' };

function punkt(teil: Partial<ExportObjekt> = {}): ExportObjekt {
  return {
    art: 'einheit',
    name: 'Trupp 1',
    beschriftung: 'Trupp 1',
    geometrie: { type: 'Point', coordinates: [9.5, 54.5] },
    stil: { markerFarbe: '#1677ff' },
    ...teil,
  };
}

function flaeche(teil: Partial<ExportObjekt> = {}): ExportObjekt {
  return {
    art: 'gefahrengebiet',
    name: 'Brandrauch',
    beschriftung: 'Brandrauch · Warnstufe: hoch',
    warnstufe: 'hoch',
    geometrie: {
      type: 'Polygon',
      coordinates: [
        [
          [9.1, 54.1],
          [9.2, 54.1],
          [9.2, 54.2],
        ],
        [
          [9.15, 54.12],
          [9.16, 54.12],
          [9.16, 54.13],
          [9.15, 54.12],
        ],
      ],
    },
    stil: { linie: '#ff0000', fuellung: '#ff0000', deckkraft: 0.25, breite: 3 },
    ...teil,
  };
}

function linie(teil: Partial<ExportObjekt> = {}): ExportObjekt {
  return {
    art: 'zone',
    name: 'Sperrlinie',
    beschriftung: 'Sperrlinie',
    geometrie: {
      type: 'LineString',
      coordinates: [
        [9.3, 54.3],
        [9.4, 54.35],
      ],
    },
    stil: { linie: '#0000ff', breite: 2 },
    ...teil,
  };
}

function lies(objekte: ExportObjekt[]): Document {
  const doc = new DOMParser().parseFromString(writeGpx(objekte, META), 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

const kinder = (el: Element) => [...el.children].map((k) => k.localName);
const text = (el: Element, name: string) =>
  [...el.children].find((k) => k.localName === name)?.textContent;
const punkte = (seg: Element) =>
  [...seg.children].map((p) => [Number(p.getAttribute('lon')), Number(p.getAttribute('lat'))]);

describe('writeGpx', () => {
  it('schreibt GPX 1.1 mit Namensraum, Ersteller und Metadaten in UTC', () => {
    const xml = writeGpx([punkt()], META);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const gpx = lies([punkt()]).documentElement;
    expect(gpx.localName).toBe('gpx');
    expect(gpx.namespaceURI).toBe('http://www.topografix.com/GPX/1/1');
    expect(gpx.getAttribute('version')).toBe('1.1');
    expect(gpx.getAttribute('creator')).toBe('Lifeline Hub');
    const meta = gpx.children[0];
    expect(meta.localName).toBe('metadata');
    expect(text(meta, 'name')).toBe('Hochwasser Nord – Stand 2026-11-24 09:05:07 UTC');
    expect(text(meta, 'time')).toBe('2026-11-24T09:05:07Z');
  });

  it('ein Punkt wird wpt mit lat/lon, Beschriftung als Name und Art als type', () => {
    const [wpt] = [...lies([punkt()]).getElementsByTagName('wpt')];
    expect(wpt.getAttribute('lat')).toBe('54.5');
    expect(wpt.getAttribute('lon')).toBe('9.5');
    expect(kinder(wpt)).toEqual(['name', 'type']);
    expect(text(wpt, 'name')).toBe('Trupp 1');
    expect(text(wpt, 'type')).toBe('einheit');
  });

  it('eine Linie wird trk mit einem Segment, nicht rte', () => {
    const doc = lies([linie()]);
    expect(doc.getElementsByTagName('rte')).toHaveLength(0);
    const [trk] = [...doc.getElementsByTagName('trk')];
    expect(kinder(trk)).toEqual(['name', 'type', 'trkseg']);
    expect(text(trk, 'type')).toBe('zone');
    expect(punkte(trk.children[2])).toEqual([
      [9.3, 54.3],
      [9.4, 54.35],
    ]);
  });

  it('eine Fläche wird geschlossene Spur: je Ring ein Segment, erster Punkt = letzter', () => {
    const [trk] = [...lies([flaeche()]).getElementsByTagName('trk')];
    expect(text(trk, 'name')).toBe('Brandrauch · Warnstufe: hoch');
    expect(text(trk, 'type')).toBe('gefahrengebiet');
    const segmente = [...trk.children].filter((k) => k.localName === 'trkseg');
    expect(segmente).toHaveLength(2);
    const aussen = punkte(segmente[0]);
    expect(aussen).toHaveLength(4);
    expect(aussen[3]).toEqual(aussen[0]);
    expect(punkte(segmente[1])).toHaveLength(4);
  });

  it('hält die Reihenfolge des Schemas: metadata, alle wpt, dann alle trk', () => {
    const gpx = lies([flaeche(), punkt(), linie(), punkt({ name: 'B', beschriftung: 'B' })])
      .documentElement;
    expect(kinder(gpx)).toEqual(['metadata', 'wpt', 'wpt', 'trk', 'trk']);
  });

  it('trägt weder Farben, Beschreibung noch Erweiterungen', () => {
    const xml = writeGpx([punkt(), flaeche(), linie()], META);
    expect(xml).not.toMatch(/<desc>|<cmt>|<extensions>|<sym>|#ff0000|#1677ff/);
  });

  it('escaped Texte und lässt unzulässige Steuerzeichen weg', () => {
    const o = punkt({ beschriftung: 'A & B <C> "D"\u0007' });
    const xml = writeGpx([o], { ...META, einsatzName: 'X<Y' });
    expect(xml).toContain('<name>A &amp; B &lt;C&gt; &quot;D&quot;</name>');
    expect(xml).toContain('X&lt;Y');
    const [wpt] = [...lies([o]).getElementsByTagName('wpt')];
    expect(text(wpt, 'name')).toBe('A & B <C> "D"');
  });
});
