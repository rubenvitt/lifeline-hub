import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, theme as antdTheme } from 'antd';
import type { KartenAnsicht } from '../../api/types';
import {
  antdAlgorithmus,
  antdKomponenten,
  antdToken,
  farbenDunkel,
  farbenHell,
} from '../../theme/tokens';
import AnsichtSwitcher from './AnsichtSwitcher';

function ansicht(over: Partial<KartenAnsicht>): KartenAnsicht {
  return {
    id: 1,
    einsatz_id: 5,
    name: 'Standard',
    reihenfolge: 0,
    ist_standard: true,
    erstellt_at: '',
    geaendert_at: '',
    ...over,
  } as KartenAnsicht;
}

const ANSICHTEN = [
  ansicht({ id: 1, name: 'Gesamtlage', ist_standard: true }),
  ansicht({ id: 2, name: 'Abschnitt Nord', ist_standard: false }),
];

function baue(over: Partial<React.ComponentProps<typeof AnsichtSwitcher>> = {}) {
  const props = {
    ansichten: ANSICHTEN,
    aktiveAnsichtId: 2,
    darfSchreiben: true,
    onWaehlen: vi.fn(),
    onNeu: vi.fn(),
    onUmbenennen: vi.fn(),
    onStandard: vi.fn(),
    onLoeschen: vi.fn(),
    ...over,
  };
  render(<AnsichtSwitcher {...props} />);
  return props;
}

describe('AnsichtSwitcher', () => {
  it('zeigt die aktive Ansicht', () => {
    baue({ aktiveAnsichtId: 2 });
    expect(screen.getByText('Abschnitt Nord')).toBeInTheDocument();
  });

  it('„Neue Ansicht" öffnet den Namensdialog und ruft onNeu mit dem Namen', async () => {
    const user = userEvent.setup();
    const props = baue();
    await user.click(screen.getByLabelText('Ansichts-Aktionen'));
    await user.click(await screen.findByText('Neue Ansicht …'));
    const input = await screen.findByLabelText('Ansichts-Name');
    await user.type(input, 'Gefahrstoff');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(props.onNeu).toHaveBeenCalledWith('Gefahrstoff');
  });

  it('Löschen ist bei einer Standardansicht gesperrt', async () => {
    const user = userEvent.setup();
    const props = baue({ aktiveAnsichtId: 1 }); // die Standardansicht ist aktiv
    await user.click(screen.getByLabelText('Ansichts-Aktionen'));
    const loeschen = await screen.findByRole('menuitem', { name: /Löschen/ });
    // antd markiert disabled-Items via aria-disabled
    expect(loeschen).toHaveAttribute('aria-disabled', 'true');
    // Ein Klick darf nichts auslösen.
    await user.click(loeschen);
    expect(props.onLoeschen).not.toHaveBeenCalled();
  });

  it('ohne Schreibrecht gibt es kein Aktions-Menü', () => {
    baue({ darfSchreiben: false });
    expect(screen.queryByLabelText('Ansichts-Aktionen')).not.toBeInTheDocument();
  });
});

/** Relative Leuchtdichte nach WCAG; `rgba()` wird vorher über `grund` gelegt. */
function luminanz(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function deckend(farbe: string, grund: string): string {
  const m = /^rgba?\(([^)]+)\)$/.exec(farbe.trim());
  if (!m) return farbe;
  const [r, g, b, a = 1] = m[1].split(',').map((t) => Number.parseFloat(t));
  const unten = [0, 2, 4].map((i) => Number.parseInt(grund.replace('#', '').slice(i, i + 2), 16));
  return (
    '#' +
    [r, g, b]
      .map((k, i) => Math.round(k * a + unten[i] * (1 - a)))
      .map((k) => k.toString(16).padStart(2, '0'))
      .join('')
  );
}
function kontrast(a: string, b: string): number {
  const [x, y] = [luminanz(a), luminanz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Der Stern kennzeichnet die Standardansicht (LFH-704). Er ist Zusatz, keine Warnung: „Als
 * Standard“ steht im Menü. Er trägt deshalb die Iconrolle `schwach` (LFH-643), nicht `achtung`,
 * und folgt dem Modus. Boden ist der Nicht-Text-Kontrast ≥ 3 : 1 gegen jeden Grund, auf dem er im
 * Auswahlfeld steht: Feld, Klappliste, Option unter dem Zeiger, gewählte Option.
 */
describe.each([
  ['Tag', farbenHell, false],
  ['Nacht', farbenDunkel, true],
] as const)('Standardstern — %s (LFH-704)', (_modus, farben, dunkel) => {
  const themeConfig = {
    token: antdToken(farben),
    algorithm: antdAlgorithmus(dunkel),
    components: antdKomponenten(farben, 'kompakt'),
  };

  it('trägt die Iconrolle schwach statt einer festen Farbe', () => {
    render(
      <ConfigProvider theme={themeConfig}>
        <AnsichtSwitcher
          ansichten={ANSICHTEN}
          aktiveAnsichtId={1}
          darfSchreiben={false}
          onWaehlen={vi.fn()}
          onNeu={vi.fn()}
          onUmbenennen={vi.fn()}
          onStandard={vi.fn()}
          onLoeschen={vi.fn()}
        />
      </ConfigProvider>,
    );
    const stern = document.querySelector('[data-lfh-icon="stern.gefuellt"]');
    expect(stern).not.toBeNull();
    expect(stern).toHaveStyle({ color: farben.schwach });
  });

  it('hält ≥ 3 : 1 gegen jeden Grund des Auswahlfelds', () => {
    const t = antdTheme.getDesignToken(themeConfig);
    const select = t as typeof t & { optionSelectedBg?: string; optionActiveBg?: string };
    const gruende = {
      feld: t.colorBgContainer,
      klappliste: t.colorBgElevated,
      unterDemZeiger: deckend(select.optionActiveBg ?? t.controlItemBgHover, t.colorBgElevated),
      gewaehlt: deckend(select.optionSelectedBg ?? t.controlItemBgActive, t.colorBgElevated),
    };
    for (const [ort, grund] of Object.entries(gruende)) {
      expect({ ort, kontrast: kontrast(farben.schwach, grund) >= 3 }).toEqual({
        ort,
        kontrast: true,
      });
    }
  });
});
