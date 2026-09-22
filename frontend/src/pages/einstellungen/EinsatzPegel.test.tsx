import { delay, http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import EinsatzPegel, { stationenAus, stationsLabel, verschiebe } from './EinsatzPegel';

/**
 * Sektion „Pegel" (LFH-606). Sofort-Speichern wie die Modul-Liste: jede Handlung ist ein
 * Request, es gibt keine Speicher-Leiste — Begründung im Dateikopf der Sektion.
 */

const UUID_HMUE = '47174d8f-1b8e-4599-8a59-b580dd55bc87';
const UUID_WAHN = '5f9c1b54-3c41-4d93-bb48-2b7c7c3f5a61';
const UUID_KASS = 'a1b2c3d4-0000-4000-8000-000000000003';

const einsatz = (meine_rolle = 'einsatzleitung') => ({
  id: 1,
  bezeichnung: 'Hochwasser Weser',
  status: 'aktiv',
  meine_rolle,
});

const pegel = (uuid: string, name: string, gewaesser: string, reihenfolge: number) => ({
  id: reihenfolge + 1,
  station_uuid: uuid,
  name,
  gewaesser,
  reihenfolge,
  messung: {
    wasserstand_cm: 684,
    zeitpunkt: '2026-09-22T14:05:00+02:00',
    trend_cm_pro_h: -3.2,
  },
});

const HMUE = pegel(UUID_HMUE, 'HANN. MÜNDEN', 'WESER', 0);
const WAHN = { ...pegel(UUID_WAHN, 'WAHNHAUSEN', 'FULDA', 1), messung: undefined };

const feature = (uuid: string | null, titel: string, gewaesser: string, km: number) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [9.6, 51.4] },
  properties: { titel, kategorie: 'pegel', uuid, gewaesser, km },
});

const FEATURES = [
  feature(UUID_HMUE, 'HANN. MÜNDEN', 'WESER', 0.5),
  feature(UUID_WAHN, 'WAHNHAUSEN', 'FULDA', 97.4),
  feature(UUID_KASS, 'KASSEL', 'FULDA', 81.73),
  feature(null, 'OHNE UUID', 'IRGENDWO', 1),
];

/** Wire-Form von `GET /api/karte/fachebenen/pegelonline` (`FachebeneAntwort`). */
const antwort = (status: 'ok' | 'offline' | 'leer', features: unknown[]) => ({
  quelle: 'pegelonline',
  status,
  attribution: 'WSV',
  features: { type: 'FeatureCollection', features },
});

interface Aufbau {
  rolle?: string;
  liste?: unknown[];
  stationenStatus?: number;
  /** Das Backend antwortet 200, meldet die Quelle aber `offline` ohne Cache-Bestand. */
  stationenOffline?: boolean;
  /** Das Backend antwortet 200 mit `leer` — erreichbar, aber ohne Station. */
  stationenLeer?: boolean;
  pegelStatus?: number;
  putStatus?: number;
  /** Schreibende Antworten verzögern (ms) — für die Rückmeldung VOR der Serverantwort. */
  verzoegerung?: number;
}

/** Stellt die Endpunkte bereit und zeichnet die schreibenden Aufrufe auf. */
function stelleBereit(a: Aufbau = {}) {
  const aufrufe: { methode: string; body: unknown }[] = [];
  let liste = a.liste ?? [HMUE, WAHN];
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz(a.rolle))),
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, org_defaults: { org_id: 1 } }),
    ),
    http.get('/api/einsaetze/1/pegel', () =>
      a.pegelStatus ? new HttpResponse(null, { status: a.pegelStatus }) : HttpResponse.json(liste),
    ),
    http.get('/api/karte/fachebenen/pegelonline', () =>
      a.stationenStatus
        ? new HttpResponse(null, { status: a.stationenStatus })
        : HttpResponse.json(
            a.stationenOffline
              ? antwort('offline', [])
              : a.stationenLeer
                ? antwort('leer', [])
                : antwort('ok', FEATURES),
          ),
    ),
    http.put('/api/einsaetze/1/pegel', async ({ request }) => {
      const body = (await request.json()) as {
        stationen: { station_uuid: string; name: string; gewaesser?: string | null }[];
      };
      aufrufe.push({ methode: 'PUT', body });
      if (a.verzoegerung) await delay(a.verzoegerung);
      if (a.putStatus) {
        return HttpResponse.json({ error: 'station doppelt' }, { status: a.putStatus });
      }
      liste = body.stationen.map((s, i) => ({
        id: i + 1,
        station_uuid: s.station_uuid,
        name: s.name,
        gewaesser: s.gewaesser,
        reihenfolge: i,
      }));
      return HttpResponse.json(liste);
    }),
    http.post('/api/einsaetze/1/pegel', async ({ request }) => {
      const body = (await request.json()) as {
        station_uuid: string;
        name: string;
        gewaesser?: string | null;
      };
      aufrufe.push({ methode: 'POST', body });
      if (a.verzoegerung) await delay(a.verzoegerung);
      liste = [...liste, { id: 9, reihenfolge: liste.length, ...body }];
      return HttpResponse.json(liste, { status: 201 });
    }),
  );
  return aufrufe;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/pegel" element={<EinsatzPegel />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/pegel' },
  );
}

