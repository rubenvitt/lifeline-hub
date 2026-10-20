import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMitProviders } from '../../test/utils';
import LageplanDruck from './LageplanDruck';
import type { LageplanBlatt } from './useLageplan';

const blatt = (teil: Partial<LageplanBlatt> = {}): LageplanBlatt => ({
  bildUrl: 'blob:lageplan',
  aufnahme: {
    bild: new Blob(),
    breitePx: 2000,
    hoehePx: 1000,
    cssBreite: 1000,
    cssHoehe: 500,
    meterJePx: 2,
    peilung: 30,
    buendel: [],
  },
  einsatz: { bezeichnung: 'Hochwasser Musterstadt', einsatznummer_intern: '2026-014' },
  zeilen: [
    { etikett: 'Stand', wert: '201215Okt26' },
    { etikett: 'Kartengrundlage', wert: 'Offline' },
  ],
  legende: {
    ebenen: [{ schluessel: 'einheit', text: 'Einheiten (2)' }],
    zonen: [
      {
        schluessel: 'zone-1',
        text: 'Brandstelle · Warnstufe: hoch',
        fuellung: '#cf1322',
        fuellDeckung: 0.2,
        linie: '#cf1322',
        gestrichelt: true,
      },
    ],
    fachebenen: [
      {
        schluessel: 'fachebene-pegelonline',
        text: 'Pegel · veraltet · Stand 0900',
        veraltet: true,
      },
    ],
    bilder: [{ schluessel: 'bild-3', text: 'Hallenplan' }],
    veraltet: ['Pegel (Stand 0900)'],
  },
  ...teil,
});

describe('LageplanDruck', () => {
  it('trägt Druckkopf, Bild in mm, Maßstab, Verhältnis, Nordpfeil, Hinweis und Legende', () => {
    renderMitProviders(<LageplanDruck blatt={blatt()} />);
    const wurzel = document.querySelector<HTMLElement>('[data-lfh="druckwurzel"]')!;
    expect(wurzel).not.toBeNull();
    const w = within(wurzel);
    expect(w.getByText('Lageplan')).toBeInTheDocument();
    const bild = wurzel.querySelector<HTMLImageElement>('[data-lfh="lageplan-bild"]')!;
    expect(bild.getAttribute('src')).toBe('blob:lageplan');
    // 2:1 auf höchstens 267 × 95 mm: die Höhe begrenzt.
    expect(bild.style.width).toBe('190mm');
    expect(bild.style.height).toBe('95mm');
    // 1000 px × 2 m = 2 km Breite → Leiste 500 m.
    expect(w.getByText('500 m')).toBeInTheDocument();
    expect(w.getByText(/^Maßstab ca\. 1 : 11\.000$/)).toBeInTheDocument();
    expect(
      wurzel.querySelector('[data-lfh="lageplan-nordpfeil"] g')?.getAttribute('transform'),
    ).toBe('rotate(330 20 20)');
    expect(w.getByText('Veraltete Fachebene: Pegel (Stand 0900)')).toBeInTheDocument();
    const legende = within(wurzel.querySelector<HTMLElement>('[data-lfh="lageplan-legende"]')!);
    expect(legende.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Einheiten (2)',
      'Brandstelle · Warnstufe: hoch',
      'Pegel · veraltet · Stand 0900',
      'Bild: Hallenplan',
    ]);
    // Die Zone trägt ihr Feld mit Strichelung; die Warnstufe steht als Text.
    expect(
      wurzel.querySelector('[data-lfh="lageplan-legende"] rect')?.getAttribute('stroke-dasharray'),
    ).toBe('3 2');
  });

  it('ohne Maßstabsangabe keine Leiste und kein Verhältnis, ohne Veraltetes kein Hinweis', () => {
    const b = blatt();
    renderMitProviders(
      <LageplanDruck
        blatt={{
          ...b,
          aufnahme: { ...b.aufnahme, meterJePx: null },
          legende: { ...b.legende, veraltet: [] },
        }}
      />,
    );
    expect(document.querySelector('[data-lfh="lageplan-massstab"]')).toBeNull();
    expect(screen.queryByText(/Maßstab ca\./)).toBeNull();
    expect(document.querySelector('[data-lfh="lageplan-veraltet"]')).toBeNull();
  });

  it('A4 quer über die benannte Seite, am Bildschirm ausgeblendet', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'lageplanDruck.css'),
      'utf8',
    );
    expect(css).toMatch(/@page lageplan\s*\{\s*size: A4 landscape;/);
    expect(css).toMatch(/\.lageplan-blatt\s*\{\s*page: lageplan;/);
    expect(css).toMatch(/@media screen\s*\{\s*\.lageplan-druck\s*\{\s*display: none;/);
  });
});
