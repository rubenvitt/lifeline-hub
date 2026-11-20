import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import EinsatzfunktionZelle from './EinsatzfunktionZelle';

/**
 * Overlays in Zeilen erst bei Bedarf (LLH-1974): der Tooltip „Funktion eintragen“ hängt sich erst
 * beim ersten Überfahren des Stifts ein (antd zeigt ihn nur dabei). Der Spy um antds echten `Tooltip` zählt,
 * ob er eingehängt wurde.
 */
const tooltip = vi.hoisted(() => ({ aufrufe: 0 }));
vi.mock('antd', async (original) => {
  const antd = await original<typeof import('antd')>();
  const Echt = antd.Tooltip;
  function TooltipSpy(props: React.ComponentProps<typeof Echt>) {
    tooltip.aufrufe += 1;
    return <Echt {...props} />;
  }
  return { ...antd, Tooltip: Object.assign(TooltipSpy, Echt) };
});

const STIFT = 'Funktion zu Anna Muster eintragen';

function zelle() {
  renderMitProviders(
    <>
      <button type="button">davor</button>
      <EinsatzfunktionZelle
        name="Anna Muster"
        funktion="Notfallsanitäter"
        vorschlaege={[]}
        darfSchreiben
        onSpeichern={vi.fn().mockResolvedValue(undefined)}
      />
    </>,
  );
}

describe('EinsatzfunktionZelle · Tooltip erst bei Bedarf (LLH-1974)', () => {
  it('hängt vor dem ersten Überfahren keinen Tooltip ein', () => {
    tooltip.aufrufe = 0;
    zelle();
    expect(tooltip.aufrufe).toBe(0);
  });

  it('zeigt den Tooltip beim ersten Überfahren', async () => {
    zelle();
    await userEvent.hover(screen.getByRole('button', { name: STIFT }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Funktion eintragen');
  });

  it('behält den Fokus am Stift, wenn der Tooltip beim Überfahren eingehängt wird', async () => {
    zelle();
    screen.getByRole('button', { name: 'davor' }).focus();
    await userEvent.tab();
    const stift = screen.getByRole('button', { name: STIFT });
    expect(stift).toHaveFocus();
    await userEvent.hover(stift);
    await screen.findByRole('tooltip');
    expect(screen.getByRole('button', { name: STIFT })).toBe(stift);
    expect(stift).toHaveFocus();
  });
});
