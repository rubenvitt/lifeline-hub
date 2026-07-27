import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalPage from './PersonalPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv', begonnen_at: '2026-05-26 09:00:00',
    abgeschlossen_at: null, abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null,
    angelegt_at: '2026-05-26 09:00:00', leitstellen_nr: null, einsatzort: null, einsatzort_lat: null,
    einsatzort_lon: null, meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

// LFH-139: Struktur-Listen für die Auflösung einheit_id/fahrzeug_id → Klartext-Label.
const einheiten = [
  { id: 3, name: 'Zugtrupp', abschnitt_id: null, ueber_einheit_id: null, typ_label: null, fuehrer_name: null, soll: null },
];
const fahrzeuge = [
  { id: 8, funkrufname: 'Florian 1', kennzeichen: 'FW-1234', fahrzeugtyp: 'ELW', einheit_id: 3, status_kategorie: null, status_label: null },
];

const disponiert = [
  {
    id: 10, einsatz_id: 7, personal_id: 5, ist_adhoc: false, name: 'Thomas Müller',
    funktion: 'Sanitäter, Gruppenführer', traegerorganisation: 'DRK', staerke_position: 'fuehrer',
    status_id: 2, status_label: 'alarmiert', status_kategorie: 'gebunden', status_farbe: null,
    bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
    einheit_id: 3, fahrzeug_id: 8,
  },
];

function render(einsatzObj: ReturnType<typeof einsatz>, personalDaten: unknown[] = disponiert) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personalDaten)),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/personal-status', () => HttpResponse.json([
      { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
    ])),
    http.get('/api/personal', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/personal' },
  );
}

describe('PersonalPage', () => {
  it('zeigt disponiertes Personal mit Funktion und Position', async () => {
    render(einsatz());
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter, Gruppenführer')).toBeInTheDocument();
  });

  it('hebt per ?personal=<id> die Zeile hervor (LFH-25 Inspector-Deeplink)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json(disponiert)),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
      http.get('/api/personal-status', () => HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
      ])),
      http.get('/api/personal', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/personal?personal=10' },
    );
    await screen.findByText('Thomas Müller');
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="10"]')).toHaveClass('zeile-hervorgehoben'),
    );
  });

  it('Leitung im aktiven Einsatz sieht Dispositions-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Ad-hoc-Person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter / abgeschlossen: reine Ansicht', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00', meine_rolle: 'beobachter' }));
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Person' })).not.toBeInTheDocument();
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
  });

  // LFH-4 P1: Position-Select ist leerbar; Clear muss explizit null senden (nicht absent),
  // sonst verschluckt JSON.stringify das Feld und das Backend behält den Altwert.
  it('Position leeren sendet explizit null', async () => {
    let patchBody: unknown = 'NICHT_AUFGERUFEN';
    server.use(
      http.patch('/api/einsaetze/7/personal/10', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...disponiert[0], staerke_position: null });
      }),
    );
    const { container } = render(einsatz());
    await screen.findByText('Thomas Müller');

    const clear = container.querySelector('.ant-select-clear');
    expect(clear, 'Position-Select muss allowClear haben').not.toBeNull();
    fireEvent.mouseDown(clear!);
    fireEvent.click(clear!);

    await waitFor(() => expect(patchBody).toEqual({ staerke_position: null }));
  });

  // LFH-139: Gegenrichtung zur Fahrzeugseite — je Kraft das zugeordnete Fahrzeug
  // (Funkrufname/Kennzeichen) + die Einheit, jeweils als Deeplink zur Modulseite.
  it('zeigt zugeordnetes Fahrzeug (Funkrufname/Kennzeichen) und Einheit je Kraft, verlinkt (LFH-139)', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');

    const fahrzeugLink = screen.getByRole('link', { name: 'Florian 1 (FW-1234)' });
    expect(fahrzeugLink).toHaveAttribute('href', '/einsaetze/7/fahrzeuge?fahrzeug=8');

    const einheitLink = screen.getByRole('link', { name: 'Zugtrupp' });
    expect(einheitLink).toHaveAttribute('href', '/einsaetze/7/einheiten?einheit=3');
  });

  it('stellt nicht zugeordnete Kräfte in Fahrzeug- und Einheit-Spalte als „—" dar (LFH-139)', async () => {
    const unzugeordnet = [{
      id: 11, einsatz_id: 7, personal_id: 6, ist_adhoc: false, name: 'Erika Mustermann',
      funktion: 'Helferin', traegerorganisation: 'THW', staerke_position: 'mannschaft',
      status_id: 2, status_label: 'alarmiert', status_kategorie: 'gebunden', status_farbe: null,
      bemerkung: 'x', disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
      einheit_id: null, fahrzeug_id: null,
    }];
    const { container } = render(einsatz(), unzugeordnet);
    await screen.findByText('Erika Mustermann');

    // Auf die Zeile der unzugeordneten Kraft scopen (robust gegen andere Zeilen/Kopf).
    const zeile = container.querySelector('[data-row-key="11"]') as HTMLElement;
    expect(zeile).not.toBeNull();
    // Keine Fahrzeug-/Einheit-Deeplinks in dieser Zeile ...
    expect(within(zeile).queryByRole('link')).toBeNull();
    // ... und beide neuen Spalten (Fahrzeug, Einheit) zeigen den „—"-Platzhalter.
    // (Alle übrigen Felder der Testperson sind gesetzt bzw. im Schreibmodus Inputs.)
    expect(within(zeile).getAllByText('—')).toHaveLength(2);
  });
});
