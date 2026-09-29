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

// Ebene „Betroffene": ohne Benutzer ist das Modul „Personen" im Client frei, die Personen-Query
// läuft also in jedem Live-Test. Vorgaben hier; ein Test kann sie per `server.use` überlagern.
beforeEach(() => {
  server.use(
    http.get('/api/einsaetze/5/modul-overrides', () => HttpResponse.json({})),
    http.get('/api/einsaetze/5/personen', () => HttpResponse.json([])),
    // Ebene „Betreuungsstellen": dieselbe Lage, ohne Benutzer ist das Modul frei.
    http.get('/api/einsaetze/5/betreuung', () => HttpResponse.json({ bezirke: [], stellen: [] })),
  );
});

function wrapper() {
  const client = neuerQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/**
 * Minimal-Snapshot-Dokument: eine Gefahrengebiet-Zone (eingefrorene Warnstufe) + eine verortete
 * Einheit ohne eigene Org → prüft den org_default-Freeze. `stand_at` im echten naiven
 * UTC-Wire-Format (ohne 'T'/'Z').
 */
function dokument(warnstufe: string, ohneGebiete = false) {
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
      gefahrengebiete: ohneGebiete ? [] : [{ id: 7, hoechste_warnstufe: warnstufe }],
    },
  };
}

describe('useLagekarteDaten Standquelle', () => {
  beforeEach(() => ladeLageSnapshot.mockReset());

  it('Historien-Modus sperrt Schreiben und ladt trägt die Snapshot-Query (pending → false)', async () => {
    // Deferred Promise: die Pending-Phase festnageln, sonst griffe waitFor(false) sofort und die
    // `istSnapshot ? snapQuery.isLoading`-Regel bliebe ungetestet.
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
    // Solange das Dokument fehlt, muss ladt true sein: die abgeschalteten Live-Queries melden
    // isLoading=false, nur die Snapshot-Query darf das Gate tragen.
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
    // Der Token kommt aus demselben Render-Pfad wie im Hook, nicht aus `theme.getDesignToken()` —
    // das wäre eine ungeprüfte Gleichheitsannahme.
    const { result: tk } = renderHook(() => theme.useToken(), { wrapper: wrapper() });
    const token = tk.current.token;
    // Die Zonenfarbe stammt aus der eingefrorenen Warnstufe 'mittel'; läse der Hook live (im
    // Snapshot-Modus undefined → 'keine'), wäre sie eine andere. Nicht auf 'niedrig' vs. 'mittel'
    // umschreiben: beide fallen auf die Rolle `achtung`, die Gegenprobe würde leer.
    expect(result.current.zonenFeatures[0].stil).toEqual(gefahrengebietStil('mittel', token));
    expect(result.current.zonenFeatures[0].stil).not.toEqual(gefahrengebietStil('keine', token));
  });

  // Die Stufe muss auf der Kartenfläche ankommen (LFH-357). `stil` kann sie nicht tragen (je
  // mehrere Stufen auf derselben Rolle); der Text ist der zweite Kanal, geprüft wird die
  // Verdrahtung.
  it('trägt die Warnstufe in die Zonenbeschriftung, nicht nur in die Farbe', async () => {
    ladeLageSnapshot.mockResolvedValue(dokument('mittel'));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.zonenFeatures.length).toBe(1));
    // Die Zone hat keinen eigenen Namen (`label: null`), übrig bleibt die Stufe. Erwartung als
    // Literal, nicht über `zonenBeschriftung`, sonst stünden beide Seiten auf derselben Quelle.
    expect(result.current.zonenFeatures[0].label).toBe('mittel');
    // Gegenprobe gegen die Nachbarin auf derselben Farbe — sie muss am Text auseinandergehen.
    expect(result.current.zonenFeatures[0].label).not.toBe('niedrig');
  });

  // Das Ladegate (`ladt`) hängt nicht an der Gefahrengebiete-Query: die Zone wird gezeichnet,
  // während der Nachschlag leer ist oder bleibt. Der Farb-Fallback auf `keine` ist dort richtig;
  // der Text darf die Stufe nicht behaupten.
  it('sagt `unbekannt`, wenn der Gebiets-Nachschlag ins Leere geht — die Farbe bleibt Alarm', async () => {
    ladeLageSnapshot.mockResolvedValue(dokument('mittel', true));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.zonenFeatures.length).toBe(1));
    expect(result.current.zonenFeatures[0].label).toBe('Stufe unbekannt');
    // Zweite Hälfte: der vorsichtshalber rote Fallback ist nicht mitgewandert.
    const { result: tk } = renderHook(() => theme.useToken(), { wrapper: wrapper() });
    expect(result.current.zonenFeatures[0].stil).toEqual(
      gefahrengebietStil('keine', tk.current.token),
    );
  });

  it('speist den org_default aus dem Dokument in die Marker-TZ, nicht aus Live (Review-Fix #4)', async () => {
    ladeLageSnapshot.mockResolvedValue(dokument('mittel'));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.alleVerortet.length).toBeGreaterThan(0));
    // Die Einheit hat kein eigenes tz_organisation → ihre TZ nutzt den eingefrorenen org_default
    // 'thw'. Läse der Hook die Live-Org-Query, wäre organisation nicht 'thw'.
    const einheit = result.current.alleVerortet.find((m) => m.schluessel === 'einheit-1');
    expect(einheit?.tz?.organisation).toBe('thw');
  });
});

