import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import DrohnenVideoFenster from './DrohnenVideoFenster';

// `hls.js` ist die Naht zum Browser: gemockt wird der Player, nicht das Fenster.
const hls = vi.hoisted(() => {
  type Zuhoerer = (ereignis: string, daten: unknown) => void;
  const instanzen: Array<{
    konfig: unknown;
    zuhoerer: Map<string, Zuhoerer>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  const zustand = { unterstuetzt: true };
  class FakeHls {
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    static isSupported = () => zustand.unterstuetzt;
    zuhoerer = new Map<string, Zuhoerer>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
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

function fehler(inst: (typeof hls.instanzen)[number], fatal: boolean) {
  act(() => inst.zuhoerer.get('hlsError')?.('hlsError', { fatal }));
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
