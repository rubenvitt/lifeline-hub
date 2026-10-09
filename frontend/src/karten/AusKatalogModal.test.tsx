import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import AusKatalogModal from './AusKatalogModal';

const KATALOG = [
  {
    name: 'TopPlusOpen',
    url: 'https://topplus/{z}/{y}/{x}.png',
    typ: 'raster',
    attribution: 'BKG',
  },
  {
    name: 'Satellit (Esri)',
    url: 'https://esri/{z}/{y}/{x}',
    typ: 'raster',
    attribution: 'Esri',
    hinweis: 'Esri-Nutzungsbedingungen: ArcGIS-Konto nötig.',
  },
];

function rendere() {
  const posts: Record<string, unknown>[] = [];
  server.use(
    http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json(KATALOG)),
    http.post('/api/karte/online-quellen', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      return HttpResponse.json({ id: posts.length, ...body }, { status: 201 });
    }),
  );
  renderMitProviders(
    <AusKatalogModal offen vorhandeneUrls={new Set()} naechsteSortier={3} onClose={() => {}} />,
  );
  return posts;
}

function zeile(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement;
}

describe('AusKatalogModal — Betreiberhinweis (LFH-616)', () => {
  it('zeigt den Hinweis am Eintrag und übernimmt ihn INAKTIV', async () => {
    const posts = rendere();
    await screen.findByText('Satellit (Esri)');
    const esri = zeile('Satellit (Esri)');
    expect(within(esri).getByRole('alert')).toHaveTextContent('ArcGIS-Konto');
    await userEvent.click(within(esri).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ name: 'Satellit (Esri)', aktiv: false, proxy: true });
  });

  it('ein Eintrag ohne Hinweis bleibt wie bisher: kein Alert, aktiv übernommen', async () => {
    const posts = rendere();
    await screen.findByText('TopPlusOpen');
    const top = zeile('TopPlusOpen');
    expect(within(top).queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(within(top).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ name: 'TopPlusOpen', aktiv: true });
  });
});

/**
 * Zeilenfehler im Dialog (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): eine abgelehnte
 * Übernahme nennt ihren Grund am Eintrag, an dem sie ausgelöst wurde; kein Toast. Schließen und
 * erneutes Öffnen zeigen keinen alten Grund.
 */
function Harness() {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Wieder öffnen
      </button>
      <AusKatalogModal
        offen={offen}
        vorhandeneUrls={new Set()}
        naechsteSortier={3}
        onClose={() => setOffen(false)}
      />
    </>
  );
}

describe('AusKatalogModal — abgelehnte Übernahme (LFH-1077)', () => {
  function abgelehnt() {
    server.use(
      http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json(KATALOG)),
      http.post('/api/karte/online-quellen', () =>
        HttpResponse.json({ error: 'URL schon vorhanden' }, { status: 409 }),
      ),
    );
  }

  it('zeigt den Grund am Eintrag, nicht als Toast', async () => {
    abgelehnt();
    renderMitProviders(<Harness />);
    await screen.findByText('TopPlusOpen');
    await userEvent.click(within(zeile('TopPlusOpen')).getByRole('button', { name: 'Hinzufügen' }));

    expect(await within(zeile('TopPlusOpen')).findByText('URL schon vorhanden')).toHaveAttribute(
      'data-fehler',
    );
    expect(zeile('Satellit (Esri)').querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('zeigt nach Schließen und erneutem Öffnen keinen alten Grund', async () => {
    abgelehnt();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    await screen.findByText('TopPlusOpen');
    await nutzer.click(within(zeile('TopPlusOpen')).getByRole('button', { name: 'Hinzufügen' }));
    await within(zeile('TopPlusOpen')).findByText('URL schon vorhanden');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs ein.
    await nutzer.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /close|schlie/i }),
    );
    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = await screen.findByRole('dialog');
    await within(wieder).findByText('TopPlusOpen');
    expect(wieder.querySelector('[data-fehler]')).toBeNull();
  });

  /**
   * Zwei Übernahmen zugleich gibt es hier nicht: beide bekämen dieselbe `naechsteSortier`. Solange
   * eine läuft, sind die anderen Einträge gesperrt — deshalb kann keine zweite Zeile den Grund der
   * ersten verdrängen.
   */
  it('sperrt die anderen Einträge, solange eine Übernahme läuft', async () => {
    let gibFrei: () => void = () => {};
    const freigabe = new Promise<void>((r) => (gibFrei = r));
    server.use(
      http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json(KATALOG)),
      http.post('/api/karte/online-quellen', async () => {
        await freigabe;
        return HttpResponse.json({ error: 'URL schon vorhanden' }, { status: 409 });
      }),
    );
    renderMitProviders(<Harness />);
    await screen.findByText('TopPlusOpen');
    await userEvent.click(within(zeile('TopPlusOpen')).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() =>
      expect(
        within(zeile('Satellit (Esri)')).getByRole('button', { name: 'Hinzufügen' }),
      ).toBeDisabled(),
    );
    gibFrei();
    expect(await within(zeile('TopPlusOpen')).findByText('URL schon vorhanden')).toHaveAttribute(
      'data-fehler',
    );
  });
});
