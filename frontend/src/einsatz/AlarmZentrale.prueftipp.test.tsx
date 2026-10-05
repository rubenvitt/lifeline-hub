import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import AlarmZentrale from './AlarmZentrale';
import { istAlarmGemutet } from '../alarm/alarmTon';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';

/**
 * LFH-950: Ein Tipp auf die Glocke, solange die Audio-Prüfung noch läuft, schaltet frei und nie
 * stumm. Eigene Datei, weil `alarmTon` den zuletzt festgestellten Status modulweit hält: nur in
 * einem frischen Modul steht die Anzeige noch auf „wird geprüft".
 */

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  setzeViewportBreite(VIEWPORT_STANDARD);
});

it('ein Tipp in „wird geprüft" ruft die Freischaltung und schaltet nicht stumm', async () => {
  // `resume()` bleibt offen wie ohne Bediengeste — die Prüfung läuft während des ganzen Tests.
  const resume = vi.fn(() => new Promise<void>(() => {}));
  const ctx = {
    state: 'suspended' as AudioContextState,
    currentTime: 0,
    resume,
    createOscillator: vi.fn(),
    createGain: vi.fn(),
  };
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return ctx;
    }),
  );
  setzeViewportBreite(1366);
  render(
    <AntApp>
      <MemoryRouter>
        <AlarmZentrale einsatzId={1} />
      </MemoryRouter>
    </AntApp>,
  );
  const ton = screen.getByRole('button', {
    name: 'Alarmton wird geprüft – tippen zum Freischalten',
  });
  expect(ton).toHaveTextContent('Ton wird geprüft');
  const vorher = resume.mock.calls.length;

  await userEvent.click(ton);

  expect(istAlarmGemutet()).toBe(false);
  expect(ton).toHaveAttribute('aria-pressed', 'false');
  // Die Geste ruft `resume()` selbst (nur so fällt die Sperre), Zuhörer und Knopf je einmal.
  expect(resume.mock.calls.length).toBeGreaterThan(vorher);
});