/** Die Zeilen der Liste (Titel samt Ordnungsnummer). */
const zeilentitel = () =>
  Array.from(document.querySelectorAll('.listen-eintrag [data-lfh="pegel-titel"]')).map(
    (h) => h.textContent,
  );

/** Öffnet das Zeilenmenü und klickt einen Eintrag — immer über das OFFENE Menü. */
async function zeilenaktion(name: string, eintrag: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Pegel ${name}` }));
  const menue = await waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(m).not.toBeNull();
    return m!;
  });
  await userEvent.click(within(menue).getByRole('menuitem', { name: eintrag }));
}

async function waehleStation(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Station wählen' }));
  const knoten = await waitFor(() => {
    const k = document.querySelector<HTMLElement>(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${label}"]`,
    );
    expect(k).not.toBeNull();
    return k!;
  });
  await userEvent.click(knoten);
}

describe('EinsatzPegel — reine Helfer', () => {
  it('liest nur Stationen mit uuid, nimmt `titel` als Namen, sortiert nach Namen', () => {
    expect(stationenAus(FEATURES)).toEqual([
      { uuid: UUID_HMUE, name: 'HANN. MÜNDEN', gewaesser: 'WESER', km: 0.5 },
      { uuid: UUID_KASS, name: 'KASSEL', gewaesser: 'FULDA', km: 81.73 },
      { uuid: UUID_WAHN, name: 'WAHNHAUSEN', gewaesser: 'FULDA', km: 97.4 },
    ]);
  });

  it('Label „Name · Gewässer · km" mit deutschem Komma, fehlende Teile fallen weg', () => {
    expect(stationsLabel({ name: 'KASSEL', gewaesser: 'FULDA', km: 81.73 })).toBe(
      'KASSEL · FULDA · km 81,73',
    );
    expect(stationsLabel({ name: 'X', gewaesser: null, km: null })).toBe('X');
  });

  it('verschiebt um eine Stelle und bleibt an den Enden stehen', () => {
    expect(verschiebe(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(verschiebe(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(verschiebe(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});

describe('EinsatzPegel', () => {
  it('zeigt die Liste in Reihenfolge, den Leitpegel markiert, Messung oder „Stand unbekannt"', async () => {
    stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toEqual(['1. HANN. MÜNDEN', '2. WAHNHAUSEN']));
    const leit = document.querySelectorAll('[data-lfh="leitpegel"]');
    expect(leit).toHaveLength(1);
    expect(leit[0].closest('.listen-eintrag')).toHaveTextContent('HANN. MÜNDEN');
    expect(screen.getByText(/WESER · 6,84 m · fallend −3 cm\/h · Stand/)).toBeInTheDocument();
    expect(screen.getByText('FULDA · Stand unbekannt')).toBeInTheDocument();
  });

  it('Hinzufügen: POST mit Name und Gewässer der Station, danach steht sie hinten', async () => {
    const aufrufe = stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    // Schon festgelegte Stationen sind in der Auswahl gesperrt.
    await userEvent.click(screen.getByRole('combobox', { name: 'Station wählen' }));
    const gesperrt = await waitFor(() => {
      const k = document.querySelector(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="HANN. MÜNDEN · WESER · km 0,5"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    expect(gesperrt.className).toContain('ant-select-item-option-disabled');

    await waehleStation('KASSEL · FULDA · km 81,73');
    await userEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(() =>
      expect(zeilentitel()).toEqual(['1. HANN. MÜNDEN', '2. WAHNHAUSEN', '3. KASSEL']),
    );
    expect(aufrufe).toEqual([
      {
        methode: 'POST',
        body: { station_uuid: UUID_KASS, name: 'KASSEL', gewaesser: 'FULDA' },
      },
    ]);
    expect(await screen.findByText('Pegel gespeichert')).toBeInTheDocument();
  });

  it('„Nach unten" schickt die ganze Liste umgeordnet als PUT; der neue Erste ist Leitpegel', async () => {
    const aufrufe = stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    await zeilenaktion('HANN. MÜNDEN', /Nach unten/);
    await waitFor(() => expect(zeilentitel()).toEqual(['1. WAHNHAUSEN', '2. HANN. MÜNDEN']));
    expect(aufrufe).toEqual([
      {
        methode: 'PUT',
        body: {
          stationen: [
            { station_uuid: UUID_WAHN, name: 'WAHNHAUSEN', gewaesser: 'FULDA' },
            { station_uuid: UUID_HMUE, name: 'HANN. MÜNDEN', gewaesser: 'WESER' },
          ],
        },
      },
    ]);
    expect(
      document.querySelector('[data-lfh="leitpegel"]')?.closest('.listen-eintrag'),
    ).toHaveTextContent('WAHNHAUSEN');
  });

  it('an den Enden ist die Richtung gesperrt, nicht weggelassen — das Menü bleibt ein Menü', async () => {
    stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Pegel HANN. MÜNDEN' }));
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });
    expect(within(menue).getByRole('menuitem', { name: /Nach oben/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menue).getByRole('menuitem', { name: /Nach unten/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('„Entfernen" schickt die Liste ohne den Eintrag — ohne Rückfrage (umkehrbar)', async () => {
    const aufrufe = stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    await zeilenaktion('WAHNHAUSEN', /Entfernen/);
    await waitFor(() => expect(zeilentitel()).toEqual(['1. HANN. MÜNDEN']));
    expect(aufrufe).toEqual([
      {
        methode: 'PUT',
        body: {
          stationen: [{ station_uuid: UUID_HMUE, name: 'HANN. MÜNDEN', gewaesser: 'WESER' }],
        },
      },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Rückmeldung vor der Serverantwort: während des PUT sind die Zeilenmenüs gesperrt', async () => {
    // Prüfliste Kriterium 3: kein optimistisches Update, aber sofort sichtbarer Zustand.
    stelleBereit({ verzoegerung: 400 });
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    await zeilenaktion('HANN. MÜNDEN', /Nach unten/);
    for (const k of screen.getAllByRole('button', { name: /^Aktionen zu Pegel/ })) {
      expect(k).toBeDisabled();
    }
    await waitFor(() => expect(zeilentitel()).toEqual(['1. WAHNHAUSEN', '2. HANN. MÜNDEN']));
    for (const k of screen.getAllByRole('button', { name: /^Aktionen zu Pegel/ })) {
      expect(k).toBeEnabled();
    }
  });

  it('Rückmeldung vor der Serverantwort: „Hinzufügen" zeigt Laden, bis der POST antwortet', async () => {
    stelleBereit({ verzoegerung: 400 });
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    await waehleStation('KASSEL · FULDA · km 81,73');
    const knopf = screen.getByRole('button', { name: 'Hinzufügen' });
    await userEvent.click(knopf);
    expect(knopf.className).toContain('ant-btn-loading');
    await waitFor(() => expect(zeilentitel()).toHaveLength(3));
    expect(knopf.className).not.toContain('ant-btn-loading');
  });

  it('ganz ohne Maus: Auswahl per Tippen + Enter, dann Tab und Enter auf „Hinzufügen"', async () => {
    // Prüfliste Kriterium 15 (volle Tastaturbedienung). Das Label steht sichtbar über dem Feld
    // und benennt es — `getByLabelText` findet das Feld nur über das `<label for>`.
    const aufrufe = stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    const feld = screen.getByLabelText('Station wählen');
    expect(screen.getByText('Station wählen', { selector: 'label' })).toBeVisible();
    await userEvent.click(feld);
    await userEvent.keyboard('KASS');
    await waitFor(() =>
      expect(
        document.querySelector(
          '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active',
        ),
      ).not.toBeNull(),
    );
    // rc-select wertet am Enter das legacy `keyCode` aus — `userEvent` v14 setzt es nicht
    // (dieselbe Falle wie antds `Editable`, CLAUDE.md), deshalb `fireEvent` mit keyCode.
    fireEvent.keyDown(feld, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeEnabled());
    // Der Weg zum Knopf: Tab (über den Leeren-Knopf des Feldes, den antd fokussierbar macht).
    for (let i = 0; i < 3 && document.activeElement?.textContent !== 'Hinzufügen'; i += 1) {
      await userEvent.tab();
    }
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(zeilentitel()).toHaveLength(3));
    expect(aufrufe).toEqual([
      { methode: 'POST', body: { station_uuid: UUID_KASS, name: 'KASSEL', gewaesser: 'FULDA' } },
    ]);
  });

  it('bei fünf Pegeln ist Hinzufügen gesperrt, mit Grund', async () => {
    const fuenf = [0, 1, 2, 3, 4].map((i) =>
      pegel(`00000000-0000-4000-8000-00000000000${i}`, `P${i}`, 'WESER', i),
    );
    stelleBereit({ liste: fuenf });
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(5));
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Station wählen' })).toBeDisabled();
    expect(
      screen.getByText('Höchstens 5 maßgebliche Pegel — zum Hinzufügen zuerst einen entfernen.'),
    ).toBeInTheDocument();
  });

  it('unter fünf steht kein Grenzhinweis — die Gegenaussage', async () => {
    stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    expect(document.querySelector('[data-lfh="pegel-grenze"]')).toBeNull();
  });

  it('ohne Schreibrecht: Grund oben, Auswahl und Hinzufügen gesperrt, keine Zeilenmenüs', async () => {
    stelleBereit({ rolle: 'beobachter' });
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    expect(await screen.findByText(/Nur die Einsatzleitung, Führungspersonal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Station wählen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Aktionen zu Pegel/ })).toBeNull();
  });

  it('mit Schreibrecht steht kein Rechtehinweis und jede Zeile hat ihr Menü', async () => {
    stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    expect(screen.queryByText(/Nur die Einsatzleitung, Führungspersonal/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Aktionen zu Pegel/ })).toHaveLength(2);
  });

  it('Fachebene nicht erreichbar: Hinweis, Auswahl gesperrt, die Liste bleibt bedienbar', async () => {
    const aufrufe = stelleBereit({ stationenStatus: 503 });
    rendern();
    expect(
      await screen.findByText('Die Stationsliste von PEGELONLINE ist gerade nicht erreichbar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Station wählen' })).toBeDisabled();
    await zeilenaktion('WAHNHAUSEN', /Nach oben/);
    await waitFor(() => expect(zeilentitel()).toEqual(['1. WAHNHAUSEN', '2. HANN. MÜNDEN']));
    expect(aufrufe).toHaveLength(1);
  });

  it('Quelle offline ohne Bestand: derselbe Hinweis, obwohl der Abruf selbst gelang', async () => {
    stelleBereit({ stationenOffline: true });
    rendern();
    expect(
      await screen.findByText('Die Stationsliste von PEGELONLINE ist gerade nicht erreichbar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Station wählen' })).toBeDisabled();
  });

  it('Quelle leer: die Auswahl ist gesperrt und sagt warum, statt leer aufzuklappen', async () => {
    stelleBereit({ stationenLeer: true });
    rendern();
    expect(
      await screen.findByText('PEGELONLINE liefert gerade keine wählbare Station.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Station wählen' })).toBeDisabled();
  });

  it('Quelle erreichbar: kein Hinweis — die Gegenaussage', async () => {
    stelleBereit();
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Station wählen' })).toBeEnabled(),
    );
    expect(screen.queryByText(/PEGELONLINE ist gerade nicht erreichbar/)).toBeNull();
    expect(screen.queryByText(/keine wählbare Station/)).toBeNull();
  });

  it('ein abgelehnter PUT steht als Fehler an der Seite, die Liste bleibt beim Serverstand', async () => {
    stelleBereit({ putStatus: 422 });
    rendern();
    await waitFor(() => expect(zeilentitel()).toHaveLength(2));
    await zeilenaktion('HANN. MÜNDEN', /Nach unten/);
    expect(await screen.findByText('Nicht gespeichert')).toBeInTheDocument();
    expect(screen.getByText('station doppelt')).toBeInTheDocument();
    expect(zeilentitel()).toEqual(['1. HANN. MÜNDEN', '2. WAHNHAUSEN']);
    expect(screen.queryByText('Pegel gespeichert')).toBeNull();
  });

  it('ein gescheiterter Pegel-Abruf fällt NICHT in die leere Liste', async () => {
    stelleBereit({ pegelStatus: 500 });
    rendern();
    expect(await screen.findByText(/Pegel nicht ladbar/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Station wählen' })).toBeNull();
    expect(screen.queryByText(/Noch kein Pegel festgelegt/)).toBeNull();
  });
});
