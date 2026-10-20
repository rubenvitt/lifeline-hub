import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { Einheit } from '../../api/types';
import { EINHEIT_ERREICHBARKEIT_MAX } from '../../api/eingabegrenzen';
import type { EinheitPatchHandler } from './EinheitKopf';
import EinheitFunk from './EinheitFunk';

/** Paneel „Funk und Kommunikation“ (LLH-1036, design.md D2): je Zeile genau ein Feld. */

const sprechgruppe = (id: number, bezeichnung: string, betriebsart: 'TMO' | 'DMO') => ({
  id,
  einsatz_id: 1,
  einsatz_lokal: false,
  bezeichnung,
  betriebsart,
  hinweis: null,
  aktiv: true,
  sortier: id,
});
const tmo = sprechgruppe(7, '412_F_DRK', 'TMO');
const dmo = sprechgruppe(8, '314_F_DMO', 'DMO');

function einheit(o: Partial<Einheit> = {}): Einheit {
  return {
    id: 10,
    name: '1. Zug',
    sprechgruppen: [tmo, dmo],
    kommunikationsmittel: null,
    erreichbarkeit: '0151 23456',
    ...o,
  } as unknown as Einheit;
}

function renderFunk(e: Einheit = einheit(), canEdit = true) {
  server.use(http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json([tmo, dmo])));
  const onPatch = vi.fn<EinheitPatchHandler>().mockResolvedValue(undefined);
  renderMitProviders(<EinheitFunk einheit={e} einsatzId={1} canEdit={canEdit} onPatch={onPatch} />);
  return { onPatch };
}

const paneel = () => screen.getByRole('region', { name: 'Funk und Kommunikation' });

describe('EinheitFunk', () => {
  it('zeigt die Sprechgruppen je Betriebsart, ohne Eingabefeld', () => {
    renderFunk();
    expect(paneel()).toHaveTextContent('TMO 412_F_DRK · DMO 314_F_DMO');
    expect(within(paneel()).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(paneel()).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('Sprechgruppen geleert: `sprechgruppe_ids: []`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderFunk();
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen bearbeiten' }));
    const feld = screen.getByRole('combobox', { name: 'Sprechgruppen' }).closest('.ant-select')!;
    await waitFor(() =>
      expect(feld.querySelectorAll('.ant-select-selection-item')).toHaveLength(2),
    );
    await user.click(feld.querySelector('.ant-select-clear')!);
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Sprechgruppen', { sprechgruppe_ids: [] }),
    );
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('Sprechgruppen unverändert: keine Anfrage', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderFunk();
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    expect(await screen.findByRole('button', { name: 'Sprechgruppen bearbeiten' })).toBeVisible();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('Kommunikationsmittel: genau `kommunikationsmittel`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderFunk();
    await user.click(screen.getByRole('button', { name: 'Kommunikationsmittel eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Kommunikationsmittel' }));
    await user.click(await screen.findByTitle('Digitalfunk'));
    await user.click(screen.getByRole('button', { name: 'Kommunikationsmittel speichern' }));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Kommunikationsmittel', {
        kommunikationsmittel: 'digitalfunk',
      }),
    );
  });

  it('Erreichbarkeit: genau `erreichbarkeit`; geleert geht `null`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderFunk();
    await user.click(screen.getByRole('button', { name: 'Erreichbarkeit / Nummer bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Erreichbarkeit / Nummer' }));
    await user.click(screen.getByRole('button', { name: 'Erreichbarkeit / Nummer speichern' }));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Erreichbarkeit / Nummer', { erreichbarkeit: null }),
    );
  });

  it('Erreichbarkeit nimmt nicht mehr Zeichen an als der Server (Spec eingabegrenzen)', async () => {
    const user = userEvent.setup();
    renderFunk();
    await user.click(screen.getByRole('button', { name: 'Erreichbarkeit / Nummer bearbeiten' }));
    expect(screen.getByRole('textbox', { name: 'Erreichbarkeit / Nummer' })).toHaveAttribute(
      'maxLength',
      String(EINHEIT_ERREICHBARKEIT_MAX),
    );
  });

  it('ohne Recht: nur die Werte, kein Stift', () => {
    renderFunk(einheit(), false);
    expect(within(paneel()).queryAllByRole('button')).toHaveLength(0);
    expect(paneel()).toHaveTextContent('0151 23456');
  });
});
