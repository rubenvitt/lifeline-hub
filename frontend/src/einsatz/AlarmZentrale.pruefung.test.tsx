import { act, render, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AlarmZentrale from './AlarmZentrale';
import { alarmTonStatus } from '../alarm/alarmTon';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import { farbenDunkel, rahmenFarben } from '../theme/tokens';

/**
 * LFH-637: Der Tonstatus ist bis zur ersten Antwort der Audio-Prüfung UNGEPRÜFT, nicht
 * „blockiert". Eigene Datei, weil `alarmTon` den zuletzt festgestellten Status modulweit hält:
 * in `AlarmZentrale.test.tsx` hinge der Startzustand an der Reihenfolge der Tests.
 *
 * Jeder Test hält die Prüfung mit einem eigenen `resume()` an und gibt sie selbst frei.
 * Der AudioContext entsteht je Modul nur einmal; deshalb liefert der Stub bei jedem Aufruf
 * dasselbe Objekt, dessen Verhalten der Test vorher setzt.
 */

type Ausgang = 'running' | 'suspended';

const audio = {
  state: 'suspended' as AudioContextState,
  /** Gibt die laufende Prüfung frei; `null`, solange keine wartet. */
  freigeben: null as ((ausgang: Ausgang) => void) | null,
};

function stubAngehalteneAudioPruefung() {
  audio.state = 'suspended';
  audio.freigeben = null;
  const ctx = {
    get state() {
      return audio.state;
    },
    currentTime: 0,
    resume: vi.fn(
      () =>
        new Promise<void>((fertig) => {
          audio.freigeben = (ausgang) => {
            audio.state = ausgang;
            fertig();
          };
        }),
    ),
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
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return ctx;
    }),
  );
}

function stubNotification(permission: NotificationPermission) {
  const Ctor = vi.fn(function () {
    return { close: vi.fn(), onclick: null };
  }) as unknown as typeof Notification & { permission: NotificationPermission };
  Ctor.permission = permission;
  vi.stubGlobal('Notification', Ctor);
}

function renderAlarm() {
  return render(
    <AntApp>
      <MemoryRouter>
        <AlarmZentrale einsatzId={1} />
      </MemoryRouter>
    </AntApp>,
  );
}

async function pruefungEndet(ausgang: Ausgang) {
  await waitFor(() => expect(audio.freigeben).not.toBeNull());
  await act(async () => {
    audio.freigeben!(ausgang);
  });
}

/** Der Ton-Knopf der breiten Bauform — der einzige mit `aria-pressed`. */
function tonKnopf(): HTMLElement {
  const knopf = screen
    .getAllByRole('button')
    .find((el) => el.getAttribute('aria-pressed') !== null);
  expect(knopf, 'Ton-Knopf mit aria-pressed').toBeDefined();
  return knopf!;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  setzeViewportBreite(VIEWPORT_STANDARD);
});

// Der erste festgestellte Status bleibt modulweit stehen und ist im nächsten Test der Startwert.
// Die Reihenfolge ist deshalb Absicht: erst alles, solange die Prüfung noch läuft, dann „bereit",
// zuletzt ein festgestelltes „blockiert".
describe('AlarmZentrale: ungeprüfter Tonstatus (LFH-637)', () => {
  it('solange die Prüfung läuft, meldet keine Bauform „blockiert"', async () => {
    stubAngehalteneAudioPruefung();
    stubNotification('default');

    // Führungs-Tablet: der Zustand steht wie der Ruhezustand nur als Ikone — die Kopfzeile bekommt
    // beim Start keine Breite, die sie gleich wieder abgibt (CLS 0,46 bei 1024 px).
    setzeViewportBreite(1024);
    const tablet = renderAlarm();
    let ton = tonKnopf();
    expect(ton).toHaveTextContent(/^$/);
    expect(ton).toHaveStyle({ color: rahmenFarben.gedaempft });
    // Die Bedienung ist die des Ruhezustands, nicht „entsperren".
    expect(ton).toHaveAccessibleName('Alarmton stummschalten');
    tablet.unmount();

    // Breite Bauform: das Wort steht, aber es nennt die Prüfung, nicht eine Störung.
    setzeViewportBreite(1366);
    const breit = renderAlarm();
    ton = tonKnopf();
    expect(ton).toHaveTextContent('Ton prüft');
    expect(ton).toHaveStyle({ color: rahmenFarben.gedaempft });
    breit.unmount();

    // Handschirm mit erlaubtem Desktop: die Marke nennt den Ton.
    stubNotification('granted');
    setzeViewportBreite(390);
    renderAlarm();
    const marke = screen.getByRole('button', { name: /^Alarmzentrale:/ });
    expect(marke).toHaveAccessibleName('Alarmzentrale: Ton prüft');
    expect(marke).toHaveStyle({ color: rahmenFarben.gedaempft });
  });

  it('1024 px: ergibt die Prüfung „bereit", bleibt der Knopf ohne Wort', async () => {
    setzeViewportBreite(1024);
    stubAngehalteneAudioPruefung();
    stubNotification('default');
    renderAlarm();
    expect(tonKnopf()).toHaveTextContent(/^$/);

    await pruefungEndet('running');
    await waitFor(() => expect(alarmTonStatus()).toBe('bereit'));
    expect(tonKnopf()).toHaveTextContent(/^$/);
    expect(tonKnopf()).toHaveStyle({ color: rahmenFarben.gedaempft });
  });

  it('erst eine festgestellte Sperre heißt „Ton blockiert", in Warnfarbe', async () => {
    setzeViewportBreite(1024);
    stubAngehalteneAudioPruefung();
    stubNotification('default');
    renderAlarm();

    await pruefungEndet('suspended');
    await waitFor(() => expect(tonKnopf()).toHaveTextContent('Ton blockiert'));
    expect(tonKnopf()).toHaveStyle({ color: farbenDunkel.achtung });
    expect(tonKnopf()).toHaveAccessibleName('Alarmton durch Klick entsperren');
  });
});
