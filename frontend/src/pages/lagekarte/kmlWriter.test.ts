import type { Drawing } from '@einsatzzeichen/schema';
import { describe, expect, it } from 'vitest';
import type { ExportObjekt } from './geoExport';
import { PUNKT_ICON, iconDateiname, kmlFarbe, writeKml } from './kmlWriter';

const META = { stand: new Date('2026-11-24T09:05:07Z'), einsatzName: 'Hochwasser Nord' };
const ICON = (schluessel: string) => iconDateiname(schluessel);

const RING = [
  [9.1, 54.1],
  [9.2, 54.1],
  [9.2, 54.2],
  [9.1, 54.1],
];

function zeichenPunkt(schluessel: string, teil: Partial<ExportObjekt> = {}): ExportObjekt {
  return {
    art: 'einheit',
    name: 'Trupp 1',
    beschriftung: 'Trupp 1',
    geometrie: { type: 'Point', coordinates: [9.5, 54.5] },
    zeichen: { schluessel, spec: schluessel.slice(3), drawing: {} as Drawing },
    stil: { markerFarbe: '#1677ff' },
    ...teil,
  };
}

function zone(teil: Partial<ExportObjekt> = {}): ExportObjekt {
  return {
    art: 'zone',
    name: 'Sperrzone',
    beschriftung: 'Sperrzone',
    geometrie: { type: 'Polygon', coordinates: [RING] },
    stil: { linie: '#ff0000', fuellung: '#ff0000', deckkraft: 0.5, breite: 3 },
    ...teil,
  };
}

function dom(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

describe('kmlFarbe', () => {
  it('schreibt aabbggrr: #ff0000 mit Deckkraft 0.5 ist 7f0000ff', () => {
    expect(kmlFarbe('#ff0000', 0.5)).toBe('7f0000ff');
    expect(kmlFarbe('#336699')).toBe('ff996633');
    expect(kmlFarbe('#f00', 1)).toBe('ff0000ff');
  });
});

describe('iconDateiname', () => {
  it('ist files/<hex>.png, stabil je Schlüssel und verschieden je Schlüssel', () => {
    expect(iconDateiname('ez|a')).toMatch(/^files\/[0-9a-f]{8}\.png$/);
    expect(iconDateiname('ez|a')).toBe(iconDateiname('ez|a'));
    expect(iconDateiname('ez|a')).not.toBe(iconDateiname('ez|b'));
  });
});

describe('writeKml', () => {
  it('schreibt KML 2.2 mit Einsatzname im Document', () => {
    const d = dom(writeKml([zone()], META, ICON));
    expect(d.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(d.documentElement.localName).toBe('kml');
    expect(d.documentElement.namespaceURI).toBe('http://www.opengis.net/kml/2.2');
    const name = d.querySelector('Document > name')?.textContent ?? '';
    expect(name).toContain('Hochwasser Nord');
  });

  it('legt einen Style je Zeichenschlüssel mit Icon-href an', () => {
    const xml = writeKml(
      [zeichenPunkt('ez|a'), zeichenPunkt('ez|a', { name: 'Trupp 2' }), zeichenPunkt('ez|b')],
      META,
      ICON,
    );
    const d = dom(xml);
    const hrefs = [...d.querySelectorAll('Style IconStyle Icon href')].map((e) => e.textContent);
    expect(hrefs).toHaveLength(2);
    expect(new Set(hrefs)).toEqual(new Set([iconDateiname('ez|a'), iconDateiname('ez|b')]));
    expect(hrefs[0]).toMatch(/^files\/.+\.png$/);
  });

  it('legt einen Folder je Art an', () => {
    const d = dom(writeKml([zone(), zone({ name: 'B' }), zeichenPunkt('ez|a')], META, ICON));
    const folder = [...d.querySelectorAll('Folder > name')].map((e) => e.textContent);
    expect(folder).toHaveLength(2);
    expect(d.querySelectorAll('Folder')[0].querySelectorAll('Placemark')).toHaveLength(2);
  });

  it('schreibt Linien- und Füllfarbe in aabbggrr', () => {
    const d = dom(writeKml([zone()], META, ICON));
    expect(d.querySelector('PolyStyle > color')?.textContent).toBe('7f0000ff');
    expect(d.querySelector('LineStyle > color')?.textContent).toBe('ff0000ff');
    expect(d.querySelector('LineStyle > width')?.textContent).toBe('3');
  });

  it('schreibt Flächen als Polygon mit outerBoundaryIs, lon,lat,0', () => {
    const d = dom(writeKml([zone()], META, ICON));
    expect(d.querySelector('Polygon > outerBoundaryIs > LinearRing > coordinates')).not.toBeNull();
    expect(d.querySelector('Polygon > tessellate')?.textContent).toBe('1');
    const koord = d.querySelector('coordinates')?.textContent?.trim().split(/\s+/);
    expect(koord?.[0]).toBe('9.1,54.1,0');
  });

  it('escaped Sonderzeichen in Texten', () => {
    const roh = `A<&>"'B`;
    const xml = writeKml([zone({ name: roh, beschriftung: roh })], META, ICON);
    expect(xml).not.toContain(roh);
    expect(dom(xml).querySelector('Placemark > name')?.textContent).toBe(roh);
  });

  it('schreibt keine description, aber ExtendedData mit lfh:art und lfh:zeichen', () => {
    const xml = writeKml([zeichenPunkt('ez|a')], META, ICON);
    expect(xml).not.toContain('description');
    const d = dom(xml);
    const daten = Object.fromEntries(
      [...d.querySelectorAll('ExtendedData Data')].map((e) => [
        e.getAttribute('name'),
        e.querySelector('value')?.textContent,
      ]),
    );
    expect(daten['lfh:art']).toBe('einheit');
    expect(daten['lfh:zeichen']).toBe('a');
  });

  it('gibt Flächen ohne Zeichen keinen IconStyle', () => {
    const d = dom(writeKml([zone()], META, ICON));
    expect(d.querySelectorAll('IconStyle')).toHaveLength(0);
  });

  it('ein Punkt ohne Zeichen behält seine Farbe: eingefärbter Kreis statt der gelben Nadel', () => {
    const schaden: ExportObjekt = {
      art: 'schaden',
      name: 'Keller',
      beschriftung: 'Keller',
      geometrie: { type: 'Point', coordinates: [9.5, 54.5] },
      stil: { markerFarbe: '#ff0000' },
    };
    const d = dom(writeKml([schaden], META, ICON));
    const stil = d.querySelector('Placemark IconStyle');
    expect(stil?.querySelector('color')?.textContent).toBe('ff0000ff');
    expect(stil?.querySelector('Icon href')?.textContent).toBe(PUNKT_ICON);
  });
});
