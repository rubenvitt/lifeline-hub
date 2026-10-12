import { render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Auftrag } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import AuftragListenKarte from './AuftragListenKarte';

const auftrag = (over: Partial<Auftrag> = {}): Auftrag =>
  ({
    id: 31,
    einsatz_id: 5,
    lfd_nr: 4,
    auftrag_text: 'Wasserversorgung von Hydrant H12 aufbauen',
    absicht: null,
    lage: null,
    ort: null,
    zeit: null,
    mittel: null,
    verbindung: null,
    sicherheit: null,
    prioritaet: 'sofort',
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
      {
        id: 1,
        auftrag_id: 31,
        abschnitt_id: 3,
        einheit_id: null,
        funktion: null,
        snap_anzeige: '2. Zug',
        quittiert_at: '2026-06-11 08:15:00',
        quittiert_von_id: 1,
        aktuelle_besetzung: null,
      },
      {
        id: 2,
        auftrag_id: 31,
        abschnitt_id: null,
        einheit_id: 9,
        funktion: null,
        snap_anzeige: 'Logistiktrupp',
        quittiert_at: null,
        quittiert_von_id: null,
        aktuelle_besetzung: null,
      },
    ],
    ...over,
  }) as Auftrag;

function renderKarte(a: Auftrag, extra: { gewaehlt?: boolean } = {}) {
  const onClick = vi.fn();
  const ergebnis = render(
    <AntApp>
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <MemoryRouter>
          <AuftragListenKarte
            auftrag={a}
            gewaehlt={extra.gewaehlt ?? false}
            hervorgehoben={false}
            auswahl={{ onClick }}
          />
        </MemoryRouter>
      </AnzeigeKonventionenProvider>
    </AntApp>,
  );
  return { ...ergebnis, onClick };
}

describe('AuftragListenKarte (Spec `auftraege-befehle`, „Karte eines Auftrags“)', () => {
  it('zeigt Erteilungszeit, Kennung, Phase, Empfänger und Quittungsstand', () => {
    const { container } = renderKarte(auftrag());
    const spalte = container.querySelector<HTMLElement>('[data-lfh="komm-karte-zeit"]')!;
    expect(spalte).toHaveTextContent('erteilt');
    expect(spalte).toHaveTextContent('1013');
    expect(spalte).toHaveTextContent('#4');
    expect(screen.getByText('Offen')).toBeInTheDocument();
    expect(screen.getByText(/2\. Zug/)).toBeInTheDocument();
    expect(screen.getByText(/Logistiktrupp/)).toBeInTheDocument();
    expect(screen.getByText('2 Empfänger · 1/2 quittiert')).toBeInTheDocument();
  });

  it('das Auswahlziel nennt Kennung und vollen Text und wählt beim Klick', () => {
    const { onClick } = renderKarte(auftrag());
    const ziel = screen.getByRole('button', {
      name: 'Auftrag #4: Wasserversorgung von Hydrant H12 aufbauen',
    });
    ziel.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('überfällig trägt die Karte Alarmkante und das Wort', () => {
    const { container } = renderKarte(auftrag({ ist_ueberfaellig: true }));
    expect(container.querySelector('[data-lfh="komm-karte"]')).toHaveAttribute(
      'data-alarm',
      'true',
    );
    expect(screen.getByText('Überfällig')).toBeInTheDocument();
  });

  it('der Auftragstext ist auf drei Zeilen geschnitten', () => {
    renderKarte(auftrag());
    const text = screen
      .getByText('Wasserversorgung von Hydrant H12 aufbauen')
      .closest<HTMLElement>('.ant-typography')!;
    // jsdom kennt `-webkit-line-clamp` nicht; geprüft wird der Rest des Schnitts.
    expect(text.style.overflow).toBe('hidden');
    expect(text.getAttribute('data-zeilen')).toBe('3');
  });

  it('trägt keinen Knopf außer dem Auswahlziel und keinen ETB-Sprung', () => {
    renderKarte(auftrag(), { gewaehlt: true });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /ETB-Eintrag/ })).toBeNull();
    expect(screen.queryByText('Quittung offen:')).toBeNull();
  });

  it('gewählt steht die Karte auf der Auswahlfläche', () => {
    const { container } = renderKarte(auftrag(), { gewaehlt: true });
    expect(container.querySelector('[data-lfh="komm-karte"]')).toHaveAttribute(
      'data-gewaehlt',
      'true',
    );
  });
});
