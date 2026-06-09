import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import LageberichtePage from './LageberichtePage';
import LageberichtDetailPage from './LageberichtDetailPage';
import type { EinsatzAnzeige, LageberichtAnzeige } from '../api/types';

const admin = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};

const einsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-06-02 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-06-02 09:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Orga',
};

const bericht: LageberichtAnzeige = {
  id: 11, einsatz_id: 7, vorlage: 'freitext', titel: 'Lage 10:00', zeitstand: '2026-06-02 10:00:00',
  status: 'entwurf', abschnitte: [{ schluessel: 'text', text: 'Inhalt' }], version: 1,
  vorgaenger_id: null, ersteller_id: 1, ersteller_name: 'A', erstellt_at: '2026-06-02 10:00:00',
  aktualisiert_at: '2026-06-02 10:00:00', freigegeben_von_id: null, freigegeben_von_name: null,
  freigegeben_at: null, etb_eintrag_id: null,
};

function setup(berichte: LageberichtAnzeige[] = [bericht]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json(berichte)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/lageberichte' },
  );
}

const lagebericht7Abschnitte: LageberichtAnzeige = {
  ...bericht, id: 12, vorlage: 'lagebericht', titel: 'Lagevortrag',
  abschnitte: [
    { schluessel: 'auftrag', text: '' },
    { schluessel: 'gefahren_schadenlage', text: '' },
    { schluessel: 'eigene_lage', text: '' },
    { schluessel: 'lageentwicklung', text: '' },
    { schluessel: 'fuehrungsprobleme', text: '' },
    { schluessel: 'antraege_vorschlaege', text: '' },
    { schluessel: 'zusammenfassung', text: '' },
  ],
};

function setupDetail(lb: LageberichtAnzeige) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get(`/api/einsaetze/7/lageberichte/${lb.id}`, () => HttpResponse.json(lb)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route: `/einsaetze/7/lageberichte/${lb.id}` },
  );
}

