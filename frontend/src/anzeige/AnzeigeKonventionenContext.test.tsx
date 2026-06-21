import { screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { EinsatzAnzeigeProvider, useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { setzeOverride } from './koordinatenSystemStore';
import type { EinsatzEinstellungen, OrgEinstellungen } from '../api/types';

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
      <span data-testid="distanz">{k.formatDistanz(5000)}</span>
    </div>
  );
}

/** Vollständiges EinsatzEinstellungen-Mock; `partial` überschreibt gezielt einzelne Felder. */
function einstellungenMock(partial: Partial<EinsatzEinstellungen> = {}): EinsatzEinstellungen {
  return {
    einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
    fachebenen_sichtbar: null,
    zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
    etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null,
    meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null,
    meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null,
    auto_etb_eintraege: null, retention_dauer_tage: null,
    etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false,
    geaendert_at: null, geaendert_von: null,
    ...partial,
  };
}

/** Vollständiges OrgEinstellungen-Mock für das eingebettete `org_defaults`-Feld. */
function orgDefaultsMock(partial: Partial<OrgEinstellungen> = {}): OrgEinstellungen {
  return {
    zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: null,
    retention_dauer_tage: null, etb_nummer_praefix: null, meldung_nummer_praefix: null,
    auftrag_nummer_praefix: null, meldung_bestaetigung_frist_min: null,
    auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, geocoder_url: null,
    geaendert_at: null, geaendert_von: null,
    ...partial,
  };
}

describe('useAnzeigeKonventionen', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => localStorage.clear());

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

  it('Override übersteuert das geladene Koordinatenformat in formatKoordinate', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
      fachebenen_sichtbar: null,
      zeitzone: null, zeitformat: null, einheiten: null, koordinatenformat: 'wgs84',
      etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null, meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null, meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false, retention_dauer_tage: null, geaendert_at: null, geaendert_von: null,
    });

    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>
        <Sonde />
      </EinsatzAnzeigeProvider>,
    );

    // Warte bis wgs84 geladen ist.
    await waitFor(() =>
      expect(screen.getByTestId('koord').textContent).toBe('51.10000, 4.10000'),
    );

    // Override auf DMS setzen — Anzeige muss reaktiv wechseln.
    act(() => setzeOverride('dms'));

    await waitFor(() =>
      expect(screen.getByTestId('koord').textContent).toBe("51°06'00\"N 004°06'00\"E"),
    );
  });

  it('fällt auf den Org-Default zurück, wenn der Einsatz keinen eigenen Wert hat', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(
      einstellungenMock({
        koordinatenformat: null,
        org_defaults: orgDefaultsMock({ koordinatenformat: 'mgrs' }),
      }),
    );

    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>
        <Sonde />
      </EinsatzAnzeigeProvider>,
    );

    // Kein Einsatz-Override → der globale Org-Default (mgrs) greift in der Anzeige.
    await waitFor(() =>
      expect(screen.getByTestId('koord').textContent).toBe('31U ES 77019 61520'),
    );
    expect(screen.getByTestId('format').textContent).toBe('mgrs');
  });

  it('Einsatz-Wert sticht den Org-Default', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(
      einstellungenMock({
        koordinatenformat: 'wgs84',
        org_defaults: orgDefaultsMock({ koordinatenformat: 'mgrs' }),
      }),
    );

    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>
        <Sonde />
      </EinsatzAnzeigeProvider>,
    );

    // Einsatz-wgs84 schlägt den Org-Default mgrs → Dezimalanzeige (warte auf den
    // geladenen Zustand: format wechselt von 'null' auf 'wgs84').
    await waitFor(() => expect(screen.getByTestId('format').textContent).toBe('wgs84'));
    expect(screen.getByTestId('koord').textContent).toBe('51.10000, 4.10000');
  });

  it('zieht auch andere Konventionen (Zeitzone/Zeitformat/Einheiten) aus dem Org-Default', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue(
      einstellungenMock({
        zeitzone: null,
        zeitformat: null,
        einheiten: null,
        org_defaults: orgDefaultsMock({
          zeitzone: 'Europe/Berlin', zeitformat: '12h', einheiten: 'imperial',
        }),
      }),
    );

    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>
        <Sonde />
      </EinsatzAnzeigeProvider>,
    );

    // 09:00 UTC → Berlin 11:00 im 12h-Format; 5000 m → imperial; beides aus dem Org-Default
    // (kein Einsatz-Override) — der Cascade greift für alle Anzeige-Konventionen, nicht nur Koordinaten.
    await waitFor(() =>
      expect(screen.getByTestId('zeit').textContent).toBe('11.06.2026 11:00 AM'),
    );
    expect(screen.getByTestId('distanz').textContent).toBe('3.11 mi');
  });
});
