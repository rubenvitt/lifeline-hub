import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alsBackendZeit } from '../etb/filterZeit';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import WiederherstellenDialog from './WiederherstellenDialog';

dayjs.extend(customParseFormat);

/** Wiederherstellen-Dialog (LFH-23, tasks.md 6.10). */

const GRUND = 'Die Karenz ist abgelaufen — eine Wiederherstellung ist nicht mehr möglich';
let gesendet: Record<string, unknown>[];
let antwort: () => Response;

beforeEach(() => {
  gesendet = [];
  antwort = () => HttpResponse.json({ zustand: 'frist_laeuft' });
  server.use(
    http.post('/api/aufbewahrung/einsaetze/7/wiederherstellen', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return antwort();
    }),
  );
});

function Harness() {
  const [offen, setOffen] = useState(true);
  return offen ? (
    <WiederherstellenDialog
      einsatzId={7}
      einsatzLabel="E-2026-0007"
      onSchliessen={() => setOffen(false)}
    />
  ) : (
    <output aria-label="zu">zu</output>
  );
}

async function zeige() {
  const r = renderMitProviders(<Harness />);
  const dialog = await screen.findByRole('dialog', { name: 'E-2026-0007 wiederherstellen' });
  return { ...r, dialog };
}

function toastsMit(wortlaut: string) {
  return [...document.querySelectorAll<HTMLElement>('.ant-message')].filter((n) =>
    n.textContent?.includes(wortlaut),
  );
}

const ZUKUNFT = dayjs().add(90, 'day').format('YYYY-MM-DD') + ' 12:00';

describe('WiederherstellenDialog', () => {
  it('Erfassungs-Norm: keine Modal-Fußzeile, Absende-Knopf im <form>, Vorgabe „unbegrenzt“ aus', async () => {
    const { dialog } = await zeige();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Wiederherstellen' }).closest('form'),
    ).not.toBeNull();
    expect(within(dialog).getByRole('switch')).not.toBeChecked();
  });

  it('sendet die gewählte Frist (UTC) per Enter', async () => {
    const { client, dialog } = await zeige();
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    const u = userEvent.setup();
    const eingabe = within(dialog).getByRole('textbox');
    await u.click(eingabe);
    await u.type(eingabe, `${ZUKUNFT}{Enter}`);
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toEqual({
      retention_bis: alsBackendZeit(dayjs(ZUKUNFT, 'YYYY-MM-DD HH:mm')),
    });
    expect(await screen.findByLabelText('zu')).toBeInTheDocument();
    const keys = invalidiert.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const k of [['aufbewahrung'], ['einsaetze'], ['einsatz', 7], ['etb', 7]]) {
      expect(keys).toContain(JSON.stringify(k));
    }
  });

  it('„unbegrenzt“ sendet null und verlangt keinen Zeitpunkt', async () => {
    const { dialog } = await zeige();
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(gesendet).toEqual([{ retention_bis: null }]));
  });

  it('ohne Frist und ohne „unbegrenzt“ geht nichts hinaus', async () => {
    const { dialog } = await zeige();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wiederherstellen' }));
    expect(
      await within(dialog).findByText('Zeitpunkt wählen oder „unbegrenzt“'),
    ).toBeInTheDocument();
    expect(gesendet).toHaveLength(0);
  });

  it('409 steht als Text im Dialog und nicht als Toast', async () => {
    antwort = () => HttpResponse.json({ error: GRUND }, { status: 409 });
    const { dialog } = await zeige();
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wiederherstellen' }));
    const treffer = await within(dialog).findByText(GRUND);
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit(GRUND)).toHaveLength(0);
    expect(within(dialog).getByText('Wiederherstellen fehlgeschlagen')).toBeInTheDocument();
    expect(dialog).not.toHaveClass('ant-zoom-leave');
  });
});
