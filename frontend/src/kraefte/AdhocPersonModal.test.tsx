import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import AdhocPersonModal from './AdhocPersonModal';

describe('AdhocPersonModal', () => {
  it('meldet die angelegte Disposition zurück und schliesst', async () => {
    let body: unknown;
    server.use(
      http.post('/api/einsaetze/1/personal', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 77, einsatz_id: 1, name: 'Dr. Schmidt' }, { status: 201 });
      }),
    );
    const onAngelegt = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <AdhocPersonModal offen einsatzId={1} onSchliessen={onSchliessen} onAngelegt={onAngelegt} />,
    );

    await userEvent.type(await screen.findByLabelText('Name'), 'Dr. Schmidt');
    await userEvent.click(screen.getByRole('button', { name: 'Disponieren' }));

    await waitFor(() =>
      expect(onAngelegt).toHaveBeenCalledWith(expect.objectContaining({ id: 77 })),
    );
    expect(onSchliessen).toHaveBeenCalled();
    expect(body).toEqual({ adhoc: expect.objectContaining({ name: 'Dr. Schmidt' }) });
  });

  it('bietet „Speichern und nächste" nur im Serienmodus an', async () => {
    const { unmount } = renderMitProviders(
      <AdhocPersonModal offen einsatzId={1} onSchliessen={() => {}} />,
    );
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).toBeNull();
    unmount();

    renderMitProviders(<AdhocPersonModal offen serie einsatzId={1} onSchliessen={() => {}} />);
    expect(
      await screen.findByRole('button', { name: 'Speichern und nächste' }),
    ).toBeInTheDocument();
  });
});
