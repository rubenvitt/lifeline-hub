import { render, screen, within } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Auftrag } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import AuftragKarte from './AuftragKarte';

/**
 * Zeitspalte der Auftragskarte (LFH-972): sie zeigt die ERTEILUNGSZEIT wie der Überblick, nicht
 * den Erfassungszeitpunkt. Ein über Funk erteilter, nachträglich erfasster Auftrag trüge sonst auf
 * beiden Seiten zwei verschiedene Uhrzeiten.
 *
 * Die Zone steht ausdrücklich: ohne sie gälte die Maschinenzone, und der Test hinge an `TZ`.
 */

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 31,
  einsatz_id: 5,
  lfd_nr: 9,
  auftrag_text: 'Stromerzeuger 8 kVA bereitstellen',
  absicht: null,
  lage: null,
  ort: null,
  zeit: null,
  mittel: null,
  verbindung: null,
  sicherheit: null,
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  // Mündlich um 22:01 Ortszeit erteilt, erst um 23:26 erfasst (Sommerzeit, UTC+2).
  erteilt_at: '2026-06-11 20:01:00',
  in_arbeit_at: null,
  vollzugsmeldung: null,
  abgenommen_at: null,
  abgenommen_von_id: null,
  etb_anordnung_id: 5,
  quell_etb_eintrag_id: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-11 21:26:00',
  vollzug_status: 'offen',
  vollzogen_at: null,
  vollzogen_von_id: null,
  empfaenger_anzahl: 0,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  empfaenger: [],
  ...over,
});

function renderKarte(a: Auftrag) {
  return render(
    <AntApp>
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <MemoryRouter>
          <AuftragKarte auftrag={a} einsatzId={5} />
        </MemoryRouter>
      </AnzeigeKonventionenProvider>
    </AntApp>,
  );
}

describe('AuftragKarte — Erteilungszeit (LFH-972)', () => {
  it('zeigt die Erteilungszeit, nicht den Erfassungszeitpunkt, und beschriftet sie sichtbar', () => {
    const { container } = renderKarte(auftrag());
    const spalte = container.querySelector<HTMLElement>('[data-lfh="komm-karte-zeit"]')!;
    expect(within(spalte).getByText('2201')).toBeInTheDocument();
    expect(within(spalte).queryByText('2326')).toBeNull();
    // Die Beschriftung steht im Text, nicht nur als Tooltip: auf Touch gibt es kein Hover.
    expect(within(spalte).getByText('erteilt')).toBeVisible();
  });

  it('trägt im Klappkopf „Auftragsdetails", nicht „Befehlsdetails"', () => {
    renderKarte(auftrag({ ort: 'Deichkrone Süd' }));
    expect(screen.getByText('Auftragsdetails (Schema)')).toBeInTheDocument();
    expect(screen.queryByText(/Befehlsdetails/)).toBeNull();
  });
});
