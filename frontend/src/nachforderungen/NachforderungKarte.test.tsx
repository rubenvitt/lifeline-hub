import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import type { Nachforderung } from '../api/types';
import NachforderungKarte, { type UebernahmePosten } from './NachforderungKarte';

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
  material_ids: [],
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

describe('NachforderungKarte — Material übernehmen (LLH-1226 D10)', () => {
  const eingetroffen = (over: Partial<Nachforderung> = {}) =>
    nf({
      art: 'Sandsäcke',
      bezeichnung: 'Sandsäcke Deich Nord',
      anzahl: 2000,
      status: 'eingetroffen',
      ist_offen: false,
      eingetroffen_at: '2026-06-12 09:30:00',
      ...over,
    });
  const sandsaecke: UebernahmePosten = {
    id: 7,
    bezeichnung: 'Sandsäcke',
    art: 'verbrauchsgut',
    menge: 1200,
    ausgegeben: 0,
    einheit_id: null,
    einsatz_fahrzeug_id: null,
    uhs_id: null,
    br_id: null,
    beendet_at: null,
  };

  function zeigeKarte(props: Partial<ComponentProps<typeof NachforderungKarte>>) {
    server.use(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([
          { id: 3, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null },
        ]),
      ),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    );
    return renderMitProviders(
      <NachforderungKarte nachforderung={eingetroffen()} ansicht="abgeschlossen" {...props} />,
    );
  }

  it('an der eingetroffenen Karte „Als Material übernehmen“, der Klick meldet die Nachforderung', async () => {
    const onMaterialUebernehmen = vi.fn();
    zeigeKarte({ darfSchreiben: true, onMaterialUebernehmen });
    await userEvent.click(screen.getByRole('button', { name: 'Als Material übernehmen' }));
    expect(onMaterialUebernehmen).toHaveBeenCalledWith(1);
  });

  it('mit übernommenem Posten „Weiteren Posten übernehmen“', () => {
    zeigeKarte({
      nachforderung: eingetroffen({ material_ids: [7] }),
      darfSchreiben: true,
      onMaterialUebernehmen: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Weiteren Posten übernehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Als Material übernehmen' })).toBeNull();
  });

  it('kein Knopf ohne Schreibrecht und nicht an einer offenen Nachforderung', () => {
    const { unmount } = zeigeKarte({ onMaterialUebernehmen: vi.fn() });
    expect(screen.queryByRole('button', { name: /übernehmen/ })).toBeNull();
    unmount();
    zeigeKarte({
      nachforderung: nf({ status: 'unterwegs' }),
      darfSchreiben: true,
      onMaterialUebernehmen: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /übernehmen/ })).toBeNull();
  });

  it('Material gesperrt: der Knopf steht gesperrt mit „Keine Berechtigung“, ein Klick öffnet nichts', async () => {
    const onMaterialUebernehmen = vi.fn();
    zeigeKarte({ darfSchreiben: true, materialGesperrt: true, onMaterialUebernehmen });
    const knopf = screen.getByRole('button', { name: 'Als Material übernehmen' });
    expect(knopf).toBeDisabled();
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
    expect(knopf).toHaveAccessibleDescription('Keine Berechtigung');
    await userEvent.click(knopf);
    expect(onMaterialUebernehmen).not.toHaveBeenCalled();
  });

  it('zeigt je Posten Bezeichnung, Menge und Ort, die übernommene Menge und den Sprung', async () => {
    zeigeKarte({
      nachforderung: eingetroffen({ material_ids: [7, 8] }),
      materialJeId: new Map([
        [7, sandsaecke],
        [8, { ...sandsaecke, id: 8, menge: 300, einheit_id: 3 }],
      ]),
    });
    expect(screen.getByText('Sandsäcke · 1200 · ohne Ort')).toBeInTheDocument();
    expect(await screen.findByText('Sandsäcke · 300 · Staffel A')).toBeInTheDocument();
    expect(screen.getByText('übernommen 1500 von 2000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Material/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/material',
    );
    expect(screen.queryByText(/Posten übernommen/)).toBeNull();
  });

  it('ein aus dem Einsatz genommener Posten steht mit seinem Zustand, ohne Anzahl kein Verhältnis', () => {
    zeigeKarte({
      nachforderung: eingetroffen({ anzahl: null, material_ids: [7] }),
      materialJeId: new Map([[7, { ...sandsaecke, beendet_at: '2026-06-12 10:00:00' }]]),
    });
    expect(screen.getByText('Sandsäcke · 1200 · aus dem Einsatz genommen')).toBeInTheDocument();
    expect(screen.queryByText(/übernommen \d+ von/)).toBeNull();
  });

  it('ohne Material-Freigabe nur die Zahl der Posten, keine Angaben', () => {
    zeigeKarte({ nachforderung: eingetroffen({ material_ids: [7, 8] }), materialJeId: null });
    expect(screen.getByText('2 Posten übernommen')).toBeInTheDocument();
    expect(screen.queryByText(/Sandsäcke ·/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Material/ })).toBeNull();
  });

  it('ein Posten: „1 Posten übernommen“', () => {
    zeigeKarte({ nachforderung: eingetroffen({ material_ids: [7] }) });
    expect(screen.getByText('1 Posten übernommen')).toBeInTheDocument();
  });

  it('Deeplink-Hervorhebung: die Karte trägt ihre Kennung und die Markierung', () => {
    const { container } = zeigeKarte({ hervorgehoben: true });
    const karte = container.querySelector('[data-nachforderung-id="1"]');
    expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
  });
});

/** LLH-1082 (design.md D7): der Stellenbezug steht als Zeile mit Sprung auf die Stelle. */
describe('NachforderungKarte — Stellenbezug (LLH-1082)', () => {
  const stellen = new Map([[8, { name: 'Turnhalle Ost', pfad: '/einsaetze/1/betreuung/8' }]]);

  it('„Für Betreuungsstelle Turnhalle Ost ↗“ führt auf die Stelle', () => {
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({ betreuungsstelle_id: 8 })}
        ansicht="offen"
        stellenJeId={stellen}
      />,
    );
    expect(screen.getByText(/Für Betreuungsstelle/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Turnhalle Ost/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/betreuung/8',
    );
  });

  it('unbekannte Stelle (Betreuung nicht freigegeben): ohne Namen und Sprung', () => {
    renderMitProviders(
      <NachforderungKarte nachforderung={nf({ betreuungsstelle_id: 9 })} ansicht="offen" />,
    );
    expect(screen.getByText('Für eine Betreuungsstelle')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Betreuungsstelle/ })).toBeNull();
  });

  it('ohne Bezug keine Zeile', () => {
    renderMitProviders(
      <NachforderungKarte nachforderung={nf()} ansicht="offen" stellenJeId={stellen} />,
    );
    expect(screen.queryByText(/Betreuungsstelle/)).toBeNull();
  });
});
