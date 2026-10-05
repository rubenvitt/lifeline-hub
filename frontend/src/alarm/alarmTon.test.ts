import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `alarmTon` cacht den AudioContext modulweit; damit jeder Test seinen eigenen Mock sieht,
// werden Modul-Registry und Import je Test frisch geladen.
let setzeAlarmMute: typeof import('./alarmTon').setzeAlarmMute;
let spieleAlarmTon: typeof import('./alarmTon').spieleAlarmTon;
let pruefeAlarmTonBereitschaft: typeof import('./alarmTon').pruefeAlarmTonBereitschaft;
let entsperreAlarmTon: typeof import('./alarmTon').entsperreAlarmTon;

beforeEach(async () => {
  vi.resetModules();
  ({ setzeAlarmMute, spieleAlarmTon, pruefeAlarmTonBereitschaft, entsperreAlarmTon } =
    await import('./alarmTon'));
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
    get state() {
      return status;
    },
    currentTime: 0,
    resume: vi.fn(async () => {
      status = statusNachResume;
    }),
    createOscillator: vi.fn(() => ({
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start,
      stop,
    })),
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
    await waitFor(() => expect(ctx.resume).toHaveBeenCalled());
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

/**
 * LFH-950: Ohne Bediengeste bleibt `resume()` in Chromium offen. Dieser Mock hält es offen, bis
 * der Test es freigibt — wie die Autoplay-Sperre bis zur ersten Geste.
 */
function mockGesperrtesAudio() {
  const start = vi.fn();
  let status: AudioContextState = 'suspended';
  const wartende: Array<() => void> = [];
  const ctx = {
    get state() {
      return status;
    },
    currentTime: 0,
    resume: vi.fn(
      () =>
        new Promise<void>((fertig) => {
          wartende.push(fertig);
        }),
    ),
    createOscillator: vi.fn(() => ({
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start,
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
  /** Die Sperre fällt: wie im Browser lösen ALLE offenen `resume()` gemeinsam auf. */
  const freigeben = async () => {
    status = 'running';
    for (const fertig of wartende.splice(0)) fertig();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { ctx, start, freigeben };
}

describe('gesperrter Alarmton ohne Rückstau (LFH-950)', () => {
  let ALARM_TON_FRIST_MS: number;
  let alarmTonStatus: typeof import('./alarmTon').alarmTonStatus;

  beforeEach(async () => {
    vi.useFakeTimers();
    ({ ALARM_TON_FRIST_MS, alarmTonStatus } = await import('./alarmTon'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('viele Alarme bei gesperrtem Kontext: EIN resume() und nach der Freigabe EIN Ton', async () => {
    const { ctx, start, freigeben } = mockGesperrtesAudio();
    for (let i = 0; i < 20; i += 1) spieleAlarmTon('alarm');
    expect(ctx.resume).toHaveBeenCalledOnce();

    await freigeben();
    expect(start).toHaveBeenCalledOnce();
    expect(alarmTonStatus()).toBe('bereit');
  });

  it('eine Anforderung älter als die Frist spielt nach der Freigabe nicht mehr', async () => {
    const { start, freigeben } = mockGesperrtesAudio();
    spieleAlarmTon('alarm');
    await vi.advanceTimersByTimeAsync(ALARM_TON_FRIST_MS + 1);
    await freigeben();
    expect(start).not.toHaveBeenCalled();
    expect(alarmTonStatus()).toBe('bereit');
  });

  it('nach Ablauf der Frist meldet ein gesperrter Alarm „blockiert"', async () => {
    mockGesperrtesAudio();
    spieleAlarmTon('alarm');
    expect(alarmTonStatus()).toBeNull();
    await vi.advanceTimersByTimeAsync(ALARM_TON_FRIST_MS - 1);
    expect(alarmTonStatus()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(alarmTonStatus()).toBe('blockiert');
  });

  it('Stummschaltung vor der Freigabe verhindert den aufgestauten Ton', async () => {
    const { start, freigeben } = mockGesperrtesAudio();
    spieleAlarmTon('alarm');
    setzeAlarmMute(true);
    await freigeben();
    expect(start).not.toHaveBeenCalled();
  });

  it('die Einstiegsprüfung endet nach der Frist mit „blockiert", statt ewig zu prüfen', async () => {
    mockGesperrtesAudio();
    let ergebnis: string | null = null;
    void pruefeAlarmTonBereitschaft().then((s) => {
      ergebnis = s;
    });
    await vi.advanceTimersByTimeAsync(ALARM_TON_FRIST_MS - 1);
    expect(ergebnis).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(ergebnis).toBe('blockiert');
  });

  it('fällt die Sperre nach der Frist, meldet der Status „bereit"', async () => {
    const { freigeben } = mockGesperrtesAudio();
    void pruefeAlarmTonBereitschaft();
    await vi.advanceTimersByTimeAsync(ALARM_TON_FRIST_MS);
    expect(alarmTonStatus()).toBe('blockiert');
    await freigeben();
    expect(alarmTonStatus()).toBe('bereit');
  });

  it('die Freischaltung per Geste spielt einen jungen aufgestauten Ton genau einmal', async () => {
    const { ctx, start, freigeben } = mockGesperrtesAudio();
    spieleAlarmTon('alarm');
    spieleAlarmTon('dezent');
    const entsperrt = entsperreAlarmTon();
    await freigeben();
    await expect(entsperrt).resolves.toBe('bereit');
    expect(start).toHaveBeenCalledOnce();
    // Die Geste ruft `resume()` selbst: nur ein Aufruf aus einer Aktivierung hebt die Sperre auf.
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });
});
