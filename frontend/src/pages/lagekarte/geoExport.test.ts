import { describe, expect, it } from 'vitest';
import {
  EXPORT_MARKER_ARTEN,
  GEFAHR_EXPORT_FARBE,
  collectExportObjekte,
  standAusWire,
  type ExportEingabe,
} from './geoExport';
import type { ZoneFeature } from './kartenLayer';
import type { KarteMarker, MarkerTyp } from './marker';

// Jeder Wert von `MarkerTyp`: der Record zwingt tsc, einen neuen Typ hier nachzutragen, und der
// Test zwingt dann die Entscheidung „hinein oder draußen“ (Spec, „Was hineinkommt“).
const ALLE_MARKER_TYPEN: Record<MarkerTyp, true> = {
  einsatzort: true,
  fuehrungsstelle: true,
  uhs: true,
  schaden: true,
  einheit: true,
  fahrzeug: true,
  fuehrung: true,
  abschnitt: true,
  lagemeldung: true,
  freies_zeichen: true,
  betreuungsstelle: true,
  bereitstellungsraum: true,
  tier: true,
  sammelstelle: true,
  person: true,
};
const AUSGESCHLOSSEN: MarkerTyp[] = ['fuehrung', 'tier', 'lagemeldung', 'person'];

function marker(typ: MarkerTyp, teil: Partial<KarteMarker> = {}): KarteMarker {
  return {
    schluessel: `${typ}-1`,
    typ,
    id: 1,
    lat: 54.123456789,
    lon: 9.987654321,
    label: `${typ} 1`,
    farbe: '#1677ff',
    ...teil,
  };
}

function eingabe(teil: Partial<ExportEingabe> = {}): ExportEingabe {
  return {
    marker: [],
    flaechen: [],
    zonen: [],
    einsatzName: 'Hochwasser Nord',
    stand: new Date('2026-11-24T10:00:00Z'),
    ...teil,
  };
}

const QUADRAT = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [9.1234567, 54.1234567],
      [9.2, 54.1],
      [9.2, 54.2],
      [9.1234567, 54.1234567],
    ],
  ],
};

function gefahrZone(teil: Partial<ZoneFeature> = {}): ZoneFeature {
  return {
    id: 7,
    geometrie: QUADRAT,
    label: 'Werk · hoch',
    rohLabel: 'Werk',
    typ: 'gefahrengebiet',
    warnstufe: 'hoch',
    stil: { fillColor: 'var(--x)', fillOpacity: 0.25, lineColor: 'var(--x)', lineWidth: 2 },
    gestrichelt: true,
    ...teil,
  };
}

