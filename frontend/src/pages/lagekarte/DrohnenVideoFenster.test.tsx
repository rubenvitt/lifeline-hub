import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import DrohnenVideoFenster, { wiederholNachMs } from './DrohnenVideoFenster';

// `hls.js` ist die Naht zum Browser: gemockt wird der Player, nicht das Fenster.
const hls = vi.hoisted(() => {
  type Zuhoerer = (ereignis: string, daten: unknown) => void;
  const instanzen: Array<{
    konfig: unknown;
    zuhoerer: Map<string, Zuhoerer>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    startLoad: ReturnType<typeof vi.fn>;
    recoverMediaError: ReturnType<typeof vi.fn>;
  }> = [];
  const zustand = { unterstuetzt: true };
  class FakeHls {
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static isSupported = () => zustand.unterstuetzt;
    zuhoerer = new Map<string, Zuhoerer>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    constructor(public konfig: unknown) {
      instanzen.push(this);
    }
    on(ereignis: string, f: Zuhoerer) {
      this.zuhoerer.set(ereignis, f);
    }
  }
  return { instanzen, zustand, FakeHls };
});

vi.mock('hls.js', () => ({ default: hls.FakeHls }));

const URL_K1 = '/api/incidents/7/drone/video/k1/hls/index.m3u8';

function fehler(inst: (typeof hls.instanzen)[number], fatal: boolean, type = 'otherError') {
  act(() => inst.zuhoerer.get('hlsError')?.('hlsError', { fatal, type }));
}

