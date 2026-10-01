import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useAdressSprung } from './useAdressSprung';
import type { PaletteModus } from './typen';
import { authWertFixture, benutzerFixture } from '../test/fixtures';

/**
 * Beschaffung der Adresszeile (LFH-638): Rechte wie beim Koordinatensprung, und NIE eine Anfrage an
 * die Adresssuche — die Palette tippt live, gesucht wird erst auf der Karte.
 */
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => authWertFixture(benutzerFixture({ org_rolle: 'fuehrungskraft' })),
}));

const EINSATZ = 1;

let zaehler: Record<string, number>;
let overrides: Record<string, object>;

beforeEach(() => {
  zaehler = {};
  overrides = {};
  server.use(
    http.get('/api/einsaetze/:id/modul-overrides', () => {
      zaehler.overrides = (zaehler.overrides ?? 0) + 1;
      return HttpResponse.json(overrides);
    }),
    http.get('/api/einsaetze/:id/einstellungen', () => HttpResponse.json({})),
    http.get('/api/einsaetze/:id/karte/ort-suche', () => {
      zaehler.ortSuche = (zaehler.ortSuche ?? 0) + 1;
      return HttpResponse.json({ zustand: 'ok', treffer: [] });
    }),
  );
});

interface Eingabe {
  suche: string;
  modus?: PaletteModus;
  einsatzId?: number | null;
}

function starte(anfang: Eingabe, ziele: string[] = []) {
  const client = neuerQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    (p: Eingabe) =>
      useAdressSprung({
        einsatzId: p.einsatzId === undefined ? EINSATZ : p.einsatzId,
        modus: p.modus ?? 'alles',
        suche: p.suche,
        navigate: (pfad) => ziele.push(pfad),
      }),
    { wrapper: Wrapper, initialProps: anfang },
  );
}

async function ruhe() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('useAdressSprung (LFH-638)', () => {
  it('fragt nichts an, solange die Eingabe keine Adresse sein kann', async () => {
    const { rerender } = starte({ suche: '42' });
    await ruhe();
    rerender({ suche: '51.16040, 10.45140' });
    await ruhe();
    expect(zaehler).toEqual({});
  });

  it('liefert die Adresszeile mit Recht auf die Lagekarte — und fragt nie die Adresssuche', async () => {
    const ziele: string[] = [];
    const { result } = starte({ suche: 'Hauptstraße 12' }, ziele);
    await waitFor(() => expect(result.current('Hauptstraße 12')).not.toBeNull());
    result.current('Hauptstraße 12')!.ausfuehren();
    expect(new URL(ziele[0], 'http://x').searchParams.get('ort')).toBe('Hauptstraße 12');
    expect(result.current('Ha')).toBeNull();
    await ruhe();
    expect(zaehler.ortSuche).toBeUndefined();
  });

  it('bietet nichts an, wenn die Lagekarte im Einsatz ausgeblendet ist', async () => {
    overrides = {
      lagekarte: {
        einsatz_id: EINSATZ,
        modul_key: 'lagekarte',
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    const { result } = starte({ suche: 'Hauptstraße 12' });
    await waitFor(() => expect(zaehler.overrides).toBe(1));
    await ruhe();
    expect(result.current('Hauptstraße 12')).toBeNull();
  });

  it('ausserhalb eines Einsatzes und in einem Präfixmodus fragt und bietet er nichts', async () => {
    const aussen = starte({ suche: 'Hauptstraße 12', einsatzId: null });
    const praefix = starte({ suche: 'Hauptstraße 12', modus: 'etb' });
    await ruhe();
    expect(aussen.result.current('Hauptstraße 12')).toBeNull();
    expect(praefix.result.current('Hauptstraße 12')).toBeNull();
    expect(zaehler).toEqual({});
  });
});
