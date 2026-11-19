import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import {
  liesErlaubt,
  setzeParam,
  useAdressKennung,
  useAdressSchalter,
  useAdressSuche,
  useAdressWahl,
  useAdressWert,
} from './useAdressWert';
import { GEDAECHTNIS_ENTPRELLUNG_MS } from '../components/listenGedaechtnis';
import { useLinkAuftrag } from './useLinkAuftrag';

type Richtung = 'alle' | 'intern' | 'extern';
const RICHTUNG_ERLAUBT: Record<Richtung, true> = { alle: true, intern: true, extern: true };
type BefehleSicht = 'entwuerfe' | 'freigegeben';
const BEFEHLE_SICHT_ERLAUBT: Record<BefehleSicht, true> = { entwuerfe: true, freigegeben: true };

/** Der jüngste Render der Sonde: Hook-Ergebnis und Adresse. */
let stand: { wert: unknown; setze: (v: never) => void; search: string; pathname: string };

function Sonde({ hook }: { hook: () => readonly [unknown, (v: never) => void] }) {
  const [wert, setze] = hook();
  const location = useLocation();
  stand = { wert, setze, search: location.search, pathname: location.pathname };
  return null;
}

function starte(hook: () => readonly [unknown, (v: never) => void], eintraege: string[]) {
  const router = createMemoryRouter([{ path: '*', element: <Sonde hook={hook} /> }], {
    initialEntries: eintraege,
    initialIndex: eintraege.length - 1,
  });
  render(<RouterProvider router={router} />);
  return router;
}

const setze = <T,>(wert: T) => act(() => (stand.setze as (v: T) => void)(wert));

describe('setzeParam und liesErlaubt (LLH-1826)', () => {
  it('setzeParam lässt fremde Parameter stehen', () => {
    const neu = setzeParam(new URLSearchParams('meldung=7&richtung=extern'), 'richtung', undefined);
    expect(neu.toString()).toBe('meldung=7');
  });

  it('setzeParam löscht bei leerem Text', () => {
    expect(setzeParam(new URLSearchParams('q=a'), 'q', '').toString()).toBe('');
  });

  it('liesErlaubt verwirft einen unbekannten Wert ganz', () => {
    expect(liesErlaubt(new URLSearchParams('richtung=quer'), 'richtung', RICHTUNG_ERLAUBT)).toBe(
      undefined,
    );
    expect(liesErlaubt(new URLSearchParams('richtung=extern'), 'richtung', RICHTUNG_ERLAUBT)).toBe(
      'extern',
    );
  });
});

describe('useAdressWert (LLH-1826)', () => {
  const hook = () => useAdressWert('richtung', RICHTUNG_ERLAUBT, 'alle');

  it('liest den Wert und nimmt bei Unbekanntem die Vorgabe', () => {
    starte(hook, ['/m?richtung=extern']);
    expect(stand.wert).toBe('extern');
  });

  it('nimmt bei unbekanntem Wert die Vorgabe', () => {
    starte(hook, ['/m?richtung=quer']);
    expect(stand.wert).toBe('alle');
  });

  it('die Vorgabe steht nicht in der Adresse', async () => {
    starte(hook, ['/m?meldung=7']);
    setze('extern');
    await waitFor(() => expect(stand.search).toBe('?meldung=7&richtung=extern'));
    setze('alle');
    await waitFor(() => expect(stand.search).toBe('?meldung=7'));
  });

  it('ein Wechsel legt keinen Verlaufseintrag an', async () => {
    const router = starte(hook, ['/liste', '/einsaetze/1/meldungen']);
    setze('extern');
    setze('intern');
    setze('extern');
    await waitFor(() => expect(stand.search).toBe('?richtung=extern'));
    await act(() => router.navigate(-1));
    expect(stand.pathname).toBe('/liste');
  });
});

