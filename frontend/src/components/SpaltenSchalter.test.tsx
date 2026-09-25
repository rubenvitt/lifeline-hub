import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { SpaltenSchalter, sichtbareSpalten, type SchaltbareSpalte } from './SpaltenSchalter';

/**
 * Die geteilte Zählwahrheit (LFH-374). Die Bestandsfälle — Index 0 nie entfernbar, beide
 * Ursachen in EINEM Zähler, doppelt verborgen einmal gezählt — stehen weiter in
 * `Datensicht.test.tsx`, weil sie dort über den Weiterexport laufen und damit BEIDE Wege
 * belegen. Hier steht, was D9 neu hinzubringt: die Handwahl, die die Breite überstimmt.
 */
type Schluessel = 'name' | 'url' | 'attribution';

const SPALTEN: readonly SchaltbareSpalte<Schluessel>[] = [
  { key: 'name', title: 'Name' },
  { key: 'url', title: 'URL', abBreite: 'lg' },
  { key: 'attribution', title: 'Attribution', abBreite: 'lg' },
];

const schmal = () => false;
const schluessel = (s: readonly SchaltbareSpalte<Schluessel>[]) => s.map((x) => x.key);

describe('sichtbareSpalten() · eingeblendet (D9)', () => {
  it('eine per Breite weggefallene Spalte kommt über `eingeblendet` zurück', () => {
    const ohne = sichtbareSpalten({
      spalten: SPALTEN,
      verborgen: new Set<Schluessel>(),
      abBreite: schmal,
    });
    expect(schluessel(ohne.spalten)).toEqual(['name']);
    expect(ohne.anzahlVerborgen).toBe(2);

    const mit = sichtbareSpalten({
      spalten: SPALTEN,
      verborgen: new Set<Schluessel>(),
      eingeblendet: new Set<Schluessel>(['url']),
      abBreite: schmal,
    });
    expect(schluessel(mit.spalten)).toEqual(['name', 'url']);
    expect(mit.anzahlVerborgen).toBe(1);
  });

  it('die Handauswahl `verborgen` gewinnt über `eingeblendet`', () => {
    const ergebnis = sichtbareSpalten({
      spalten: SPALTEN,
      verborgen: new Set<Schluessel>(['url']),
      eingeblendet: new Set<Schluessel>(['url']),
      abBreite: () => true,
    });
    expect(schluessel(ergebnis.spalten)).toEqual(['name', 'attribution']);
    expect(ergebnis.anzahlVerborgen).toBe(1);
  });
});

describe('SpaltenSchalter · ohne onAn (Seitenvariante)', () => {
  it('eine per Breite weggefallene Spalte ist gesperrt statt still wirkungslos', async () => {
    /**
     * Ohne `onAn` kann der Schalter eine weggefallene Spalte nicht zurückholen. Ein
     * klickbarer Eintrag, der dann nichts tut, wäre das „Opt-in, das still nichts tut" —
     * also gesperrt, und ein Klick darauf meldet nichts nach oben.
     */
    setzeViewportBreite(800);
    const onAus = vi.fn();
    renderMitProviders(
      <SpaltenSchalter bezeichnung="Quellen" spalten={SPALTEN} aus={[]} onAus={onAus} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });
    const url = within(menue).getByRole('menuitem', { name: 'URL' });
    expect(url).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(url);
    expect(onAus).not.toHaveBeenCalled();
  });
});
