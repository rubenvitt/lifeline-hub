import { describe, expect, it, vi } from 'vitest';
import { useState, type ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { ConfigProvider } from 'antd';
import { renderMitProviders } from '../test/utils';
import { antdToken, farbenHell, type Dichte } from '../theme/tokens';
import { server } from '../test/server';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import type { Nachforderung } from '../api/types';
import NachforderungKarte, {
  type KartenFormular,
  type UebernahmePosten,
} from './NachforderungKarte';

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
  einheit_ids: [],
  einheit_ids_am_raum: [],
  zusage_rufnamen: [],
  ...over,
});

/** LFH-913 (Spec `zeiteingabe`): die Übergangszeiten stehen in der Anzeigezone. */
describe('NachforderungKarte — Zeiten in der Anzeigezone (LFH-913)', () => {
  mitProzessZone('UTC');

  function zeige(n: Nachforderung) {
    render(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <NachforderungKarte nachforderung={n} />
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
    expect(screen.getByText('Angefordert: 121100jun26')).toBeInTheDocument();
    expect(screen.getByText('Zugesagt: 121110jun26')).toBeInTheDocument();
    expect(screen.getByText('Unterwegs: 121120jun26')).toBeInTheDocument();
    expect(screen.getByText('Eingetroffen: 121130jun26')).toBeInTheDocument();
  });

  it('Ablehnung als Berliner Zeit', () => {
    zeige(nf({ status: 'abgelehnt', ist_offen: false, abgelehnt_at: '2026-06-12 09:40:00' }));
    expect(screen.getByText('Abgelehnt (121140jun26)')).toBeInTheDocument();
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
    return renderMitProviders(<NachforderungKarte nachforderung={eingetroffen()} {...props} />);
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

  // LLH-1259 D5: neben der Übernahme der zweite Weg für schon von Hand erfasstes Material.
  it('„Erfassten Posten zuordnen …“ neben der Übernahme, der Klick meldet die Nachforderung', async () => {
    const onPostenZuordnen = vi.fn();
    const { unmount } = zeigeKarte({
      darfSchreiben: true,
      onMaterialUebernehmen: vi.fn(),
      onPostenZuordnen,
    });
    expect(screen.getByRole('button', { name: 'Als Material übernehmen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erfassten Posten zuordnen …' }));
    expect(onPostenZuordnen).toHaveBeenCalledWith(1);
    unmount();
    // Auch mit übernommenem Posten (dann als Ergänzung), nie ohne Schreibrecht oder bei Sperre.
    const zweite = zeigeKarte({
      nachforderung: eingetroffen({ material_ids: [7] }),
      darfSchreiben: true,
      onPostenZuordnen: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Erfassten Posten zuordnen …' })).toBeInTheDocument();
    zweite.unmount();
    const dritte = zeigeKarte({ onPostenZuordnen: vi.fn() });
    expect(screen.queryByRole('button', { name: /zuordnen/ })).toBeNull();
    dritte.unmount();
    zeigeKarte({ darfSchreiben: true, materialGesperrt: true, onPostenZuordnen: vi.fn() });
    expect(screen.queryByRole('button', { name: /zuordnen/ })).toBeNull();
  });

  it('keine Zuordnung, sobald eine Einheit übernommen ist (Material und Einheit schließen sich aus)', () => {
    zeigeKarte({
      nachforderung: eingetroffen({ einheit_ids: [11] }),
      darfSchreiben: true,
      onPostenZuordnen: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /zuordnen/ })).toBeNull();
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

describe('NachforderungKarte — Als Einheit übernehmen (LLH-1383 D9)', () => {
  const rtw = (over: Partial<Nachforderung> = {}) =>
    nf({
      art: 'RTW',
      anzahl: 2,
      status: 'eingetroffen',
      ist_offen: false,
      eingetroffen_at: '2026-06-12 09:30:00',
      ...over,
    });
  const zeige = (props: Partial<ComponentProps<typeof NachforderungKarte>>) =>
    renderMitProviders(<NachforderungKarte nachforderung={rtw()} {...props} />);

  it('an der eingetroffenen Karte neben dem Material, der Klick meldet die Nachforderung', async () => {
    const onEinheitUebernehmen = vi.fn();
    zeige({ darfSchreiben: true, onEinheitUebernehmen, onMaterialUebernehmen: vi.fn() });
    expect(screen.getByRole('button', { name: 'Als Material übernehmen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Als Einheit übernehmen' }));
    expect(onEinheitUebernehmen).toHaveBeenCalledWith(1);
  });

  it('Material und Einheit schließen sich aus', () => {
    const { unmount } = zeige({
      nachforderung: rtw({ anzahl: 3, einheit_ids: [11] }),
      darfSchreiben: true,
      onEinheitUebernehmen: vi.fn(),
      onMaterialUebernehmen: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Weitere Einheit übernehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Material|Posten/ })).toBeNull();
    unmount();
    zeige({
      nachforderung: rtw({ material_ids: [7] }),
      darfSchreiben: true,
      onEinheitUebernehmen: vi.fn(),
      onMaterialUebernehmen: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /Einheit/ })).toBeNull();
  });

  it('ausgeschöpfte Anzahl: kein Knopf mehr', () => {
    zeige({
      nachforderung: rtw({ einheit_ids: [11, 12] }),
      darfSchreiben: true,
      onEinheitUebernehmen: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /Einheit/ })).toBeNull();
  });

  it('gesperrt mit „Keine Berechtigung“ daneben', () => {
    zeige({ darfSchreiben: true, einheitGesperrt: true, onEinheitUebernehmen: vi.fn() });
    const knopf = screen.getByRole('button', { name: 'Als Einheit übernehmen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('Keine Berechtigung');
  });

  it('nennt die übernommenen Einheiten mit Sprung, unbekannte zählen als „weitere“', () => {
    zeige({
      nachforderung: rtw({ anzahl: 3, einheit_ids: [11, 12, 13] }),
      einheitenJeId: new Map([
        [11, { id: 11, name: 'Rettung', funkrufname: '83-1' }],
        [12, { id: 12, name: '83-2', funkrufname: null }],
      ]),
    });
    const zeile = screen.getByText(/Als Einheit übernommen/);
    expect(zeile).toHaveTextContent('Als Einheit übernommen: 83-1 ↗, 83-2 ↗, 1 weitere');
    expect(within(zeile).getByRole('link', { name: '83-1' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/11',
    );
  });

  /**
   * LLH-1410: in der schmalen Board-Spalte stand jeder Link als unteilbarer Block von Steuerhöhe
   * auf eigener Zeile. In `kompakt` fließen sie im Satz; ab dem Tablet behalten sie den Boden.
   */
  function einheitenLinks(dichte: Dichte) {
    const { unmount } = renderMitProviders(
      <ConfigProvider theme={{ token: antdToken(farbenHell, dichte) }}>
        <NachforderungKarte
          nachforderung={rtw({ einheit_ids: [11, 12] })}
          einheitenJeId={
            new Map([
              [11, { id: 11, name: 'Nachbarstadt 85-1', funkrufname: null }],
              [12, { id: 12, name: 'Nachbarstadt 85-2', funkrufname: null }],
            ])
          }
        />
      </ConfigProvider>,
    );
    const zeile = screen.getByText(/Als Einheit übernommen/);
    const stile = within(zeile)
      .getAllByRole('link')
      .map((a) => ({ display: a.style.display, minHeight: a.style.minHeight }));
    const flex = zeile.style.display;
    unmount();
    return { stile, flex };
  }

  it('kompakt: die Links fließen im Satz, ohne Steuerboden (LLH-1410)', () => {
    const { stile, flex } = einheitenLinks('kompakt');
    expect(stile).toHaveLength(2);
    for (const s of stile) expect(s).toEqual({ display: 'inline', minHeight: '' });
    expect(flex).not.toBe('flex');
  });

  it('Handschuh: die Links behalten den Boden 72 und stehen in Reihen (LLH-1410)', () => {
    const { stile, flex } = einheitenLinks('handschuh');
    for (const s of stile) expect(s.minHeight).toBe('72px');
    expect(flex).toBe('flex');
  });

  it('„Wer“ der Zusage schlägt die Einheiten des Einsatzes vor (D10)', async () => {
    zeige({
      nachforderung: nf(),
      darfSchreiben: true,
      formular: 'zusage',
      onFormular: vi.fn(),
      onZusage: vi.fn().mockResolvedValue(undefined),
      werVorschlaege: ['Florian 2', 'Florian 10'],
    });
    await userEvent.click(screen.getByRole('combobox', { name: 'Wer' }));
    expect(await screen.findByRole('option', { name: 'Florian 10' })).toBeInTheDocument();
  });

  it('ohne bekannte Einheiten nur die Zahl', () => {
    zeige({ nachforderung: rtw({ einheit_ids: [11, 12] }), einheitenJeId: null });
    expect(screen.getByText('2 Einheiten übernommen')).toBeInTheDocument();
  });

  /** LLH-1395: vor dem Eintreffen verknüpft nur die Buchung am Raum (LLH-1387 D4). */
  it('unterwegs mit am Raum gebuchter Einheit: „am Raum eingetroffen“, nicht „übernommen“', () => {
    const unterwegs = rtw({
      status: 'unterwegs',
      ist_offen: true,
      eingetroffen_at: null,
      einheit_ids: [11],
    });
    const { unmount } = zeige({
      nachforderung: unterwegs,
      einheitenJeId: new Map([[11, { id: 11, name: 'Rettung', funkrufname: '83-1' }]]),
    });
    expect(screen.getByText(/Am Raum eingetroffen/)).toHaveTextContent(
      'Am Raum eingetroffen: 83-1 ↗',
    );
    expect(screen.queryByText(/übernommen/)).toBeNull();
    unmount();
    zeige({ nachforderung: { ...unterwegs, einheit_ids: [11, 12] }, einheitenJeId: null });
    expect(screen.getByText('2 Einheiten am Raum eingetroffen')).toBeInTheDocument();
  });

  /** LLH-1445: nach dem Eintreffen trennt die Karte die Wege je Einheit. */
  it('eingetroffen mit beiden Wegen: zwei Zeilen, je mit ihren Sprüngen', () => {
    zeige({
      nachforderung: rtw({ einheit_ids: [11, 12], einheit_ids_am_raum: [11] }),
      einheitenJeId: new Map([
        [11, { id: 11, name: 'Rettung', funkrufname: '83-1' }],
        [12, { id: 12, name: '83-2', funkrufname: null }],
      ]),
    });
    const amRaum = screen.getByText(/Am Raum eingetroffen/);
    expect(amRaum).toHaveTextContent(/^Am Raum eingetroffen: 83-1 ↗$/);
    expect(within(amRaum).getByRole('link', { name: '83-1' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/11',
    );
    expect(screen.getByText(/Als Einheit übernommen/)).toHaveTextContent(
      /^Als Einheit übernommen: 83-2 ↗$/,
    );
  });

  it('eingetroffen mit beiden Wegen ohne bekannte Einheiten: je Weg die Zahl', () => {
    zeige({
      nachforderung: rtw({ einheit_ids: [11, 12], einheit_ids_am_raum: [11] }),
      einheitenJeId: null,
    });
    // Jede Zahl steht auf eigener Zeile, nicht inline aneinander (beide im selben Space-Item).
    expect(screen.getByText('1 Einheit am Raum eingetroffen')).toHaveStyle({ display: 'block' });
    expect(screen.getByText('1 Einheit übernommen')).toHaveStyle({ display: 'block' });
  });

  it('eine unbekannte Einheit zählt in ihrer Gruppe als „weitere“', () => {
    zeige({
      nachforderung: rtw({ anzahl: 3, einheit_ids: [11, 12, 13], einheit_ids_am_raum: [11, 13] }),
      einheitenJeId: new Map([
        [11, { id: 11, name: '83-1', funkrufname: null }],
        [12, { id: 12, name: '83-2', funkrufname: null }],
      ]),
    });
    expect(screen.getByText(/Am Raum eingetroffen/)).toHaveTextContent(
      'Am Raum eingetroffen: 83-1 ↗, 1 weitere',
    );
    expect(screen.getByText(/Als Einheit übernommen/)).toHaveTextContent(
      /^Als Einheit übernommen: 83-2 ↗$/,
    );
  });

  it('eine vor LLH-1445 am Raum verknüpfte Einheit bleibt nach dem Eintreffen „übernommen“', () => {
    zeige({
      nachforderung: rtw({ einheit_ids: [11], einheit_ids_am_raum: [] }),
      einheitenJeId: new Map([[11, { id: 11, name: '83-1', funkrufname: null }]]),
    });
    expect(screen.getByText(/Als Einheit übernommen/)).toHaveTextContent(
      'Als Einheit übernommen: 83-1 ↗',
    );
    expect(screen.queryByText(/Am Raum/)).toBeNull();
  });
});

/** LLH-1082 (design.md D7): der Stellenbezug steht als Zeile mit Sprung auf die Stelle. */
describe('NachforderungKarte — Stellenbezug (LLH-1082)', () => {
  const stellen = new Map([[8, { name: 'Turnhalle Ost', pfad: '/einsaetze/1/betreuung/8' }]]);

  it('„Für Betreuungsstelle Turnhalle Ost ↗“ führt auf die Stelle', () => {
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({ betreuungsstelle_id: 8 })}

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
    renderMitProviders(<NachforderungKarte nachforderung={nf({ betreuungsstelle_id: 9 })} />);
    expect(screen.getByText('Für eine Betreuungsstelle')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Betreuungsstelle/ })).toBeNull();
  });

  it('ohne Bezug keine Zeile', () => {
    renderMitProviders(<NachforderungKarte nachforderung={nf()} stellenJeId={stellen} />);
    expect(screen.queryByText(/Betreuungsstelle/)).toBeNull();
  });
});

/** LLH-1078: die kompakte Karte im Board. */
describe('NachforderungKarte — im Board (LLH-1078)', () => {
  it('in ihrer Spalte ohne Statusetikett, mit Alter und der Handlung als Knopf', async () => {
    const onStatus = vi.fn();
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({ angefordert_at: '2026-06-12 09:00:00' })}
        spaltenStufe="angefordert"
        jetzt={Date.UTC(2026, 5, 12, 9, 25)}
        darfSchreiben
        onStatus={onStatus}
        onAblehnen={vi.fn()}
      />,
    );
    expect(screen.queryByText('Angefordert', { exact: true })).toBeNull();
    expect(screen.getByText('vor 25 min')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    expect(onStatus).toHaveBeenCalledWith(1, 'zugesagt');
    // Ablehnen steht im ⋮-Menü (LLH-1097 D10), nicht in der Reihe.
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Aktionen zu Nachforderung 2× RTW — 2 RTW zur Verstärkung',
      }),
    ).toBeInTheDocument();
  });

  it('eine gehaltene Karte, die schon weiter ist, nennt ihre neue Stufe', () => {
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({ status: 'zugesagt', zugesagt_at: '2026-06-12 09:10:00' })}
        spaltenStufe="angefordert"
      />,
    );
    expect(screen.getByText('Zugesagt', { exact: true })).toBeInTheDocument();
  });

  it('ohne Schreibrecht keine Knöpfe', () => {
    renderMitProviders(
      <NachforderungKarte nachforderung={nf()} spaltenStufe="angefordert" onStatus={vi.fn()} />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

/** LLH-1089 (design.md D10): Ziel und Bedarfszeit an der Karte, Details optional. */
describe('NachforderungKarte — Ziel und Bedarfszeit (LLH-1089)', () => {
  const namen = {
    raeume: new Map([[4, 'BR Nord']]),
    abschnitte: new Map([[7, 'EA Deich']]),
  };
  const ziel = () => document.querySelector('[data-lfh="nachforderung-ziel"]');

  it('nennt den Raum mit Namen, ohne Namen „→ Bereitstellungsraum“', () => {
    const { unmount } = renderMitProviders(
      <NachforderungKarte nachforderung={nf({ ziel_br_id: 4 })} zielNamen={namen} />,
    );
    expect(ziel()).toHaveTextContent('→ BR Nord');
    unmount();
    renderMitProviders(<NachforderungKarte nachforderung={nf({ ziel_br_id: 4 })} />);
    expect(ziel()).toHaveTextContent('→ Bereitstellungsraum');
  });

  it('Abschnitt und Freitext; ohne Ziel keine Zeile', () => {
    const { unmount } = renderMitProviders(
      <NachforderungKarte nachforderung={nf({ ziel_abschnitt_id: 7 })} zielNamen={namen} />,
    );
    expect(ziel()).toHaveTextContent('→ EA Deich');
    unmount();
    const zwei = renderMitProviders(
      <NachforderungKarte nachforderung={nf({ ziel_text: 'Lotsenpunkt Feuerwache' })} />,
    );
    expect(ziel()).toHaveTextContent('→ Lotsenpunkt Feuerwache');
    zwei.unmount();
    renderMitProviders(<NachforderungKarte nachforderung={nf()} zielNamen={namen} />);
    expect(ziel()).toBeNull();
  });

  it('ohne Details steht nur „2× RTW“, mit Bedarfszeit die Zeile „Benötigt bis“', () => {
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({ bezeichnung: undefined, benoetigt_bis: '2026-06-12 13:30:00' })}
      />,
    );
    expect(screen.getByText('2× RTW')).toBeInTheDocument();
    expect(screen.queryByText('2 RTW zur Verstärkung')).toBeNull();
    expect(screen.getByText(/^Benötigt bis: /)).toBeInTheDocument();
  });
});

/** LLH-1097 (Teil a): Zusage, Anzeige, ⋮-Menü und Bearbeiten an der Karte. */
describe('NachforderungKarte — Zusage und Menü (LLH-1097)', () => {
  /** Die Karte mit dem Formularzustand, wie die Seite ihn hält. */
  function MitFormular(props: Omit<ComponentProps<typeof NachforderungKarte>, 'formular'>) {
    const [formular, setFormular] = useState<KartenFormular | null>(null);
    return (
      <NachforderungKarte
        {...props}
        formular={formular}
        onFormular={(_id, art) => setFormular(art)}
      />
    );
  }

  it('„Zusage erfassen“ öffnet das Formular an der Karte, Vorgabe die angeforderte Menge', async () => {
    const onZusage = vi.fn().mockResolvedValue(undefined);
    const onStatus = vi.fn();
    renderMitProviders(
      <MitFormular
        nachforderung={nf()}
        spaltenStufe="angefordert"
        darfSchreiben
        onStatus={onStatus}
        onZusage={onZusage}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    const formular = screen.getByRole('region', {
      name: 'Zusage zu 2× RTW — 2 RTW zur Verstärkung',
    });
    expect(within(formular).getByRole('spinbutton', { name: 'Zugesagt' })).toHaveValue('2');
    // Der Öffner ist weg: genau ein Knopf dieses Namens, der Absendeknopf.
    expect(screen.getAllByRole('button', { name: 'Zusage erfassen' })).toHaveLength(1);
    const menge = within(formular).getByRole('spinbutton', { name: 'Zugesagt' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '1');
    await userEvent.type(within(formular).getByRole('combobox', { name: 'Wer' }), '83-1{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    expect(onZusage).toHaveBeenCalledWith(1, { anzahl: 1, rufnamen: ['83-1'] });
    expect(onStatus).not.toHaveBeenCalled();
    // Nach dem Erfassen schließt das Formular.
    expect(await screen.findByRole('button', { name: 'Zusage erfassen' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Zusage zu/ })).toBeNull();
  });

  it('Enter im Mengenfeld sendet die Zusage ohne weitere Angaben', async () => {
    const onZusage = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <MitFormular
        nachforderung={nf()}
        spaltenStufe="angefordert"
        darfSchreiben
        onZusage={onZusage}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Zugesagt' }), '{Enter}');
    expect(onZusage).toHaveBeenCalledWith(1, { anzahl: 2 });
  });

  it('mehr zugesagt als angefordert sendet nicht', async () => {
    const onZusage = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <MitFormular
        nachforderung={nf()}
        spaltenStufe="angefordert"
        darfSchreiben
        onZusage={onZusage}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    const menge = screen.getByRole('spinbutton', { name: 'Zugesagt' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Zusage erfassen' }));
    expect(await screen.findByText('Höchstens 2 angefordert')).toBeInTheDocument();
    expect(onZusage).not.toHaveBeenCalled();
  });

  it('zeigt Teilung, Wer, das erwartete Eintreffen und „überfällig“', () => {
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({
          status: 'zugesagt',
          anzahl: 1,
          anzahl_angefordert: 2,
          zusage_rufnamen: ['83-1'],
          zugesagt_at: '2026-06-12 09:10:00',
          eintreffen_erwartet_at: '2026-06-12 09:30:00',
        })}
        spaltenStufe="zugesagt"
        jetzt={Date.UTC(2026, 5, 12, 9, 45)}
      />,
    );
    expect(screen.getByText('1 von 2 zugesagt')).toBeInTheDocument();
    expect(screen.getByText('Wer: 83-1')).toBeInTheDocument();
    expect(screen.getByText(/^Eintreffen erwartet: /)).toBeInTheDocument();
    const chip = screen.getByText('überfällig').closest('[data-lfh="status-chip"]');
    expect(chip).toHaveAttribute('data-ton', 'achtung');
  });

  it('vor dem erwarteten Eintreffen kein „überfällig“; die Restposition nennt sich', () => {
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({
          status: 'zugesagt',
          teilung_aus_id: 3,
          eintreffen_erwartet_at: '2026-06-12 10:30:00',
        })}
        spaltenStufe="zugesagt"
        jetzt={Date.UTC(2026, 5, 12, 9, 45)}
      />,
    );
    expect(screen.queryByText('überfällig')).toBeNull();
    expect(screen.getByText('Rest einer Teilzusage')).toBeInTheDocument();
  });

  it('das ⋮-Menü: Bearbeiten, dann Zurückziehen und Ablehnen hinter dem Trenner', async () => {
    const onZurueckziehen = vi.fn();
    const onAblehnen = vi.fn();
    renderMitProviders(
      <MitFormular
        nachforderung={nf({ bezeichnung: null })}
        spaltenStufe="angefordert"
        darfSchreiben
        onStatus={vi.fn()}
        onZusage={vi.fn()}
        onBearbeiten={vi.fn()}
        onZurueckziehen={onZurueckziehen}
        onAblehnen={onAblehnen}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Nachforderung 2× RTW' }));
    const eintraege = (await screen.findAllByRole('menuitem')).map((e) => e.textContent);
    expect(eintraege).toEqual(['Bearbeiten', 'Zurückziehen', 'Ablehnen']);
    expect(document.querySelectorAll('.ant-dropdown-menu-item-danger')).toHaveLength(2);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zurückziehen' }));
    expect(onZurueckziehen).toHaveBeenCalledWith(1);
  });

  /**
   * LLH-1395: mit verknüpfter Einheit lehnt der Server Zurückziehen und Ablehnen mit 422 ab
   * (LLH-1387 D5). Beide stehen gesperrt mit dem Grund im Eintrag, ein Klick meldet nichts.
   */
  it('mit verknüpfter Einheit: Zurückziehen und Ablehnen gesperrt mit Grund', async () => {
    const onZurueckziehen = vi.fn();
    const onAblehnen = vi.fn();
    renderMitProviders(
      <MitFormular
        nachforderung={nf({ bezeichnung: null, status: 'unterwegs', einheit_ids: [11] })}
        spaltenStufe="unterwegs"
        darfSchreiben
        onStatus={vi.fn()}
        onZusage={vi.fn()}
        onBearbeiten={vi.fn()}
        onZurueckziehen={onZurueckziehen}
        onAblehnen={onAblehnen}
      />,
    );
    // Vorwärts bleibt offen.
    expect(screen.getByRole('button', { name: 'Eintreffen melden' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Nachforderung 2× RTW' }));
    const eintraege = await screen.findAllByRole('menuitem');
    expect(eintraege.map((e) => e.textContent)).toEqual([
      'Bearbeiten',
      'Zurückziehen (Einheiten verknüpft)',
      'Ablehnen (Einheiten verknüpft)',
    ]);
    expect(eintraege[1]).toHaveAttribute('aria-disabled', 'true');
    expect(eintraege[2]).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(eintraege[1]);
    await userEvent.click(eintraege[2]);
    expect(onZurueckziehen).not.toHaveBeenCalled();
    expect(onAblehnen).not.toHaveBeenCalled();
  });

  it('Bearbeiten sendet nur Geändertes; unverändert schließt ohne Anfrage', async () => {
    const onBearbeiten = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <MitFormular
        nachforderung={nf({ bezeichnung: null })}
        spaltenStufe="angefordert"
        darfSchreiben
        onBearbeiten={onBearbeiten}
      />,
    );
    const oeffne = async () => {
      await userEvent.click(
        screen.getByRole('button', { name: 'Aktionen zu Nachforderung 2× RTW' }),
      );
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Bearbeiten' }));
    };
    await oeffne();
    const formular = screen.getByRole('region', { name: '2× RTW bearbeiten' });
    // Wer und Eintreffen gehören zur Zusage: in angefordert nicht da.
    expect(within(formular).queryByRole('combobox', { name: 'Wer' })).toBeNull();
    await userEvent.click(within(formular).getByRole('button', { name: 'Änderung speichern' }));
    expect(onBearbeiten).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '2× RTW bearbeiten' })).toBeNull();

    await oeffne();
    const anzahl = screen.getByRole('spinbutton', { name: 'Anzahl' });
    await userEvent.clear(anzahl);
    await userEvent.type(anzahl, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Änderung speichern' }));
    expect(onBearbeiten).toHaveBeenCalledWith(1, { anzahl: 3 });
  });

  /** LLH-1395: die Anzahl fällt nicht unter die verknüpften Einheiten (LLH-1387 D5, sonst 422). */
  it('Bearbeiten: Anzahl unter den verknüpften Einheiten sendet nicht', async () => {
    const onBearbeiten = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <MitFormular
        nachforderung={nf({
          bezeichnung: null,
          anzahl: 3,
          status: 'unterwegs',
          einheit_ids: [11, 12],
        })}
        spaltenStufe="unterwegs"
        darfSchreiben
        onBearbeiten={onBearbeiten}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Nachforderung 3× RTW' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Bearbeiten' }));
    const anzahl = screen.getByRole('spinbutton', { name: 'Anzahl' });
    await userEvent.clear(anzahl);
    await userEvent.type(anzahl, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Änderung speichern' }));
    expect(
      await screen.findByText('Mindestens 2: so viele Einheiten sind verknüpft'),
    ).toBeInTheDocument();
    expect(onBearbeiten).not.toHaveBeenCalled();
    await userEvent.clear(anzahl);
    await userEvent.type(anzahl, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Änderung speichern' }));
    expect(onBearbeiten).toHaveBeenCalledWith(1, { anzahl: 2 });
  });

  it('zurückgezogen: neutral, ohne Alarmrand, mit Grund und ohne Aktionen', () => {
    renderMitProviders(
      <NachforderungKarte
        nachforderung={nf({
          status: 'zurueckgezogen',
          ist_offen: false,
          zurueckgezogen_grund: 'nicht mehr benötigt',
        })}
        darfSchreiben
        onStatus={vi.fn()}
        onZurueckziehen={vi.fn()}
      />,
    );
    expect(screen.getByText('Zurückgezogen: nicht mehr benötigt')).toBeInTheDocument();
    const chip = screen.getByText('Zurückgezogen', { exact: true }).closest('[data-ton]');
    expect(chip).toHaveAttribute('data-ton', 'neutral');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
