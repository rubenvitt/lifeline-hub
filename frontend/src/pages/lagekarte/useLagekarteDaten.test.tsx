import { describe, it, expect, vi, beforeEach } from 'vitest';
import { theme } from 'antd';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import { gefahrengebietStil } from './zonenStil';

// darfSchreiben wird im Snapshot-Modus hart auf false gefahren → benutzer egal.
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: null, laedt: false, login: vi.fn(), logout: vi.fn(), aktualisiere: vi.fn() }),
}));

const ladeLageSnapshot = vi.fn();
vi.mock('../../api/lageSnapshot', () => ({
  ladeLageSnapshot: (...a: unknown[]) => ladeLageSnapshot(...a),
}));

import { useLagekarteDaten } from './useLagekarteDaten';

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Minimal-Snapshot-Dokument: eine Gefahrengebiet-Zone (EINGEFRORENE Warnstufe) + eine verortete
 *  Einheit OHNE eigene Org (org-scoped tz_organisation=null) → prüft den org_default-Freeze.
 *  `stand_at` bewusst im ECHTEN naiven UTC-Wire-Format (ohne 'T'/'Z'), wie das Backend liefert. */
function dokument(warnstufe: string) {
  const stand = '2026-07-24 08:00:00';
  return {
    id: 9,
    einsatz_id: 5,
    stand_at: stand,
    schema_version: 1,
    erstellt_von: 1,
    erstellt_at: stand,
    daten: {
      version: 1,
      stand_at: stand,
      org_default: 'thw',
      einsatz: { id: 5 },
      ansichten: [],
      uhs: [],
      schaeden: [],
      einheiten: [
        { id: 1, name: 'Zug 1', typ_label: 'Zug', lat: 50.1, lon: 8.6, tz_fachaufgabe: null, tz_organisation: null },
      ],
      fahrzeuge: [],
      fuehrungskraefte: [],
      abschnitte: [],
      freie_zeichen: [],
      lagemeldungen: [],
      bilder: [],
      zonen: [
        {
          id: 1,
          typ: 'gefahrengebiet',
          gefahrengebiet_id: 7,
          geometrie: JSON.stringify({
            type: 'Polygon',
            coordinates: [[[8.6, 50.1], [8.7, 50.1], [8.7, 50.2], [8.6, 50.1]]],
          }),
          farbe: null,
          label: null,
          ansicht_id: null,
        },
      ],
      gefahrengebiete: [{ id: 7, hoechste_warnstufe: warnstufe }],
    },
  };
}

describe('useLagekarteDaten Standquelle', () => {
  beforeEach(() => ladeLageSnapshot.mockReset());

  it('Historien-Modus sperrt Schreiben und ladt trägt die Snapshot-Query (pending → false)', async () => {
    // Deferred Promise: die Pending-Phase explizit festnageln — sonst greift waitFor(false) sofort
    // und die `istSnapshot ? snapQuery.isLoading`-Regel bliebe ungetestet (Review-Fix #5).
    let aufloesen!: (v: unknown) => void;
    ladeLageSnapshot.mockReturnValue(new Promise((r) => { aufloesen = r; }));
    const { result } = renderHook(
      () => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    // Solange das Dokument nicht da ist, MUSS ladt true sein (die disabled Live-Queries melden
    // isLoading=false → nur die Snapshot-Query darf das Gate tragen).
    expect(result.current.ladt).toBe(true);
    expect(result.current.darfSchreiben).toBe(false);

    aufloesen(dokument('akut'));
    await waitFor(() => expect(result.current.ladt).toBe(false));
    expect(result.current.darfSchreiben).toBe(false);
    expect(ladeLageSnapshot).toHaveBeenCalledWith(5, 9);
  });

  it('speist die Gefahrengebiet-Warnstufe aus dem eingefrorenen Dokument, nicht aus Live', async () => {
    ladeLageSnapshot.mockResolvedValue(dokument('mittel'));
    const { result } = renderHook(
      () => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.zonenFeatures.length).toBe(1));
    // Der Token kommt aus DEMSELBEN Render-Pfad wie im Hook (LFH-328/A2: `gefahrengebietStil`
    // bekommt ihn durchgereicht, weil Kartenstil-Module keinen `useToken()`-Zugang haben) —
    // nicht aus `theme.getDesignToken()`, das wäre eine ungeprüfte Gleichheitsannahme.
    const { result: tk } = renderHook(() => theme.useToken(), { wrapper: wrapper() });
    const token = tk.current.token;
    // Die Zonenfarbe stammt aus der eingefrorenen Warnstufe 'mittel'. Läse der Hook aus einer
    // Live-Quelle (im Snapshot-Modus abgeschaltet → undefined → 'keine'), wäre die Farbe eine andere.
    // NICHT auf 'niedrig' vs. 'mittel' umschreiben: beide fallen seit A2 auf die Rolle `achtung`
    // (dokumentierter Auflösungsverlust), die Gegenprobe würde damit stillschweigend leer.
    expect(result.current.zonenFeatures[0].stil).toEqual(gefahrengebietStil('mittel', token));
    expect(result.current.zonenFeatures[0].stil).not.toEqual(gefahrengebietStil('keine', token));
  });

  it('speist den org_default aus dem Dokument in die Marker-TZ, nicht aus Live (Review-Fix #4)', async () => {
    ladeLageSnapshot.mockResolvedValue(dokument('mittel'));
    const { result } = renderHook(
      () => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.alleVerortet.length).toBeGreaterThan(0));
    // Die Einheit hat kein eigenes tz_organisation → ihre TZ nutzt den EINGEFRORENEN org_default 'thw'.
    // Läse der Hook die (im Snapshot-Modus abgeschaltete) Live-Org-Query, wäre organisation nicht 'thw'.
    const einheit = result.current.alleVerortet.find((m) => m.schluessel === 'einheit-1');
    expect(einheit?.tz?.organisation).toBe('thw');
  });
});
