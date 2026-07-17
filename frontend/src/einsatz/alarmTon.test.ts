import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `alarmTon` cacht den AudioContext modulweit (bewusst — Browser deckeln gleichzeitig lebende
// AudioContexts, siehe alarmTon.ts). Damit jeder Test seinen EIGENEN AudioContext-Mock sieht
// (statt den vom Vortest gecachten wiederzuverwenden), Modul-Registry + Import je Test frisch.
let setzeAlarmMute: typeof import('./alarmTon').setzeAlarmMute;
let spieleAlarmTon: typeof import('./alarmTon').spieleAlarmTon;

beforeEach(async () => {
  vi.resetModules();
  ({ setzeAlarmMute, spieleAlarmTon } = await import('./alarmTon'));
});

/** Minimaler AudioContext-Mock: zählt, ob ein Oszillator erzeugt/gestartet wurde. */
function mockAudio() {
  const start = vi.fn();
  const ctx = {
    state: 'running',
    currentTime: 0,
    resume: vi.fn(),
    createOscillator: vi.fn(() => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), start, stop: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn() })),
  };
  // Seit Vitest 4 wirft `new` auf einem vi.fn() mit Arrow — daher reguläre Funktion.
  const AC = vi.fn(function () {
    return ctx;
  });
  vi.stubGlobal('AudioContext', AC);
  return { AC, start };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('spieleAlarmTon', () => {
  it('spielt den Alarm-Ton, wenn nicht gemutet', () => {
    const { AC, start } = mockAudio();
    setzeAlarmMute(false);
    spieleAlarmTon('alarm');
    expect(AC).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('spielt auch den dezenten Ton, wenn nicht gemutet', () => {
    const { AC, start } = mockAudio();
    setzeAlarmMute(false);
    spieleAlarmTon('dezent');
    expect(AC).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('unterdrückt jeden Ton, wenn global gemutet (Early-Return, kein AudioContext)', () => {
    const { AC } = mockAudio();
    setzeAlarmMute(true);
    spieleAlarmTon('alarm');
    spieleAlarmTon('dezent');
    expect(AC).not.toHaveBeenCalled();
  });
});