/** Lässt die falsche Uhr laufen und die Mikrotasks (Nachladen von `hls.js`) zu Ende kommen. */
async function warte(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('DrohnenVideoFenster (LLH-2107)', () => {
  beforeEach(() => {
    hls.instanzen.length = 0;
    hls.zustand.unterstuetzt = true;
    vi.restoreAllMocks();
    // jsdom kennt `load()` nicht und meldet es als Fehler.
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  it('lädt die Playlist der Route ohne Niedriglatenzmodus und zeigt „Lädt …“', async () => {
    renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />);
    await waitFor(() => expect(hls.instanzen).toHaveLength(1));
    const inst = hls.instanzen[0];
    expect(inst.loadSource).toHaveBeenCalledWith(URL_K1);
    expect(inst.attachMedia).toHaveBeenCalledTimes(1);
    expect(inst.konfig).toMatchObject({ lowLatencyMode: false });
    expect(screen.getByText('Lädt …')).toBeInTheDocument();
    const video = document.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video).toHaveAttribute('playsinline');
  });

  it('kodiert den Schlüssel als Pfadsegment', async () => {
    renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="a b/c" onClose={vi.fn()} />);
    await waitFor(() => expect(hls.instanzen).toHaveLength(1));
    expect(hls.instanzen[0].loadSource).toHaveBeenCalledWith(
      '/api/incidents/7/drone/video/a%20b%2Fc/hls/index.m3u8',
    );
  });

  it('zeigt „Kein Livebild“ bei einem fatalen Fehler, einen nicht fatalen übergeht es', async () => {
    renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />);
    await waitFor(() => expect(hls.instanzen).toHaveLength(1));
    fehler(hls.instanzen[0], false);
    expect(screen.queryByText('Kein Livebild')).toBeNull();
    fehler(hls.instanzen[0], true);
    expect(await screen.findByText('Kein Livebild')).toBeInTheDocument();
    expect(hls.instanzen[0].destroy).toHaveBeenCalled();
  });

  it('zeigt „Kein Livebild“ ohne Schlüssel und startet keinen Player', () => {
    renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey={null} onClose={vi.fn()} />);
    expect(screen.getByText('Kein Livebild')).toBeInTheDocument();
    expect(hls.instanzen).toHaveLength(0);
  });

  it('zeigt „Kein Livebild“, wenn weder hls.js noch der Browser HLS kann', async () => {
    hls.zustand.unterstuetzt = false;
    renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />);
    expect(await screen.findByText('Kein Livebild')).toBeInTheDocument();
    expect(hls.instanzen).toHaveLength(0);
  });

  it('schließt über den Knopf „Livebild schließen“', async () => {
    const onClose = vi.fn();
    renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Livebild schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('räumt den Player beim Schließen ab', async () => {
    const { unmount } = renderMitProviders(
      <DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />,
    );
    await waitFor(() => expect(hls.instanzen).toHaveLength(1));
    unmount();
    expect(hls.instanzen[0].destroy).toHaveBeenCalled();
  });

  it('startet neu bei neuem Schlüssel, auch wenn er nach einem Ausfall wieder erscheint', async () => {
    const { rerender } = renderMitProviders(
      <DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />,
    );
    await waitFor(() => expect(hls.instanzen).toHaveLength(1));
    fehler(hls.instanzen[0], true);
    expect(await screen.findByText('Kein Livebild')).toBeInTheDocument();

    rerender(<DrohnenVideoFenster einsatzId={7} videoKey="k2" onClose={vi.fn()} />);
    await waitFor(() => expect(hls.instanzen).toHaveLength(2));
    expect(hls.instanzen[1].loadSource).toHaveBeenCalledWith(
      '/api/incidents/7/drone/video/k2/hls/index.m3u8',
    );
    expect(screen.queryByText('Kein Livebild')).toBeNull();
  });

  it('wartet 5 s, 10 s, 20 s und dann höchstens 30 s bis zum nächsten Versuch', () => {
    expect([1, 2, 3, 4, 5, 9].map(wiederholNachMs)).toEqual([
      5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ]);
  });

  describe('nach einem fatalen Fehler', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('lädt bei einem Netzfehler zuerst einmal neu, dann startet es mit Pause neu', async () => {
      renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />);
      await warte(0);
      expect(hls.instanzen).toHaveLength(1);
      fehler(hls.instanzen[0], true, 'networkError');
      expect(hls.instanzen[0].startLoad).toHaveBeenCalledTimes(1);
      expect(hls.instanzen[0].destroy).not.toHaveBeenCalled();
      expect(screen.queryByText('Kein Livebild')).toBeNull();

      fehler(hls.instanzen[0], true, 'networkError');
      expect(hls.instanzen[0].destroy).toHaveBeenCalled();
      expect(screen.getByText('Kein Livebild')).toBeInTheDocument();
      await warte(4_999);
      expect(hls.instanzen).toHaveLength(1);
      await warte(1);
      expect(hls.instanzen).toHaveLength(2);
      expect(hls.instanzen[1].loadSource).toHaveBeenCalledWith(URL_K1);
      expect(screen.getByText('Lädt …')).toBeInTheDocument();

      // Der zweite Ausfall in Folge wartet länger.
      fehler(hls.instanzen[1], true);
      await warte(5_000);
      expect(hls.instanzen).toHaveLength(2);
      await warte(5_000);
      expect(hls.instanzen).toHaveLength(3);
    });

    it('stellt sich bei einem Medienfehler einmal selbst wieder her', async () => {
      renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />);
      await warte(0);
      fehler(hls.instanzen[0], true, 'mediaError');
      expect(hls.instanzen[0].recoverMediaError).toHaveBeenCalledTimes(1);
      expect(hls.instanzen[0].destroy).not.toHaveBeenCalled();
      fehler(hls.instanzen[0], true, 'mediaError');
      expect(hls.instanzen[0].recoverMediaError).toHaveBeenCalledTimes(1);
      expect(hls.instanzen[0].destroy).toHaveBeenCalled();
    });

    it('versucht es nicht mehr, sobald die Quelle den Schlüssel nicht mehr meldet', async () => {
      const { rerender } = renderMitProviders(
        <DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />,
      );
      await warte(0);
      fehler(hls.instanzen[0], true);
      rerender(<DrohnenVideoFenster einsatzId={7} videoKey={null} onClose={vi.fn()} />);
      await warte(60_000);
      expect(hls.instanzen).toHaveLength(1);
      expect(screen.getByText('Kein Livebild')).toBeInTheDocument();
    });

    it('fängt nach einem laufenden Bild wieder mit 5 s an', async () => {
      renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />);
      await warte(0);
      fehler(hls.instanzen[0], true);
      await warte(5_000);
      expect(hls.instanzen).toHaveLength(2);
      fireEvent.playing(document.querySelector('video')!);
      fehler(hls.instanzen[1], true);
      await warte(5_000);
      expect(hls.instanzen).toHaveLength(3);
    });
  });

  it('spielt nativ ab, wo der Browser HLS selbst kann (Safari)', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((typ) =>
      typ === 'application/vnd.apple.mpegurl' ? 'maybe' : '',
    );
    renderMitProviders(<DrohnenVideoFenster einsatzId={7} videoKey="k1" onClose={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', URL_K1));
    expect(hls.instanzen).toHaveLength(0);
    fireEvent.error(document.querySelector('video')!);
    expect(await screen.findByText('Kein Livebild')).toBeInTheDocument();
  });
});
