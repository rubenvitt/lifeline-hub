import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import type { Nachforderung } from '../api/types';
import NachforderungKarte from './NachforderungKarte';

const nf = (over: Partial<Nachforderung> = {}): Nachforderung => ({
  id: 1,
  einsatz_id: 1,
  art: 'RTW',
  bezeichnung: '2 RTW zur Verstärkung',
  anzahl: 2,
  adressat_kategorie: 'leitstelle',
  adressat_bezeichnung: null,
  begruendung: null,
  prioritaet: 'dringend',
  status: 'angefordert',
  zugesagt_at: null,
  unterwegs_at: null,
  eingetroffen_at: null,
  abgelehnt_at: null,
  abgelehnt_grund: null,
  angefordert_at: '2026-06-12 09:00:00',
  etb_nachforderung_id: 7,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  erstellt_von_name: null,
  ist_offen: true,
  ...over,
});

/** LFH-913 (Spec `zeiteingabe`): die Übergangszeiten stehen in der Anzeigezone. */
describe('NachforderungKarte — Zeiten in der Anzeigezone (LFH-913)', () => {
  mitProzessZone('UTC');

  function zeige(n: Nachforderung) {
    render(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <NachforderungKarte nachforderung={n} ansicht="abgeschlossen" />
      </AnzeigeKonventionenProvider>,
    );
  }

  it('Angefordert, Zugesagt, Unterwegs und Eingetroffen als Berliner Zeit', () => {
    zeige(
      nf({
        status: 'eingetroffen',
        ist_offen: false,
        zugesagt_at: '2026-06-12 09:10:00',
        unterwegs_at: '2026-06-12 09:20:00',
        eingetroffen_at: '2026-06-12 09:30:00',
      }),
    );
    expect(screen.getByText('Angefordert: 121100JUN2026')).toBeInTheDocument();
    expect(screen.getByText('Zugesagt: 121110JUN2026')).toBeInTheDocument();
    expect(screen.getByText('Unterwegs: 121120JUN2026')).toBeInTheDocument();
    expect(screen.getByText('Eingetroffen: 121130JUN2026')).toBeInTheDocument();
  });

  it('Ablehnung als Berliner Zeit', () => {
    zeige(nf({ status: 'abgelehnt', ist_offen: false, abgelehnt_at: '2026-06-12 09:40:00' }));
    expect(screen.getByText('Abgelehnt (121140JUN2026)')).toBeInTheDocument();
  });
});
