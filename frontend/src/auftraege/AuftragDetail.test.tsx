import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Auftrag } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { freigabenFixture } from '../test/fixtures';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import AuftragDetail, { type AuftragDetailProps } from './AuftragDetail';

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
  }: {
    punkt: { lat: number; lon: number } | null;
    etikett: string;
  }) => (
    <div data-testid="kartenausschnitt">
      {etikett}: {punkt ? `${punkt.lat}, ${punkt.lon}` : 'Nicht verortet'}
    </div>
  ),
}));

const empfaenger = (id: number, name: string, quittiert_at: string | null) => ({
  id,
  auftrag_id: 31,
  empfaenger_typ: 'abschnitt' as const,
  abschnitt_id: id,
  snap_anzeige: name,
  quittiert_at,
  quittiert_von_id: quittiert_at ? 1 : null,
});

const auftrag = (over: Partial<Auftrag> = {}): Auftrag =>
  ({
    id: 31,
    einsatz_id: 5,
    lfd_nr: 4,
    auftrag_text: 'Wasserversorgung von Hydrant H12 aufbauen',
    absicht: 'Löschwasser für Abschnitt 2',
    lage: null,
    ort: null,
    zeit: null,
    mittel: '2× B-Schlauch',
    verbindung: null,
    sicherheit: null,
    prioritaet: 'dringend',
    richtung: 'intern',
    frist_at: null,
    erteilt_at: '2026-06-11 08:13:00',
    in_arbeit_at: null,
    vollzugsmeldung: null,
    abgenommen_at: null,
    abgenommen_von_id: null,
    etb_anordnung_id: 5,
    quell_etb_eintrag_id: 17,
    erstellt_von_id: 1,
    erstellt_at: '2026-06-11 08:14:00',
    vollzug_status: 'offen',
    vollzogen_at: null,
    vollzogen_von_id: null,
    empfaenger_anzahl: 2,
    quittiert_anzahl: 1,
    ist_ueberfaellig: false,
    bearbeitungsstatus: 'offen',
    empfaenger: [
      empfaenger(1, '2. Zug', '2026-06-11 08:15:00'),
      empfaenger(2, 'Logistiktrupp', null),
    ],
    ...over,
  }) as Auftrag;

