// frontend/src/command-palette/CommandPalette.zeilenstil.test.tsx
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Befehl } from './typen';

/**
 * Belegt, dass BEIDE Renderzweige der Palette denselben Trefflächenboden benutzen
 * (LFH-391 · A3).
 *
 * Seit A3 rendert die Palette bei aktiver Suche flach und bei leerer Suche gruppiert. Der
 * Bedienziel-Boden aus LFH-365 (`minHeight` + Polsterung) ist ein Inline-Style — `dichte.guard`
 * sieht ihn strukturell NICHT, ein Pixel-Padding ist keine Größen-Prop. Ginge er in einem der
 * beiden Zweige verloren, fiele kein Gate und kein anderer Test darauf; genau das ist der
 * Grund für die gemeinsame Renderfunktion, und diese Datei ist ihr Nachweis.
 *
 * Deshalb liegt `palettenZeilenStil` in einem EIGENEN Modul statt neben der Komponente
 * (Präzedenz `bedienzielStil` in `pages/lagekarte/Sidebar.tsx` gilt der Bauform, nicht dem
 * Ort): eine Funktion in der Datei, die man testet, lässt sich nicht ersetzen — und ein
 * Vergleich der zwei gerenderten Zweige gegeneinander bliebe grün, wenn beide dieselbe
 * kopierte Zahl trügen. Die Marke unten kann nur aus der Funktion stammen.
 */
vi.mock('./zeilenStil', () => ({
  palettenZeilenStil: () => ({ minHeight: 4242, padding: '1px 2px' }),
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
 * Die dritte Zeilensorte (LFH-391 · C3): ein Datensatz-Treffer.
 *
 * Er entsteht in `baueDatensatzTreffer` und kommt als `Treffer` herein statt als `Befehl` —
 * genau die Stelle, an der ein eigener Renderzweig naheläge (zweizeilige Treffer, eigene
 * Beschriftungsform). Er läuft deshalb ausdrücklich durch DIESELBE `role="option"`-Schleife;
 * ein eigener Zweig verlöre den Bedienziel-Boden still, und `dichte.guard.test.ts` sieht ein
 * Pixel-Padding strukturell nicht.
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
