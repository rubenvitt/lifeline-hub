import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { ExterneStelle } from '../api/types';
import { EXTERNE_STELLE_BEZEICHNUNG_MAX, EXTERNE_STELLE_KURZ_MAX } from '../api/eingabegrenzen';
import ExterneStelleFormModal from './ExterneStelleFormModal';

/** LFH-1194, design.md D10: Maske einer externen Stelle auf `ErfassungsModal`. */

const ils: ExterneStelle = {
  id: 4,
  bezeichnung: 'ILS Musterkreis',
  art: 'leitstelle',
  aktiv: true,
  zustaendig: true,
};

function Harness({ bestand }: { bestand?: ExterneStelle | null }) {
  const [offen, setOffen] = useState(true);
  return (
    <ExterneStelleFormModal
      offen={offen}
      stelle={bestand ?? null}
      onClose={() => setOffen(false)}
    />
  );
}

async function artWaehlen(nutzer: ReturnType<typeof userEvent.setup>, label: string) {
  await nutzer.click(screen.getByLabelText('Art'));
  await nutzer.click(await screen.findByTitle(label));
}

describe('ExterneStelleFormModal', () => {
  it('Absende-Knopf im Formular, keine antd-Fusszeile, Fokus im ersten Feld', async () => {
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Speichern' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung')));
  });

  it('Feldbudget: Bezeichnung und Art offen, Rufnummer und Funkrufname zugeklappt', async () => {
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    expect(await screen.findByLabelText('Bezeichnung')).toHaveAttribute(
      'maxlength',
      String(EXTERNE_STELLE_BEZEICHNUNG_MAX),
    );
    expect(screen.queryByLabelText('Rufnummer')).toBeNull();
    expect(screen.queryByLabelText('Funkrufname')).toBeNull();
    // Gegenprobe: Aufklappen → die beiden Felder erscheinen.
    await nutzer.click(screen.getByRole('button', { name: /Rufnummer und Funkrufname/ }));
    expect(await screen.findByLabelText('Rufnummer')).toHaveAttribute(
      'maxlength',
      String(EXTERNE_STELLE_KURZ_MAX),
    );
    expect(screen.getByLabelText('Funkrufname')).toBeInTheDocument();
  });

  it('„Zuständige Leitstelle“ nur bei Art Leitstelle, angelegt mit Markierung', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/externe-stellen', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...ils, id: 9 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    await nutzer.type(await screen.findByLabelText('Bezeichnung'), 'ILS Nord');
    expect(screen.queryByLabelText('Zuständige Leitstelle')).toBeNull();
    await artWaehlen(nutzer, 'Polizei');
    expect(screen.queryByLabelText('Zuständige Leitstelle')).toBeNull();
    await artWaehlen(nutzer, 'Leitstelle');
    await nutzer.click(await screen.findByLabelText('Zuständige Leitstelle'));

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(body).toEqual({ bezeichnung: 'ILS Nord', art: 'leitstelle', zustaendig: true }),
    );
  });

  it('Bearbeiten ohne Kontaktfelder lässt Rufnummer und Funkrufname im PATCH weg', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/externe-stellen/4', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(ils);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={ils} />);
    expect(await screen.findByLabelText('Bezeichnung')).toHaveValue('ILS Musterkreis');
    expect(screen.getByLabelText('Zuständige Leitstelle')).toBeChecked();
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(body).toEqual({ bezeichnung: 'ILS Musterkreis', art: 'leitstelle', zustaendig: true }),
    );
  });

  it('Bearbeiten mit Rufnummer öffnet den Bereich und leert ein geleertes Feld mit null', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/externe-stellen/4', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(ils);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(
      <Harness bestand={{ ...ils, rufnummer: '112', funkrufname: 'Leitstelle' }} />,
    );
    const ruf = await screen.findByLabelText('Rufnummer');
    expect(ruf).toHaveValue('112');
    await nutzer.clear(screen.getByLabelText('Funkrufname'));
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(body).toEqual({
        bezeichnung: 'ILS Musterkreis',
        art: 'leitstelle',
        zustaendig: true,
        rufnummer: '112',
        funkrufname: null,
      }),
    );
  });

  it('nennt eine Ablehnung (409) im Dialog', async () => {
    server.use(
      http.post('/api/externe-stellen', () =>
        HttpResponse.json(
          { error: 'Eine externe Stelle mit dieser Bezeichnung gibt es schon' },
          { status: 409 },
        ),
      ),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await nutzer.type(within(dialog).getByLabelText('Bezeichnung'), 'Polizei');
    await artWaehlen(nutzer, 'Polizei');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('gibt es schon');
    expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('Polizei');
  });
});
