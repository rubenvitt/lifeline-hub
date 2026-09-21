import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import Paneel, { PANEEL_KOPF_HOEHE, paneelKopfStil, paneelStil, paneelZeileStil } from './Paneel';

describe('Paneel', () => {
  it('ist eine Region, benannt über ihre Augenbrauen-Überschrift', () => {
    renderMitProviders(
      <Paneel titel="Einsatzabschnitte" meta="4 Abschnitte · 31 Einheiten">
        <p>Inhalt</p>
      </Paneel>,
    );
    const region = screen.getByRole('region', { name: 'Einsatzabschnitte' });
    expect(region).toContainElement(screen.getByText('Inhalt'));
    expect(screen.getByRole('heading', { level: 2, name: 'Einsatzabschnitte' })).toBeVisible();
    expect(screen.getByText('4 Abschnitte · 31 Einheiten')).toBeInTheDocument();
  });

  it('nimmt die Überschriftenebene vom Aufrufer', () => {
    renderMitProviders(<Paneel titel="Nächste Marken" ueberschrift="h3" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Nächste Marken' })).toBeVisible();
  });

  it('rendert Aktion und Fuß nur, wenn sie übergeben werden', () => {
    const { rerender } = renderMitProviders(<Paneel titel="A" />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <Paneel titel="A" aktion={<button type="button">ETB</button>} fuss={<span>Fuß</span>} />,
    );
    expect(screen.getByRole('button', { name: 'ETB' })).toBeInTheDocument();
    expect(screen.getByText('Fuß')).toBeInTheDocument();
  });

  it('Rahmen linie, Grund paneel, Radius 0 — aus den Rollen', () => {
    expect(paneelStil(farbenHell)).toMatchObject({
      background: farbenHell.paneel,
      border: `1px solid ${farbenHell.linie}`,
      borderRadius: 0,
    });
  });

  it('der Kopf hat 38 px als Boden, nicht als feste Höhe — eine Aktion darf ihn dehnen', () => {
    const stil = paneelKopfStil(farbenHell, { padding: 11, paddingXS: 3 });
    expect(PANEEL_KOPF_HOEHE).toBe(38);
    expect(stil.minHeight).toBe(38);
    expect(stil.height).toBeUndefined();
  });

  it('Zeilen trennt flaeche3 (Entwurf #16191d)', () => {
    expect(paneelZeileStil(farbenHell, { padding: 11, paddingSM: 7 }).borderBlockEnd).toBe(
      `1px solid ${farbenHell.flaeche3}`,
    );
  });
});