describe('collectExportObjekte', () => {
  it('jeder Markertyp ist entschieden: hinein oder ausdrücklich draußen, nie beides', () => {
    for (const typ of Object.keys(ALLE_MARKER_TYPEN) as MarkerTyp[]) {
      const drin = EXPORT_MARKER_ARTEN[typ] !== undefined;
      const draussen = AUSGESCHLOSSEN.includes(typ);
      expect(drin !== draussen, typ).toBe(true);
    }
  });

  it('Personen, Führung, Tiere und Lagemeldungen fehlen im Export', () => {
    const objekte = collectExportObjekte(
      eingabe({ marker: AUSGESCHLOSSEN.map((t) => marker(t)).concat(marker('uhs')) }),
    );
    expect(objekte.map((o) => o.art)).toEqual(['uhs']);
  });

  it('keine Freitexte: Zusatz und Notiz bleiben draußen, der Name ist das Label', () => {
    const mk = {
      ...marker('bereitstellungsraum', { label: 'BR Süd', beschriftungZusatz: '0/2/9//11 · 3 Fz' }),
      notiz: 'Zufahrt über Hof, Schlüssel bei Herrn Meier',
    } as KarteMarker;
    const [o] = collectExportObjekte(eingabe({ marker: [mk] }));
    expect(o.name).toBe('BR Süd');
    expect(o.beschriftung).toBe('BR Süd');
    expect(JSON.stringify(o)).not.toMatch(/Meier|3 Fz/);
  });

  it('Einsatzort heißt „Einsatzort“, nicht nach seiner Anschrift', () => {
    const [o] = collectExportObjekte(
      eingabe({ marker: [marker('einsatzort', { label: 'Hauptstraße 5' })] }),
    );
    expect(o.name).toBe('Einsatzort');
  });

  it('Koordinaten als [lon, lat] mit sechs Nachkommastellen', () => {
    const [punkt, flaeche] = collectExportObjekte(
      eingabe({
        marker: [marker('uhs')],
        flaechen: [{ id: 3, label: 'EA 1', polygon: QUADRAT }],
      }),
    ).sort((a) => (a.geometrie.type === 'Point' ? -1 : 1));
    expect(punkt.geometrie).toEqual({ type: 'Point', coordinates: [9.987654, 54.123457] });
    expect(flaeche.geometrie.type).toBe('Polygon');
    if (flaeche.geometrie.type !== 'Polygon') throw new Error('kein Polygon');
    expect(flaeche.geometrie.coordinates[0][0]).toEqual([9.123457, 54.123457]);
  });

  it('die Zeichen-Spec wird aus dem Schlüssel ez|<spec> zurückgelesen', () => {
    const [o] = collectExportObjekte(eingabe({ marker: [marker('bereitstellungsraum')] }));
    expect(o.zeichen).toBeDefined();
    expect(o.zeichen!.schluessel.startsWith('ez|')).toBe(true);
    expect(o.zeichen!.spec).toBe(o.zeichen!.schluessel.slice(3));
    expect(o.zeichen!.spec.startsWith('ez|')).toBe(false);
    expect(o.zeichen!.drawing).toBeTruthy();
  });

  it('ein Marker ohne Zeichen trägt kein zeichen, aber seine Farbe als Hex', () => {
    const [o] = collectExportObjekte(eingabe({ marker: [marker('uhs', { farbe: '#555' })] }));
    expect(o.zeichen).toBeUndefined();
    expect(o.stil.markerFarbe).toBe('#555555');
  });

  it('Gefahrengebiet: Warnstufe gesetzt, Beschriftung mit „Warnstufe“, feste Hex-Farbe', () => {
    const [o] = collectExportObjekte(eingabe({ zonen: [gefahrZone()] }));
    expect(o.art).toBe('gefahrengebiet');
    expect(o.name).toBe('Werk');
    expect(o.warnstufe).toBe('hoch');
    expect(o.beschriftung).toContain('Warnstufe');
    expect(o.beschriftung).toContain('hoch');
    expect(o.stil.linie).toMatch(/^#[0-9a-f]{6}$/i);
    expect(o.stil.linie).not.toContain('var(');
    expect(o.stil.linie).toBe(GEFAHR_EXPORT_FARBE.alarm);
  });

  it('Gefahrengebiet ohne Namen und ohne Nachschlag: „Gefahrengebiet“, Stufe unbekannt, Alarmfarbe', () => {
    const [o] = collectExportObjekte(
      eingabe({ zonen: [gefahrZone({ rohLabel: null, label: null, warnstufe: undefined })] }),
    );
    expect(o.name).toBe('Gefahrengebiet');
    expect(o.warnstufe).toBe('unbekannt');
    expect(o.beschriftung).toContain('Warnstufe unbekannt');
    expect(o.stil.linie).toBe(GEFAHR_EXPORT_FARBE.alarm);
  });

  it('Gefahrengebiet mit niedriger Stufe nimmt die Achtungsfarbe', () => {
    const [o] = collectExportObjekte(eingabe({ zonen: [gefahrZone({ warnstufe: 'niedrig' })] }));
    expect(o.stil.linie).toBe(GEFAHR_EXPORT_FARBE.achtung);
    expect(o.stil.fuellung).toBe(GEFAHR_EXPORT_FARBE.achtung);
  });

  it('andere Zonen behalten Stil und Kartenbeschriftung, Bezirke heißen evakuierungsbezirk', () => {
    const objekte = collectExportObjekte(
      eingabe({
        zonen: [
          {
            id: 1,
            geometrie: QUADRAT,
            label: 'Sperre · r = 300 m',
            rohLabel: 'Sperre',
            typ: 'sperrgebiet',
            kreis: { mitte: { lat: 54.1, lon: 9.1 }, radiusM: 300 },
            stil: { fillColor: '#8c8c8c', fillOpacity: 0.3, lineColor: '#595959', lineWidth: 2 },
          },
          {
            id: 2,
            geometrie: QUADRAT,
            label: 'Bezirk A · Räumung: läuft',
            rohLabel: 'Bezirk A',
            typ: 'evakuierungsbezirk',
            stil: { fillColor: '#a0522d', fillOpacity: 0.15, lineColor: '#a0522d', lineWidth: 2 },
          },
        ],
      }),
    );
    expect(objekte.map((o) => o.art)).toEqual(['zone', 'evakuierungsbezirk']);
    expect(objekte[0]).toMatchObject({
      name: 'Sperre',
      beschriftung: 'Sperre · r = 300 m',
      kreis: { mitte: [9.1, 54.1], radius_m: 300 },
      stil: { linie: '#595959', fuellung: '#8c8c8c', deckkraft: 0.3, breite: 2 },
    });
    expect(objekte[0].warnstufe).toBeUndefined();
    expect(objekte[1].name).toBe('Bezirk A');
  });

  it('gedämpfte Abschnitte bleiben im Export, als Fläche und als Marker', () => {
    const objekte = collectExportObjekte(
      eingabe({
        marker: [marker('abschnitt', { gedaempft: true, label: 'EA 2' })],
        flaechen: [{ id: 2, label: 'EA 2', polygon: QUADRAT }],
      }),
    );
    expect(objekte.map((o) => [o.art, o.geometrie.type])).toEqual([
      ['abschnitt', 'Polygon'],
      ['abschnitt', 'Point'],
    ]);
  });
});

describe('Stand eines gesicherten Stands (Review)', () => {
  it('liest den Stand eines gesicherten Stands als UTC, in SQLite- wie in ISO-Form', () => {
    expect(standAusWire('2026-11-24 09:00:00')?.toISOString()).toBe('2026-11-24T09:00:00.000Z');
    expect(standAusWire('2026-11-24T09:00:00Z')?.toISOString()).toBe('2026-11-24T09:00:00.000Z');
    expect(standAusWire('kaputt')).toBeNull();
  });
});
