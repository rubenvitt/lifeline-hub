import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import {
  SpaltenSchalter,
  sichtbareSpalten,
  weichtVonVorgabeAb,
  type SchaltbareSpalte,
} from './SpaltenSchalter';

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

  it('das Kästchen im Eintrag trägt keinen eigenen Boden — der Menüeintrag ist das Ziel (LFH-907)', async () => {
    renderMitProviders(
      <SpaltenSchalter bezeichnung="Quellen" spalten={SPALTEN} aus={[]} onAus={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });
    const kaestchen = within(menue)
      .getByRole('menuitem', { name: 'URL' })
      .querySelector<HTMLElement>('label.ant-checkbox-wrapper');
    expect(kaestchen, 'Kästchen im Eintrag').not.toBeNull();
    expect(kaestchen!.style.minHeight).toBe('0px');
  });
});

describe('Zähler erst nach eigener Wahl (LLH-1790, Spec katalogtabelle-spaltenschalter)', () => {
  const MIT_VOR: readonly SchaltbareSpalte<Schluessel | 'sortierung'>[] = [
    ...SPALTEN,
    { key: 'sortierung', title: 'Sortierung' },
  ];

  it('weichtVonVorgabeAb: Breite und Voreinstellung sind Vorgabe, jede Handwahl nicht', () => {
    const vor = ['sortierung'] as const;
    const pruefe = (verborgen: Schluessel[] | string[], eingeblendet: string[] = []) =>
      weichtVonVorgabeAb<string>({
        verborgen: new Set(verborgen),
        eingeblendet: new Set(eingeblendet),
        voreinstellung: vor,
      });
    expect(pruefe(['sortierung'])).toBe(false);
    expect(pruefe([])).toBe(true);
    expect(pruefe(['sortierung', 'url'])).toBe(true);
    expect(pruefe(['sortierung'], ['url'])).toBe(true);
    expect(weichtVonVorgabeAb({ verborgen: new Set(), voreinstellung: [] })).toBe(false);
  });

  it('der Schalter heißt „Spalten“, solange die Vorgabe gilt, und zählt nach eigener Wahl alle', async () => {
    setzeViewportBreite(800);
    const { rerender } = renderMitProviders(
      <SpaltenSchalter
        bezeichnung="Quellen"
        spalten={MIT_VOR}
        aus={['sortierung']}
        voreinstellung={['sortierung']}
        onAus={() => {}}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Spalten — Quellen' })).toBeInTheDocument();
    rerender(
      <SpaltenSchalter
        bezeichnung="Quellen"
        spalten={MIT_VOR}
        aus={[]}
        voreinstellung={['sortierung']}
        onAus={() => {}}
      />,
    );
    // Sortierung von Hand eingeblendet: URL und Attribution fehlen weiter nach Breite.
    expect(
      await screen.findByRole('button', { name: 'Spalten · 2 ausgeblendet — Quellen' }),
    ).toBeInTheDocument();
  });
});
