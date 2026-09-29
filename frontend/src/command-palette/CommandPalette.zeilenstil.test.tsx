import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Befehl } from './typen';

/**
 * Belegt, dass BEIDE Renderzweige (flach und gruppiert) denselben Trefflächenboden benutzen. Der
 * Boden ist ein Inline-Style, den `dichte.guard` nicht sieht.
 *
 * `palettenZeilenStil` liegt deshalb in einem eigenen, ersetzbaren Modul: die Marke unten kann nur
 * aus der Funktion stammen; ein Vergleich zweier Zweige bliebe grün, wenn beide dieselbe kopierte
 * Zahl trügen.
 */
vi.mock('./zeilenStil', () => ({
  palettenZeilenStil: () => ({ minHeight: 4242, padding: '1px 2px' }),
  vorschauZielStil: () => ({ minWidth: 4343, padding: '3px 4px' }),
}));

const korpus: Befehl[] = [
  { id: 'modul:etb', gruppe: 'module', label: 'ETB', ausfuehren: () => {} },
];

describe('CommandPalette · Bedienziel-Boden in beiden Zweigen', () => {
  it('nimmt den Zeilenstil im Gruppenzweig (leere Suche)', () => {
    renderMitProviders(<CommandPalette befehle={korpus} schliesse={() => {}} />);

    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: 'ETB' })).toHaveStyle({
      minHeight: '4242px',
      padding: '1px 2px',
    });
  });

  it('nimmt denselben Zeilenstil im flachen Zweig (aktive Suche)', async () => {
    const u = userEvent.setup();
    renderMitProviders(<CommandPalette befehle={korpus} schliesse={() => {}} />);

    await u.type(screen.getByRole('combobox'), 'etb');

    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.getByRole('option', { name: 'ETB' })).toHaveStyle({
      minHeight: '4242px',
      padding: '1px 2px',
    });
  });
});

/**
 * Ein Datensatz-Treffer läuft durch DIESELBE `role="option"`-Schleife; ein eigener Renderzweig
 * verlöre den Boden still.
 */
describe('CommandPalette · Bedienziel-Boden der Datensatz-Zeile', () => {
  it('nimmt denselben Zeilenstil für einen Datensatz-Treffer', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPalette
        befehle={[]}
        datensatzTreffer={[
          {
            befehl: {
              id: 'datensatz:personen:7',
              gruppe: 'datensaetze',
              label: 'Personen · R-042 · Müller',
              ausfuehren: () => {},
            },
            score: 0,
            stufe: 0,
          },
        ]}
        schliesse={() => {}}
      />,
    );

    await u.type(screen.getByRole('combobox'), '42');

    expect(screen.getByRole('option', { name: 'Personen · R-042 · Müller' })).toHaveStyle({
      minHeight: '4242px',
      padding: '1px 2px',
    });
  });
});

/**
 * Das Tippziel nimmt seinen Boden aus `vorschauZielStil` und aus nichts anderem; ein kopierter Wert
 * im JSX fiele hier auf.
 */
describe('CommandPalette · Bedienziel-Boden des Vorschau-Ziels', () => {
  it('nimmt den Stil aus vorschauZielStil', () => {
    renderMitProviders(
      <CommandPalette
        befehle={[
          {
            id: 'datensatz:personen:11',
            gruppe: 'datensaetze',
            label: 'Florian Mustermann',
            vorschau: { art: 'person', einsatzId: 5, id: 11 },
            ausfuehren: () => {},
          },
        ]}
        schliesse={() => {}}
      />,
    );
    const ziel = screen
      .getByRole('option', { name: 'Florian Mustermann' })
      .querySelector('[data-lfh="palette-vorschau-ziel"]');
    expect(ziel).toHaveStyle({ minWidth: '4343px', padding: '3px 4px' });
  });
});
