import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SchichtplanGrenzwerte } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { farbenHell } from '../theme/tokens';
import DauerMitEinstufung from './DauerMitEinstufung';

const VORGABE: SchichtplanGrenzwerte = {
  max_dienst_minuten: 720,
  min_ruhe_minuten: 480,
  max_dienst_eigen: false,
  min_ruhe_eigen: false,
};
const zeit = (utc: string) => utc.slice(11, 16);

function hexZuRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

// Spec `kraefte-zeitachse`, „Einstufung gegen die Grenzwerte des Einsatzes“ (LLH-730).
describe('DauerMitEinstufung', () => {
  it('ohne Einstufung: nur die Zahl, neutral, wie bisher', () => {
    renderMitProviders(
      <DauerMitEinstufung
        lfh="im-einsatz"
        minuten={460}
        einstufung={null}
        grenzwerte={VORGABE}
        zeit={zeit}
        zusatz="seit Alarmierung 06:10"
      />,
    );
    const zelle = document.querySelector('[data-lfh="im-einsatz"]') as HTMLElement;
    expect(zelle.textContent).toBe('7 h 40, seit Alarmierung 06:10');
    expect(zelle.title).toBe('seit Alarmierung 06:10');
    expect(document.querySelector('[data-lfh="dauer-einstufung"]')).toBeNull();
  });

  it('„zu lang“: Wort in der Rolle achtung, Beschreibung mit Strecke und Höchstwert', () => {
    renderMitProviders(
      <DauerMitEinstufung
        lfh="im-einsatz"
        minuten={390}
        einstufung={{
          wort: 'zu_lang',
          streckeBeginnAt: '2026-09-30 08:00:00',
          streckeMinuten: 870,
          ruheMinuten: 120,
        }}
        grenzwerte={VORGABE}
        zeit={zeit}
        zusatz="seit Alarmierung 16:00"
      />,
    );
    const wort = screen.getByText('zu lang');
    expect(wort.closest('[data-lfh="dauer-einstufung"]')).not.toBeNull();
    expect((wort.closest('[data-lfh="dauer-einstufung"]') as HTMLElement).style.color).toBe(
      hexZuRgb(farbenHell.achtungText),
    );
    const zelle = document.querySelector('[data-lfh="im-einsatz"]') as HTMLElement;
    const text =
      'Im Dienst seit 08:00: 14 h 30, Höchstwert 12 h · Ruhe davor 2 h 00, Mindestruhe 8 h';
    expect(zelle.title).toBe(`seit Alarmierung 16:00 · ${text}`);
    expect(zelle.textContent).toBe(`6 h 30 zu lang, seit Alarmierung 16:00. ${text}`);
  });

  it('„Ruhe zu kurz“ ohne Zusatz', () => {
    renderMitProviders(
      <DauerMitEinstufung
        minuten={60}
        einstufung={{
          wort: 'ruhe_zu_kurz',
          streckeBeginnAt: '2026-09-30 08:00:00',
          streckeMinuten: 540,
          ruheMinuten: 120,
        }}
        grenzwerte={VORGABE}
        zeit={zeit}
      />,
    );
    expect(screen.getByText('Ruhe zu kurz')).toBeTruthy();
    expect(
      screen.getByTitle(/^Ruhe davor 2 h 00, Mindestruhe 8 h · Im Dienst seit 08:00/),
    ).toBeTruthy();
  });

  it('ohne Grenzwerte keine Einstufung, auch wenn eine übergeben wird', () => {
    renderMitProviders(
      <DauerMitEinstufung
        minuten={740}
        einstufung={{
          wort: 'zu_lang',
          streckeBeginnAt: '2026-09-30 06:10:00',
          streckeMinuten: 740,
          ruheMinuten: null,
        }}
        grenzwerte={undefined}
        zeit={zeit}
      />,
    );
    expect(screen.queryByText('zu lang')).toBeNull();
    expect(screen.getByText('12 h 20')).toBeTruthy();
  });
});
