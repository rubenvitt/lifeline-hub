import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders, setzeOnline } from '../test/utils';
import { erzeugeQueryClient } from '../api/queryClient';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
import PersonenDruckPage from './PersonenDruckPage';

/**
 * Personen-Druckansicht (LFH-727, design.md D1/D4): Daten nur über den protokollierenden Abruf,
 * genau ein Abruf je Öffnung, kein stiller Wiederholungsversuch, Auswahl aus der Adresse.
 */

const EINSATZ = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0007',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
};

function person(nr: number, over: Partial<Person> = {}): Person {
  return {
    id: nr * 10,
    einsatz_id: 7,
    registrier_nr: nr,
    status: 'betroffen',
    name: `Person ${nr}`,
    vorname: null,
    geschlecht: null,
    geburtsdatum: null,
    alter_geschaetzt: null,
    herkunft_adresse: null,
    antreff_ort: 'Brücke',
    melder_kontakt: null,
    notiz: null,
    erfasst_at: '2026-09-25 06:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-09-25 06:00:00',
    geaendert_von: 1,
    storniert_at: null,
    ...over,
  };
}

/** Zählt die Abrufe beider Wege; die Liste darf die Druckansicht nie bedienen. */
function server_mit(personen: Person[], druckStatus = 200) {
  const abrufe = { druck: 0, liste: 0 };
  server.use(
    http.get('/api/einsaetze/7', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/7/personen/druck', () => {
      abrufe.druck += 1;
      return druckStatus === 200
        ? HttpResponse.json(personen)
        : HttpResponse.json({ error: 'kaputt' }, { status: druckStatus });
    }),
    http.get('/api/einsaetze/7/personen', () => {
      abrufe.liste += 1;
      return HttpResponse.json(personen);
    }),
    http.get('/api/einsaetze/7/uhs', () => HttpResponse.json([{ id: 5, bezeichnung: 'BHP 50' }])),
  );
  return abrufe;
}

function rendere(suche = '', client = neuerQueryClient()) {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personen/druck" element={<PersonenDruckPage />} />
      <Route path="/einsaetze/:id/personen" element={<div>PERSONEN-LISTE</div>} />
    </Routes>,
    { route: `/einsaetze/7/personen/druck${suche}`, client },
  );
}

const druckKnopf = () => screen.getByRole('button', { name: 'Drucken / als PDF' });
async function fertig() {
  await waitFor(() => expect(druckKnopf()).toBeEnabled());
}
function nummern(): string[] {
  return Array.from(
    document.querySelectorAll('[data-lfh="personen-druck-tabelle"] tbody tr td:first-child'),
  ).map((td) => td.textContent ?? '');
}

