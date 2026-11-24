import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import type { BenutzerAnzeige, Bereitschaft } from '../api/types';
import BereitschaftUebersicht from './BereitschaftUebersicht';
import { setzeViewportBreite } from '../test/viewport';

/** Übersicht der Verwaltung (LLH-1820): Satz, fünf Zeilen, Sprünge, Demo-Anteil. */

const admin = adminFixture({ anzeigename: 'Chef' });
const fuehrungskraft = benutzerFixture({ id: 2, anzeigename: 'Eva', org_rolle: 'fuehrungskraft' });

const BESTAND: Bereitschaft = {
  benutzer: 1,
  fahrzeuge: 4,
  fahrzeuge_demo: 12,
  personal: 23,
  personal_demo: 0,
  einheit_vorlagen: 0,
  einheit_vorlagen_demo: 0,
  einsatz_vorlagen: 2,
};

function setup(me: BenutzerAnzeige, antwort: Bereitschaft | 'fehler' = BESTAND) {
  server.use(
    meHandler(me),
    http.get('/api/administration/inventory', () =>
      antwort === 'fehler'
        ? HttpResponse.json({ error: 'kaputt' }, { status: 500 })
        : HttpResponse.json(antwort),
    ),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/admin/uebersicht" element={<BereitschaftUebersicht />} />
      <Route path="/admin/stammdaten/fahrzeuge" element={<div>Seite Fahrzeuge</div>} />
    </Routes>,
    { route: '/admin/uebersicht' },
  );
}

async function zeile(name: string) {
  return screen.findByRole('row', { name: new RegExp(`^${name}`) });
}

describe('BereitschaftUebersicht (LLH-1820)', () => {
  it('zeigt_satz_und_fuenf_zeilen', async () => {
    setup(admin);
    expect(await screen.findByText('Für einen Einsatz fehlt: weitere Benutzer.')).toBeVisible();
    const zeilen = within(await screen.findByRole('table', { name: 'Bereitschaft' })).getAllByRole(
      'row',
    );
    expect(zeilen.map((z) => within(z).getAllByRole('cell')[0].textContent)).toEqual([
      'Benutzer',
      'Fahrzeuge',
      'Personal',
      'Einheiten-Vorlagen',
      'Einsatz-Vorlagen',
    ]);
    expect(within(await zeile('Benutzer')).getByText('fehlt')).toBeVisible();
    expect(within(await zeile('Einheiten-Vorlagen')).getByText('empfohlen')).toBeVisible();
  });

  it('demo_anteil_gedaempft', async () => {
    setup(admin);
    expect(within(await zeile('Fahrzeuge')).getByText('+ 12 aus der Demo')).toBeVisible();
    expect(within(await zeile('Personal')).queryByText(/aus der Demo/)).toBeNull();
  });

  it('sprung_fuehrt_zur_stammdatenseite', async () => {
    setup(admin);
    expect(within(await zeile('Fahrzeuge')).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/stammdaten/fahrzeuge',
    );
    expect(within(await zeile('Benutzer')).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/benutzer',
    );
  });

  it('fuehrungskraft_ohne_sprung_zu_benutzern', async () => {
    setup(fuehrungskraft);
    expect(within(await zeile('Benutzer')).queryByRole('link')).toBeNull();
    for (const name of ['Fahrzeuge', 'Personal', 'Einheiten-Vorlagen', 'Einsatz-Vorlagen']) {
      expect(within(await zeile(name)).getByRole('link')).toBeVisible();
    }
  });

  it('bereit_ohne_pflichtluecke', async () => {
    setup(admin, { ...BESTAND, benutzer: 3 });
    expect(await screen.findByText('Bereit für einen Einsatz.')).toBeVisible();
  });

  it('fehler_zeigt_seitenfehler', async () => {
    setup(admin, 'fehler');
    expect(await screen.findByRole('button', { name: /erneut|wiederholen/i })).toBeVisible();
  });

  describe('am Handschirm (Entwurf Handy.dc.html)', () => {
    it('die_ganze_zeile_ist_der_sprung', async () => {
      setzeViewportBreite(390);
      setup(admin);
      const fahrzeuge = await zeile('Fahrzeuge');
      // Die Bezeichnung trägt den Link, rechts nur der Pfeil.
      expect(within(fahrzeuge).getByRole('link', { name: 'Fahrzeuge' })).toHaveAttribute(
        'href',
        '/admin/stammdaten/fahrzeuge',
      );
      expect(within(fahrzeuge).queryByRole('link', { name: /↗/ })).toBeNull();
      // Ein Tipp auf die Zahl genügt.
      await userEvent.click(within(fahrzeuge).getByText('4'));
      expect(await screen.findByText('Seite Fahrzeuge')).toBeInTheDocument();
    });

    it('fuehrungskraft_ohne_sprung_zu_benutzern', async () => {
      setzeViewportBreite(390);
      setup(fuehrungskraft);
      const benutzer = await zeile('Benutzer');
      expect(within(benutzer).queryByRole('link')).toBeNull();
      expect(within(benutzer).getByText('nur für System-Admins')).toBeInTheDocument();
    });
  });
});
