import { render } from '@testing-library/react';
import { contrastSurface } from '@einsatzzeichen/core';
import { describe, expect, it } from 'vitest';
import EinsatzZeichen, { FunktionsZeichen } from './EinsatzZeichen';
import { ZEICHEN_THEME_DUNKEL } from './zeichenTheme';

/** Striche in der Farbe der Hinterlegung des Themes `dark`: die Hinterlegung entlang der Kontur. */
const hinterlegung = (svg: Element) =>
  svg.querySelectorAll(`[stroke="${contrastSurface(ZEICHEN_THEME_DUNKEL)}"]`).length;

describe('EinsatzZeichen', () => {
  it('rendert für ein darstellbares Fachobjekt genau ein svg in der verlangten Größe', () => {
    const { container } = render(
      <EinsatzZeichen
        tz={{ grundzeichen: 'taktische-formation', organisation: 'thw' }}
        size={22}
      />,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute('width')).toBe('22');
  });

  it('rendert nichts, wenn nicht einmal der Körper darstellbar ist', () => {
    const { container } = render(
      <EinsatzZeichen tz={{ grundzeichen: 'gibt-es-nicht' as 'person' }} size={22} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('vergibt in einer Liste keine id doppelt', () => {
    const tz = { grundzeichen: 'taktische-formation', organisation: 'feuerwehr' } as const;
    const { container } = render(
      <>
        <EinsatzZeichen tz={tz} size={22} />
        <EinsatzZeichen tz={tz} size={22} />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // LLH-1409: Zeichen ohne Organisation zeichnet die Bibliothek mit schwarzem Umriss ohne Fläche;
  // nachts hinterlegt das Theme `dark` die Kontur selbst hell, statt eines hellen Quadrats dahinter
  // (Messung im e2e „Zeichenkontrast“).
  it('zeichnet mit dem Theme `dark` die Hinterlegung entlang der Kontur, ohne Fläche dahinter', () => {
    const { container } = render(
      <EinsatzZeichen
        tz={{ grundzeichen: 'taktische-formation' }}
        size={22}
        theme={ZEICHEN_THEME_DUNKEL}
      />,
    );
    const svg = container.querySelector('svg')!;
    expect(hinterlegung(svg)).toBeGreaterThan(0);
    expect(svg.style.backgroundColor).toBe('');
    expect(svg.getAttribute('width')).toBe('22');
  });

  it('zeichnet ohne Theme mit der Referenzpalette, ohne Hinterlegung und ohne Fläche', () => {
    const { container } = render(
      <EinsatzZeichen tz={{ grundzeichen: 'taktische-formation' }} size={22} />,
    );
    const svg = container.querySelector('svg')!;
    expect(hinterlegung(svg)).toBe(0);
    expect(svg.style.backgroundColor).toBe('');
  });

  it('reicht das Theme auch an ein Funktionszeichen durch', () => {
    const { container } = render(
      <FunktionsZeichen funktion={{ kuerzel: 'S2' }} size={22} theme={ZEICHEN_THEME_DUNKEL} />,
    );
    expect(hinterlegung(container.querySelector('svg')!)).toBeGreaterThan(0);
  });
});