describe('PersonenDruckPage', () => {
  it('lädt genau einmal über den Druck-Abruf, nie über die Liste', async () => {
    const abrufe = server_mit([person(1), person(2)]);
    rendere();
    await fertig();
    expect(nummern()).toEqual(['R-001', 'R-002']);
    expect(abrufe).toEqual({ druck: 1, liste: 0 });
  });

  it('nimmt keine zwischengespeicherte Liste, sondern ruft beim Öffnen neu ab', async () => {
    const abrufe = server_mit([person(1)]);
    const client = neuerQueryClient();
    client.setQueryData(einsatzKeys.personen(7), [person(9)]);
    client.setQueryData(einsatzKeys.personenDruck(7), {
      personen: [person(8)],
      uhs: [],
      geladenAt: '2026-09-25T05:00:00Z',
    });
    rendere('', client);
    await waitFor(() => expect(abrufe.druck).toBe(1));
    await fertig();
    expect(nummern()).toEqual(['R-001']);
  });

  it('druckt ohne Verbindung keinen zwischengespeicherten Stand', async () => {
    // Offline pausierte TanStack den Abruf (networkMode „online“) und zeigte den Schnappschuss
    // des letzten Besuchs als druckbar — ohne neuen Protokolleintrag.
    server_mit([person(1)]);
    server.use(http.get('/api/einsaetze/7/personen/druck', () => HttpResponse.error()));
    const client = neuerQueryClient();
    client.setQueryData(einsatzKeys.personenDruck(7), {
      personen: [person(8)],
      uhs: [],
      geladenAt: '2026-09-25T05:00:00Z',
    });
    // Den Einsatz hält im echten Layout schon die Einsatzhülle im Cache.
    client.setQueryData(einsatzKeys.einsatz(7), EINSATZ);
    setzeOnline(false);
    rendere('', client);
    await screen.findByText('Die Liste konnte nicht geladen werden');
    expect(druckKnopf()).toBeDisabled();
    expect(nummern()).toEqual([]);
  });

  it('zeigt den Protokoll-Hinweis schon beim Laden', async () => {
    server_mit([person(1)]);
    server.use(
      http.get('/api/einsaetze/7/personen/druck', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json([person(1)]);
      }),
    );
    rendere();
    await screen.findByRole('status');
    expect(screen.getByTestId('druck-hinweis')).toHaveTextContent('Zugriffsprotokoll');
  });

  it('„Neu laden“ ist genau ein weiterer protokollierter Abruf', async () => {
    const abrufe = server_mit([person(1)]);
    rendere();
    await fertig();
    await userEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(abrufe.druck).toBe(2));
    await fertig();
    expect(abrufe.druck).toBe(2);
  });

  it('wiederholt einen gescheiterten Abruf nicht still', async () => {
    const abrufe = server_mit([person(1)], 500);
    rendere();
    await screen.findByText('Die Liste konnte nicht geladen werden');
    // Ein Takt Luft für einen etwaigen Retry.
    await new Promise((r) => setTimeout(r, 50));
    expect(abrufe.druck).toBe(1);
    expect(druckKnopf()).toBeDisabled();
  });

  it('schaltet den Wiederholungsversuch aus, auch für Netzfehler der Produktionsvorgabe', async () => {
    server_mit([person(1)]);
    // Produktionsvorgabe: Netzfehler werden zweimal wiederholt — beim Druck-Abruf hieße das
    // bis zu drei Protokolleinträge für einen Klick.
    const client = erzeugeQueryClient();
    rendere('', client);
    await fertig();
    const query = client.getQueryCache().find({ queryKey: einsatzKeys.personenDruck(7) });
    expect(query?.options.retry).toBe(false);
  });

  it('wählt nach der Adresse aus und nennt die Auswahl im Kopf', async () => {
    server_mit([
      person(1, { status: 'vermisst' }),
      person(2, { status: 'betroffen' }),
      person(3, { status: 'vermisst' }),
    ]);
    rendere('?filter=vermisst');
    await fertig();
    expect(nummern()).toEqual(['R-001', 'R-003']);
    const kopf = document.querySelector<HTMLElement>('[data-lfh="druckkopf"]')!;
    expect(kopf).toHaveTextContent('Betroffenenliste');
    expect(kopf).toHaveTextContent('Status: Vermisst');
    expect(kopf).toHaveTextContent('2 Personen');
  });

  it('sagt am Bildschirm, dass der Abruf protokolliert wird', async () => {
    server_mit([person(1)]);
    rendere();
    await fertig();
    expect(screen.getByTestId('druck-hinweis')).toHaveTextContent('Zugriffsprotokoll');
  });

  it('nennt den UHS-Namen im Verbleib aus demselben Stand', async () => {
    server_mit([person(1, { aktuelle_uhs_id: 5 })]);
    rendere();
    await fertig();
    expect(screen.getByText('UHS BHP 50')).toBeInTheDocument();
  });

  it('druckt ohne UHS-Namen, wenn die UHS-Liste nicht zugänglich ist', async () => {
    server_mit([person(1, { aktuelle_uhs_id: 5 })]);
    server.use(
      http.get('/api/einsaetze/7/uhs', () =>
        HttpResponse.json({ error: 'gesperrt' }, { status: 403 }),
      ),
    );
    rendere();
    await fertig();
    expect(
      document.querySelectorAll('[data-lfh="personen-druck-tabelle"] tbody tr td')[6].textContent,
    ).toBe('UHS');
  });
});
