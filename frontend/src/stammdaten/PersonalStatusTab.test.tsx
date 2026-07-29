import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalStatusTab from './PersonalStatusTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

/**
 * Fachliche Reihenfolge (`sortier` 10 vor 20), die zugleich NICHT die alphabetische ist —
 * sonst sähe die Tabelle nach dem Sortierklick genauso aus wie davor.
 */
const status = [
  { id: 1, label: 'dienstbereit', kategorie: 'verfuegbar', farbe: null, sortier: 10 },
  { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
];

/** Die Leitspalte aller Datenzeilen — der Kopf ist ein eigenes `<table>`, siehe KatalogTabelle. */
const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tr.ant-table-row td:first-child')].map((z) => z.textContent);

/**
 * Der Eintrag IM Filtermenü. Das Kategorie-Label steht zweimal im Dokument — in der Zelle als
 * `StatusTag` und im Menü —, ein schlichtes `findByText` bräche an der Mehrdeutigkeit. Und das
 * Menü hängt in einem Portal unter `document.body`, nicht unter dem `container`.
 */
async function menueEintrag(text: string): Promise<HTMLElement> {
  const treffer = (await screen.findAllByText(text)).find((k) =>
    k.closest('.ant-table-filter-dropdown'),
  );
  if (!treffer) throw new Error(`Kein Filtereintrag „${text}" im Menü`);
  return treffer;
}

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/personal-status', () => HttpResponse.json(status)),
  );
  return renderMitProviders(
    <AuthProvider>
      <PersonalStatusTab />
    </AuthProvider>,
  );
}

describe('PersonalStatusTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('dienstbereit')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('dienstbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('dienstbereit');
    expect(screen.queryByRole('button', { name: 'Status anlegen' })).not.toBeInTheDocument();
  });

  it('Ordnung: die Leitspalte sortiert, Suche und Kategorie-Filter verengen', async () => {
    const { container } = render(admin);
    await screen.findByText('dienstbereit');
    expect(labels(container)).toEqual(['dienstbereit', 'alarmiert']);

    // Der Sortierauslöser sitzt in der Kopfzelle der fixierten Leitspalte. jsdom rechnet
    // dort kein Layout — dass der Klick auch am 390-px-Schirm ankommt, ist hier NICHT belegt.
    await userEvent.click(container.querySelector<HTMLElement>('th.ant-table-cell-fix-start')!);
    expect(labels(container)).toEqual(['alarmiert', 'dienstbereit']);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await userEvent.type(feld, 'dienst');
    expect(labels(container)).toEqual(['dienstbereit']);
    await userEvent.clear(feld);
    expect(labels(container)).toHaveLength(2);

    // Gefiltert wird die ZEILENMENGE, nicht die Anwesenheit des Trichters: antd zeichnet ihn
    // schon bei gesetztem `filters`, gefiltert wird aber erst mit `onFilter`.
    await userEvent.click(container.querySelector<HTMLElement>('.ant-table-filter-trigger')!);
    await userEvent.click(await menueEintrag('gebunden'));
    await userEvent.click(
      document.querySelector<HTMLElement>('.ant-table-filter-dropdown-btns .ant-btn-primary')!,
    );
    expect(labels(container)).toEqual(['alarmiert']);
  });
});
