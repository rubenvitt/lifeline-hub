import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { dichten, rahmenFarben } from '../theme/tokens';
import CommandPaletteTrigger, {
  SUCHFELD_TEXT,
  suchKuerzelFuerUserAgent,
  suchfeldStil,
} from './CommandPaletteTrigger';

vi.mock('../command-palette/useBefehle', () => ({ useBefehle: () => [] }));

function zeige() {
  return renderMitProviders(
    <CommandPaletteProvider>
      <CommandPaletteTrigger />
    </CommandPaletteProvider>,
  );
}

describe('CommandPaletteTrigger', () => {
  beforeEach(() => setzeViewportBreite(1024));

  it('öffnet die Palette per Klick und übergibt ihr den Fokus', async () => {
    const u = userEvent.setup();
    zeige();

    await u.click(screen.getByRole('button', { name: 'Suchen' }));

    expect(await screen.findByRole('combobox')).toHaveFocus();
  });

  it('steht breit als Suchfeld: Hinweistext, Plattformkürzel, Name bleibt „Suchen"', () => {
    zeige();

    const knopf = screen.getByRole('button', { name: 'Suchen' });
    // Der Hinweistext ist Beiwerk; der zugängliche Name bleibt „Suchen" (e2e-Suiten).
    expect(knopf).toHaveTextContent(SUCHFELD_TEXT);
    expect(screen.getByText('Strg+K', { selector: 'kbd' })).toBeInTheDocument();
    // Nur, was funktioniert: keine Koordinatensuche versprochen (Neuentwurf-Text gekürzt).
    expect(SUCHFELD_TEXT).not.toMatch(/Koordinate/);
  });

  it('trägt als Suchfeld ZWEI Angaben über die Dichtestufen (LFH-365)', () => {
    const tokenFuer = (s: keyof typeof dichten) => ({
      controlHeight: dichten[s].zeilenhoehe,
      paddingSM: dichten[s].abstand.sm,
      paddingXS: dichten[s].abstand.xs,
    });
    expect(suchfeldStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(suchfeldStil(tokenFuer('handschuh')).minHeight).toBe(72);
    expect(suchfeldStil(tokenFuer('handschuh')).padding).toBe('7px 16px');
    expect(suchfeldStil(tokenFuer('kompakt')).maxWidth).toBe(520);
    expect(suchfeldStil(tokenFuer('kompakt')).background).toBe(rahmenFarben.feld);
  });

  it('nutzt für das sichtbare Kürzel das Betriebssystem des Nutzers', () => {
    expect(suchKuerzelFuerUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('⌘K');
    expect(suchKuerzelFuerUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Strg+K');
  });

  it('bleibt unter lg eine benannte 48-px-Icon-Trefffläche in der Rahmen-Vordergrundrolle', () => {
    setzeViewportBreite(390);
    zeige();

    const trigger = screen.getByRole('button', { name: 'Suchen' });
    expect(trigger).toHaveAttribute('aria-label', 'Suchen');
    expect(trigger.style.width).toBe('48px');
    expect(trigger.style.height).toBe('48px');
    expect(trigger.style.minWidth).toBe('48px');
    expect(trigger.style.minHeight).toBe('48px');
    // Der Kopf ist in beiden Modi dunkel — Vordergrund aus `rahmenFarben`, nicht dem Modus.
    expect(trigger).toHaveStyle({ color: rahmenFarben.text });
    expect(trigger.querySelector('kbd')).toBeNull();
  });
});