describe('useAdressWahl (LLH-1826)', () => {
  it('schreibt auch den Wert, der gerade Vorgabe wäre', async () => {
    starte(() => useAdressWahl('befehle_sicht', BEFEHLE_SICHT_ERLAUBT), ['/a']);
    expect(stand.wert).toBe(undefined);
    setze('entwuerfe');
    await waitFor(() => expect(stand.search).toBe('?befehle_sicht=entwuerfe'));
    expect(stand.wert).toBe('entwuerfe');
  });
});

describe('useAdressSchalter (LLH-1826)', () => {
  it('liest =1 und löscht beim Ausschalten', async () => {
    starte(() => useAdressSchalter('luecken'), ['/p?luecken=1']);
    expect(stand.wert).toBe(true);
    setze(false);
    await waitFor(() => expect(stand.search).toBe(''));
    expect(stand.wert).toBe(false);
  });
});

describe('useAdressKennung (LLH-1826)', () => {
  it('verwirft eine ungültige Kennung', () => {
    starte(() => useAdressKennung('abschnitt'), ['/k?abschnitt=abc']);
    expect(stand.wert).toBe(undefined);
  });

  it('liest und schreibt eine Kennung', async () => {
    starte(() => useAdressKennung('abschnitt'), ['/k']);
    setze(12);
    await waitFor(() => expect(stand.search).toBe('?abschnitt=12'));
    expect(stand.wert).toBe(12);
  });
});

describe('useAdressSuche (LLH-1826)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schreibt entprellt', async () => {
    starte(() => useAdressSuche(), ['/a']);
    setze('Bra');
    expect(stand.wert).toBe('Bra');
    await act(() => vi.advanceTimersByTimeAsync(GEDAECHTNIS_ENTPRELLUNG_MS - 1));
    expect(stand.search).toBe('');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(stand.search).toBe('?q=Bra');
  });

  it('folgt einer fremden Änderung', async () => {
    const router = starte(() => useAdressSuche(), ['/a?q=alt']);
    expect(stand.wert).toBe('alt');
    await act(() => router.navigate('/a?q=neu', { replace: true }));
    expect(stand.wert).toBe('neu');
  });

  it('nach dem Zurück zeigt das Feld den Text der Adresse', async () => {
    const router = starte(() => useAdressSuche(), ['/a?q=erst', '/b']);
    await act(() => router.navigate('/a?q=erst'));
    setze('getippt');
    await act(() => vi.advanceTimersByTimeAsync(GEDAECHTNIS_ENTPRELLUNG_MS));
    await act(() => router.navigate(-2));
    expect(stand.search).toBe('?q=erst');
    expect(stand.wert).toBe('erst');
  });
});

describe('Schreiben im selben Zug (LLH-1826)', () => {
  it('zwei Setter im selben Handler überschreiben einander nicht', async () => {
    let sicht: (v: 'offen' | 'abgeschlossen') => void = () => {};
    starte(() => {
      const [, setzeSicht] = useAdressWert(
        'sicht',
        { offen: true, abgeschlossen: true },
        'offen',
      );
      sicht = setzeSicht;
      return useAdressWert('richtung', RICHTUNG_ERLAUBT, 'alle');
    }, ['/m']);
    act(() => {
      (stand.setze as (v: Richtung) => void)('extern');
      sicht('abgeschlossen');
    });
    await waitFor(() => expect(stand.search).toBe('?richtung=extern&sicht=abgeschlossen'));
  });

  it('ein Setter stellt einen eben geräumten Link-Auftrag nicht wieder her', async () => {
    let raeume: () => void = () => {};
    starte(() => {
      const auftrag = useLinkAuftrag();
      raeume = () => auftrag.raeume('meldung');
      return useAdressWert('richtung', RICHTUNG_ERLAUBT, 'alle');
    }, ['/m?meldung=7&richtung=extern']);
    act(() => {
      raeume();
      (stand.setze as (v: Richtung) => void)('alle');
    });
    await waitFor(() => expect(stand.search).toBe(''));
  });
});
