import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEtbKopfKleben } from './etbKopfKleben';
import { useNachObenPasst } from './nachOben';

/**
 * „Nach oben“ passt nur ganz unter den klebenden Kopf (LLH-1386). Kleben Seitenkopf und
 * Filterleiste des ETB mit (kwc2yszv D8), gehören sie zum Kopf: die Wurzel des Beobachters ist oben
 * um sie gekürzt, sonst stünde der Knopf als unsichtbarer Tab-Stopp unter der Filterleiste.
 */
describe('useNachObenPasst unter klebenden ETB-Köpfen', () => {
  const raender: string[] = [];
  const echt = globalThis.IntersectionObserver;

  afterEach(() => {
    globalThis.IntersectionObserver = echt;
    vi.restoreAllMocks();
  });

  function Probe() {
    const kleben = useEtbKopfKleben(true);
    const [, messen] = useNachObenPasst();
    return (
      <>
        <div ref={kleben.seitenkopfRef} />
        <div ref={kleben.filterleisteRef} />
        <button ref={messen}>Nach oben</button>
      </>
    );
  }

  it('kürzt die Wurzel oben um Seitenkopf und Filterleiste', async () => {
    raender.length = 0;
    globalThis.IntersectionObserver = class {
      constructor(_cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        raender.push(opts?.rootMargin ?? '');
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
    // jsdom legt nicht aus: Seitenkopf und Filterleiste je 50 px, das Fenster 768 px hoch.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50);
    render(<Probe />);
    await waitFor(() => expect(raender).toContain('-100px 0px 0px 0px'));
  });
});
