import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { kopfFilterWaehlen } from '../test/kopfFilter';
import { ort, Ortsfuehler } from '../test/ortsfuehler';
import { setzeViewportBreite } from '../test/viewport';
import { EINHEIT_TYPEN, VORLAGEN as EINHEIT_VORLAGEN } from '../test/einheitVorlagen';
import { verpflegungsplan } from '../test/verpflegungVorlageDaten';
import StichworteTab from './StichworteTab';
import EinsatzVorlagenTab from './EinsatzVorlagenTab';
import EtbBausteineTab from './EtbBausteineTab';
import SchichtmodelleTab from './SchichtmodelleTab';
import VerpflegungsplanTab from './VerpflegungsplanTab';
import StatusKatalogTab from './StatusKatalogTab';
import EinheitTypenTab from './EinheitTypenTab';
import EinheitVorlagenTab from './EinheitVorlagenTab';

/**
 * Sortieren und Filtern im Spaltenkopf der Stammdaten (LLH-1096, Rollout des Musters aus
 * LLH-1086). Fahrzeuge, Material, Personal, Sprechgruppen und Externe Stellen prüfen es in ihren
 * eigenen Testdateien; hier die übrigen Sektionen mit Tabelle, je ein Weg durch Kopf und Adresse.
 * Ohne Verwaltungsrecht gerendert: die Zeilen tragen dann keine Bedienelemente.
 */

const leser = adminFixture({ system_rolle: 'keiner' });

function zeige(ui: ReactElement, route: string) {
  return renderMitProviders(
    <>
      <Ortsfuehler />
      {ui}
    </>,
    { route },
  );
}

const folge = () =>
  [...document.querySelectorAll('tbody tr[data-row-key]')].map((z) =>
    z.getAttribute('data-row-key'),
  );