/**
 * Der benannte Quellenkatalog (LFH-331). Geprüft werden die Zuordnung Query → Name und die
 * Trennlinie Lagebild/Render-Kontext.
 */
/** Eine Rückmeldung (LFH-610) — Form von `GET …/meldungen/rueckmeldungen`. */
const RUECKMELDUNGEN = {
  frist_min: 60,
  einheiten: [
    {
      bezug_id: 1,
      meldung_id: 3,
      lfd_nr: 3,
      ereigniszeit: '2026-09-21 12:11:00',
      inhalt: 'Verbau hält',
      meldeweg: 'funk',
      faellig_at: '2026-09-21 13:11:00',
    },
  ],
  abschnitte: [],
};

describe('useLagekarteDaten fehlerhafteQuellen', () => {
  it('nennt die gescheiterten Lagebild-Quellen — und KEINEN Render-Kontext', async () => {
    // Zwei Lagebild-Quellen scheitern (uhs, zonen) und alle drei Render-Kontext-Quellen
    // (Organisation, Karten-Config, Einstellungen). Nur die zwei stehen in der Meldung; wäre der
    // Render-Kontext im Katalog, käme die Liste auf fünf.
    server.use(
      http.get('/api/einsaetze/5', () =>
        HttpResponse.json({ id: 5, bezeichnung: 'T', status: 'aktiv' }),
      ),
      http.get('/api/einsaetze/5/uhs', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/einsaetze/5/zonen', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/organisation', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/karte/config', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/einsaetze/5/einstellungen', () => new HttpResponse(null, { status: 500 })),
      // 403 auf die Rückmeldungen ist für Rollen ohne „Meldungen" der Normalfall und gehört nicht
      // in den Katalog.
      http.get(
        '/api/einsaetze/5/meldungen/rueckmeldungen',
        () => new HttpResponse(null, { status: 403 }),
      ),
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
      http.get('/api/einsaetze/5/meldungen/rueckmeldungen', () =>
        HttpResponse.json(RUECKMELDUNGEN),
      ),
    );
    const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.fehlerhafteQuellen).toHaveLength(2));
    expect(result.current.fehlerhafteQuellen).toEqual(['Unfallhilfsstellen', 'Zonen']);
    // Und das Paneel bekommt keine Rückmeldungen — kein Block statt eines erfundenen.
    expect(result.current.rohdaten.rueckmeldungen).toBeUndefined();
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
      http.get('/api/einsaetze/5/meldungen/rueckmeldungen', () =>
        HttpResponse.json(RUECKMELDUNGEN),
      ),
    );
    const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ladt).toBe(false));
    expect(result.current.fehlerhafteQuellen).toEqual([]);
    // Live: die Rückmeldungen reichen bis ins Paneel „Ausgewählt" durch.
    await waitFor(() => expect(result.current.rohdaten.rueckmeldungen).toEqual(RUECKMELDUNGEN));
  });

  it('spiegelt im Historien-Modus die EINE aktive Quelle, nicht die elf abgeschalteten', async () => {
    // Dieselbe Weiche wie bei `ladt`: im Snapshot-Modus sind die Live-Queries abgeschaltet und
    // melden nie einen Fehler; die Aussage kann nur das Dokument treffen.
    ladeLageSnapshot.mockRejectedValue(new Error('weg'));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.fehlerhafteQuellen).toEqual(['Gesicherter Stand']));
  });
});

