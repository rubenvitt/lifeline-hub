import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, theme as antdTheme } from 'antd';
import type { KartenAnsicht } from '../../api/types';
import { ApiError } from '../../api/client';
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

/**
 * Speicherfehler im Dialog (LFH-1077, design.md D3): Namens- und Löschdialog warten auf die
 * Antwort, schließen nur beim Erfolg und nennen eine Ablehnung in sich. rc-dialog friert einen
 * schließenden Dialog in jsdom ein: nach dem Wiederöffnen zählt der zuletzt eingehängte.
 */
describe('AnsichtSwitcher · Ablehnung im Dialog (LFH-1077)', () => {
  const ablehnung = () => Promise.reject(new ApiError(422, 'Name schon vergeben'));
  const letzterDialog = () => {
    const alle = document.querySelectorAll<HTMLElement>('.ant-modal');
    return alle[alle.length - 1];
  };
  async function oeffne(user: ReturnType<typeof userEvent.setup>, eintrag: RegExp) {
    await user.click(screen.getByLabelText('Ansichts-Aktionen'));
    await user.click(await screen.findByRole('menuitem', { name: eintrag }));
    await waitFor(() => expect(letzterDialog()).toBeDefined());
    return letzterDialog();
  }

  it('Neue Ansicht: Grund und Wortlaut bleiben, erneutes Speichern räumt, Erfolg schließt', async () => {
    const user = userEvent.setup();
    let freigeben: () => void = () => {};
    const onNeu = vi
      .fn()
      .mockImplementationOnce(ablehnung)
      .mockImplementationOnce(() => new Promise<void>((r) => (freigeben = r)));
    baue({ onNeu });
    const dialog = await oeffne(user, /Neue Ansicht/);
    await user.type(within(dialog).getByLabelText('Ansichts-Name'), 'Gefahrstoff');
    await user.click(within(dialog).getByRole('button', { name: /Speichern/ }));

    expect(await within(dialog).findByText('Name schon vergeben')).toBeInTheDocument();
    expect(within(dialog).getByText('Nicht angelegt')).toBeInTheDocument();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
    expect(within(dialog).getByLabelText('Ansichts-Name')).toHaveValue('Gefahrstoff');

    // Zweiter Versuch, Antwort zurückgehalten: der alte Grund ist weg, Abbrechen gesperrt.
    await user.click(within(dialog).getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(within(dialog).queryByText('Name schon vergeben')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
    expect(onNeu).toHaveBeenCalledTimes(2);

    act(() => freigeben());
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
  });

  it('Umbenennen: Abbrechen nach einer Ablehnung, wieder öffnen — kein alter Grund', async () => {
    const user = userEvent.setup();
    const onUmbenennen = vi.fn().mockImplementation(ablehnung);
    baue({ onUmbenennen });
    const erster = await oeffne(user, /Umbenennen/);
    await user.click(within(erster).getByRole('button', { name: /Speichern/ }));
    expect(await within(erster).findByText('Name schon vergeben')).toBeInTheDocument();
    expect(within(erster).getByText('Nicht gespeichert')).toBeInTheDocument();
    expect(onUmbenennen).toHaveBeenCalledWith(2, 'Abschnitt Nord');

    await user.click(within(erster).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(erster).toHaveClass('ant-zoom-leave'));
    const zweiter = await oeffne(user, /Umbenennen/);
    expect(within(zweiter).queryByText('Name schon vergeben')).toBeNull();
  });

  it('Löschen: der Dialog bleibt bei Ablehnung offen und nennt sie', async () => {
    const user = userEvent.setup();
    let ablehnen: (e: unknown) => void = () => {};
    const onLoeschen = vi
      .fn()
      .mockImplementation(() => new Promise<void>((_, rej) => (ablehnen = rej)));
    baue({ onLoeschen });
    const dialog = await oeffne(user, /Löschen/);
    await user.click(within(dialog).getByRole('button', { name: /Löschen/ }));
    expect(onLoeschen).toHaveBeenCalledWith(2, 'freigeben');
    // Während des Laufs gibt es kein Zurück.
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    act(() => ablehnen(new ApiError(422, 'Ansicht hat Bilder')));
    expect(await within(dialog).findByText('Ansicht hat Bilder')).toBeInTheDocument();
    expect(within(dialog).getByText('Nicht gelöscht')).toBeInTheDocument();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
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