describe('Stammdaten · Sortieren und Filtern (LLH-1096)', () => {
  it('Einsatz-Stichworte filtern nach der Vorlage, auch „ohne Vorlage“', async () => {
    setzeViewportBreite(1600);
    server.use(
      meHandler(leser),
      http.get('/api/stichwort-vorschlaege', () =>
        HttpResponse.json([
          { id: 1, text: 'H1', vorlage_id: 5 },
          { id: 2, text: 'B2', vorlage_id: null },
        ]),
      ),
      http.get('/api/einsatz-vorlagen', () =>
        HttpResponse.json([{ id: 5, bezeichnung: 'Kleinlage', ausgeblendet: [], sortier: 1 }]),
      ),
    );
    zeige(<StichworteTab />, '/admin/stammdaten/stichworte');
    await screen.findByText('Kleinlage');
    await kopfFilterWaehlen('Vorlage', ['ohne Vorlage (1)']);
    await waitFor(() => expect(folge()).toEqual(['2']));
    await waitFor(() => expect(ort.aktuell).toBe('/admin/stammdaten/stichworte?f.vorlage=ohne'));
  });

  it('Einsatz-Vorlagen filtern nach der Einsatzart, die Adresse trägt den Filter zurück', async () => {
    setzeViewportBreite(1600);
    server.use(
      meHandler(leser),
      http.get('/api/einsatz-vorlagen', () =>
        HttpResponse.json([
          {
            id: 1,
            bezeichnung: 'Kleinlage',
            einsatzart: 'realeinsatz',
            ausgeblendet: [],
            sortier: 10,
          },
          { id: 2, bezeichnung: 'Großbrand', ausgeblendet: [], sortier: 20 },
        ]),
      ),
    );
    zeige(<EinsatzVorlagenTab />, '/admin/stammdaten/einsatz-vorlagen?f.einsatzart=realeinsatz');
    await screen.findByText('Kleinlage');
    expect(screen.queryByText('Großbrand')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Filter Einsatzart: Realeinsatz entfernen' }),
    ).toBeInTheDocument();
  });

  it('ETB-Schnellbausteine sortieren nach der gepflegten Sortierung', async () => {
    setzeViewportBreite(1600);
    server.use(
      meHandler(leser),
      http.get('/api/etb-bausteine', () =>
        HttpResponse.json([
          { id: 1, label: 'B', typ: 'lage', inhalt: 'b', sortier: 20 },
          { id: 2, label: 'A', typ: 'lage', inhalt: 'a', sortier: 10 },
        ]),
      ),
    );
    zeige(<EtbBausteineTab />, '/admin/stammdaten/etb-bausteine');
    await screen.findByText('b');
    expect(folge()).toEqual(['1', '2']);
    await userEvent.click(screen.getByRole('columnheader', { name: /^Sortierung/ }));
    await waitFor(() => expect(folge()).toEqual(['2', '1']));
    await waitFor(() =>
      expect(ort.aktuell).toBe('/admin/stammdaten/etb-bausteine?sort=sortier%3Aauf'),
    );
  });

  it('Schichtmodelle filtern nach der Art der Regel und sortieren nach der Vorwarnung', async () => {
    setzeViewportBreite(1600);
    const basis = {
      typ: 'rhythmus',
      rhythmus_minuten: 360,
      planungsvorlauf_minuten: 120,
      ist_vorgabe: false,
      ist_demo: false,
    };
    server.use(
      meHandler(leser),
      http.get('/api/schichtmodelle', () =>
        HttpResponse.json([
          { ...basis, id: 1, bezeichnung: 'Lang', vorwarnung_minuten: 45 },
          {
            ...basis,
            id: 2,
            bezeichnung: 'Wechsel',
            typ: 'wechselzeiten',
            rhythmus_minuten: undefined,
            wechselzeiten: ['06:00', '18:00'],
            mindestdauer_minuten: 240,
            vorwarnung_minuten: 30,
          },
        ]),
      ),
    );
    zeige(<SchichtmodelleTab />, '/admin/stammdaten/schichtmodelle');
    await screen.findByText('Wechsel');
    await userEvent.click(screen.getByRole('columnheader', { name: /^Vorwarnung/ }));
    await waitFor(() => expect(folge()).toEqual(['2', '1']));
    await kopfFilterWaehlen('Regel', ['Wechselzeiten (1)']);
    await waitFor(() => expect(folge()).toEqual(['2']));
    await waitFor(() =>
      expect(ort.aktuell).toBe(
        '/admin/stammdaten/schichtmodelle?sort=vorwarnung%3Aauf&f.regel=wechselzeiten',
      ),
    );
  });

  it('der Verpflegungsplan filtert nach der Art und sortiert nach der Zeit', async () => {
    setzeViewportBreite(1600);
    server.use(
      meHandler(leser),
      http.get('/api/verpflegung-vorlagen', () => HttpResponse.json(verpflegungsplan())),
    );
    zeige(<VerpflegungsplanTab />, '/admin/stammdaten/verpflegungsplan');
    await screen.findByText('Mittag');
    await userEvent.click(screen.getByRole('columnheader', { name: /^Zeit/ }));
    await userEvent.click(screen.getByRole('columnheader', { name: /^Zeit/ }));
    // Absteigend: die Nachtverpflegung am Folgetag zuerst, das Frühstück zuletzt.
    await waitFor(() => expect(folge()).toEqual(['4', '3', '2', '1']));
    await kopfFilterWaehlen('Art', ['warm (1)']);
    await waitFor(() => expect(folge()).toEqual(['2']));
    await waitFor(() =>
      expect(ort.aktuell).toBe('/admin/stammdaten/verpflegungsplan?sort=zeit%3Aab&f.art=warm'),
    );
  });

  it('Fahrzeug-Status sortieren nach Sortierung und FMS-Anker, die Adresse trägt den Stand', async () => {
    setzeViewportBreite(1600);
    server.use(
      meHandler(leser),
      http.get('/api/fahrzeug-status', () =>
        HttpResponse.json([
          {
            id: 1,
            label: 'einsatzbereit',
            kategorie: 'verfuegbar',
            farbe: null,
            fms_anker: 2,
            sortier: 10,
          },
          {
            id: 2,
            label: 'disponiert',
            kategorie: 'gebunden',
            farbe: null,
            fms_anker: 1,
            sortier: 20,
          },
        ]),
      ),
    );
    zeige(<StatusKatalogTab />, '/admin/stammdaten/status?sort=fms_anker%3Aauf');
    await screen.findByText('einsatzbereit');
    expect(folge()).toEqual(['2', '1']);
    await userEvent.click(screen.getByRole('columnheader', { name: /^Sortierung/ }));
    await waitFor(() => expect(folge()).toEqual(['1', '2']));
    await waitFor(() => expect(ort.aktuell).toBe('/admin/stammdaten/status?sort=sortier%3Aauf'));
  });

  it('Einheitstypen sortieren nach der Soll-Stärke, ohne Soll hinten', async () => {
    setzeViewportBreite(1600);
    server.use(
      meHandler(leser),
      http.get('/api/einheit-typen', () =>
        HttpResponse.json([
          { id: 1, label: 'Sonstige', soll: null, sortier: 10 },
          {
            id: 2,
            label: 'Zug',
            soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
            sortier: 20,
          },
          {
            id: 3,
            label: 'Trupp',
            soll: { fuehrer: 0, unterfuehrer: 1, mannschaft: 2 },
            sortier: 30,
          },
        ]),
      ),
    );
    zeige(<EinheitTypenTab />, '/admin/stammdaten/einheit-typen');
    await screen.findByText('Zug');
    await userEvent.click(screen.getByRole('columnheader', { name: /^Soll-Stärke/ }));
    await waitFor(() => expect(folge()).toEqual(['3', '2', '1']));
    await userEvent.click(screen.getByRole('columnheader', { name: /^Soll-Stärke/ }));
    await waitFor(() => expect(folge()).toEqual(['2', '3', '1']));
  });

  it('Einheiten-Vorlagen sind ein Baum: keine Sortierung, der Aktiv-Filter steht in der Adresse', async () => {
    setzeViewportBreite(1600);
    server.use(
      meHandler(leser),
      http.get('/api/einheit-vorlagen', () => HttpResponse.json(EINHEIT_VORLAGEN)),
      http.get('/api/einheit-typen', () => HttpResponse.json(EINHEIT_TYPEN)),
    );
    zeige(<EinheitVorlagenTab />, '/admin/stammdaten/einheiten?f.aktiv=false');
    await screen.findByText('SEG Behandlung');
    expect(screen.queryByText('Löschzug Nord')).toBeNull();
    expect(document.querySelector('thead .ant-table-column-has-sorters')).toBeNull();
  });
});
