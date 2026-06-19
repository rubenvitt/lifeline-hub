import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { EinsatzAnzeigeProvider, useAnzeigeKonventionen } from './AnzeigeKonventionenContext';

vi.mock('../api/einsaetze', () => ({ ladeEinstellungen: vi.fn() }));
import { ladeEinstellungen } from '../api/einsaetze';

/** Testkomponente, die den Hook ausliest und Formatter-Ergebnisse rendert. */
function Sonde() {
  const k = useAnzeigeKonventionen();
  return (
    <div>
      <span data-testid="zeit">{k.formatZeit('2026-06-11 09:00:00')}</span>
      <span data-testid="koord">{k.formatKoordinate(51.1, 4.1)}</span>
      <span data-testid="format">{k.konventionen.koordinatenformat ?? 'null'}</span>
    </div>
  );
}

describe('useAnzeigeKonventionen', () => {
  beforeEach(() => vi.resetAllMocks());

  it('liefert ohne Provider die Defaults (kein Throw)', () => {
    renderMitProviders(<Sonde />);
    expect(screen.getByTestId('koord').textContent).toBe('51.10000, 4.10000');
    expect(screen.getByTestId('format').textContent).toBe('null');
  });

  it('bindet die geladenen Einstellungen an die Formatter', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: 'Europe/Berlin', zeitformat: '12h', einheiten: 'metrisch', koordinatenformat: 'mgrs',
      etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null, meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null, meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false, retention_dauer_tage: null, geaendert_at: null, geaendert_von: null,
    });

    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>
        <Sonde />
      </EinsatzAnzeigeProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('koord').textContent).toBe('31U ES 77019 61520'),
    );
    // 09:00 UTC → Berlin 11:00, 12h-Format.
    expect(screen.getByTestId('zeit').textContent).toBe('11.06.2026 11:00 AM');
    expect(screen.getByTestId('format').textContent).toBe('mgrs');
  });

  it('fällt bei fehlenden Werten auf Defaults zurück (Alt-Verhalten)', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
      etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null, meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null, meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false, retention_dauer_tage: null, geaendert_at: null, geaendert_von: null,
    });

    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>
        <Sonde />
      </EinsatzAnzeigeProvider>,
    );

    // Default-Koordinate bleibt dezimal.
    await waitFor(() => expect(ladeEinstellungen).toHaveBeenCalledWith(1));
    expect(screen.getByTestId('koord').textContent).toBe('51.10000, 4.10000');
  });
});
