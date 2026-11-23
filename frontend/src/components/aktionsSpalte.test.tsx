import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { antdToken, dichten, farbenHell } from '../theme/tokens';
import { menueSpaltenBreite } from './menueSpalte';
import {
  AktionsInhalt,
  KennungAktionKontext,
  aktionsSpalte,
  aktionsSpaltenBreite,
} from './aktionsSpalte';

/** 7 px je Zeichen, unabhängig von der Schriftgröße. */
const messen = (text: string) => text.length * 7;

describe('aktionsSpaltenBreite (LLH-1789)', () => {
  it('nur ⋮: genau die Breite der Menüspalte', () => {
    for (const d of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      expect(aktionsSpaltenBreite({ dichte: d, messen })).toBe(menueSpaltenBreite(d));
    }
  });

  it('mit Primäraktion: Menüspalte plus Knopf (Beschriftung, Polster, Rand) plus Fuge', () => {
    // „Stand melden“: 12 Zeichen × 7 = 84, + 32 Polster/Rand = 116, + Fuge `abstand.md`.
    for (const d of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      const knopf = Math.max(dichten[d].kleineZeilenhoehe, 116);
      expect(aktionsSpaltenBreite({ dichte: d, primaer: 'Stand melden', messen }), d).toBe(
        menueSpaltenBreite(d) + knopf + dichten[d].abstand.md,
      );
    }
  });

  it('die Fuge ist die Lücke, die antd für `Space size="middle"` setzt (`token.padding`, LLH-1961)', () => {
    // Kompakt 12, komfortabel 20, handschuh 24 px: ein festes Maß stimmte in keiner Stufe.
    for (const d of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      const ohneFuge = menueSpaltenBreite(d) + 116;
      expect(
        aktionsSpaltenBreite({ dichte: d, primaer: 'Stand melden', messen }) - ohneFuge,
        d,
      ).toBe(antdToken(farbenHell, d)?.padding);
    }
  });

  it('ein kurzes Etikett hält mindestens den Knopfboden der Stufe', () => {
    expect(aktionsSpaltenBreite({ dichte: 'handschuh', primaer: 'X', messen })).toBe(
      menueSpaltenBreite('handschuh') + 72 + 24,
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

  const beides = {
    aktion: { etikett: 'Stand melden', onKlick: vi.fn() },
    weitere: {
      eintraege: () => [{ key: 'b', label: 'Bearbeiten' }],
      zugaenglicherName: () => 'Aktionen',
      onWahl: vi.fn(),
    },
  };

  it('in der eigenen Spalte (ab md) bricht die Reihe nicht um und trägt keine Hülle', () => {
    // Die Spalte ist breit genug gerechnet; ein Umbruch dort verdoppelte jede Zeilenhöhe.
    const { container } = renderMitProviders(
      <AktionsInhalt zeile={{ name: 'Nord' }} {...beides} />,
    );
    expect(getComputedStyle(container.querySelector('.ant-space')!).flexWrap).not.toBe('wrap');
    expect(container.querySelector('[data-lfh="datensicht-kennung-aktionsreihe"]')).toBeNull();
  });

  it('in der Kennung (unter md): Hülle mit Mindestbreite, Knopf und ⋮ dürfen umbrechen', () => {
    // Nebeneinander setzte die Reihe die Breite der fixierten Kennung (Betreuungsstellen auf
    // 390 px: +31 px, „frei“ aus dem Bild). `min-content` meldet nur das breiteste Teil,
    // `minWidth: 100%` füllt danach die Zelle.
    const { container } = renderMitProviders(
      <KennungAktionKontext.Provider value={true}>
        <AktionsInhalt zeile={{ name: 'Nord' }} {...beides} />
      </KennungAktionKontext.Provider>,
    );
    const huelle = container.querySelector<HTMLElement>(
      '[data-lfh="datensicht-kennung-aktionsreihe"]',
    )!;
    expect(huelle).not.toBeNull();
    expect(huelle.style.width).toBe('min-content');
    expect(huelle.style.minWidth).toBe('100%');
    expect(getComputedStyle(huelle.querySelector('.ant-space')!).flexWrap).toBe('wrap');
  });

  it('in der Kennung ohne Knopf und ⋮: keine leere Hülle (sie brächte eine Fuge mit)', () => {
    const { container } = renderMitProviders(
      <KennungAktionKontext.Provider value={true}>
        <AktionsInhalt
          zeile={{ name: 'Nord' }}
          aktion={{ etikett: 'Stand melden', onKlick: vi.fn(), sichtbar: () => false }}
        />
      </KennungAktionKontext.Provider>,
    );
    expect(container.querySelector('[data-lfh="datensicht-kennung-aktionsreihe"]')).toBeNull();
  });
});
