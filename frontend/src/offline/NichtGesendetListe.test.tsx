import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { einsatzKeys } from '../api/queryKeys';
import NichtGesendetListe, { aktionWort } from './NichtGesendetListe';
import {
  OFFLINE_QUEUE_EVENT,
  queueEinreihen,
  queueLeerenFuerTests,
  schreibaktionEinreihen,
  schreibaktionEntfernen,
  schreibaktionenLaden,
} from './queue';

beforeEach(async () => {
  await queueLeerenFuerTests();
});

function renderListe() {
  // Eigener Client: `gcTime: 0` des Testclients räumte den Einsatzkopf sofort wieder.
  const client = new QueryClient();
  client.setQueryData(einsatzKeys.einsatz(7), { id: 7, bezeichnung: 'Hochwasser Süd' });
  return render(
    <QueryClientProvider client={client}>
      <NichtGesendetListe benutzerId={11} />
    </QueryClientProvider>,
  );
}

describe('NichtGesendetListe (LLH-1758)', () => {
  it('zeigt jede nicht gesendete Aktion mit Art, Einsatz und Zeit, über alle Einsätze', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'meldung',
      daten: {
        absender: 'RTW 2',
        meldeweg: 'funk',
        inhalt: 'Lage',
        ereigniszeit: '2026-11-20 12:00:00',
        client_id: 'm-1',
      },
    });
    await schreibaktionEinreihen(11, 8, {
      art: 'stand',
      bezirk_id: 3,
      bezeichnung: 'Bezirk Nord',
      daten: { client_id: 's-1' } as never,
    });
    await queueEinreihen(11, 7, { typ: 'meldung', inhalt: 'ETB offline', client_id: 'etb-1' });

    renderListe();
    const abschnitt = await screen.findByRole('region', { name: 'Nicht gesendet' });
    await waitFor(() => expect(within(abschnitt).getAllByRole('listitem')).toHaveLength(3));
    expect(within(abschnitt).getByText(/Meldung von RTW 2/)).toBeInTheDocument();
    expect(within(abschnitt).getByText(/Standmeldung: Bezirk Nord/)).toBeInTheDocument();
    expect(within(abschnitt).getByText(/ETB-Eintrag/)).toBeInTheDocument();
    expect(within(abschnitt).getAllByText(/Hochwasser Süd/)).toHaveLength(2);
    expect(within(abschnitt).getByText(/Einsatz 8/)).toBeInTheDocument();
  });

  it('„Jetzt erneut senden“ stößt den Abgleich an', async () => {
    await queueEinreihen(11, 7, { typ: 'meldung', inhalt: 'x', client_id: 'etb-2' });
    const hoerer = vi.fn();
    window.addEventListener(OFFLINE_QUEUE_EVENT, hoerer);
    try {
      renderListe();
      await userEvent.click(await screen.findByRole('button', { name: 'Jetzt erneut senden' }));
      expect(hoerer).toHaveBeenCalled();
    } finally {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, hoerer);
    }
  });

  it('eine gesendete Zeile verschwindet, während die Liste offen ist', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'stand',
      bezirk_id: 3,
      bezeichnung: 'Bezirk Nord',
      daten: { client_id: 's-2' } as never,
    });
    renderListe();
    await screen.findByText(/Standmeldung: Bezirk Nord/);
    const [zeile] = await schreibaktionenLaden(11, 7);
    await act(async () => {
      await schreibaktionEntfernen(11, zeile.id!);
    });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Nicht gesendet' })).not.toBeInTheDocument(),
    );
  });

  it('leer steht nichts da', async () => {
    const { container } = renderListe();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('nennt jede Art verständlich', () => {
    expect(
      aktionWort({ art: 'ausgabe', zeitfenster_id: 1, bezeichnung: 'Mittag', daten: {} as never }),
    ).toBe('Verpflegungsausgabe: Mittag');
    expect(aktionWort({ art: 'eingaenge_gelesen', daten: { bis_id: 3 } })).toBe(
      'Eingänge „Alle gelesen“',
    );
  });
});
