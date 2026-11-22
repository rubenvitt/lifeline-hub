import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import { useAbgelehnteAntraegeAusCache } from './abgelehnteAntraege';
import { useAntraegeAusCache, useSpiegelAusCache } from './useSpiegelAntraege';

/**
 * LLH-1904: Beim Abmelden legte die Sprungpalette im Render eine neue Abfrage an
 * (`benutzerEinstellungenVon(null)`), der Cache meldete das synchron, und die Betriebszeile las
 * nach dem Leeren des Caches einen anderen Stand. React warnte „Cannot update a component
 * (`LiveStatusBanner`) while rendering a different component (`CommandPaletteProvider`)“.
 *
 * Nachgestellt ohne den ganzen Rahmen: `Oben` wechselt den Key seiner Abfrage wie die Palette und
 * rendert darunter einen Leser, der nur den Cache liest. Ein Leser, der den Cache roh abonniert,
 * würde mitten im Render von `Oben` aktualisiert.
 */

let setzeKey: (key: number | null) => void = () => {};

/**
 * Je Fall eine eigene Komponente mit eigenem Namen: React warnt je Paar aus rendernder und
 * aktualisierter Komponente nur einmal, ein geteiltes `Oben` verschluckte die Warnung der Fälle
 * danach.
 */
function obenFuer(name: string) {
  function Oben({ children }: { children: ReactNode }) {
    const [key, setKey] = useState<number | null>(1);
    setzeKey = setKey;
    useQuery({ queryKey: ['fremd', key], queryFn: () => key, enabled: key != null });
    return <>{children}</>;
  }
  Oben.displayName = `Oben${name}`;
  return Oben;
}

function AbgelehnteLeser() {
  return <span>{useAbgelehnteAntraegeAusCache(7).length}</span>;
}

function AntraegeLeser() {
  return <span>{useAntraegeAusCache(3).length}</span>;
}

function SpiegelLeser() {
  const { spiegel, abgleichTakt } = useSpiegelAusCache(3);
  return <span>{`${spiegel}-${abgleichTakt}`}</span>;
}

function fehlerBeimAbmelden(qc: QueryClient, name: string, leser: ReactNode): string[] {
  const Oben = obenFuer(name);
  const fehler = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <QueryClientProvider client={qc}>
      <Oben>{leser}</Oben>
    </QueryClientProvider>,
  );
  // Wie `abmeldenLokal`: Cache leeren, Benutzer weg; die Palette legt im Render eine neue Abfrage an.
  act(() => {
    qc.clear();
    setzeKey(null);
  });
  return fehler.mock.calls.map((aufruf) => String(aufruf[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cache-Leser aktualisieren nicht im Render einer anderen Komponente (LLH-1904)', () => {
  it('useAbgelehnteAntraegeAusCache: die Betriebszeile bleibt still, wenn die Palette beim Abmelden eine Abfrage anlegt', () => {
    const qc = new QueryClient();
    qc.setQueryData(globalKeys.abgelehnteAntraegeVon(7), []);
    expect(fehlerBeimAbmelden(qc, 'Abgelehnte', <AbgelehnteLeser />)).toEqual([]);
  });

  it('useAntraegeAusCache: der Antragsstand am Spiegel bleibt still, wenn anderswo eine Abfrage entsteht', () => {
    const qc = new QueryClient();
    qc.setQueryData(einsatzKeys.antraege(3), []);
    expect(fehlerBeimAbmelden(qc, 'Antraege', <AntraegeLeser />)).toEqual([]);
  });

  it('useSpiegelAusCache: die Spiegel-Erkennung bleibt still, wenn anderswo eine Abfrage entsteht', () => {
    const qc = new QueryClient();
    qc.setQueryData(einsatzKeys.einsatz(3), { spiegel: {} });
    expect(fehlerBeimAbmelden(qc, 'Spiegel', <SpiegelLeser />)).toEqual([]);
  });

  it('der Leser zeigt den neuen Stand trotzdem, sobald der Cache ihn gemeldet hat', async () => {
    const qc = new QueryClient();
    qc.setQueryData(globalKeys.abgelehnteAntraegeVon(7), [{}, {}]);
    const { findByText } = render(
      <QueryClientProvider client={qc}>
        <AbgelehnteLeser />
      </QueryClientProvider>,
    );
    await findByText('2');
    act(() => {
      qc.setQueryData(globalKeys.abgelehnteAntraegeVon(7), [{}, {}, {}]);
    });
    await findByText('3');
  });
});
