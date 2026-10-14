import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import MaterialVerdichtung from './MaterialVerdichtung';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';
import { kraefteuebersichtPfad } from '../routing/deeplinks';

const posten = (status: MaterialStatus, menge = 1) => ({ status, menge }) as EinsatzMaterial;

function setup(material: EinsatzMaterial[] | undefined) {
  return renderMitProviders(
    <MaterialVerdichtung einsatzId={1} material={material} pfad={kraefteuebersichtPfad(1)} />,
  );
}

/** Die Materialaussage über der Liste statt der Personalstärke (LLH-1093, design.md D10). */
describe('MaterialVerdichtung', () => {
  it('zählt Posten gegen die Statusachse: 7 einsatzbereit · 3 im Einsatz · 2 Ausfall', () => {
    setup([
      ...Array.from({ length: 7 }, () => posten('einsatzbereit', 40)),
      ...Array.from({ length: 3 }, () => posten('im_einsatz', 2)),
      posten('defekt'),
      posten('verbraucht', 30),
    ]);
    const zeile = screen.getByTestId('material-verdichtung');
    expect(zeile).toHaveTextContent('7 einsatzbereit');
    expect(zeile).toHaveTextContent('3 im Einsatz');
    expect(zeile).toHaveTextContent('2 Ausfall');
  });

  it('nennt keine Personal- oder Fahrzeugzahl', () => {
    setup([posten('einsatzbereit')]);
    const zeile = screen.getByTestId('material-verdichtung');
    expect(zeile.textContent).not.toMatch(/Stärke|Fzg|verfügbar|\/\//);
  });

  it('tönt Ausfall nur bei mehr als null, das Wort steht immer daneben', () => {
    const { unmount } = setup([posten('einsatzbereit')]);
    const ohne = screen.getByText('0 Ausfall');
    expect(ohne.getAttribute('data-ton')).toBeNull();
    unmount();

    setup([posten('desinfektion_noetig'), posten('defekt')]);
    const mit = screen.getByText('2 Ausfall');
    // Die Textrolle des schwersten Status im Topf: defekt (alarm) vor Desinfektion (achtung).
    expect(mit.getAttribute('data-ton')).toBe('alarm');
    expect(mit.style.color).not.toBe('');
  });

  it('bleibt ohne Daten stumm, statt eine Null zu behaupten', () => {
    const { container } = setup(undefined);
    expect(container.textContent).toBe('');
  });

  it('verlinkt auf das Meldebild', () => {
    setup([]);
    expect(screen.getByRole('link', { name: 'Meldebild' })).toHaveAttribute(
      'href',
      '/einsaetze/1/kraefteuebersicht',
    );
  });
});
