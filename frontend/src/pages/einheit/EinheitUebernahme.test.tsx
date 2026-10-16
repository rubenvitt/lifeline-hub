import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { oeffne, optionenVon, waehle } from '../../test/auswahlListe';
import type { Einheit, Einsatzabschnitt } from '../../api/types';
import EinheitUebernahme from './EinheitUebernahme';

const eh = (id: number, name: string, mehr: Partial<Einheit> = {}) =>
  ({
    id,
    einsatz_id: 1,
    name,
    abschnitt_id: null,
    abschnitt_name: null,
    ueber_einheit_id: null,
    unangemeldet: false,
    nicht_uebernommen_seit: null,
    ...mehr,
  }) as unknown as Einheit;

const NEU = eh(20, 'Florian Nachbar 3', {
  unangemeldet: true,
  nicht_uebernommen_seit: '2026-10-16T12:00:00Z',
});
const EINHEITEN = [eh(10, 'Zug Nord'), NEU, eh(21, 'Staffel unter Neu', { ueber_einheit_id: 20 })];
const ABSCHNITTE = [{ id: 3, name: 'EA Nord' }] as Einsatzabschnitt[];

function zeige({
  canAbweisen = true,
  onAbgewiesen = vi.fn(),
}: { canAbweisen?: boolean; onAbgewiesen?: () => void } = {}) {
  const koerper: unknown[] = [];
  const abgewiesen: number[] = [];
  server.use(
    http.post('/api/einsaetze/1/einheiten/20/uebernehmen', async ({ request }) => {
      koerper.push(await request.json());
      return HttpResponse.json({ ...NEU, nicht_uebernommen_seit: null, abschnitt_id: 3 });
    }),
    http.post('/api/einsaetze/1/einheiten/20/abweisen', () => {
      abgewiesen.push(20);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderMitProviders(
    <EinheitUebernahme
      einsatzId={1}
      einheit={NEU}
      einheiten={EINHEITEN}
      abschnitte={ABSCHNITTE}
      canAbweisen={canAbweisen}
      onAbgewiesen={onAbgewiesen}
    />,
  );
  return { koerper, abgewiesen, onAbgewiesen };
}

describe('EinheitUebernahme (LLH-1075, design.md D14)', () => {
  it('„Übernehmen“ sendet Abschnitt und Über-Einheit', async () => {
    const { koerper } = zeige();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    await waehle('Abschnitt', 'EA Nord');
    await waehle('Über-Einheit', 'Zug Nord');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(koerper).toEqual([{ abschnitt_id: 3, ueber_einheit_id: 10 }]));
    expect(await screen.findByText('Florian Nachbar 3 übernommen')).toBeInTheDocument();
  });

  it('ohne Angaben geht ein leerer Körper', async () => {
    const { koerper } = zeige();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(koerper).toEqual([{}]));
  });

  it('die Über-Einheit bietet weder die Einheit selbst noch ihre Nachfahren an', async () => {
    zeige();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await screen.findByRole('dialog');
    await oeffne('Über-Einheit');
    expect(optionenVon('Über-Einheit')).toEqual(['Zug Nord']);
  });

  it('Abbruch sendet nichts', async () => {
    const { koerper } = zeige();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(koerper).toEqual([]);
  });

  it('„Abweisen“ fragt rot nach und meldet danach zurück', async () => {
    const { abgewiesen, onAbgewiesen } = zeige();
    const knopf = screen.getByRole('button', { name: 'Abweisen' });
    expect(knopf).toHaveClass('ant-btn-dangerous');
    await userEvent.click(knopf);
    const blase = await screen.findByRole('tooltip');
    expect(within(blase).getByText('Einheit abweisen?')).toBeInTheDocument();
    expect(
      within(blase).getByText(
        'Die Einheit verlässt den Bereitstellungsraum und wird aufgelöst, ihre Fahrzeuge werden entlassen.',
      ),
    ).toBeInTheDocument();
    expect(abgewiesen).toEqual([]);
    await userEvent.click(within(blase).getByRole('button', { name: 'Abweisen' }));
    await waitFor(() => expect(abgewiesen).toEqual([20]));
    await waitFor(() => expect(onAbgewiesen).toHaveBeenCalled());
  });

  it('ohne Fahrzeuge-Recht kein „Abweisen“', () => {
    zeige({ canAbweisen: false });
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abweisen' })).toBeNull();
  });

  it('eine Ablehnung steht am Ort, ohne Toast', async () => {
    zeige();
    server.use(
      http.post('/api/einsaetze/1/einheiten/20/abweisen', () =>
        HttpResponse.json({ error: 'Einheit ist schon übernommen' }, { status: 409 }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abweisen' }));
    const blase = await screen.findByRole('tooltip');
    await userEvent.click(within(blase).getByRole('button', { name: 'Abweisen' }));
    expect(await screen.findByText('Einheit ist schon übernommen')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});
