import { http, HttpResponse } from 'msw';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import FahrzeugePage from './FahrzeugePage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-26 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: '2026-001', angelegt_at: '2026-05-26 09:00:00',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

const ef = {
  id: 10, einsatz_id: 7, fahrzeug_id: 1, einheit_id: null, ist_adhoc: false, funkrufname: 'Florian 1',
  kennzeichen: 'XX-AB 1', fahrzeugtyp: 'LF 20', opta: null, traegerorganisation: null,
  status_id: 2, status_label: 'disponiert', status_kategorie: 'gebunden', status_farbe: null,
  bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
  soll_besatzung: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
};
const stati = [
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
  { id: 3, label: 'vor_ort', kategorie: 'gebunden', farbe: null, fms_anker: 4, sortier: 40 },
];

function person(overrides: Record<string, unknown> = {}) {
  return {
    id: 100, einsatz_id: 7, personal_id: 5, einheit_id: null, fahrzeug_id: null, ist_adhoc: false,
    name: 'Anna Crew', funktion: null, traegerorganisation: null, staerke_position: 'mannschaft',
    status_id: null, status_label: null, status_kategorie: null, status_farbe: null,
    bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1, ...overrides,
  };
}

function render(
  einsatzObj: ReturnType<typeof einsatz>,
  personal: ReturnType<typeof person>[] = [],
  efObj: Record<string, unknown> = ef,
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([efObj])),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personal)),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/fahrzeuge' },
  );
}

describe('FahrzeugePage', () => {
  it('zeigt disponierte Fahrzeuge', async () => {
    render(einsatz());
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
  });

  it('Einsatzleitung im aktiven Einsatz sieht Disponieren-/Entfernen-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByText('Stamm-Fahrzeug disponieren …')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter sieht reine Anzeige (Status-Badge statt Select)', async () => {
    render(einsatz({ meine_rolle: 'beobachter' }));
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Fahrzeug' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.getByText('disponiert')).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist read-only und zeigt Hinweis', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00' }));
    await screen.findByText('Florian 1');
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
  });

  it('zeigt Unterbesetzung rot mit Soll-Kontext in Klammern', async () => {
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew]);
    await screen.findByText('Florian 1');
    // Besatzungs-Spalte dauerhaft sichtbar. Ist 1/0/0//1 < Soll 0/1/8//9 (UF/M fehlen) →
    // unterbesetzt: roter Badge, Soll als Klammer-Kontext (zugleich nicht-farbliches Signal).
    expect(screen.getByRole('columnheader', { name: 'Besatzung' })).toBeInTheDocument();
    expect(container.querySelector('.ant-tag-red')).toHaveTextContent('1/0/0//1 (Soll 0/1/8//9)');
  });

  it('zählt Besatzung ohne Stärke-Position als Mannschaft (BOS-Σ ist Kopfzahl)', async () => {
    // LFH-9: Eine Kraft ist physisch auf dem Fahrzeug und gehört zur Stärke, auch ohne
    // explizite F/UF-Position. Sammeltopf in der BOS-Schreibweise ist die Mannschaft.
    const fuehrer = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const ohnePosition = person({ id: 101, name: 'asdasd', fahrzeug_id: 10, staerke_position: null });
    const { container } = render(einsatz(), [fuehrer, ohnePosition]);
    await screen.findByText('Florian 1');
    // 1 Führer + 1 ohne Position → 1/0/1//2 (nicht 1/0/0//1, die zweite Kraft verschwindet sonst).
    expect(container.querySelector('.ant-tag-red')).toHaveTextContent('1/0/1//2 (Soll 0/1/8//9)');
  });

  it('zeigt erfülltes Soll grün ohne Soll-Ballast', async () => {
    const sollKlein = { ...ef, soll_besatzung: { fuehrer: 1, unterfuehrer: 0, mannschaft: 0 } };
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    render(einsatz(), [crew], sollKlein);
    await screen.findByText('Florian 1');
    // Ist 1/0/0//1 ≥ Soll 1/0/0//1 in jeder Position → grün, ohne redundanten Soll-Text.
    // Über den Stärke-Text wählen (der grüne Einsatz-Status „aktiv" wäre sonst ein zweiter ant-tag-green).
    const badge = screen.getByText('1/0/0//1');
    expect(badge).toHaveClass('ant-tag-green');
    expect(badge).not.toHaveTextContent('Soll');
  });

  it('wertet Überbesetzung als erfüllt (grün)', async () => {
    const sollKlein = { ...ef, soll_besatzung: { fuehrer: 1, unterfuehrer: 0, mannschaft: 0 } };
    const crew = [
      person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' }),
      person({ id: 101, name: 'Bert', fahrzeug_id: 10, staerke_position: 'mannschaft' }),
    ];
    render(einsatz(), crew, sollKlein);
    await screen.findByText('Florian 1');
    // Ist 1/0/1//2 ≥ Soll 1/0/0//1 in jeder Position (Mannschaft über Soll) → erfüllt.
    expect(screen.getByText('1/0/1//2')).toHaveClass('ant-tag-green');
  });

  it('zeigt fehlendes Soll neutral blau ohne Soll-Kontext', async () => {
    const ohneSoll = { ...ef, soll_besatzung: null };
    const crew = person({ id: 100, name: 'Anna', fahrzeug_id: 10, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew], ohneSoll);
    await screen.findByText('Florian 1');
    // Kein hinterlegtes Soll → kein „erfüllt"-Urteil möglich → neutral blau, nur Ist.
    const badge = container.querySelector('.ant-tag-blue');
    expect(badge).toHaveTextContent('1/0/0//1');
    expect(badge).not.toHaveTextContent('Soll');
  });

  it('zeigt die Besatzung des Fahrzeugs und einen Frei-Pool-Picker nach dem Aufklappen', async () => {
    const crew = person({ id: 100, name: 'Anna Crew', fahrzeug_id: 10, staerke_position: 'mannschaft' });
    const frei = person({ id: 101, name: 'Bert Frei', fahrzeug_id: null, staerke_position: 'fuehrer' });
    const { container } = render(einsatz(), [crew, frei]);
    await screen.findByText('Florian 1');

    // Besatzung ist standardmäßig eingeklappt → Zeile per Icon aufklappen.
    const expandIcon = container.querySelector('.ant-table-row-expand-icon-collapsed');
    expect(expandIcon).not.toBeNull();
    fireEvent.click(expandIcon!);

    // Besatzungsmitglied (fahrzeug_id === 10) wird angezeigt, mit Freigeben-Aktion.
    expect(await screen.findByText(/Anna Crew/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeInTheDocument();
    // Frei-Pool-Picker vorhanden (nur freie Kräfte).
    expect(screen.getByText('Kraft zur Besatzung …')).toBeInTheDocument();
  });

  it('markiert eine Besatzung aus anderer Einheit als das Fahrzeug', async () => {
    // Fahrzeug ef.einheit_id = null, Person in Einheit 3 → Diskrepanz-Tag nach Aufklappen.
    const crew = person({ id: 100, name: 'Cara Diskrepanz', fahrzeug_id: 10, einheit_id: 3 });
    const { container } = render(einsatz(), [crew]);
    await screen.findByText('Florian 1');
    fireEvent.click(container.querySelector('.ant-table-row-expand-icon-collapsed')!);
    expect(await screen.findByText(/Cara Diskrepanz/)).toBeInTheDocument();
    expect(screen.getByText('andere Einheit')).toBeInTheDocument();
  });
});
