import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { AufbewahrungEintrag } from '../api/types';
import { formatZeit } from '../anzeige/format';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import AufbewahrungUebersicht from './AufbewahrungUebersicht';

/** Übersicht (LFH-23, tasks.md 6.8). */

const ME_ADMIN = { id: 1, anzeigename: 'Admin', system_rolle: 'admin', org_rolle: 'keine' };
const ME_FK = { id: 2, anzeigename: 'FK', system_rolle: 'keiner', org_rolle: 'fuehrungskraft' };

const EINTRAEGE: AufbewahrungEintrag[] = [
  {
    einsatz_id: 9101,
    einsatznummer_intern: 'E-2026-0007',
    bezeichnung: 'Hochwasser Nord',
    abgeschlossen_at: '2026-05-01 10:00:00',
    retention_bis: '2026-06-01 10:00:00',
    geloescht_at: '2026-06-01 10:10:00',
    karenz_ende: '2026-07-01 10:10:00',
    zustand: 'vorgemerkt',
  },
  {
    einsatz_id: 9102,
    einsatznummer_intern: 'E-2026-0008',
    bezeichnung: 'Sturm Süd',
    abgeschlossen_at: '2026-05-02 10:00:00',
    zustand: 'ohne_frist',
  },
  {
    einsatz_id: 9103,
    einsatznummer_intern: 'E-2025-0001',
    bezeichnung: 'Brand West',
    abgeschlossen_at: '2025-01-02 10:00:00',
    retention_bis: '2025-02-01 10:00:00',
    geloescht_at: '2025-02-01 10:10:00',
    karenz_ende: '2025-03-03 10:10:00',
    geschwaerzt_at: '2025-03-03 10:20:00',
    zustand: 'geschwaerzt',
  },
];

function Ort() {
  return <output aria-label="Ort">{useLocation().pathname}</output>;
}

function zeige(me: Record<string, unknown> = ME_ADMIN) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(me)),
    http.get('/api/aufbewahrung', () => HttpResponse.json(EINTRAEGE)),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/admin/aufbewahrung" element={<AufbewahrungUebersicht />} />
      <Route path="/admin/aufbewahrung/:einsatzId" element={<Ort />} />
      <Route path="/admin/stammdaten/stichworte" element={<Ort />} />
    </Routes>,
    { route: '/admin/aufbewahrung' },
  );
}

/** Die Tabelle als Ganzes — antd rendert Kopf und Körper als zwei `table`-Elemente. */
async function tabelle(): Promise<HTMLElement> {
  await screen.findAllByRole('table');
  return document.querySelector<HTMLElement>('.ant-table')!;
}

describe('AufbewahrungUebersicht', () => {
  it('zeigt Einsatznummer, Zustand mit Wort und das Karenz-Ende in der Anzeigezeit', async () => {
    zeige();
    const t = await tabelle();
    await within(t).findByText('E-2026-0007');
    expect(within(t).getByText('zur Löschung vorgemerkt')).toBeInTheDocument();
    expect(within(t).getByText('ohne Frist')).toBeInTheDocument();
    expect(within(t).getByText('geschwärzt')).toBeInTheDocument();
    // Karenz-Ende als taktische DTG, nicht als roher UTC-String.
    expect(within(t).getByText(formatZeit('2026-07-01 10:10:00'))).toBeInTheDocument();
    expect(t).not.toHaveTextContent('2026-07-01 10:10:00');
    // Keine DB-id im sichtbaren Text.
    for (const id of ['9101', '9102', '9103']) expect(t).not.toHaveTextContent(id);
  });

  it('filtert je Zustand über die Segmentleiste', async () => {
    zeige();
    const t = await tabelle();
    await within(t).findByText('E-2026-0007');
    await userEvent.click(screen.getByRole('radio', { name: 'geschwärzt' }));
    await waitFor(() => expect(within(t).queryByText('E-2026-0007')).toBeNull());
    expect(within(t).getByText('E-2025-0001')).toBeInTheDocument();
    expect(within(t).queryByText('E-2026-0008')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Frist läuft' }));
    expect(await screen.findByText('Kein Einsatz im Zustand „Frist läuft“')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'alle' }));
    expect(await within(t).findByText('E-2026-0008')).toBeInTheDocument();
  });

  it('führt per Zeilenklick in die Akte unter der stabilen id', async () => {
    zeige();
    const t = await tabelle();
    await userEvent.click(await within(t).findByText('Sturm Süd'));
    expect(await screen.findByLabelText('Ort')).toHaveTextContent('/admin/aufbewahrung/9102');
  });

  it('die Führungskraft landet in der Verwaltung, nicht im Archiv', async () => {
    zeige(ME_FK);
    expect(await screen.findByLabelText('Ort')).toHaveTextContent('/admin/stammdaten/stichworte');
  });
});