describe('LageberichtDetailPage', () => {
  it('Entwurf-Editor zeigt ein Feld je Abschnitt der Vorlage', async () => {
    setupDetail(lagebericht7Abschnitte);
    expect(await screen.findByLabelText('Auftrag')).toBeInTheDocument();
    expect(screen.getByLabelText('Zusammenfassung')).toBeInTheDocument();
    expect(screen.getByLabelText('Gefahren-/Schadenlage')).toBeInTheDocument();
  });

  it('Entwurf-Editor stellt die Abschnitts-Felder mit autoSize statt fixer Mini-Höhe dar', async () => {
    setupDetail(lagebericht7Abschnitte);
    const feld = (await screen.findByLabelText('Auftrag')) as HTMLTextAreaElement;
    // autoSize lässt das Feld mit dem Inhalt mitwachsen (kein fixer rows={4}-Kasten)
    // und schaltet den browser-nativen Resize-Griff ab — kein zufälliger Mini-Griff (AK#2).
    // autoSize löst in rc-textarea eine Resize-Messung aus, die overflowY:hidden setzt
    // (nach Flush der Effects via findBy); ein fixer rows-Kasten hat kein Inline-Style.
    expect(feld.style.overflowY).toBe('hidden');
    expect(feld).not.toHaveAttribute('rows', '4');
  });

  it('Freigeben speichert den getippten Inhalt zuvor — ein eben befüllter Entwurf wird nicht als „leer" abgelehnt', async () => {
    // Backend-Semantik nachgebildet: POST /freigeben nimmt KEINEN Body und validiert
    // den PERSISTIERTEN Stand. Wer tippt und direkt freigibt (ohne „Entwurf speichern"),
    // bekam bisher „Der Bericht ist leer", obwohl Text im Feld steht.
    let persistierte = lagebericht7Abschnitte.abschnitte.map((a) => ({ ...a }));
    let status = 'entwurf';
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte/12', () =>
        HttpResponse.json({ ...lagebericht7Abschnitte, abschnitte: persistierte, status }),
      ),
      http.patch('/api/einsaetze/7/lageberichte/12', async ({ request }) => {
        const body = (await request.json()) as { abschnitte?: typeof persistierte };
        if (body.abschnitte) persistierte = body.abschnitte;
        return HttpResponse.json({ ...lagebericht7Abschnitte, abschnitte: persistierte, status });
      }),
      http.post('/api/einsaetze/7/lageberichte/12/freigeben', () => {
        if (persistierte.every((a) => a.text.trim() === '')) {
          return HttpResponse.json(
            { error: 'Der Bericht ist leer und kann nicht freigegeben werden' },
            { status: 422 },
          );
        }
        status = 'freigegeben';
        return HttpResponse.json({
          ...lagebericht7Abschnitte,
          abschnitte: persistierte,
          status,
          etb_eintrag_id: 99,
        });
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/lageberichte/12' },
    );

    const auftrag = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftrag, 'Hochwasser steigt');
    // Bewusst OHNE vorher „Entwurf speichern" zu klicken.
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Freigeben/i }));

    // Erfolg: der getippte Inhalt wird persistiert und der Bericht freigegeben.
    expect(await screen.findByText('Bericht freigegeben')).toBeInTheDocument();
  });

  it('freigegebener Bericht ist read-only mit ETB-Link und Fortschreiben', async () => {
    setupDetail({
      ...lagebericht7Abschnitte, status: 'freigegeben', etb_eintrag_id: 99,
      freigegeben_von_name: 'A', freigegeben_at: '2026-06-02 11:00:00',
    });
    expect(await screen.findByRole('button', { name: /Fortschreiben/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Auftrag')).not.toBeInTheDocument();
  });

  it('rendert einen markierten Druckbereich', async () => {
    const { container } = setupDetail(lagebericht7Abschnitte);
    await screen.findAllByText('Lagevortrag');
    expect(container.querySelector('.lagebericht-print-root')).not.toBeNull();
  });

  it('Freigeben öffnet einen Bestätigungsdialog', async () => {
    setupDetail({ ...lagebericht7Abschnitte, abschnitte: [
      { schluessel: 'auftrag', text: 'X' }, { schluessel: 'gefahren_schadenlage', text: '' },
      { schluessel: 'eigene_lage', text: '' }, { schluessel: 'lageentwicklung', text: '' },
      { schluessel: 'fuehrungsprobleme', text: '' }, { schluessel: 'antraege_vorschlaege', text: '' },
      { schluessel: 'zusammenfassung', text: '' }] });
    await screen.findByRole('button', { name: /Freigeben/i });
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    expect(await screen.findByText(/endgültig|unveränderlich|ETB/i)).toBeInTheDocument();
  });

  it('Entwurf-Editor spiegelt Markdown live als Vorschau (layout=split)', async () => {
    setupDetail({
      ...lagebericht7Abschnitte,
      abschnitte: [
        { schluessel: 'auftrag', text: '' },
        { schluessel: 'gefahren_schadenlage', text: '' },
        { schluessel: 'eigene_lage', text: '' },
        { schluessel: 'lageentwicklung', text: '' },
        { schluessel: 'fuehrungsprobleme', text: '' },
        { schluessel: 'antraege_vorschlaege', text: '' },
        { schluessel: 'zusammenfassung', text: '' },
      ],
    });
    // Warte auf das Formular
    const auftragFeld = await screen.findByLabelText('Auftrag');
    // Markdown-Text eintippen
    await userEvent.type(auftragFeld, '## Schwerpunkt\n- Punkt A');
    // Live-Vorschau muss die formatierte Überschrift zeigen (nicht den Rohtext)
    expect(await screen.findByRole('heading', { name: 'Schwerpunkt', level: 2 })).toBeInTheDocument();
    // Listeneintrag muss als listitem erscheinen
    expect(screen.getByText('Punkt A')).toBeInTheDocument();
    // "## Schwerpunkt" darf NICHT als sichtbarer Text (außerhalb der Textarea) erscheinen
    const rohTexte = screen.queryAllByText(/## Schwerpunkt/);
    for (const el of rohTexte) {
      expect(el.tagName.toLowerCase()).toBe('textarea');
    }
  });

  it('freigegebener Bericht rendert Markdown-Abschnittstext formatiert (Überschrift + Liste)', async () => {
    // Einen Abschnitt mit Markdown, einen ohne Text (Fallback "—")
    setupDetail({
      ...lagebericht7Abschnitte,
      status: 'freigegeben',
      abschnitte: [
        { schluessel: 'auftrag', text: '## Schwerpunkt\n- Punkt A' },
        { schluessel: 'gefahren_schadenlage', text: '' },
        { schluessel: 'eigene_lage', text: '' },
        { schluessel: 'lageentwicklung', text: '' },
        { schluessel: 'fuehrungsprobleme', text: '' },
        { schluessel: 'antraege_vorschlaege', text: '' },
        { schluessel: 'zusammenfassung', text: '' },
      ],
    });
    // Markdown-Überschrift (h2) muss als Heading gerendert sein, nicht als Rohtext "## Schwerpunkt"
    expect(await screen.findByRole('heading', { name: 'Schwerpunkt', level: 2 })).toBeInTheDocument();
    // Listeneintrag muss als listitem erscheinen, nicht als Rohtext "- Punkt A"
    expect(screen.getByText('Punkt A')).toBeInTheDocument();
    // Leerer Abschnitt zeigt den Fallback "—"
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Kein Rohtext mit Markdown-Zeichen
    expect(screen.queryByText(/## Schwerpunkt/)).toBeNull();
    expect(screen.queryByText(/- Punkt A/)).toBeNull();
  });
});

describe('LageberichtePage', () => {
  it('zeigt die Berichte des Einsatzes', async () => {
    setup();
    expect(await screen.findByText('Lage 10:00')).toBeInTheDocument();
  });

  it('zeigt für Schreibberechtigte den Anlegen-Button', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /Neuer Bericht/i })).toBeInTheDocument();
  });

  it('zeigt leeren Zustand ohne Berichte', async () => {
    setup([]);
    expect(await screen.findByText(/Noch keine Lageberichte/i)).toBeInTheDocument();
  });
});
