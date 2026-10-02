import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Dropdown } from 'antd';
import { renderMitProviders } from '../test/utils';
import { MenueAusloeser, menueEintraege, type MenueEintrag } from './MenueAusloeser';

/**
 * Das GEÖFFNETE Menü. rc-dropdown mountet lazy und lässt ein geschlossenes Overlay mit
 * `ant-dropdown-hidden` im DOM stehen: ein `queryByRole('menu')` vor dem ersten Öffnen ist immer
 * `null`, danach findet es auch geschlossene. Gesucht wird deshalb über die Overlay-Klasse.
 */
function offenesMenue(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
}

async function oeffne(name: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name }));
  return waitFor(() => {
    const m = offenesMenue();
    expect(m).not.toBeNull();
    return m!;
  });
}

const DREI: readonly MenueEintrag<'bearbeiten' | 'verschieben' | 'stornieren'>[] = [
  { key: 'bearbeiten', label: 'Bearbeiten' },
  { key: 'stornieren', label: 'Stornieren', gefahr: true },
  { key: 'verschieben', label: 'Verschieben' },
];

describe('MenueAusloeser', () => {
  it('ohne Einträge gibt es keinen Auslöser, auch keinen deaktivierten', () => {
    const { container } = renderMitProviders(
      <MenueAusloeser eintraege={[]} zugaenglicherName="Aktionen zu Stelle A" onWahl={vi.fn()} />,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('der Auslöser ist ein Textknopf ohne Beschriftung, das Zeichen ist verborgen', () => {
    renderMitProviders(
      <MenueAusloeser eintraege={DREI} zugaenglicherName="Aktionen zu Stelle A" onWahl={vi.fn()} />,
    );
    const knopf = screen.getByRole('button', { name: 'Aktionen zu Stelle A' });
    expect(knopf).toHaveClass('ant-btn-text');
    expect(knopf.textContent).toBe('');
    const zeichen = knopf.querySelector('svg');
    expect(zeichen).not.toBeNull();
    expect(zeichen!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(knopf).toBeEnabled();
  });

  it('`gesperrt` sperrt den Auslöser, `laeuft` zeigt ihn als ladend', () => {
    renderMitProviders(
      <>
        <MenueAusloeser eintraege={DREI} zugaenglicherName="A" onWahl={vi.fn()} gesperrt />
        <MenueAusloeser eintraege={DREI} zugaenglicherName="B" onWahl={vi.fn()} laeuft />
      </>,
    );
    expect(screen.getByRole('button', { name: 'A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('ant-btn-loading');
  });

  it('das Menü entsteht erst beim Öffnen und ist dann genau eines', async () => {
    renderMitProviders(
      <>
        <MenueAusloeser eintraege={DREI} zugaenglicherName="Zeile 1" onWahl={vi.fn()} />
        <MenueAusloeser eintraege={DREI} zugaenglicherName="Zeile 2" onWahl={vi.fn()} />
      </>,
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const menue = await oeffne('Zeile 2');
    expect(
      document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]'),
    ).toHaveLength(1);
    expect(within(menue).getAllByRole('menuitem')).toHaveLength(3);
  });

  it('neutral in Lieferreihenfolge, EIN Trenner, dann die Gefahr rot', async () => {
    renderMitProviders(
      <MenueAusloeser
        eintraege={[...DREI, { key: 'loeschen', label: 'Löschen', gefahr: true }]}
        zugaenglicherName="Zeile 1"
        onWahl={vi.fn()}
      />,
    );
    const menue = await oeffne('Zeile 1');
    const kinder = [...menue.children].map((k) =>
      k.classList.contains('ant-dropdown-menu-item-divider') ? '—' : k.textContent,
    );
    expect(kinder).toEqual(['Bearbeiten', 'Verschieben', '—', 'Stornieren', 'Löschen']);
    expect(within(menue).getByRole('menuitem', { name: 'Stornieren' })).toHaveClass(
      'ant-dropdown-menu-item-danger',
    );
    expect(within(menue).getByRole('menuitem', { name: 'Bearbeiten' })).not.toHaveClass(
      'ant-dropdown-menu-item-danger',
    );
  });

  it('nur Gefahr: kein Trenner davor', async () => {
    renderMitProviders(
      <MenueAusloeser
        eintraege={[{ key: 'loeschen', label: 'Löschen', gefahr: true }]}
        zugaenglicherName="Zeile 1"
        onWahl={vi.fn()}
      />,
    );
    const menue = await oeffne('Zeile 1');
    expect(menue.querySelector('.ant-dropdown-menu-item-divider')).toBeNull();
  });

  it('ein gesperrter Eintrag steht deaktiviert da und löst nichts aus; das Icon steht am Eintrag', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <MenueAusloeser
        eintraege={[
          { key: 'hoch', label: 'Nach oben', gesperrt: true },
          { key: 'runter', label: 'Nach unten', icon: <span data-testid="icon-runter" /> },
        ]}
        zugaenglicherName="Zeile 1"
        onWahl={onWahl}
      />,
    );
    const menue = await oeffne('Zeile 1');
    const hoch = within(menue).getByRole('menuitem', { name: /Nach oben/ });
    expect(hoch).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(hoch);
    expect(onWahl).not.toHaveBeenCalled();
    const runter = within(menue).getByRole('menuitem', { name: /Nach unten/ });
    expect(within(runter).getByTestId('icon-runter')).toBeInTheDocument();
  });

  it('die Wahl meldet genau einmal den Schlüssel', async () => {
    const onWahl = vi.fn();
    renderMitProviders(
      <MenueAusloeser eintraege={DREI} zugaenglicherName="Zeile 1" onWahl={onWahl} />,
    );
    const menue = await oeffne('Zeile 1');
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Verschieben' }));
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(onWahl).toHaveBeenCalledWith('verschieben');
  });

  /**
   * PORTAL-AUFSTEIGEN (LFH-367/B5g). Das Menü liegt im DOM unter `document.body`, ein Synthetic
   * Event steigt aber durch den KOMPONENTENbaum auf: ein Klick ins Menü erreicht jeden Vorfahren
   * des Auslösers, der `onClick` trägt (Zeile öffnen, Chip bearbeiten). Ein Riegel im
   * `menu.onClick` kommt zu spät und feuert für das Polster gar nicht.
   */
  describe('ein Griff ins Menü erreicht keinen Vorfahren', () => {
    it('weder über einen Eintrag noch über das Polster des Menüs', async () => {
      const vorfahr = vi.fn();
      const onWahl = vi.fn();
      renderMitProviders(
        <div onClick={vorfahr}>
          <MenueAusloeser eintraege={DREI} zugaenglicherName="Zeile 1" onWahl={onWahl} />
        </div>,
      );
      // Der Auslöser selbst darf durchreichen; gezählt wird erst ab dem Öffnen.
      const menue = await oeffne('Zeile 1');
      vorfahr.mockClear();
      await userEvent.click(menue);
      expect(vorfahr).not.toHaveBeenCalled();
      expect(onWahl).not.toHaveBeenCalled();

      await userEvent.click(within(menue).getByRole('menuitem', { name: 'Bearbeiten' }));
      expect(onWahl).toHaveBeenCalledWith('bearbeiten');
      expect(vorfahr).not.toHaveBeenCalled();
    });

    it('ein Klick auf den Auslöser selbst erreicht den Vorfahren weiter', async () => {
      // Gegenhälfte: der Riegel greift nur für das Portal, nicht für den eigenen Teilbaum.
      const vorfahr = vi.fn();
      renderMitProviders(
        <div onClick={vorfahr}>
          <MenueAusloeser eintraege={DREI} zugaenglicherName="Zeile 1" onWahl={vi.fn()} />
        </div>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Zeile 1' }));
      expect(vorfahr).toHaveBeenCalledTimes(1);
    });

    it('Gegenprobe: ein nacktes Dropdown derselben Form reicht den Klick an den Vorfahren', async () => {
      // Belegt die Falle selbst: ohne diesen Fall wäre der erste auch grün, falls antd das
      // Aufsteigen eines Tages von sich aus unterbände, und der Riegel stünde ohne Grund da.
      const vorfahr = vi.fn();
      renderMitProviders(
        <div onClick={vorfahr}>
          <Dropdown trigger={['click']} menu={{ items: menueEintraege(DREI) }}>
            <Button type="text" aria-label="Nackt" />
          </Dropdown>
        </div>,
      );
      const menue = await oeffne('Nackt');
      vorfahr.mockClear();
      await userEvent.click(within(menue).getByRole('menuitem', { name: 'Bearbeiten' }));
      expect(vorfahr).toHaveBeenCalled();
    });
  });
});
