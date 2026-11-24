import type { Drawing } from '@einsatzzeichen/schema';
import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { ExportObjekt } from './geoExport';
import { packKmz } from './kmzPacker';

const META = { stand: new Date('2026-11-24T09:05:07Z'), einsatzName: 'Hochwasser Nord' };

function punkt(schluessel: string, name = 'P'): ExportObjekt {
  return {
    art: 'einheit',
    name,
    beschriftung: name,
    geometrie: { type: 'Point', coordinates: [9.5, 54.5] },
    zeichen: { schluessel, spec: schluessel.slice(3), drawing: {} as Drawing },
    stil: {},
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const stub = () => vi.fn(async () => new Blob([PNG], { type: 'image/png' }));

async function entpacke(blob: Blob) {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

describe('packKmz', () => {
  it('packt doc.kml als ersten Eintrag und je Zeichenschlüssel genau ein PNG', async () => {
    const render = stub();
    const blob = await packKmz([punkt('ez|a'), punkt('ez|b')], META, render);
    expect(blob.type).toBe('application/vnd.google-earth.kmz');
    const namen = Object.keys(await entpacke(blob));
    expect(namen[0]).toBe('doc.kml');
    expect(namen.filter((n) => n.endsWith('.png'))).toHaveLength(2);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('ergibt bei zweimal demselben Schlüssel ein PNG', async () => {
    const render = stub();
    const dateien = await entpacke(
      await packKmz([punkt('ez|a', 'P1'), punkt('ez|a', 'P2')], META, render),
    );
    expect(Object.keys(dateien).filter((n) => n.endsWith('.png'))).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('verweist in doc.kml auf die gepackten PNG-Dateien und unverändert gespeicherte Bytes', async () => {
    const dateien = await entpacke(await packKmz([punkt('ez|a')], META, stub()));
    const kml = new TextDecoder().decode(dateien['doc.kml']);
    const png = Object.keys(dateien).find((n) => n.endsWith('.png'))!;
    expect(kml).toContain(`<href>${png}</href>`);
    expect([...dateien[png]]).toEqual([...PNG]);
  });

  it('packt ohne Zeichen nur doc.kml', async () => {
    const render = stub();
    const o: ExportObjekt = { ...punkt('ez|a'), zeichen: undefined };
    const dateien = await entpacke(await packKmz([o], META, render));
    expect(Object.keys(dateien)).toEqual(['doc.kml']);
    expect(render).not.toHaveBeenCalled();
  });
});
