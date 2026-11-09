import { describe, expect, it } from 'vitest';
import { schaetzeTextbreite } from '../skizzenZeichen';
import {
  SCHRIFTFELD_BREITE,
  VS_NFD,
  schriftfeldAngaben,
  schriftfeldBlock,
  umbrich,
} from './schriftfeld';

const dtg = (s: string) => `DTG(${s})`;
const LEER = {
  herausgeber: null,
  vs_vermerk: 'keiner' as const,
  gueltig_ab: null,
  gez_name: null,
  gez_at: null,
};

describe('Schriftfeld (Spec „Schriftfeld“)', () => {
  it('Schriftfeld ohne Angaben: Titel, kein VS-Vermerk, „—“ bei Gültig ab und gez.', () => {
    const a = schriftfeldAngaben(LEER, 'Großbrand Musterhausen', null, dtg);
    expect(a.titel).toBe('Taktische Fernmeldeskizze für den Einsatz ‚Großbrand Musterhausen‘');
    expect(a.vermerk).toBeNull();
    expect(a.zeilen).toEqual([
      { etikett: 'Herausgeber', wert: 'Großbrand Musterhausen' },
      { etikett: 'Gültig ab', wert: '—' },
      { etikett: 'gez.', wert: '—' },
      { etikett: 'Stand', wert: '—' },
    ]);
  });

  it('gesetzte Angaben als DTG, VS-Vermerk ausgeschrieben, gez. mit Name und DTG', () => {
    const a = schriftfeldAngaben(
      {
        herausgeber: 'Kreis Muster, S6',
        vs_vermerk: 'vs_nfd',
        gueltig_ab: '2026-10-04 16:00:00',
        gez_name: 'Meier',
        gez_at: '2026-10-04 15:00:00',
      },
      'Großbrand',
      '2026-10-04 15:30:00',
      dtg,
    );
    expect(a.vermerk).toBe(VS_NFD);
    expect(a.zeilen).toEqual([
      { etikett: 'Herausgeber', wert: 'Kreis Muster, S6' },
      { etikett: 'Gültig ab', wert: 'DTG(2026-10-04 16:00:00)' },
      { etikett: 'gez.', wert: 'Meier DTG(2026-10-04 15:00:00)' },
      { etikett: 'Stand', wert: 'DTG(2026-10-04 15:30:00)' },
    ]);
  });

  it('ohne geladene Skizzendaten „nicht geladen“ statt „—“ (fehlende Quelle ist keine leere)', () => {
    const a = schriftfeldAngaben(null, 'Großbrand', null, dtg);
    expect(a.zeilen.map((z) => z.wert)).toEqual([
      'Großbrand',
      'nicht geladen',
      'nicht geladen',
      'nicht geladen',
    ]);
  });
});

describe('Umbruch', () => {
  it('bricht an Wortgrenzen, kürzt nie, und lange Wörter zeichenweise', () => {
    const zeilen = umbrich('Taktische Fernmeldeskizze für den Einsatz', 10, 100);
    expect(zeilen.join(' ')).toBe('Taktische Fernmeldeskizze für den Einsatz');
    for (const z of zeilen) expect(schaetzeTextbreite(z, 10)).toBeLessThanOrEqual(100);
    const lang = umbrich('X'.repeat(40), 10, 60);
    expect(lang.join('')).toBe('X'.repeat(40));
    expect(lang.every((z) => z.length <= 10)).toBe(true);
    expect(umbrich('', 10, 100)).toEqual(['']);
  });

  it('der Block wächst mit dem Text und hält die Breite', () => {
    const kurz = schriftfeldBlock(schriftfeldAngaben(LEER, 'A', null, dtg));
    const lang = schriftfeldBlock(
      schriftfeldAngaben(
        LEER,
        'Großbrand in der Lagerhalle der Firma Mustermann GmbH & Co. KG',
        null,
        dtg,
      ),
    );
    expect(kurz.breite).toBe(SCHRIFTFELD_BREITE);
    expect(lang.breite).toBe(SCHRIFTFELD_BREITE);
    expect(lang.hoehe).toBeGreaterThan(kurz.hoehe);
    expect(lang.hoehe % 8).toBe(0);
  });
});
