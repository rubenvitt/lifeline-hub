import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from './utils';
import { waehleMenueEintrag } from './menue';
import { MenueAusloeser } from '../components/MenueAusloeser';

/**
 * Die Testhilfe wählt nur im Menü, das sie eben geöffnet hat (LLH-1537): Ein geschlossenes Menü
 * bleibt in jsdom eingehängt, sein gleichnamiger Eintrag darf einen fehlenden im neuen Menü nicht
 * vertreten.
 */
function zweiMenues(onWahlA = vi.fn(), onWahlB = vi.fn()) {
  renderMitProviders(
    <>
      <MenueAusloeser
        eintraege={[
          { key: 'bearbeiten', label: 'Bearbeiten' },
          { key: 'verschieben', label: 'Verschieben' },
        ]}
        zugaenglicherName="Aktionen zu Stelle A"
        onWahl={onWahlA}
      />
      <MenueAusloeser
        eintraege={[
          { key: 'verschieben', label: 'Verschieben' },
          { key: 'stornieren', label: 'Stornieren', gefahr: true },
        ]}
        zugaenglicherName="Aktionen zu Stelle B"
        onWahl={onWahlB}
      />
    </>,
  );
  return {
    a: screen.getByRole('button', { name: 'Aktionen zu Stelle A' }),
    b: screen.getByRole('button', { name: 'Aktionen zu Stelle B' }),
  };
}

describe('waehleMenueEintrag', () => {
  it('wählt im zuletzt geöffneten Menü, auch wenn ein früheres denselben Eintrag trägt', async () => {
    const onWahlA = vi.fn();
    const onWahlB = vi.fn();
    const { a, b } = zweiMenues(onWahlA, onWahlB);

    await waehleMenueEintrag(a, 'Verschieben');
    await waehleMenueEintrag(b, 'Verschieben');

    expect(onWahlA).toHaveBeenCalledTimes(1);
    expect(onWahlB).toHaveBeenCalledTimes(1);
    expect(onWahlB).toHaveBeenCalledWith('verschieben');
  });

  it('scheitert laut, wenn nur ein geschlossenes Menü den Eintrag trägt', async () => {
    const onWahlA = vi.fn();
    const { a, b } = zweiMenues(onWahlA);

    await waehleMenueEintrag(a, 'Verschieben');
    await expect(waehleMenueEintrag(b, 'Bearbeiten')).rejects.toThrow(
      'Unable to find role="menuitem" and name "Bearbeiten"',
    );

    expect(onWahlA).toHaveBeenCalledTimes(1);
  });
});
