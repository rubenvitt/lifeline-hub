import { describe, expect, it, vi } from 'vitest';
import { theme } from 'antd';

// Zeichnet die Bibliothek das Tier ohne Zustand nicht, bleibt der Marker ein Kreis mit „T“
// (Spec tier-lagekarte, Rückfall; LLH-1343).
vi.mock('@einsatzzeichen/core', async (original) => {
  const echt = await original<typeof import('@einsatzzeichen/core')>();
  return {
    ...echt,
    drawAnySpec: vi.fn((spec: { kind?: string }) => {
      if (spec.kind === 'animal-state') throw new TypeError('nicht darstellbar');
      return echt.drawAnySpec(spec as Parameters<typeof echt.drawAnySpec>[0]);
    }),
  };
});

const { buildTierMarker } = await import('./tierMarker');
const { markerIconKey } = await import('./markerIcons');
const { rollenFarbe } = await import('../../theme/statusFarben');

const token = theme.getDesignToken();

describe('buildTierMarker — Rückfall ohne Tierzeichen (LLH-1343)', () => {
  it('offenes und vermisstes Tier tragen „T“ und kein Bild, vermisst ohne Scheibe', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { verortet } = buildTierMarker(
      [
        {
          id: 1,
          registrier_nr: 1,
          status: 'aktiv',
          spezies: 'hund',
          rufname: null,
          antreff_ort: null,
          antreff_lat: 1,
          antreff_lon: 2,
        },
        {
          id: 2,
          registrier_nr: 2,
          status: 'vermisst',
          spezies: 'katze',
          rufname: null,
          antreff_ort: null,
          antreff_lat: 3,
          antreff_lon: 4,
        },
      ],
      token,
    );
    const [offen, vermisst] = verortet;
    expect(offen.kurzzeichen).toBe('T');
    expect(vermisst.kurzzeichen).toBe('T');
    expect(markerIconKey(offen)).toBeUndefined();
    expect(markerIconKey(vermisst)).toBeUndefined();
    // Im Rückfall trägt der Kreis selbst die Achtung-Farbe, eine Scheibe dahinter entfällt.
    expect(vermisst.farbe).toBe(rollenFarbe('achtung', token));
    expect(vermisst.statusFarbe).toBeUndefined();
  });
});
