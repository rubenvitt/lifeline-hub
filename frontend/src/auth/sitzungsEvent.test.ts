import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SITZUNG_ABGELAUFEN,
  meldeSitzungAbgelaufen,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';

afterEach(() => sitzungsMeldungZuruecksetzen());

describe('sitzungsEvent', () => {
  it('meldet einen Sitzungsablauf als window-Event', () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('meldet nur EINMAL, auch wenn mehrere Anfragen gleichzeitig 401 liefern', () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    meldeSitzungAbgelaufen();
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('meldet nach einem erfolgreichen Re-Login wieder', () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    sitzungsMeldungZuruecksetzen();
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(2);
  });
});
