import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { menueSpaltenBreite } from './menueSpalte';
import { AktionsInhalt, aktionsSpalte, aktionsSpaltenBreite } from './aktionsSpalte';

/** 7 px je Zeichen, unabhängig von der Schriftgröße. */
const messen = (text: string) => text.length * 7;

describe('aktionsSpaltenBreite (LLH-1789)', () => {
  it('nur ⋮: genau die Breite der Menüspalte', () => {
    for (const d of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      expect(aktionsSpaltenBreite({ dichte: d, messen })).toBe(menueSpaltenBreite(d));
    }
  });

  it('mit Primäraktion: Menüspalte plus Knopf (Beschriftung, Polster, Rand) plus Fuge', () => {
    // „Stand melden“: 12 Zeichen × 7 = 84, + 32 Polster/Rand = 116, + 16 Fuge.
    expect(aktionsSpaltenBreite({ dichte: 'kompakt', primaer: 'Stand melden', messen })).toBe(
      menueSpaltenBreite('kompakt') + 116 + 16,
    );
  });

  it('ein kurzes Etikett hält mindestens den Knopfboden der Stufe', () => {
    expect(aktionsSpaltenBreite({ dichte: 'handschuh', primaer: 'X', messen })).toBe(
      menueSpaltenBreite('handschuh') + 72 + 16,
    );
  });
});

describe('aktionsSpalte (LLH-1789)', () => {
  it('trägt Schlüssel, Sichtbarkeit und die Marke für die Fixierung', () => {
    const s = aktionsSpalte<{ id: number }>({ dichte: 'kompakt', schrift: '' });
    expect(s.key).toBe('aktionen');
    expect(s.immerSichtbar).toBe(true);
    expect(s.amEnde).toBe(true);
    expect(s.width).toBe(menueSpaltenBreite('kompakt'));
  });

  it('zeigt Primäraktion und ⋮ mit Zeilenkennung; ohne beides nichts', async () => {
    const onKlick = vi.fn();
    const onWahl = vi.fn();
    const zeile = { name: 'Nord' };
    const { container, rerender } = renderMitProviders(
      <AktionsInhalt
        zeile={zeile}
        aktion={{
          etikett: 'Stand melden',
          onKlick,
          zugaenglicherName: (z) => `Stand melden für Bezirk ${z.name}`,
        }}
        weitere={{
          eintraege: () => [{ key: 'b', label: 'Bearbeiten' }],
          zugaenglicherName: (z) => `Aktionen zu Bezirk ${z.name}`,
          onWahl,
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Stand melden für Bezirk Nord' }));
    expect(onKlick).toHaveBeenCalledWith(zeile);
    expect(screen.getByRole('button', { name: 'Aktionen zu Bezirk Nord' })).toBeInTheDocument();

    rerender(
      <AktionsInhalt
        zeile={zeile}
        aktion={{ etikett: 'Stand melden', onKlick, sichtbar: () => false }}
      />,
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
