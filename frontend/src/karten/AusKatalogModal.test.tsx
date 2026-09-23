import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
