import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `alarmTon` cacht den AudioContext modulweit (bewusst — Browser deckeln gleichzeitig lebende
// AudioContexts, siehe alarmTon.ts). Damit jeder Test seinen EIGENEN AudioContext-Mock sieht
// (statt den vom Vortest gecachten wiederzuverwenden), Modul-Registry + Import je Test frisch.
let setzeAlarmMute: typeof import('./alarmTon').setzeAlarmMute;
let spieleAlarmTon: typeof import('./alarmTon').spieleAlarmTon;
let pruefeAlarmTonBereitschaft: typeof import('./alarmTon').pruefeAlarmTonBereitschaft;
let entsperreAlarmTon: typeof import('./alarmTon').entsperreAlarmTon;

beforeEach(async () => {
  vi.resetModules();
  ({
    setzeAlarmMute,
    spieleAlarmTon,
    pruefeAlarmTonBereitschaft,
    entsperreAlarmTon,
  } = await import('./alarmTon'));
});

/** Minimaler AudioContext-Mock: zählt, ob ein Oszillator erzeugt/gestartet wurde. */
function mockAudio(
  startStatus: AudioContextState = 'running',
  statusNachResume: AudioContextState = startStatus,
) {
  const start = vi.fn();
  const stop = vi.fn();
  const gainSet = vi.fn();
  let status = startStatus;
  const ctx = {
    get state() { return status; },
    currentTime: 0,
    resume: vi.fn(async () => { status = statusNachResume; }),
    createOscillator: vi.fn(() => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), start, stop })),
    createGain: vi.fn(() => ({ gain: { value: 0, setValueAtTime: gainSet }, connect: vi.fn() })),
  };
  // Seit Vitest 4 wirft `new` auf einem vi.fn() mit Arrow — daher reguläre Funktion.
  const AC = vi.fn(function () {
    return ctx;
  });
  vi.stubGlobal('AudioContext', AC);
  return { AC, ctx, start, stop, gainSet };
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

  it('spielt nach resume nur, wenn der Context danach wirklich running ist', async () => {
    const { ctx, start } = mockAudio('suspended', 'suspended');
    spieleAlarmTon('alarm');
    await vi.waitFor(() => expect(ctx.resume).toHaveBeenCalled());
    expect(start).not.toHaveBeenCalled();
  });
});

describe('Audio-Bereitschaft', () => {
  it('führt den Einstiegstest stumm aus', async () => {
    const { ctx, start, stop, gainSet } = mockAudio('suspended', 'running');
    await expect(pruefeAlarmTonBereitschaft()).resolves.toBe('bereit');
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(ctx.createOscillator).toHaveBeenCalledOnce();
    expect(gainSet).toHaveBeenCalledWith(0, 0);
    expect(start).toHaveBeenCalledWith(0);
    expect(stop).toHaveBeenCalledWith(0.01);
  });

  it('meldet blockiert, wenn resume den Context nicht freischaltet', async () => {
    mockAudio('suspended', 'suspended');
    await expect(pruefeAlarmTonBereitschaft()).resolves.toBe('blockiert');
  });

  it('kann aus einer User-Geste entsperrt werden', async () => {
    mockAudio('suspended', 'running');
    await expect(entsperreAlarmTon()).resolves.toBe('bereit');
  });
});
