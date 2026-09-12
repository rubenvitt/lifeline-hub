import { describe, it, expect, vi, beforeEach } from 'vitest';
import { theme } from 'antd';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../../test/server';
import { neuerQueryClient } from '../../test/utils';
import { gefahrengebietStil } from './zonenStil';

// darfSchreiben wird im Snapshot-Modus hart auf false gefahren → benutzer egal.
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    benutzer: null,
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
  }),
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
        {
          id: 1,
          name: 'Zug 1',
          typ_label: 'Zug',
          lat: 50.1,
          lon: 8.6,
          tz_fachaufgabe: null,
          tz_organisation: null,
        },
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
            coordinates: [
              [
                [8.6, 50.1],
                [8.7, 50.1],
                [8.7, 50.2],
                [8.6, 50.1],
              ],
            ],
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
    ladeLageSnapshot.mockReturnValue(
      new Promise((r) => {
        aufloesen = r;
      }),
    );
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
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
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
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
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.alleVerortet.length).toBeGreaterThan(0));
    // Die Einheit hat kein eigenes tz_organisation → ihre TZ nutzt den EINGEFRORENEN org_default 'thw'.
    // Läse der Hook die (im Snapshot-Modus abgeschaltete) Live-Org-Query, wäre organisation nicht 'thw'.
    const einheit = result.current.alleVerortet.find((m) => m.schluessel === 'einheit-1');
    expect(einheit?.tz?.organisation).toBe('thw');
  });
});

/**
 * Der benannte Quellenkatalog (LFH-331 · B3).
 *
 * Hier liegt die Beweislast für AK6, nicht in der Seitenklammer: dort ist die Negativhälfte
 * strukturell wahr (kein Fehler → das Overlay ist gar nicht montiert), hier wird die
 * Zuordnung Query → Name und die Trennlinie Lagebild/Render-Kontext tatsächlich geprüft.
 */
describe('useLagekarteDaten fehlerhafteQuellen', () => {
  it('nennt die gescheiterten Lagebild-Quellen — und KEINEN Render-Kontext', async () => {
    // Zwei Lagebild-Quellen scheitern (uhs, zonen) UND alle drei Render-Kontext-Quellen
    // (Organisation, Karten-Config, Einstellungen). Genau das trennt die Entscheidung von
    // einem „alles, was rot ist"-Sammelsurium: nur die zwei stehen in der Meldung. Wäre der
    // Render-Kontext im Katalog, käme die Liste hier auf fünf Einträge.
    server.use(
      http.get('/api/einsaetze/5', () =>
        HttpResponse.json({ id: 5, bezeichnung: 'T', status: 'aktiv' }),
      ),
      http.get('/api/einsaetze/5/uhs', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/einsaetze/5/zonen', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/organisation', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/karte/config', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/einsaetze/5/einstellungen', () => new HttpResponse(null, { status: 500 })),
      ...[
        '/api/einsaetze/5/schaeden',
        '/api/einsaetze/5/einheiten',
        '/api/einsaetze/5/fahrzeuge',
        '/api/einsaetze/5/abschnitte',
        '/api/einsaetze/5/freie-zeichen',
        '/api/einsaetze/5/gefahrengebiete',
        '/api/einsaetze/5/lage/meldungen',
        '/api/einsaetze/5/karte/fuehrungskraefte',
      ].map((pfad) => http.get(pfad, () => HttpResponse.json([]))),
    );
    const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fehlerhafteQuellen).toHaveLength(2));
    expect(result.current.fehlerhafteQuellen).toEqual(['Unfallhilfsstellen', 'Zonen']);
  });

  it('ist bei vollständigem Abruf leer', async () => {
    server.use(
      http.get('/api/einsaetze/5', () =>
        HttpResponse.json({ id: 5, bezeichnung: 'T', status: 'aktiv' }),
      ),
      http.get('/api/organisation', () =>
        HttpResponse.json({ id: 1, name: 'Org', tz_organisation: null }),
      ),
      http.get('/api/karte/config', () =>
        HttpResponse.json({
          online_styles: [],
          offline_verfuegbar: false,
          offline_tiles_url: null,
          offline_attribution: null,
          offline_regionen: [],
          karten_bau_verfuegbar: false,
        }),
      ),
      http.get('/api/einsaetze/5/einstellungen', () =>
        HttpResponse.json({ einsatz_id: 5, org_defaults: { org_id: 1 } }),
      ),
      ...[
        '/api/einsaetze/5/uhs',
        '/api/einsaetze/5/schaeden',
        '/api/einsaetze/5/einheiten',
        '/api/einsaetze/5/fahrzeuge',
        '/api/einsaetze/5/abschnitte',
        '/api/einsaetze/5/zonen',
        '/api/einsaetze/5/freie-zeichen',
        '/api/einsaetze/5/gefahrengebiete',
        '/api/einsaetze/5/lage/meldungen',
        '/api/einsaetze/5/karte/fuehrungskraefte',
      ].map((pfad) => http.get(pfad, () => HttpResponse.json([]))),
    );
    const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ladt).toBe(false));
    expect(result.current.fehlerhafteQuellen).toEqual([]);
  });

  it('spiegelt im Historien-Modus die EINE aktive Quelle, nicht die elf abgeschalteten', async () => {
    // Die Weiche ist dieselbe wie bei `ladt`: im Snapshot-Modus sind die Live-Queries
    // `enabled: false` und melden nie einen Fehler — die Aussage über den Stand kann also
    // nur das Dokument treffen.
    ladeLageSnapshot.mockRejectedValue(new Error('weg'));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.fehlerhafteQuellen).toEqual(['Gesicherter Stand']));
  });
});
