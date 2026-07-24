import { describe, it, expect, vi, beforeEach } from 'vitest';
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

/** Minimal-Snapshot-Dokument: eine Gefahrengebiet-Zone + das Gebiet mit EINGEFRORENER Warnstufe. */
function dokument(warnstufe: string) {
  const stand = '2026-07-24T08:00:00Z';
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
      einheiten: [],
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

  it('Historien-Modus sperrt Schreiben (darfSchreiben=false) und ladt spiegelt die Snapshot-Query', async () => {
    ladeLageSnapshot.mockResolvedValue(dokument('akut'));
    const { result } = renderHook(
      () => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    // ladt darf nicht sofort false sein (disabled Live-Query meldet isLoading=false — die
    // Snapshot-Query trägt das Ladegate).
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
    // Die Zonenfarbe stammt aus der eingefrorenen Warnstufe 'mittel'. Läse der Hook aus einer
    // Live-Quelle (im Snapshot-Modus abgeschaltet → undefined → 'keine'), wäre die Farbe eine andere.
    expect(result.current.zonenFeatures[0].stil).toEqual(gefahrengebietStil('mittel'));
    expect(result.current.zonenFeatures[0].stil).not.toEqual(gefahrengebietStil('keine'));
  });
});
