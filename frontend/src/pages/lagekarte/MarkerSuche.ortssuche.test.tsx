import { http, HttpResponse, type JsonBodyType } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { formatiere } from '../../anzeige/koordinaten';
import MarkerSuche from './MarkerSuche';
import type { KarteMarker, MarkerTyp } from './marker';

/**
 * Ortssuche im Suchfeld der Kartenleiste (LFH-638, Spec `lagekarte-ortssuche`): Koordinate beim
 * Tippen ohne Server, Adresse erst auf Enter über `…/karte/ort-suche`.
 */

const PFAD = '/api/einsaetze/7/karte/ort-suche';
const BERLIN = { lat: 52.52194, lon: 13.41321 };

function marker(typ: MarkerTyp, id: number, label: string): KarteMarker {
  return { schluessel: `${typ}-${id}`, typ, id, lat: 50.1, lon: 8.6, label, farbe: '#333333' };
}

/** Fängt jede Adresssuche ab, antwortet mit `antwort` und zählt die Suchtexte mit. */
function geocoder(antwort: JsonBodyType | (() => Response)) {
  const anfragen: string[] = [];
  server.use(
    http.get(PFAD, ({ request }) => {
      anfragen.push(new URL(request.url).searchParams.get('q') ?? '');
      return typeof antwort === 'function'
        ? (antwort as () => Response)()
        : HttpResponse.json(antwort);
    }),
  );
  return anfragen;
}

function zeige(props: Partial<React.ComponentProps<typeof MarkerSuche>> = {}) {
  const onOrtWaehlen = vi.fn();
  const alle: React.ComponentProps<typeof MarkerSuche> = {
    marker: [marker('uhs', 1, 'BHP Nord')],
    onMarkerWaehlen: vi.fn(),
    ortssuche: { einsatzId: 7, onOrtWaehlen },
    ...props,
  };
  const r = renderMitProviders(<MarkerSuche {...alle} />);
  return { ...alle, onOrtWaehlen, rerender: r.rerender };
}

const suchfeld = () => screen.getByLabelText('Kartenobjekte suchen');
const kopf = (name: string) => screen.queryByRole('heading', { name });

describe('MarkerSuche — Koordinate (LFH-638)', () => {
  it('bietet eine getippte Dezimalgrad-Koordinate als Gruppe „Koordinate“ über den Objekten an', async () => {
    const anfragen = geocoder({ zustand: 'ok', treffer: [] });
    const { onOrtWaehlen } = zeige({ marker: [marker('uhs', 1, '52 Grad Nord')] });
    await userEvent.type(suchfeld(), '52.52194, 13.41321');
    const koepfe = screen.getAllByRole('heading').map((k) => k.textContent);
    expect(koepfe[0]).toBe('Koordinate');
    const beschriftung = formatiere(BERLIN.lat, BERLIN.lon, 'wgs84');
    await userEvent.click(screen.getByRole('button', { name: beschriftung }));
    expect(onOrtWaehlen).toHaveBeenCalledWith({
      lat: BERLIN.lat,
      lon: BERLIN.lon,
      beschriftung,
      art: 'koordinate',
    });
    // Eine Koordinate verlässt den Browser nicht — auch nicht nach Enter.
    await userEvent.keyboard('{Enter}');
    expect(anfragen).toEqual([]);
  });

  it('beschriftet eine MGRS-Eingabe im eingestellten Format (ohne Einstellung WGS84)', async () => {
    zeige();
    const mgrs = formatiere(BERLIN.lat, BERLIN.lon, 'mgrs');
    await userEvent.type(suchfeld(), mgrs);
    expect(kopf('Koordinate')).not.toBeNull();
    const knopf = screen.getByRole('button', { name: /^52\.\d+, 13\.\d+/ });
    expect(knopf).toBeInTheDocument();
  });

  it('„12 34“ ist keine Koordinate', async () => {
    zeige();
    await userEvent.type(suchfeld(), '12 34');
    expect(kopf('Koordinate')).toBeNull();
  });

  it('ohne Ortssuche (kein Einsatz-Kontext) bleibt das Feld reine Objektsuche', async () => {
    zeige({ ortssuche: undefined });
    await userEvent.type(suchfeld(), '52.52194, 13.41321');
    expect(kopf('Koordinate')).toBeNull();
  });

  it('der Treffer ist ein Bedienziel mit Trefflächenboden', async () => {
    zeige();
    await userEvent.type(suchfeld(), '52.52194, 13.41321');
    const knopf = screen.getByRole('button', {
      name: formatiere(BERLIN.lat, BERLIN.lon, 'wgs84'),
    });
    expect(knopf.style.minHeight).not.toBe('');
  });

  it('ohne passendes Objekt steht nur der knappe Hinweis, kein Leerzustand der Fläche', async () => {
    zeige();
    await userEvent.type(suchfeld(), '52.52194, 13.41321');
    expect(screen.getByText('Kein Kartenobjekt zu „52.52194, 13.41321“')).toBeInTheDocument();
    expect(screen.queryByText('Suchbegriff kürzen oder Schreibweise prüfen.')).toBeNull();
  });
});

