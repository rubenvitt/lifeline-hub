import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { PassZeile } from '../api/types';
import { ZWECK_BILDSCHIRM, ZWECK_BLATT } from '../personen/passListe';
import PassListeDruckPage from './PassListeDruckPage';

/**
 * Druckansicht der PASS-Liste (LLH-1198, Entwurf `2026-11-24-sco62ku3-pass-liste`): Zeilen nur
 * über den protokollierenden Abruf mit `profile=pass`, Texte unverändert, Zweckbindung am
 * Bildschirm und auf dem Blatt.
 */

const EINSATZ = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0007',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
};

const ZEILE: PassZeile = {
  id_label: 'R-001',
  last_name: 'Muster',
  first_name: 'Erika',
  birth_date: '07.03.1950',
  age: '',
  sex: 'weiblich',
  address: 'Hauptstr. 1, Köln',
  affectedness: 'verletzt/erkrankt',
  whereabouts: 'Transport → KH Mitte',
  recorded_at: '24.11.2026 14:05',
};

function server_mit(status = 200) {
  const abrufe = { pass: 0 };
  server.use(
    http.get('/api/incidents/7', () => HttpResponse.json(EINSATZ)),
    http.get('/api/incidents/7/persons/print', ({ request }) => {
      if (new URL(request.url).searchParams.get('profile') !== 'pass') {
        return HttpResponse.json({ error: 'falscher Abruf' }, { status: 418 });
      }
      abrufe.pass += 1;
      return status === 200
        ? HttpResponse.json([ZEILE])
        : HttpResponse.json({ error: 'kaputt' }, { status });
    }),
  );
  return abrufe;
}

function rendere() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personen/pass-druck" element={<PassListeDruckPage />} />
    </Routes>,
    { route: '/einsaetze/7/personen/pass-druck' },
  );
}

const druckKnopf = () => screen.getByRole('button', { name: 'Drucken / als PDF' });

describe('PassListeDruckPage', () => {
  it('zeigt die Zeilen mit Kopf in PASS-Reihenfolge', async () => {
    server_mit();
    rendere();
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    const tabelle = document.querySelector('[data-lfh="pass-liste-tabelle"]')!;
    const kopf = Array.from(tabelle.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(kopf).toEqual([
      'Kennung',
      'Name',
      'Vorname',
      'Geburtsdatum',
      'Alter (geschätzt)',
      'Geschlecht',
      'Anschrift',
      'Art der Betroffenheit',
      'Verbleib',
      'Erfasst am',
    ]);
    const zellen = Array.from(tabelle.querySelectorAll('tbody td')).map((td) => td.textContent);
    expect(zellen).toEqual([
      'R-001',
      'Muster',
      'Erika',
      '07.03.1950',
      '',
      'weiblich',
      'Hauptstr. 1, Köln',
      'verletzt/erkrankt',
      'Transport → KH Mitte',
      '24.11.2026 14:05',
    ]);
  });

  it('nennt die Zweckbindung am Bildschirm und auf dem Blatt', async () => {
    server_mit();
    rendere();
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(screen.getByTestId('druck-hinweis')).toHaveTextContent(ZWECK_BILDSCHIRM);
    const blatt = document.querySelector('[data-lfh="druckwurzel"] [data-lfh="pass-zweck"]');
    expect(blatt).toHaveTextContent(ZWECK_BLATT);
    expect(ZWECK_BILDSCHIRM).toBe(
      'Die PASS-Liste enthält Personendaten Betroffener. Nur für die Personenauskunft verwenden und nicht weitergeben. Der Abruf wird protokolliert.',
    );
    expect(ZWECK_BLATT).toBe('Zweckgebunden: nur für die Personenauskunftsstelle.');
  });

  it('lädt genau einmal und wiederholt nicht bei Fehler', async () => {
    const abrufe = server_mit(500);
    rendere();
    await screen.findByText('Die Liste konnte nicht geladen werden');
    expect(abrufe.pass).toBe(1);
    expect(druckKnopf()).toBeDisabled();
  });
});
