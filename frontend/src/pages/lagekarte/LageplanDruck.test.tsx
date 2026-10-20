import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const PX_JE_MM = 96 / 25.4;

/**
 * Höhen wie im gesetzten Blatt: jsdom setzt nichts, deshalb liefert die Attrappe für Blatt und Bild
 * Höhen in mm — aber nur im Messmodus (`data-messen`), denn am Bildschirm ist das Blatt
 * ausgeblendet und hätte keine Höhe.
 */
function setzeHoehen(hoehen: () => { blattMm: number; bildMm: number }) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const messen = this.closest('[data-lfh="druckwurzel"]')?.hasAttribute('data-messen');
    const { blattMm, bildMm } = hoehen();
    const mm = !messen
      ? 0
      : this.classList.contains('lageplan-blatt')
        ? blattMm
        : this.matches('[data-lfh="lageplan-bild"]')
          ? bildMm
          : 0;
    return new DOMRect(0, 0, 0, mm * PX_JE_MM);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
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

  it('vermisst sich und gibt dem Bild den Rest des Blatts; Breite und Maßstab folgen', () => {
    // Rest (Kopf mit Logo, Maßstabszeile, lange Legende) 105 mm: 177 − 105 = 72 mm Bildhöhe.
    let hoehen = { blattMm: 200, bildMm: 95 };
    setzeHoehen(() => hoehen);
    renderMitProviders(<LageplanDruck blatt={blatt()} />);
    const wurzel = document.querySelector<HTMLElement>('[data-lfh="druckwurzel"]')!;
    const bild = wurzel.querySelector<HTMLImageElement>('[data-lfh="lageplan-bild"]')!;
    expect(bild.style.height).toBe('72mm');
    expect(bild.style.width).toBe('144mm');
    // 2 km auf 144 mm → 1 : 13.889 → 1 : 14.000; die Leiste bleibt ein Viertel der Bildbreite.
    expect(screen.getByText(/^Maßstab ca\. 1 : 14\.000$/)).toBeInTheDocument();
    expect(wurzel.querySelector('[data-lfh="lageplan-massstab"] svg')?.getAttribute('width')).toBe(
      '36mm',
    );
    expect(wurzel.hasAttribute('data-messen'), 'nach dem Messen wieder ausgeblendet').toBe(false);

    // Bei `beforeprint` neu (das Logo ist jetzt geladen, der Kopf höher): Rest 120 mm → 57 mm.
    hoehen = { blattMm: 192, bildMm: 72 };
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(bild.style.height).toBe('57mm');
    expect(bild.style.width).toBe('114mm');
  });

  it('ohne Messung (nicht gesetzt) bleibt die größte Fläche', () => {
    setzeHoehen(() => ({ blattMm: 0, bildMm: 0 }));
    renderMitProviders(<LageplanDruck blatt={blatt()} />);
    expect(
      document.querySelector<HTMLImageElement>('[data-lfh="lageplan-bild"]')!.style.height,
    ).toBe('95mm');
  });

  it('Messmodus: unsichtbar in Seitenbreite, Kopf sichtbar, Blattregeln auch außerhalb des Drucks', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'lageplanDruck.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.lageplan-druck\[data-messen\]\s*\{[^}]*display: block !important;[^}]*position: fixed !important;[^}]*width: 267mm !important;[^}]*visibility: hidden;/,
    );
    expect(css).toMatch(
      /\.lageplan-druck\[data-messen\] \.druckkopf--nur-druck\s*\{\s*display: block;/,
    );
    // Nur Seite und Seitenname hängen am Druckmedium; Bild, Zeile und Legende gelten beim Messen.
    const druck = /@media print \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(druck).not.toMatch(/lageplan-(figur|unterzeile|legende)/);
    expect(css).toMatch(/\.lageplan-unterzeile\s*\{[^}]*height: 10mm;[^}]*white-space: nowrap;/);
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
