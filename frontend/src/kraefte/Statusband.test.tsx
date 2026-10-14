import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Statusband from './Statusband';
import type { BandZelle } from './meldebildRaster';

function zelle(
  schluessel: string,
  ton: BandZelle['ton'],
  wert = 1,
  code: string | null = schluessel.toUpperCase(),
): BandZelle {
  return { schluessel, code, wert, wort: `Wort ${schluessel}`, ton };
}

/** Die Kennzahl einer Gruppe des Bands. */
const kennzahl = (name: string) =>
  screen.getByRole('region', { name }).querySelector('[data-lfh="kennzahl"]') as HTMLElement;

describe('Statusband (Kennzahl mit Aufgliederung, LLH-1025)', () => {
  it('die Zahl führt: Einheiten der Auswahl, aufgegliedert je FMS-Status', () => {
    renderMitProviders(
      <Statusband
        einheiten={[
          zelle('s3', 'achtung', 2),
          zelle('s4', 'achtung', 1),
          zelle('x', 'neutral', 1, null),
        ]}
        personal={[]}
        zustand="daten"
      />,
    );
    const k = kennzahl('Einheiten je Status');
    expect(k.querySelector('[data-lfh="kennzahl-wert"]')).toHaveTextContent(/^4$/);
    // Ein Bild mit Wortlaut, die Legende sagt dasselbe fürs Auge; ohne Code steht das Wort.
    expect(
      screen.getByRole('img', { name: 'Einheiten nach Status: S3 2, S4 1, Wort x 1' }),
    ).toBeInTheDocument();
    expect(k).toHaveTextContent('S3 2 · S4 1 · Wort x 1');
  });

  it('Personal als Zahl mit Aufgliederung je Zustand', () => {
    renderMitProviders(
      <Statusband einheiten={[]} personal={[zelle('p1', 'achtung', 12, null)]} zustand="daten" />,
    );
    const k = kennzahl('Personal je Status');
    expect(k.querySelector('[data-lfh="kennzahl-wert"]')).toHaveTextContent(/^12$/);
    expect(
      screen.getByRole('img', { name: 'Personal nach Status: Wort p1 12' }),
    ).toBeInTheDocument();
  });

  it.each([1440, 1024, 390])('bei %i px keine Füllkachel, auch bei wenigen Status', (breite) => {
    setzeViewportBreite(breite);
    const { container } = renderMitProviders(
      <Statusband
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[zelle('p1', 'achtung', 12, null)]}
        zustand="daten"
      />,
    );
    expect(container.querySelectorAll('[data-lfh="meldebild-bandluecke"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-lfh="kennzahl"]')).toHaveLength(2);
  });

  it('„keine Rückmeldung“ als dritte Kennzahl nur, wenn es sie gibt (LFH-610)', () => {
    const { rerender } = renderMitProviders(
      <Statusband
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[]}
        rueckmeldung={{
          schluessel: 'rueckmeldung-keine',
          code: null,
          wert: 2,
          wort: 'keine Rückmeldung',
          ton: 'alarm',
        }}
        zustand="daten"
      />,
    );
    const k = kennzahl('Einheiten ohne Rückmeldung');
    expect(k).toHaveAttribute('data-ton', 'alarm');
    expect(k).toHaveTextContent('2');
    expect(k).toHaveTextContent('keine Rückmeldung');
    rerender(<Statusband einheiten={[zelle('s4', 'achtung', 3)]} personal={[]} zustand="daten" />);
    expect(screen.queryByRole('region', { name: 'Einheiten ohne Rückmeldung' })).toBeNull();
  });

  it('der Hinweis zu Mittelfiltern steht als Notiz an den Einheiten', () => {
    renderMitProviders(
      <Statusband
        einheiten={[zelle('s4', 'achtung', 3)]}
        einheitenHinweis="ungefiltert"
        personal={[]}
        zustand="daten"
      />,
    );
    expect(screen.getByRole('region', { name: 'Einheiten je Status' })).toHaveTextContent(
      'ungefiltert',
    );
  });

  it('laden und Fehler: Platzhalter statt einer Null', () => {
    renderMitProviders(<Statusband einheiten={[]} personal={[]} zustand="fehler" />);
    expect(screen.getAllByText('Stand unbekannt').length).toBeGreaterThan(0);
  });
});