/**
 * `markerLaden`: die Startansicht entscheidet erst über das vollständige Markerbild. `ladt` hängt
 * nur an Einsatz und Config und wäre dafür zu früh.
 */
describe('useLagekarteDaten markerLaden', () => {
  it('bleibt wahr, solange eine Marker-Quelle lädt — auch wenn `ladt` schon fertig ist', async () => {
    let freigeben: () => void = () => {};
    const gesperrt = new Promise<void>((r) => {
      freigeben = r;
    });
    server.use(
      http.get('/api/einsaetze/5', () =>
        HttpResponse.json({ id: 5, bezeichnung: 'T', status: 'aktiv' }),
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
      http.get('/api/einsaetze/5/einheiten', async () => {
        await gesperrt;
        return HttpResponse.json([]);
      }),
      ...[
        '/api/einsaetze/5/uhs',
        '/api/einsaetze/5/schaeden',
        '/api/einsaetze/5/fahrzeuge',
        '/api/einsaetze/5/abschnitte',
        '/api/einsaetze/5/zonen',
        '/api/einsaetze/5/freie-zeichen',
        '/api/einsaetze/5/gefahrengebiete',
        '/api/einsaetze/5/lage/meldungen',
        '/api/einsaetze/5/karte/fuehrungskraefte',
      ].map((pfad) => http.get(pfad, () => HttpResponse.json([]))),
      http.get('/api/einsaetze/5/meldungen/rueckmeldungen', () =>
        HttpResponse.json(RUECKMELDUNGEN),
      ),
    );
    const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ladt).toBe(false));
    expect(result.current.markerLaden).toBe(true);
    freigeben();
    await waitFor(() => expect(result.current.markerLaden).toBe(false));
  });
});

/**
 * Ebene „Betroffene": die Zugriffsgrenze sitzt an der Personen-Query. Die Tests zählen deshalb die
 * Requests an `…/personen` mit — „nichts gezeichnet" allein belegte nicht, dass auch nichts geladen
 * wurde.
 */
