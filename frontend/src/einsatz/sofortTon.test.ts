import { afterEach, describe, expect, it, vi } from 'vitest';
import { setzeSofortMute, spieleSofortAlarm } from './sofortTon';

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
  // AudioContext wird per `new AC()` instanziiert. Seit Vitest 4 wirft `new` auf einem
  // vi.fn() mit Arrow-Implementierung (Arrows sind keine Konstruktoren) — daher eine
  // reguläre Funktion, deren zurückgegebenes Objekt `new` korrekt überschreibt.
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

describe('spieleSofortAlarm', () => {
  it('spielt einen Ton, wenn nicht gemutet', () => {
    const { AC, start } = mockAudio();
    setzeSofortMute(false);
    spieleSofortAlarm();
    expect(AC).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('unterdrückt den Ton, wenn gemutet (Early-Return, kein AudioContext)', () => {
    const { AC } = mockAudio();
    setzeSofortMute(true);
    spieleSofortAlarm();
    expect(AC).not.toHaveBeenCalled();
  });
});
