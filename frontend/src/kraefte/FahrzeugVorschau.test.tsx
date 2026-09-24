import { act, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import type { EinsatzFahrzeug } from '../api/types';
import FahrzeugVorschau from './FahrzeugVorschau';

const URL = '/api/einsaetze/5/fahrzeuge';

const fahrzeug = (o: Partial<EinsatzFahrzeug> = {}): EinsatzFahrzeug =>
  ({
    id: 7,
    einsatz_id: 5,
    funkrufname: 'Florian Musterstadt 1/44-1',
    ist_adhoc: false,
    disponiert_at: '2026-09-24 08:00:00',
    fahrzeugtyp: 'HLF 20',
    kennzeichen: 'MS-FW 144',
    opta: 'FW MS 01/44-01',
    traegerorganisation: 'Feuerwehr',
    soll_besatzung: { fuehrer: 1, unterfuehrer: 1, mannschaft: 7 },
    bemerkung: 'Wasserführend',
    status_label: '3 – Einsatz übernommen',
    status_kategorie: 'gebunden',
    status_farbe: null,
    einheit_id: 3,
    ...o,
  }) as EinsatzFahrzeug;

function liefere(liste: EinsatzFahrzeug[], zaehler?: { n: number }) {
  server.use(
    http.get(URL, () => {
      if (zaehler) zaehler.n += 1;
      return HttpResponse.json(liste);
    }),
  );
}

describe('FahrzeugVorschau (LFH-664)', () => {
  it('zeigt Funkrufname, Status mit Wort, Typ, Kennzeichen, OPTA, Träger, Soll-Besatzung und Bemerkung', async () => {
    liefere([fahrzeug({ id: 6, funkrufname: 'Anderes' }), fahrzeug()]);
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />);

    expect(await screen.findByText('Florian Musterstadt 1/44-1')).toBeInTheDocument();
    expect(screen.getByText('3 – Einsatz übernommen')).toBeInTheDocument();
    expect(screen.getByText('HLF 20')).toBeInTheDocument();
    expect(screen.getByText('MS-FW 144')).toBeInTheDocument();
    expect(screen.getByText('FW MS 01/44-01')).toBeInTheDocument();
    expect(screen.getByText('Feuerwehr')).toBeInTheDocument();
    expect(screen.getByText('1/1/7//9')).toBeInTheDocument();
    expect(screen.getByText('Wasserführend')).toBeInTheDocument();
    // Nicht der Nachbar aus derselben Liste.
    expect(screen.queryByText('Anderes')).not.toBeInTheDocument();
    // Kein „ad-hoc", wenn das Fahrzeug aus dem Katalog kommt.
    expect(screen.queryByText(/ad-hoc/i)).not.toBeInTheDocument();
  });

  it('sagt „kein Status", wenn das Fahrzeug keinen Status trägt', async () => {
    liefere([fahrzeug({ status_label: null, status_kategorie: null })]);
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />);
    expect(await screen.findByText('kein Status')).toBeInTheDocument();
  });

  it('kennzeichnet ein ad-hoc disponiertes Fahrzeug', async () => {
    liefere([fahrzeug({ ist_adhoc: true })]);
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />);
    expect(await screen.findByText('ad-hoc')).toBeInTheDocument();
  });

  it('sagt, dass das Fahrzeug nicht mehr vorhanden ist', async () => {
    liefere([fahrzeug({ id: 6 })]);
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />);
    expect(await screen.findByText('Das Fahrzeug ist nicht mehr vorhanden.')).toBeInTheDocument();
  });

  it('liest nur: keine Statuswahl, kein Knopf, kein Auswahlfeld', async () => {
    liefere([fahrzeug()]);
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />);
    await screen.findByText('Florian Musterstadt 1/44-1');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  /**
   * Die Spec „Kein zusätzlicher Abruf": ist das Fach der Palette warm, holt die Vorschau
   * nicht neu. `new QueryClient()` statt `neuerQueryClient()` — dessen `gcTime: 0` räumte
   * das per `setQueryData` gesetzte, noch unbeobachtete Fach vor dem Render weg.
   */
  it('holt bei warmem Fach nicht neu', async () => {
    const zaehler = { n: 0 };
    liefere([fahrzeug({ funkrufname: 'vom Server' })], zaehler);
    const client = new QueryClient();
    client.setQueryData(datensatzAbfrage.fahrzeuge(5).queryKey, [fahrzeug()]);
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />, { client });

    expect(await screen.findByText('Florian Musterstadt 1/44-1')).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(zaehler.n).toBe(0);
    expect(client.getQueryState(datensatzAbfrage.fahrzeuge(5).queryKey)?.fetchStatus).toBe('idle');
  });

  /** Gegenprobe zum warmen Fach: ohne sie bliebe ein falsch geschriebener Handler grün. */
  it('holt ein abgelaufenes Fach genau einmal neu', async () => {
    const zaehler = { n: 0 };
    liefere([fahrzeug({ funkrufname: 'vom Server' })], zaehler);
    const client = new QueryClient();
    client.setQueryData(datensatzAbfrage.fahrzeuge(5).queryKey, [fahrzeug()], {
      updatedAt: Date.now() - 120_000,
    });
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />, { client });

    expect(await screen.findByText('vom Server')).toBeInTheDocument();
    expect(zaehler.n).toBe(1);
  });

  /** Die Spec „Live-Änderung während der Vorschau": der neue Status kommt ohne Neuöffnen an. */
  it('zeigt einen live geänderten Status', async () => {
    const client = new QueryClient();
    const key = datensatzAbfrage.fahrzeuge(5).queryKey;
    client.setQueryData(key, [fahrzeug()]);
    renderMitProviders(<FahrzeugVorschau einsatzId={5} id={7} />, { client });
    expect(await screen.findByText('3 – Einsatz übernommen')).toBeInTheDocument();

    act(() => {
      client.setQueryData(key, [
        fahrzeug({ status_label: '4 – Am Einsatzort', status_kategorie: 'gebunden' }),
      ]);
    });

    await waitFor(() => expect(screen.getByText('4 – Am Einsatzort')).toBeInTheDocument());
    expect(screen.queryByText('3 – Einsatz übernommen')).not.toBeInTheDocument();
  });
});
