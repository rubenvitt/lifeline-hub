import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { GesperrterSprung, SprungKnopf, sprungGesperrtText } from './Sprung';

/**
 * Gemeinsames Sprung-Muster (LFH-968): ein Sprung steht als Knopf in Steuerhöhe mit „↗“, bleibt
 * ein Link (Strg/⌘-Klick öffnet einen Tab) und navigiert beim schlichten Klick in der App. Ein
 * gesperrter Sprung nennt seinen Grund im sichtbaren Text — ein `title` erscheint auf Touch nie.
 */
describe('SprungKnopf (LFH-968)', () => {
  it('ist ein Link mit Ziel und „↗“, der Pfeil gehört nicht zum Namen', () => {
    renderMitProviders(<SprungKnopf to="/einsaetze/1/etb?eintrag=42">Zum ETB-Eintrag</SprungKnopf>);
    const link = screen.getByRole('link', { name: 'Zum ETB-Eintrag' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=42');
    expect(link).toHaveTextContent('Zum ETB-Eintrag ↗');
    // antds Knopfform: die Steuerhöhe kommt aus dem `ConfigProvider`, nicht aus einem Literal.
    expect(link).toHaveClass('ant-btn');
    expect(link).not.toHaveClass('ant-btn-primary');
  });

  it('navigiert beim schlichten Klick in der App', async () => {
    renderMitProviders(
      <Routes>
        <Route path="/start" element={<SprungKnopf to="/ziel">Zum Ziel</SprungKnopf>} />
        <Route path="/ziel" element={<p>angekommen</p>} />
      </Routes>,
      { route: '/start' },
    );
    await userEvent.click(screen.getByRole('link', { name: 'Zum Ziel' }));
    expect(await screen.findByText('angekommen')).toBeInTheDocument();
  });

  it('gesperrt: gesperrter Knopf mit sichtbarem Grund, kein Link', () => {
    renderMitProviders(
      <SprungKnopf to="/einsaetze/1/etb" gesperrt>
        Zum ETB-Eintrag
      </SprungKnopf>,
    );
    const knopf = screen.getByRole('button', { name: 'Zum ETB-Eintrag (Keine Berechtigung)' });
    expect(knopf).toBeDisabled();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('GesperrterSprung (LFH-968)', () => {
  it('nennt den Grund im Text, nicht nur im title', () => {
    renderMitProviders(<GesperrterSprung>Auf Karte zeigen</GesperrterSprung>);
    const knopf = screen.getByRole('button');
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveTextContent('Auf Karte zeigen (Keine Berechtigung)');
    // Der title bleibt als Zusatz (Maus), ist aber nicht mehr die einzige Erklärung.
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
  });

  it('sprungGesperrtText hängt den Grund in Klammern an', () => {
    expect(sprungGesperrtText('Zum ETB-Eintrag')).toBe('Zum ETB-Eintrag (Keine Berechtigung)');
  });
});
