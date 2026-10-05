import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlarmZentrale from './AlarmZentrale';
import { istAlarmGemutet } from '../alarm/alarmTon';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import { farbenDunkel } from '../theme/tokens';

/**
 * Eigene Datei, weil `alarmTon` den AudioContext modulweit hält: in `AlarmZentrale.test.tsx`
 * bliebe der Kontext des ersten Tests (immer `running`) stehen, und dieser Stub käme nie zum Zug.
 */

function renderAlarm() {
  return render(
    <AntApp>
      <MemoryRouter>
        <AlarmZentrale einsatzId={1} />
      </MemoryRouter>
    </AntApp>,
  );
}

function stubNotification(permission: NotificationPermission) {
  const Ctor = vi.fn(function () {
    return { close: vi.fn(), onclick: null };
  }) as unknown as typeof Notification & { permission: NotificationPermission };
  Ctor.permission = permission;
  vi.stubGlobal('Notification', Ctor);
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

/**
 * AudioContext, dessen Sperre erst fällt, wenn der Test `geste.erlaubt` setzt — wie die
 * Autoplay-Sperre bis zur ersten Bediengeste. `resume()` löst sofort auf, der Zustand bleibt bis
 * zum ersten `resume()` danach `suspended`; so meldet die Prüfung ohne Wartezeit „blockiert".
 */
const geste = { erlaubt: false, laeuft: false };
/** EIN Objekt für alle Tests: `alarmTon` hält den ersten Kontext ohnehin fest. */
const ctx = {
  get state(): AudioContextState {
    return geste.laeuft ? 'running' : 'suspended';
  },
  currentTime: 0,
  // Wie im Browser: erst ein `resume()` NACH der Geste startet den Kontext.
  resume: vi.fn(async () => {
    if (geste.erlaubt) geste.laeuft = true;
  }),
  createOscillator: vi.fn(() => ({
    type: '',
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
  createGain: vi.fn(() => ({
    gain: { value: 0, setValueAtTime: vi.fn() },
    connect: vi.fn(),
  })),
};
function stubGesperrtesAudio() {
  geste.erlaubt = false;
  geste.laeuft = false;
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return ctx;
    }),
  );
  return ctx;
}

/**
 * LFH-950: Ein Tipp in `prueft`/`blockiert` schaltet frei, nie stumm; die erste Bediengeste
 * irgendwo schaltet frei. Der AudioContext ist modulweit gecacht: der Stub bleibt dasselbe
 * Objekt, sein Zustand hängt an `geste.erlaubt`.
 */
describe('AlarmZentrale: gesperrter Alarmton (LFH-950)', () => {
  beforeEach(() => setzeViewportBreite(1366));
  afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

  it('ein Tipp auf die gesperrte Glocke schaltet frei und nicht stumm — auch wenn die Geste schon freigeschaltet hat', async () => {
    stubGesperrtesAudio();
    renderAlarm();
    const ton = await screen.findByRole('button', {
      name: 'Alarmton blockiert – tippen zum Freischalten',
    });
    expect(ton).toHaveTextContent('Ton blockiert');

    // Die Geste ist echt: der Browser hebt die Sperre schon beim Drücken auf, der Zuhörer auf
    // `pointerdown` schaltet frei, BEVOR der Klick die Glocke erreicht.
    geste.erlaubt = true;
    await userEvent.click(ton);

    await waitFor(() => expect(screen.getByText('Ton bereit')).toBeInTheDocument());
    expect(istAlarmGemutet()).toBe(false);
    expect(screen.getByRole('button', { name: 'Alarmton stummschalten' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('schaltet die Geste frei und steht „bereit" vor dem Klick, schaltet der Klick nicht stumm', async () => {
    // Der Ablauf im Browser, Schritt für Schritt: `pointerdown` hebt die Sperre, der Render
    // zeigt „bereit", ERST DANN kommt der Klick. Maßgeblich ist der Zustand beim Drücken.
    stubGesperrtesAudio();
    renderAlarm();
    const ton = await screen.findByRole('button', {
      name: 'Alarmton blockiert – tippen zum Freischalten',
    });
    geste.erlaubt = true;
    act(() => {
      fireEvent.pointerDown(ton);
    });
    await waitFor(() => expect(ton).toHaveTextContent('Ton bereit'));
    fireEvent.pointerUp(ton);
    fireEvent.click(ton);
    await waitFor(() => expect(ton).toHaveAccessibleName('Alarmton stummschalten'));
    expect(istAlarmGemutet()).toBe(false);
  });

  it('die erste Bediengeste irgendwo in der App schaltet den Ton frei', async () => {
    const ctx = stubGesperrtesAudio();
    renderAlarm();
    expect(await screen.findByText('Ton blockiert')).toBeInTheDocument();
    const vorher = ctx.resume.mock.calls.length;

    geste.erlaubt = true;
    act(() => {
      fireEvent.pointerDown(document.body);
    });

    await waitFor(() => expect(screen.getByText('Ton bereit')).toBeInTheDocument());
    expect(ctx.resume.mock.calls.length).toBeGreaterThan(vorher);
    expect(istAlarmGemutet()).toBe(false);
  });

  it('ist der Ton bereit, löst eine Geste kein weiteres resume() aus', async () => {
    const ctx = stubGesperrtesAudio();
    geste.erlaubt = true;
    renderAlarm();
    expect(await screen.findByText('Ton bereit')).toBeInTheDocument();
    const vorher = ctx.resume.mock.calls.length;
    act(() => {
      fireEvent.pointerDown(document.body);
      fireEvent.keyDown(document.body, { key: 'a' });
    });
    expect(ctx.resume.mock.calls.length).toBe(vorher);
  });

  it('nach dem Unmount schaltet eine Geste nichts mehr frei', async () => {
    const ctx = stubGesperrtesAudio();
    const { unmount } = renderAlarm();
    expect(await screen.findByText('Ton blockiert')).toBeInTheDocument();
    unmount();
    const vorher = ctx.resume.mock.calls.length;
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(ctx.resume.mock.calls.length).toBe(vorher);
  });

  it.each([390, 820, 1180, 1440])(
    'bei %i px: „Ton blockiert" mit durchgestrichener Glocke',
    async (px) => {
      setzeViewportBreite(px);
      stubGesperrtesAudio();
      stubNotification('default');
      renderAlarm();
      const ziel =
        px < 768
          ? await screen.findByRole('button', { name: 'Alarmzentrale: Ton blockiert' })
          : await screen.findByRole('button', {
              name: 'Alarmton blockiert – tippen zum Freischalten',
            });
      expect(ziel).toHaveTextContent('Ton blockiert');
      expect(ziel).toHaveStyle({ color: farbenDunkel.achtung });
      // Die durchgestrichene Glocke ist die Form der Störung (LFH-513): eine andere als „bereit".
      const svgBlockiert = ziel.querySelector('svg')!.innerHTML;
      geste.erlaubt = true;
      act(() => {
        fireEvent.pointerDown(document.body);
      });
      await waitFor(() => expect(ziel.querySelector('svg')!.innerHTML).not.toBe(svgBlockiert));
    },
  );
});
