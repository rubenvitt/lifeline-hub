// frontend/src/command-palette/useKoordinatenSprung.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { formatiere } from '../anzeige/koordinaten';
import { useKoordinatenSprung } from './useKoordinatenSprung';
import type { PaletteModus } from './typen';

/**
 * Die Beschaffungs-Hälfte des Koordinatensprungs (LFH-619). Der reine Kern steht in
 * `koordinatenSprung.test.ts`; hier steht, WANN angefragt wird, und dass Rechte und
 * eingestelltes Format ankommen.
 *
 * Zähler je Endpunkt wie in `useDatensaetze.test.tsx`: „kein Request, solange keine Koordinate
 * getippt ist" ist die Zusicherung, die die Bestands-Palettentests grün hält — die fahren MSW
 * mit `onUnhandledRequest: 'error'`, ein eager Abruf bräche sie.
 */
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    benutzer: {
      id: 1,
      anzeigename: 'EL',
      benutzername: 'el',
      system_rolle: 'keiner',
      org_rolle: 'fuehrungskraft',
      aktiv: true,
      erstellt_at: '',
      totp_aktiviert: false,
    },
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}));

const EINSATZ = 1;
const BERLIN = '52.52194, 13.41321';

let zaehler: Record<string, number>;
let overrides: Record<string, object>;
let einstellungen: object;

beforeEach(() => {
  zaehler = {};
  overrides = {};
  einstellungen = {};
  server.use(
    http.get('/api/einsaetze/:id/modul-overrides', () => {
      zaehler.overrides = (zaehler.overrides ?? 0) + 1;
      return HttpResponse.json(overrides);
    }),
    http.get('/api/einsaetze/:id/einstellungen', () => {
      zaehler.einstellungen = (zaehler.einstellungen ?? 0) + 1;
      return HttpResponse.json(einstellungen);
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
      useKoordinatenSprung({
        einsatzId: p.einsatzId === undefined ? EINSATZ : p.einsatzId,
        modus: p.modus ?? 'alles',
        suche: p.suche,
        navigate: (pfad) => ziele.push(pfad),
      }),
    { wrapper: Wrapper, initialProps: anfang },
  );
}

/** Eine Runde Ereignisschleife — MSW liefert asynchron, ein synchroner Blick wäre trivial 0. */
async function ruhe() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('useKoordinatenSprung', () => {
  it('fragt nichts an, solange keine Koordinate getippt ist', async () => {
    const { rerender } = starte({ suche: 'deich' });
    await ruhe();
    rerender({ suche: '42' });
    await ruhe();
    expect(zaehler).toEqual({});
  });

  it('liefert für eine Koordinate die Kartenzeile, sobald die Rechte bekannt sind', async () => {
    const ziele: string[] = [];
    const { result } = starte({ suche: BERLIN }, ziele);
    await waitFor(() => expect(result.current(BERLIN)).not.toBeNull());
    const befehl = result.current(BERLIN)!;
    befehl.ausfuehren();
    expect(new URL(ziele[0], 'http://x').searchParams.get('zentrum')).toBe('52.52194,13.41321');
    // Die Palette fragt mit dem LEBENDEN Rest: keine Koordinate → keine Zeile.
    expect(result.current('deich')).toBeNull();
  });

  it('beschriftet im eingestellten Format des Einsatzes', async () => {
    einstellungen = { koordinatenformat: 'mgrs' };
    const { result } = starte({ suche: BERLIN });
    const mgrs = formatiere(52.52194, 13.41321, 'mgrs');
    await waitFor(() => expect(result.current(BERLIN)?.label).toContain(mgrs));
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
    const { result } = starte({ suche: BERLIN });
    await waitFor(() => expect(zaehler.overrides).toBe(1));
    await ruhe();
    expect(result.current(BERLIN)).toBeNull();
  });

  it('ausserhalb eines Einsatzes und in einem Präfixmodus fragt und bietet er nichts', async () => {
    const aussen = starte({ suche: BERLIN, einsatzId: null });
    const imModus = starte({ suche: BERLIN, modus: 'kraefte' });
    await ruhe();
    expect(zaehler).toEqual({});
    expect(aussen.result.current(BERLIN)).toBeNull();
    expect(imModus.result.current(BERLIN)).toBeNull();
  });
});
