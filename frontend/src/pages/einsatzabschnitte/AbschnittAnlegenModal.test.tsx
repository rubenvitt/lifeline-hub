import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { Einsatzabschnitt } from '../../api/types';
import AbschnittAnlegenModal from './AbschnittAnlegenModal';

const bestand = [
  { id: 5, einsatz_id: 1, name: 'Abschnitt Nord', kurzbezeichnung: 'EA 1' },
  { id: 6, einsatz_id: 1, name: 'Süd', kurzbezeichnung: null },
] as Einsatzabschnitt[];

function mitschnitt(antwort: () => Response = () => HttpResponse.json({ id: 9, name: 'x' })) {
  const bodies: unknown[] = [];
  server.use(
    http.post('/api/einsaetze/1/abschnitte', async ({ request }) => {
      bodies.push(await request.json());
      return antwort();
    }),
  );
  return bodies;
}

function zeige() {
  const onAngelegt = vi.fn();
  const onSchliessen = vi.fn();
  renderMitProviders(
    <AbschnittAnlegenModal
      offen
      einsatzId={1}
      abschnitte={bestand}
      onAngelegt={onAngelegt}
      onSchliessen={onSchliessen}
    />,
  );
  return { onAngelegt, onSchliessen };
}

describe('AbschnittAnlegenModal (LFH-1208)', () => {
  it('Feldbudget: genau drei sichtbare Felder — Name, Kurzbezeichnung, Über-Abschnitt', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog', { name: 'Abschnitt anlegen' });
    const felder = dialog.querySelectorAll('.ant-form-item');
    // Die Gegenprobe zur Obergrenze: drei benannte Felder, nicht bloß „höchstens drei“.
    expect(felder).toHaveLength(3);
    expect(Array.from(felder).map((f) => f.querySelector('label')?.textContent?.trim())).toEqual([
      'Name',
      'Kurzbezeichnung',
      'Über-Abschnitt',
    ]);
    expect(within(dialog).queryByText(/Fortschritt|Lagezustand/)).toBeNull();
  });

  it('Fokus im Namen, Enter sendet genau die drei Felder', async () => {
    const bodies = mitschnitt();
    const user = userEvent.setup();
    const { onAngelegt } = zeige();
    const name = await screen.findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(name).toHaveFocus());
    await user.type(name, '  Deichverteidigung {Enter}');
    await waitFor(() => expect(onAngelegt).toHaveBeenCalledWith(9));
    expect(bodies).toEqual([
      { name: 'Deichverteidigung', kurzbezeichnung: null, ueber_abschnitt_id: null },
    ]);
  });

  it('Struktur der Erfassungs-Norm: Absende-Knopf im Formular, keine antd-Fußzeile', async () => {
    zeige();
    const dialog = await screen.findByRole('dialog');
    const knopf = within(dialog).getByRole('button', { name: /Anlegen/ });
    expect(knopf.closest('form')).not.toBeNull();
    expect(dialog.ownerDocument.querySelector('.ant-modal-footer')).toBeNull();
  });

  it('Kurzbezeichnung und Über-Abschnitt gehen mit', async () => {
    const bodies = mitschnitt();
    const user = userEvent.setup();
    zeige();
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Deichspitze');
    await user.type(screen.getByRole('textbox', { name: 'Kurzbezeichnung' }), 'EA 1.1');
    await user.click(screen.getByRole('combobox', { name: 'Über-Abschnitt' }));
    await user.click(await screen.findByTitle('Abschnitt Nord'));
    await user.click(screen.getByRole('button', { name: /Anlegen/ }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { name: 'Deichspitze', kurzbezeichnung: 'EA 1.1', ueber_abschnitt_id: 5 },
      ]),
    );
  });

  it('vergebene Kurzbezeichnung: Grund am Feld, nichts gesendet', async () => {
    const bodies = mitschnitt();
    const user = userEvent.setup();
    zeige();
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Neu');
    await user.type(screen.getByRole('textbox', { name: 'Kurzbezeichnung' }), 'ea 1{Enter}');
    expect(await screen.findByText('Schon vergeben (Abschnitt Nord)')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('Ablehnung: der Dialog bleibt mit den Werten offen, der Grund steht in ihm', async () => {
    mitschnitt(() => HttpResponse.json({ error: 'Kurzbezeichnung vergeben' }, { status: 409 }));
    const user = userEvent.setup();
    const { onAngelegt } = zeige();
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Neu{Enter}');
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Kurzbezeichnung vergeben')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Neu');
    expect(onAngelegt).not.toHaveBeenCalled();
  });

  it('Abbrechen sendet nichts', async () => {
    const bodies = mitschnitt();
    const user = userEvent.setup();
    const { onSchliessen } = zeige();
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Verworfen');
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onSchliessen).toHaveBeenCalled();
    expect(bodies).toEqual([]);
  });
});
