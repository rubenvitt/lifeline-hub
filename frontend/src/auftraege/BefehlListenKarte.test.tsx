import { render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import type { BefehlKopf } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import BefehlListenKarte from './BefehlListenKarte';

const befehlKopf = (over: Partial<BefehlKopf> = {}): BefehlKopf => ({
  id: 7,
  einsatz_id: 5,
  ersteller_id: 1,
  ersteller_name: 'Huber',
  erstellt_at: '2026-06-11 08:00:00',
  etb_eintrag_id: null,
  freigegeben_at: null,
  freigegeben_von_id: null,
  freigegeben_von_name: null,
  status: 'entwurf',
  titel: 'Befehl an 2. Zug',
  version: 1,
  vorgaenger_id: null,
  vorlage: 'befehl_lad',
  zeitstand: '2026-06-11 08:30:00',
  verteiler: [],
  is_quittierbar: false,
  ...over,
});

function renderKarte(b: BefehlKopf) {
  return render(
    <AntApp>
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <BefehlListenKarte
          befehl={b}
          gewaehlt={false}
          hervorgehoben={false}
          auswahl={{ onClick: vi.fn() }}
        />
      </AnzeigeKonventionenProvider>
    </AntApp>,
  );
}

describe('BefehlListenKarte (Spec `auftraege-befehle`, „Karte eines Befehls“)', () => {
  it('zeigt Zeitstand und Fassung in der Zeitspalte, Status, Schema, Titel und Ersteller', () => {
    const { container } = renderKarte(befehlKopf());
    const spalte = container.querySelector<HTMLElement>('[data-lfh="komm-karte-zeit"]')!;
    expect(spalte).toHaveTextContent('Stand');
    expect(spalte).toHaveTextContent('1030');
    expect(spalte).toHaveTextContent('v1');
    expect(screen.getByText('Entwurf')).toBeInTheDocument();
    expect(screen.getByText('Befehl LAD (vereinfacht)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Befehl v1: Befehl an 2. Zug' })).toBeInTheDocument();
    expect(screen.getByText(/Huber/)).toBeInTheDocument();
  });

  it('freigegeben nennt die Karte, wer wann freigegeben hat', () => {
    renderKarte(
      befehlKopf({
        status: 'freigegeben',
        freigegeben_at: '2026-06-11 08:40:00',
        freigegeben_von_name: 'Meier',
      }),
    );
    expect(screen.getByText('Freigegeben')).toBeInTheDocument();
    expect(screen.getByText(/freigegeben 111040 von Meier/)).toBeInTheDocument();
  });

  it('zwei Fassungen desselben Titels unterscheiden sich an der v-Nummer', () => {
    renderKarte(befehlKopf({ version: 2 }));
    expect(screen.getByRole('button', { name: 'Befehl v2: Befehl an 2. Zug' })).toBeInTheDocument();
  });

  it('trägt keinen Knopf außer dem Auswahlziel', () => {
    renderKarte(befehlKopf({ status: 'freigegeben' }));
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  describe('Verteiler und Quittungsstand (LLH-1173)', () => {
    const verteiler: BefehlKopf['verteiler'] = [
      {
        id: 1,
        empfaenger_typ: 'abschnitt',
        abschnitt_id: 3,
        snap_anzeige: 'EA Süd',
        quittiert_at: '2026-06-11 08:45:00',
      },
      { id: 2, empfaenger_typ: 'funktion', funktion: 's3', snap_anzeige: 'S3 Einsatz' },
    ];

    it('ein freigegebener Befehl nennt den Verteiler und zählt die Quittungen', () => {
      renderKarte(befehlKopf({ status: 'freigegeben', is_quittierbar: true, verteiler }));
      expect(screen.getByText('2 Empfänger · 1/2 quittiert')).toBeInTheDocument();
      expect(screen.getByText('EA Süd, S3 Einsatz')).toBeInTheDocument();
    });

    it('ein Entwurf nennt den Verteiler ohne Quittungsstand', () => {
      renderKarte(befehlKopf({ verteiler }));
      expect(screen.getByText('EA Süd, S3 Einsatz')).toBeInTheDocument();
      expect(screen.queryByText(/quittiert/)).toBeNull();
    });

    it('ohne Verteiler keine Zeile', () => {
      renderKarte(befehlKopf({ status: 'freigegeben' }));
      expect(screen.queryByText(/Empfänger/)).toBeNull();
    });
  });
});
