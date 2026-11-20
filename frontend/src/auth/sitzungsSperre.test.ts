import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  istSitzungGesperrt,
  sitzungEntsperren,
  sitzungSperren,
  warteAufSitzung,
} from './sitzungsSperre';
import { SITZUNG_WIEDERHERGESTELLT, meldeSitzungWiederhergestellt } from './sitzungsEvent';

afterEach(() => sitzungEntsperren('beendet'));

describe('Sitzungssperre (LLH-1770)', () => {
  it('ohne Sperre gibt es nichts abzuwarten', () => {
    expect(warteAufSitzung()).toBeNull();
    expect(istSitzungGesperrt()).toBe(false);
  });

  it('eine zweite Sperre legt kein neues Versprechen an', () => {
    sitzungSperren();
    const erstes = warteAufSitzung();
    sitzungSperren();
    expect(warteAufSitzung()).toBe(erstes);
    expect(istSitzungGesperrt()).toBe(true);
  });

  it('wiederhergestellt löst mit true, danach ist nichts mehr gesperrt', async () => {
    sitzungSperren();
    const warten = warteAufSitzung();
    sitzungEntsperren('wiederhergestellt');
    await expect(warten).resolves.toBe(true);
    expect(istSitzungGesperrt()).toBe(false);
    expect(warteAufSitzung()).toBeNull();
  });

  it('beendet löst mit false', async () => {
    sitzungSperren();
    const warten = warteAufSitzung();
    sitzungEntsperren('beendet');
    await expect(warten).resolves.toBe(false);
  });

  it('meldet „wiederhergestellt“ als Fensterereignis, je Aufruf einmal', () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_WIEDERHERGESTELLT, horcher);
    meldeSitzungWiederhergestellt();
    meldeSitzungWiederhergestellt();
    window.removeEventListener(SITZUNG_WIEDERHERGESTELLT, horcher);
    expect(horcher).toHaveBeenCalledTimes(2);
  });
});