describe('useLagekarteDaten Betroffene (LFH-648)', () => {
  const PERSON = {
    id: 11,
    einsatz_id: 5,
    registrier_nr: 42,
    status: 'betroffen',
    name: 'Kowalski',
    vorname: 'Anna',
    aktuelle_sichtung: 'sk2',
    antreff_lat: 50.05,
    antreff_lon: 8.55,
    storniert_at: null,
  };

  /** Alle Live-Quellen gesund; Overrides und Personen je Fall. Liefert den Personen-Zähler. */
  function handler(overrides: Record<string, unknown>, personen: () => Response) {
    const zaehler = { personen: 0, overrides: 0 };
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
      http.get('/api/einsaetze/5/meldungen/rueckmeldungen', () =>
        HttpResponse.json(RUECKMELDUNGEN),
      ),
      http.get('/api/einsaetze/5/modul-overrides', () => {
        zaehler.overrides += 1;
        return HttpResponse.json(overrides);
      }),
      http.get('/api/einsaetze/5/personen', () => {
        zaehler.personen += 1;
        return personen();
      }),
    );
    return zaehler;
  }

  function render() {
    return renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: wrapper(),
    });
  }

  it('frei: Personen kommen als eigene Liste — NICHT in `alleVerortet`', async () => {
    const z = handler({}, () => HttpResponse.json([PERSON]));
    const { result } = render();
    await waitFor(() => expect(result.current.personenVerortet).toHaveLength(1));
    expect(result.current.personenZugriff).toBe('frei');
    expect(result.current.personenVerortet[0]).toMatchObject({
      schluessel: 'person-11',
      typ: 'person',
      label: 'R-042 · SK II',
    });
    // Startausschnitt und Kopfzahl hängen an `alleVerortet` — Personen dürfen dort nie landen.
    expect(result.current.alleVerortet.some((m) => m.typ === 'person')).toBe(false);
    expect(z.personen).toBe(1);
    expect(result.current.fehlerhafteQuellen).toEqual([]);
  });

  it('Modul im Einsatz ausgeblendet: „ausgeblendet" und KEIN Request an …/personen', async () => {
    const z = handler({ personen: { sichtbar: false, benoetigte_rolle: null } }, () =>
      HttpResponse.json([PERSON]),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.ladt).toBe(false));
    await waitFor(() => expect(result.current.personenZugriff).toBe('ausgeblendet'));
    expect(result.current.personenVerortet).toEqual([]);
    expect(z.personen).toBe(0);
  });

  it('Rollensperre im Client: „gesperrt" und KEIN Request', async () => {
    // Die Auth ist ohne Benutzer gemockt, eine Führungskraft-Schranke sperrt also.
    const z = handler({ personen: { sichtbar: true, benoetigte_rolle: 'fuehrungskraft' } }, () =>
      HttpResponse.json([PERSON]),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.personenZugriff).toBe('gesperrt'));
    expect(result.current.personenVerortet).toEqual([]);
    expect(z.personen).toBe(0);
  });

  it('Server lehnt mit 403 ab (Org-Default-Drift): „gesperrt", keine Marker, KEIN Ausfall', async () => {
    const z = handler({}, () => new HttpResponse(null, { status: 403 }));
    const { result } = render();
    await waitFor(() => expect(result.current.personenZugriff).toBe('gesperrt'));
    expect(result.current.personenVerortet).toEqual([]);
    expect(result.current.fehlerhafteQuellen).toEqual([]);
    expect(z.personen).toBe(1);
  });

  it('echter Ausfall (500) bei freiem Modul: „Betroffene" steht im Ausfall, keine Altdaten', async () => {
    handler({}, () => new HttpResponse(null, { status: 500 }));
    const { result } = render();
    await waitFor(() => expect(result.current.fehlerhafteQuellen).toEqual(['Betroffene']));
    expect(result.current.personenZugriff).toBe('frei');
    expect(result.current.personenVerortet).toEqual([]);
  });

  it('Historien-Modus: „rueckblick", keine Personen, kein Request', async () => {
    const z = handler({}, () => HttpResponse.json([PERSON]));
    ladeLageSnapshot.mockResolvedValue(dokument('keine'));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.personenZugriff).toBe('rueckblick'));
    expect(result.current.personenVerortet).toEqual([]);
    expect(z.personen).toBe(0);
  });

  it('Historien-Modus mit ausgeblendetem Modul: keine Zeile, nicht „rueckblick"', async () => {
    // Die Overrides sind Render-Kontext und laden auch im Rückblick; ohne sie wäre „ausgeblendet"
    // hier der triviale Ladezustand.
    const z = handler({ personen: { sichtbar: false, benoetigte_rolle: null } }, () =>
      HttpResponse.json([PERSON]),
    );
    ladeLageSnapshot.mockResolvedValue(dokument('keine'));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(z.overrides).toBe(1));
    await waitFor(() => expect(result.current.ladt).toBe(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.personenZugriff).toBe('ausgeblendet');
  });
});

