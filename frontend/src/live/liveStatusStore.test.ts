import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abonniereLiveStatus,
  leseLiveStatus,
  setzeLiveStatusFuerTest,
} from './liveStatusStore';

function melde(status: string) {
  window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));
}

afterEach(() => setzeLiveStatusFuerTest('idle'));

describe('liveStatusStore', () => {
  it('startet auf idle', () => {
    expect(leseLiveStatus()).toBe('idle');
  });

  it('übernimmt den gemeldeten Status und benachrichtigt Abonnenten', () => {
    const horcher = vi.fn();
    const ab = abonniereLiveStatus(horcher);
    melde('lost');
    expect(leseLiveStatus()).toBe('lost');
    expect(horcher).toHaveBeenCalledTimes(1);
    ab();
  });

  // DER GRUND für den Store. `lfh:live-status` ist ein Broadcast ohne Replay:
  // ein Konsument, der NACH dem Abriss mountet, bliebe mit eigenem Listener auf
  // 'idle' stehen und meldete „Live" in eine tote Leitung.
  it('hält den letzten Stand für später hinzukommende Leser', () => {
    melde('lost');
    const spaeter = vi.fn();
    const ab = abonniereLiveStatus(spaeter);
    expect(leseLiveStatus()).toBe('lost');
    ab();
  });

  it('meldet nicht, wenn sich der Status nicht ändert', () => {
    melde('open');
    const horcher = vi.fn();
    const ab = abonniereLiveStatus(horcher);
    melde('open');
    expect(horcher).not.toHaveBeenCalled();
    ab();
  });

  it('ignoriert ein Ereignis ohne Status', () => {
    melde('open');
    window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: {} }));
    expect(leseLiveStatus()).toBe('open');
  });

  it('das Abbestellen löst den letzten Abonnenten, ohne den Stand zu verlieren', () => {
    const horcher = vi.fn();
    abonniereLiveStatus(horcher)();
    melde('connecting');
    expect(horcher).not.toHaveBeenCalled();
    expect(leseLiveStatus()).toBe('connecting');
  });
});