function renderDetail(props: Partial<AuftragDetailProps> & { auftrag: Auftrag }) {
  return render(
    <QueryClientProvider client={neuerQueryClient()}>
      <AntApp>
        <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
          <MemoryRouter>
            <AuftragDetail einsatzId={5} darfSchreiben {...props} />
          </MemoryRouter>
        </AnzeigeKonventionenProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('AuftragDetail (Spec `auftraege-befehle`)', () => {
  it('zeigt Kennung, ganzen Text, Empfänger, Schema offen und den ETB-Sprung', () => {
    renderDetail({ auftrag: auftrag() });
    expect(screen.getByRole('heading', { name: /Auftrag #4/ })).toBeInTheDocument();
    expect(screen.getByText('Wasserversorgung von Hydrant H12 aufbauen')).toBeInTheDocument();
    expect(screen.getByText('Quittung offen:')).toBeInTheDocument();
    // Das Schema steht offen, kein Klappteil.
    expect(screen.getByText('Löschwasser für Abschnitt 2')).toBeVisible();
    expect(screen.queryByText('Auftragsdetails (Schema)')).toBeNull();
    expect(screen.getByRole('link', { name: /ETB-Eintrag/ })).toHaveAttribute(
      'href',
      expect.stringContaining('eintrag=17'),
    );
  });

  it('Quittieren im Detail ruft die Quittung für genau diesen Empfänger', async () => {
    const onQuittieren = vi.fn();
    renderDetail({ auftrag: auftrag(), onQuittieren });
    fireEvent.click(screen.getByRole('button', { name: 'Empfang für Logistiktrupp quittieren' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
    expect(onQuittieren).toHaveBeenCalledWith(31, 2);
  });

  it('die Handlungen stehen direkt unter dem Text, vor den Empfängern', () => {
    renderDetail({ auftrag: auftrag(), onInArbeit: vi.fn(), onVollzugMelden: vi.fn() });
    const beginnen = screen.getByRole('button', { name: 'Bearbeitung beginnen' });
    const empf = screen.getByText('Quittung offen:');
    expect(beginnen.compareDocumentPosition(empf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vollzug melden' })).toBeInTheDocument();
  });

  it('ohne Schreibrecht stehen Empfänger und Verlauf, aber keine Handlung', () => {
    renderDetail({
      auftrag: auftrag(),
      darfSchreiben: false,
      onInArbeit: vi.fn(),
      onQuittieren: vi.fn(),
    });
    expect(screen.getByText('Quittung offen:')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verlauf' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('der Verlauf eines abgenommenen Auftrags steht in zeitlicher Folge', () => {
    renderDetail({
      auftrag: auftrag({
        bearbeitungsstatus: 'abgenommen',
        in_arbeit_at: '2026-06-11 08:20:00',
        vollzogen_at: '2026-06-11 09:05:00',
        abgenommen_at: '2026-06-11 09:10:00',
        vollzugsmeldung: 'Leitung steht',
        quittiert_anzahl: 2,
        empfaenger: [
          empfaenger(1, '2. Zug', '2026-06-11 08:15:00'),
          empfaenger(2, 'Logistiktrupp', '2026-06-11 08:16:00'),
        ],
      }),
    });
    const verlauf = screen.getByRole('list', { name: 'Verlauf' });
    const zeilen = within(verlauf)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(zeilen).toEqual([
      expect.stringMatching(/1013.*erteilt/),
      expect.stringMatching(/1015.*quittiert · 2\. Zug/),
      expect.stringMatching(/1016.*quittiert · Logistiktrupp/),
      expect.stringMatching(/1020.*in Bearbeitung/),
      expect.stringMatching(/1105.*vollzogen/),
      expect.stringMatching(/1110.*abgenommen/),
    ]);
    expect(screen.getByText(/Leitung steht/)).toBeInTheDocument();
  });

  it('der Grund einer abgelehnten Abnahme steht über den Handlungen, nicht als Toast', () => {
    renderDetail({
      auftrag: auftrag({ bearbeitungsstatus: 'vollzogen' }),
      onAbnehmen: vi.fn(),
      fehlerGrund: { fehler: new Error('Schon abgenommen'), fallback: 'Abnahme fehlgeschlagen' },
    });
    const grund = screen.getByText(/Schon abgenommen|Abnahme fehlgeschlagen/);
    const knopf = screen.getByRole('button', { name: 'Abnehmen' });
    expect(grund.compareDocumentPosition(knopf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('der Sprung „Druckansicht“ steht ohne Schreibrecht und auch am aufgehobenen Auftrag (LLH-1171)', () => {
    renderDetail({
      auftrag: auftrag({ bearbeitungsstatus: 'aufgehoben' }),
      darfSchreiben: false,
    });
    expect(screen.getByRole('link', { name: /Druckansicht/ })).toHaveAttribute(
      'href',
      '/einsaetze/5/auftraege/31/druck',
    );
  });

  it('entfallen sagt das Detail, dass der Auftrag nicht mehr in der Ansicht steht', () => {
    renderDetail({ auftrag: auftrag({ bearbeitungsstatus: 'abgenommen' }), entfallen: true });
    expect(screen.getByText('Nicht mehr in dieser Ansicht')).toBeInTheDocument();
  });

  describe('Ziel auf der Karte (LLH-1407)', () => {
    const verortet = () =>
      auftrag({ ort: 'Hydrant H12, Deichstraße', ort_lat: 53.54321, ort_lon: 9.98765 });

    it('ein verortetes Ziel steht als Ausschnitt unter dem Schema, mit Sprung zur Lagekarte am Punkt', async () => {
      renderDetail({ auftrag: verortet() });
      const ausschnitt = screen.getByTestId('kartenausschnitt');
      expect(ausschnitt).toHaveTextContent('Ziel: 53.54321, 9.98765');
      // Im Abschnitt „Schema“, nach dem Zieltext und vor dem Verlauf.
      expect(
        screen.getByText('Hydrant H12, Deichstraße').compareDocumentPosition(ausschnitt) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        ausschnitt.compareDocumentPosition(screen.getByRole('heading', { name: 'Verlauf' })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const sprung = await screen.findByRole('link', { name: /Auf Lagekarte zeigen/ });
      expect(sprung).toHaveAttribute(
        'href',
        `/einsaetze/5/lagekarte?zentrum=${encodeURIComponent('53.54321,9.98765')}`,
      );
    });

    it('ohne Koordinate weder Ausschnitt noch Sprung, der Zieltext steht im Schema', async () => {
      renderDetail({ auftrag: auftrag({ ort: 'Hydrant H12, Deichstraße' }) });
      expect(screen.getByText('Hydrant H12, Deichstraße')).toBeInTheDocument();
      expect(screen.queryByTestId('kartenausschnitt')).toBeNull();
      expect(screen.queryByText('Nicht verortet')).toBeNull();
      // Die Freigaben hätten Zeit zu laden; ein Sprung erscheint trotzdem nicht.
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole('link', { name: /Auf Lagekarte zeigen/ })).toBeNull();
    });

    it('ohne Lagekarten-Freigabe steht der Ausschnitt, aber kein Sprung', async () => {
      let abgefragt = false;
      server.use(
        http.get('/api/einsaetze/5/modul-freigaben', () => {
          abgefragt = true;
          return HttpResponse.json(
            freigabenFixture({ lagekarte: { zugriff: false, sichtbar: false } }),
          );
        }),
      );
      renderDetail({ auftrag: verortet() });
      expect(screen.getByTestId('kartenausschnitt')).toBeInTheDocument();
      await vi.waitFor(() => expect(abgefragt).toBe(true));
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole('link', { name: /Auf Lagekarte zeigen/ })).toBeNull();
    });
  });
});