describe('useLagekarteDaten Betreuungsstellen (LFH-673)', () => {
  const STELLE = {
    id: 21,
    einsatz_id: 5,
    bezeichnung: 'NU Turnhalle Nord',
    art: 'notunterkunft',
    status: 'in_betrieb',
    lat: 50.02,
    lon: 8.51,
    angelegt_at: '2026-09-24 08:00:00',
  };
  const UNVERORTET = {
    ...STELLE,
    id: 22,
    bezeichnung: 'AS Rathaus',
    lat: undefined,
    lon: undefined,
  };

  /** Alle Live-Quellen gesund; Overrides und Betreuung je Fall. Liefert den Abrufzähler. */
  function handler(overrides: Record<string, unknown>, betreuung: () => Response) {
    const zaehler = { betreuung: 0 };
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
      http.get('/api/einsaetze/5/meldungen/rueckmeldungen', () =>
        HttpResponse.json(RUECKMELDUNGEN),
      ),
      http.get('/api/einsaetze/5/modul-overrides', () => HttpResponse.json(overrides)),
      http.get('/api/einsaetze/5/betreuung', () => {
        zaehler.betreuung += 1;
        return betreuung();
      }),
    );
    return zaehler;
  }

  function render() {
    return renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: wrapper(),
    });
  }

  it('frei: verortete Stelle in `alleVerortet`, unverortete in „Nicht verortet", Rohdaten fürs Raster', async () => {
    handler({}, () => HttpResponse.json({ bezirke: [], stellen: [STELLE, UNVERORTET] }));
    const { result } = render();
    await waitFor(() =>
      expect(result.current.alleVerortet.some((m) => m.typ === 'betreuungsstelle')).toBe(true),
    );
    expect(result.current.betreuungZugriff).toBe('frei');
    expect(result.current.alleVerortet.find((m) => m.typ === 'betreuungsstelle')).toMatchObject({
      schluessel: 'betreuungsstelle-21',
      label: 'NU Turnhalle Nord',
    });
    expect(result.current.nichtVerortetAlle).toContainEqual({
      typ: 'betreuungsstelle',
      id: 22,
      label: 'AS Rathaus',
    });
    expect(result.current.rohdaten.betreuungsstellen).toHaveLength(2);
    expect(result.current.fehlerhafteQuellen).toEqual([]);
  });

  it('Rollensperre im Client: „gesperrt" und KEIN Request an …/betreuung', async () => {
    // Auth ohne Benutzer — eine Führungskraft-Schranke sperrt also.
    const z = handler(
      {
        betreuung: {
          einsatz_id: 5,
          modul_key: 'betreuung',
          sichtbar: true,
          benoetigte_rolle: 'fuehrungskraft',
        },
      },
      () => HttpResponse.json({ bezirke: [], stellen: [STELLE] }),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.betreuungZugriff).toBe('gesperrt'));
    await waitFor(() => expect(result.current.ladt).toBe(false));
    expect(result.current.alleVerortet.some((m) => m.typ === 'betreuungsstelle')).toBe(false);
    expect(z.betreuung).toBe(0);
  });

  it('Server lehnt mit 403 ab: „gesperrt", keine Marker, KEIN Ausfall', async () => {
    handler({}, () => new HttpResponse(null, { status: 403 }));
    const { result } = render();
    await waitFor(() => expect(result.current.betreuungZugriff).toBe('gesperrt'));
    expect(result.current.alleVerortet.some((m) => m.typ === 'betreuungsstelle')).toBe(false);
    expect(result.current.fehlerhafteQuellen).toEqual([]);
  });

  it('echter Ausfall (500) bei freiem Modul: „Betreuungsstellen" steht im Ausfall', async () => {
    handler({}, () => new HttpResponse(null, { status: 500 }));
    const { result } = render();
    await waitFor(() => expect(result.current.fehlerhafteQuellen).toEqual(['Betreuungsstellen']));
    expect(result.current.betreuungZugriff).toBe('frei');
    expect(result.current.nichtVerortetAlle.some((m) => m.typ === 'betreuungsstelle')).toBe(false);
  });

  it('Historien-Modus: Stellen kommen aus dem Dokument, kein Live-Request', async () => {
    const z = handler({}, () => HttpResponse.json({ bezirke: [], stellen: [] }));
    const doc = dokument('keine');
    ladeLageSnapshot.mockResolvedValue({
      ...doc,
      daten: { ...doc.daten, betreuungsstellen: [STELLE] },
    });
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(result.current.alleVerortet.some((m) => m.schluessel === 'betreuungsstelle-21')).toBe(
        true,
      ),
    );
    expect(z.betreuung).toBe(0);
  });

  it('Historien-Modus mit altem Dokument ohne Feld: keine Stellen, kein Fehler', async () => {
    handler({}, () => HttpResponse.json({ bezirke: [], stellen: [] }));
    ladeLageSnapshot.mockResolvedValue(dokument('keine'));
    const { result } = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.ladt).toBe(false));
    await waitFor(() => expect(result.current.betreuungZugriff).toBe('frei'));
    expect(result.current.alleVerortet.some((m) => m.typ === 'betreuungsstelle')).toBe(false);
    expect(result.current.fehlerhafteQuellen).toEqual([]);
  });

  it('Bezirksfläche: beschriftet mit Bezirk und Räumung — live wie im Rückblick', async () => {
    const BEZIRK = {
      id: 31,
      einsatz_id: 5,
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 640,
      plan_erhebung: 'geschaetzt',
      raeumung: 'laeuft',
      flaechen: 1,
      angelegt_at: '',
    };
    const ZONE = {
      id: 41,
      einsatz_id: 5,
      typ: 'evakuierungsbezirk',
      geometrie_typ: 'Polygon',
      geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
      label: null,
      evakuierungsbezirk_id: 31,
    };
    handler({}, () => HttpResponse.json({ bezirke: [BEZIRK], stellen: [] }));
    server.use(http.get('/api/einsaetze/5/zonen', () => HttpResponse.json([ZONE])));
    const live = render();
    await waitFor(() =>
      expect(live.result.current.zonenFeatures[0]?.label).toBe('Uferstraße 12–40 · Räumung: läuft'),
    );
    expect(live.result.current.bezirke).toHaveLength(1);

    const doc = dokument('keine');
    ladeLageSnapshot.mockResolvedValue({
      ...doc,
      daten: {
        ...doc.daten,
        zonen: [ZONE],
        evakuierungsbezirke: [{ ...BEZIRK, raeumung: 'geraeumt' }],
      },
    });
    const rueck = renderHook(
      () =>
        useLagekarteDaten({ einsatzId: 5, zeigeZonen: true, quelle: { typ: 'snapshot', id: 9 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(rueck.result.current.zonenFeatures[0]?.label).toBe(
        'Uferstraße 12–40 · Räumung: geräumt',
      ),
    );
  });

  it('Rechteverlust bei gefülltem Cache: Stellen und Bezirke verschwinden trotz Altstand', async () => {
    const BEZIRK = {
      id: 31,
      einsatz_id: 5,
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 640,
      plan_erhebung: 'geschaetzt',
      raeumung: 'laeuft',
      flaechen: 0,
      angelegt_at: '',
    };
    handler({}, () => HttpResponse.json({ bezirke: [BEZIRK], stellen: [STELLE] }));
    const client = neuerQueryClient();
    const { result } = renderHook(() => useLagekarteDaten({ einsatzId: 5, zeigeZonen: true }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() =>
      expect(result.current.alleVerortet.some((m) => m.typ === 'betreuungsstelle')).toBe(true),
    );
    expect(result.current.bezirke).toHaveLength(1);
    // Die Leitung sperrt das Modul; die Overrides laden neu, der Betreuungs-Cache bleibt stehen.
    server.use(
      http.get('/api/einsaetze/5/modul-overrides', () =>
        HttpResponse.json({
          betreuung: {
            einsatz_id: 5,
            modul_key: 'betreuung',
            sichtbar: true,
            benoetigte_rolle: 'fuehrungskraft',
          },
        }),
      ),
    );
    await client.invalidateQueries({ queryKey: ['einsatz-modul-overrides', 5] });
    await waitFor(() => expect(result.current.betreuungZugriff).toBe('gesperrt'));
    expect(client.getQueryData(['einsatz-betreuung', 5])).toBeTruthy(); // Vorbedingung: Altstand
    expect(result.current.alleVerortet.some((m) => m.typ === 'betreuungsstelle')).toBe(false);
    expect(result.current.nichtVerortetAlle.some((m) => m.typ === 'betreuungsstelle')).toBe(false);
    expect(result.current.bezirke).toEqual([]);
    expect(result.current.rohdaten.betreuungsstellen).toEqual([]);
  });

  it('Bezirksfläche ohne Modulrecht: nur das Typwort, keine Bezirksangaben', async () => {
    handler({}, () => new HttpResponse(null, { status: 403 }));
    server.use(
      http.get('/api/einsaetze/5/zonen', () =>
        HttpResponse.json([
          {
            id: 41,
            einsatz_id: 5,
            typ: 'evakuierungsbezirk',
            geometrie_typ: 'Polygon',
            geometrie:
              '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
            label: null,
            evakuierungsbezirk_id: 31,
          },
        ]),
      ),
    );
    const { result } = render();
    await waitFor(() => expect(result.current.betreuungZugriff).toBe('gesperrt'));
    await waitFor(() => expect(result.current.zonenFeatures[0]?.label).toBe('Evakuierungsbezirk'));
    expect(result.current.bezirke).toEqual([]);
  });
});