describe('MarkerSuche — Adresse auf Enter (LFH-638)', () => {
  const ZWEI = {
    zustand: 'ok',
    treffer: [
      { lat: 51.1604, lon: 10.4514, name: 'Hauptstraße 12, Musterstadt' },
      { lat: 48.1, lon: 11.5, name: 'Hauptstraße 12, Anderswo' },
    ],
  };

  it('tippen fragt nicht', async () => {
    const anfragen = geocoder(ZWEI);
    zeige();
    await userEvent.type(suchfeld(), 'Hauptstraße 12');
    expect(anfragen).toEqual([]);
    expect(kopf('Adresse')).toBeNull();
  });

  it('unter drei Zeichen fragt auch Enter nicht', async () => {
    const anfragen = geocoder(ZWEI);
    zeige();
    await userEvent.type(suchfeld(), 'Ha{Enter}');
    expect(anfragen).toEqual([]);
    expect(kopf('Adresse')).toBeNull();
  });

  it('Enter sucht; die Treffer stehen in der Gruppe „Adresse“ vor den Objekten und fliegen an', async () => {
    const anfragen = geocoder(ZWEI);
    const { onOrtWaehlen } = zeige({ marker: [marker('uhs', 1, 'Hauptstraße Wache')] });
    await userEvent.type(suchfeld(), '  Hauptstraße 12 {Enter}');
    const knopf = await screen.findByRole('button', { name: 'Hauptstraße 12, Anderswo' });
    expect(anfragen).toEqual(['Hauptstraße 12']);
    expect(screen.getAllByRole('heading').map((k) => k.textContent)[0]).toBe('Adresse');
    // Zwei Treffer: kein Direktflug.
    expect(onOrtWaehlen).not.toHaveBeenCalled();
    await userEvent.click(knopf);
    expect(onOrtWaehlen).toHaveBeenCalledWith({
      lat: 48.1,
      lon: 11.5,
      beschriftung: 'Hauptstraße 12, Anderswo',
      art: 'adresse',
    });
  });

  it('genau ein Treffer fliegt ohne weiteren Klick hin — einmal je Enter', async () => {
    geocoder({ zustand: 'ok', treffer: [{ lat: 51.1604, lon: 10.4514, name: 'Rathaus' }] });
    const { onOrtWaehlen } = zeige();
    await userEvent.type(suchfeld(), 'Rathaus{Enter}');
    await waitFor(() => expect(onOrtWaehlen).toHaveBeenCalledTimes(1));
    expect(onOrtWaehlen).toHaveBeenCalledWith({
      lat: 51.1604,
      lon: 10.4514,
      beschriftung: 'Rathaus',
      art: 'adresse',
    });
    // Ein zweites Enter auf denselben Begriff fliegt erneut (aus dem Cache).
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onOrtWaehlen).toHaveBeenCalledTimes(2));
  });

  it('ein neu gerenderter Aufrufer (neuer Callback) löst keinen zweiten Direktflug aus', async () => {
    geocoder({ zustand: 'ok', treffer: [{ lat: 51.1604, lon: 10.4514, name: 'Rathaus' }] });
    const { onOrtWaehlen, rerender, marker: m, onMarkerWaehlen } = zeige();
    await userEvent.type(suchfeld(), 'Rathaus{Enter}');
    await waitFor(() => expect(onOrtWaehlen).toHaveBeenCalledTimes(1));
    const neu = vi.fn();
    rerender(
      <MarkerSuche
        marker={m}
        onMarkerWaehlen={onMarkerWaehlen}
        ortssuche={{ einsatzId: 7, onOrtWaehlen: neu }}
      />,
    );
    await screen.findByRole('heading', { name: 'Adresse' });
    expect(neu).not.toHaveBeenCalled();
    expect(onOrtWaehlen).toHaveBeenCalledTimes(1);
  });

  it('Weitertippen verwirft die Treffer, bis erneut Enter kommt', async () => {
    geocoder(ZWEI);
    zeige();
    await userEvent.type(suchfeld(), 'Hauptstraße 12{Enter}');
    await screen.findByRole('heading', { name: 'Adresse' });
    await userEvent.type(suchfeld(), 'a');
    expect(kopf('Adresse')).toBeNull();
  });

  it('nichts gefunden', async () => {
    geocoder({ zustand: 'ok', treffer: [] });
    zeige();
    await userEvent.type(suchfeld(), 'xyzzy{Enter}');
    expect(await screen.findByText('Keine Adresse zu „xyzzy“ gefunden')).toBeInTheDocument();
  });

  it('ausgelastet', async () => {
    geocoder({ zustand: 'ausgelastet', treffer: [] });
    zeige();
    await userEvent.type(suchfeld(), 'Hauptstraße{Enter}');
    expect(await screen.findByText(/^Adresssuche gerade ausgelastet/)).toBeInTheDocument();
    expect(screen.getByText(/erneut Enter/)).toBeInTheDocument();
  });

  it('nach „ausgelastet“ fragt ein zweites Enter neu — und ein einzelner Treffer fliegt dann hin', async () => {
    let runde = 0;
    const anfragen: string[] = [];
    server.use(
      http.get(PFAD, ({ request }) => {
        anfragen.push(new URL(request.url).searchParams.get('q') ?? '');
        runde += 1;
        return HttpResponse.json(
          runde === 1
            ? { zustand: 'ausgelastet', treffer: [] }
            : { zustand: 'ok', treffer: [{ lat: 51, lon: 10, name: 'Rathaus' }] },
        );
      }),
    );
    const { onOrtWaehlen } = zeige();
    await userEvent.type(suchfeld(), 'Rathaus{Enter}');
    expect(await screen.findByText(/^Adresssuche gerade ausgelastet/)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onOrtWaehlen).toHaveBeenCalledTimes(1));
    expect(anfragen).toEqual(['Rathaus', 'Rathaus']);
  });

  it('nach einem Serverfehler fragt ein zweites Enter neu', async () => {
    let runde = 0;
    server.use(
      http.get(PFAD, () => {
        runde += 1;
        return runde === 1
          ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
          : HttpResponse.json({ zustand: 'ok', treffer: [] });
      }),
    );
    zeige();
    await userEvent.type(suchfeld(), 'Rathaus{Enter}');
    expect(await screen.findByText(/^Adresssuche nicht erreichbar/)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Keine Adresse zu „Rathaus“ gefunden')).toBeInTheDocument();
  });

  it('nicht erreichbar — Objekte bleiben darunter stehen', async () => {
    geocoder({ zustand: 'nicht_erreichbar', treffer: [] });
    zeige({ marker: [marker('uhs', 1, 'Hauptwache')] });
    await userEvent.type(suchfeld(), 'Hauptwache{Enter}');
    expect(await screen.findByText(/^Adresssuche nicht erreichbar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hauptwache' })).toBeInTheDocument();
  });

  it('ein Serverfehler zählt als nicht erreichbar', async () => {
    geocoder(() => HttpResponse.json({ error: 'kaputt' }, { status: 500 }));
    zeige();
    await userEvent.type(suchfeld(), 'Hauptstraße{Enter}');
    expect(await screen.findByText(/^Adresssuche nicht erreichbar/)).toBeInTheDocument();
  });
});

describe('MarkerSuche — Vorbelegung von außen (`?ort=`, LFH-638)', () => {
  it('meldet die übernommene Vorbelegung als verbraucht — einmal je Nonce', async () => {
    geocoder({ zustand: 'ok', treffer: [] });
    const onVorbelegungVerbraucht = vi.fn();
    zeige({
      ortssuche: {
        einsatzId: 7,
        onOrtWaehlen: vi.fn(),
        vorbelegung: { text: 'Hauptstraße 12', nonce: 3 },
        onVorbelegungVerbraucht,
      },
    });
    await waitFor(() => expect(onVorbelegungVerbraucht).toHaveBeenCalledWith(3));
    expect(onVorbelegungVerbraucht).toHaveBeenCalledTimes(1);
  });

  it('übernimmt den Text und löst die Adresssuche aus', async () => {
    const anfragen = geocoder({
      zustand: 'ok',
      treffer: [
        { lat: 51, lon: 10, name: 'Hauptstraße 12, A' },
        { lat: 52, lon: 11, name: 'Hauptstraße 12, B' },
      ],
    });
    zeige({
      ortssuche: {
        einsatzId: 7,
        onOrtWaehlen: vi.fn(),
        vorbelegung: { text: 'Hauptstraße 12', nonce: 1 },
      },
    });
    expect(suchfeld()).toHaveValue('Hauptstraße 12');
    expect(await screen.findByRole('button', { name: 'Hauptstraße 12, B' })).toBeInTheDocument();
    expect(anfragen).toEqual(['Hauptstraße 12']);
  });
});
