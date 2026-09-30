import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ChecklistenEintrag, ChecklistenPunkt } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ChecklistePaneel from './ChecklistePaneel';

const PFAD = '/api/einsaetze/1/stab/checkliste';

function eintrag(
  punkt: ChecklistenPunkt,
  erledigt: boolean,
  bemerkung?: string,
): ChecklistenEintrag {
  return {
    punkt,
    erledigt,
    ...(erledigt ? { erledigt_at: '2026-09-30 12:32:00', erledigt_von_id: 1 } : {}),
    ...(bemerkung ? { bemerkung } : {}),
    geaendert_von_id: 1,
    geaendert_at: '2026-09-30 12:32:00',
  };
}

/** Rendert das Paneel und zählt, was auf dem Draht ankommt. */
function rendere({
  liste = [] as ChecklistenEintrag[],
  getStatus = 200,
  darfSchreiben = true,
  put = (body: Record<string, unknown>) =>
    HttpResponse.json([
      eintrag('lageskizze', body.erledigt === true, body.bemerkung as string | undefined),
    ]) as Response,
} = {}) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.get(PFAD, () =>
      getStatus === 200
        ? HttpResponse.json(liste)
        : HttpResponse.json({ error: 'kaputt' }, { status: getStatus }),
    ),
    http.put(`${PFAD}/:punkt`, async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push({ punkt: params.punkt, ...body });
      return put(body);
    }),
  );
  renderMitProviders(<ChecklistePaneel einsatzId={1} darfSchreiben={darfSchreiben} />);
  return bodies;
}

const paneel = () => screen.findByRole('region', { name: 'Arbeitsaufnahme' });
const box = (name: string) => screen.findByRole('checkbox', { name });

describe('ChecklistePaneel', () => {
  it('zeigt die sieben Punkte in Reihenfolge, jeden mit Quelle', async () => {
    rendere();
    const r = await paneel();
    await waitFor(() => expect(within(r).getAllByRole('checkbox')).toHaveLength(7));
    expect(
      within(r)
        .getAllByRole('checkbox')
        .map((b) => b.getAttribute('aria-describedby') !== null),
    ).toEqual(Array(7).fill(true));
    const namen = within(r)
      .getAllByRole('checkbox')
      .map((b) => b.closest('label')?.textContent ?? '');
    expect(namen[0]).toContain('Aufstellort des ELW festgelegt');
    expect(namen[6]).toContain('Einsatzbereitschaft an die Leitstelle gemeldet');
    expect(within(r).getAllByText(/LFS-BW F5-I Kap\. 5/)).toHaveLength(7);
  });

  it('zählt erst mit Daten, und nur Haken', async () => {
    rendere({
      liste: [
        eintrag('aufstellort', true),
        eintrag('lageskizze', true),
        eintrag('einweisung', false, 'kommt gleich'),
      ],
    });
    const r = await paneel();
    expect(await within(r).findByText('2/7 erledigt')).toBeInTheDocument();
    expect(await box('Lageskizze begonnen')).toBeChecked();
    expect(await box('Einweisung durch die Einsatzleitung erhalten')).not.toBeChecked();
  });

  it('zeigt am erledigten Punkt die Uhrzeit des Hakens', async () => {
    rendere({ liste: [eintrag('lageskizze', true)] });
    const b = await box('Lageskizze begonnen');
    const zeile = b.closest('li')!;
    await waitFor(() =>
      expect(within(zeile as HTMLElement).getByText(/^erledigt /)).toBeInTheDocument(),
    );
  });

  it('ein Tipp auf den TEXT hakt ab und schickt genau ein Feld, genau einmal', async () => {
    const bodies = rendere();
    await box('Lageskizze begonnen');
    await userEvent.click(screen.getByText('Lageskizze begonnen'));
    await waitFor(() => expect(bodies).toEqual([{ punkt: 'lageskizze', erledigt: true }]));
    await waitFor(async () => expect(await box('Lageskizze begonnen')).toBeChecked());
  });

  it('entfernt einen Haken ohne Rückfrage', async () => {
    const bodies = rendere({ liste: [eintrag('lageskizze', true)] });
    await userEvent.click(await box('Lageskizze begonnen'));
    await waitFor(() => expect(bodies).toEqual([{ punkt: 'lageskizze', erledigt: false }]));
    expect(document.querySelector('.ant-modal, .ant-popover')).toBeNull();
  });

  it('ohne Schreibrecht: Boxen gesperrt, kein Aufruf, Bemerkung nur als Lesezweig', async () => {
    const bodies = rendere({ darfSchreiben: false, liste: [eintrag('aufstellort', false, 'Hof')] });
    const r = await paneel();
    await waitFor(() => expect(within(r).getAllByRole('checkbox')).toHaveLength(7));
    for (const b of within(r).getAllByRole('checkbox')) expect(b).toBeDisabled();
    await userEvent.click(screen.getByText('Lageskizze begonnen'));
    expect(bodies).toEqual([]);
    expect(within(r).queryByRole('button', { name: /Bemerkung/ })).toBeNull();
    expect(within(r).getByText('Hof')).toBeInTheDocument();
  });

  it('eine Ablehnung steht an der Zeile, der Haken zeigt den Serverstand, kein Toast', async () => {
    rendere({
      put: () => HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 409 }),
    });
    await userEvent.click(await box('Lageskizze begonnen'));
    const zeile = (await box('Lageskizze begonnen')).closest('li') as HTMLElement;
    await waitFor(() => expect(zeile.querySelector('[data-fehler]')).not.toBeNull());
    expect(zeile).toHaveTextContent('Einsatz ist abgeschlossen');
    expect(await box('Lageskizze begonnen')).not.toBeChecked();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Fehler ≠ leer: ohne Daten steht ein Fehler mit Wiederholen statt sieben offener Punkte', async () => {
    rendere({ getStatus: 500 });
    const r = await paneel();
    expect(await within(r).findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(within(r).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(r).queryByText(/erledigt$/)).toBeNull();
  });

  it('die Bemerkung schickt nur bemerkung, nie erledigt', async () => {
    const bodies = rendere({ liste: [eintrag('lageskizze', true)] });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Bemerkung zu Lageskizze begonnen hinzufügen' }),
    );
    const feld = await screen.findByRole('textbox');
    await userEvent.type(feld, 'Tafel am ELW');
    // antds `Editable` wertet den legacy `keyCode` aus (Testfalle in `BemerkungZelle.test.tsx`).
    fireEvent.keyDown(feld, { keyCode: 13 });
    fireEvent.keyUp(feld, { keyCode: 13 });
    await waitFor(() =>
      expect(bodies).toEqual([{ punkt: 'lageskizze', bemerkung: 'Tafel am ELW' }]),
    );
  });
});
