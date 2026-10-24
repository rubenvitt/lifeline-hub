import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { Einheit } from '../../api/types';
import type { EinheitPatchHandler } from './EinheitKopf';
import EinheitFunk, { type EinheitSprechgruppenHandler } from './EinheitFunk';

/**
 * Paneele „Funk“ und „Telefon und weitere Verbindungen“ (LLH-1036 D2, LLH-1134): Funk und
 * Telefon getrennt, je Zeile genau ein Feld. Die Sprechgruppen gehen einzeln, als Differenz zum
 * Stand beim Öffnen (LLH-1265, Change `pcrn0wn1-einheit-sprechgruppen-einzelwege`, D1).
 */

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
    verbindungen: [{ id: 1, mittel: 'mobil', wert: '0151 23456', hinweis: null }],
    ...o,
  } as unknown as Einheit;
}

function renderFunk(e: Einheit = einheit(), canEdit = true) {
  server.use(http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json([tmo, dmo])));
  const onPatch = vi.fn<EinheitPatchHandler>().mockResolvedValue(undefined);
  const onSprechgruppen = vi.fn<EinheitSprechgruppenHandler>().mockResolvedValue(undefined);
  const ansicht = (x: Einheit) => (
    <EinheitFunk
      einheit={x}
      einsatzId={1}
      canEdit={canEdit}
      onPatch={onPatch}
      onSprechgruppen={onSprechgruppen}
    />
  );
  const { rerender } = renderMitProviders(ansicht(e));
  return { onPatch, onSprechgruppen, rerender: (x: Einheit) => rerender(ansicht(x)) };
}

/** Die Auswahl der offenen Zeile „Sprechgruppen“, sobald ihre `n` Einträge stehen. */
async function sprechgruppenAuswahl(n: number) {
  const feld = screen.getByRole('combobox', { name: 'Sprechgruppen' }).closest('.ant-select')!;
  await waitFor(() => expect(feld.querySelectorAll('.ant-select-selection-item')).toHaveLength(n));
  return feld;
}

const paneel = () => screen.getByRole('region', { name: 'Funk' });
const telefonPaneel = () =>
  screen.getByRole('region', { name: 'Telefon und weitere Verbindungen' });

describe('EinheitFunk', () => {
  it('zeigt die Sprechgruppen je Betriebsart, ohne Eingabefeld', () => {
    renderFunk();
    expect(paneel()).toHaveTextContent('TMO 412_F_DRK · DMO 314_F_DMO');
    expect(within(paneel()).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(paneel()).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('Sprechgruppe hinzugefügt: nur dieser eine Eintrag, kein PATCH', async () => {
    const user = userEvent.setup();
    const { onPatch, onSprechgruppen } = renderFunk(einheit({ sprechgruppen: [tmo] }));
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen bearbeiten' }));
    await sprechgruppenAuswahl(1);
    await user.click(screen.getByRole('combobox', { name: 'Sprechgruppen' }));
    await user.click(await screen.findByTitle('314_F_DMO'));
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    await waitFor(() => expect(onSprechgruppen).toHaveBeenCalledWith({ hinzu: [8], weg: [] }));
    expect(onSprechgruppen).toHaveBeenCalledTimes(1);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('Sprechgruppen geleert: jede einzeln entfernt', async () => {
    const user = userEvent.setup();
    const { onPatch, onSprechgruppen } = renderFunk();
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen bearbeiten' }));
    const feld = await sprechgruppenAuswahl(2);
    await user.click(feld.querySelector('.ant-select-clear')!);
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    await waitFor(() => expect(onSprechgruppen).toHaveBeenCalledWith({ hinzu: [], weg: [7, 8] }));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('eine während der Bearbeitung fremd zugeordnete Sprechgruppe bleibt stehen', async () => {
    const user = userEvent.setup();
    const { onSprechgruppen, rerender } = renderFunk(einheit({ sprechgruppen: [tmo] }));
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen bearbeiten' }));
    const feld = await sprechgruppenAuswahl(1);
    // Ein anderer Arbeitsplatz ordnet 314_F_DMO zu; der Stand kommt live, der Entwurf bleibt.
    rerender(einheit({ sprechgruppen: [tmo, dmo] }));
    await user.click(feld.querySelector('.ant-select-clear')!);
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    await waitFor(() => expect(onSprechgruppen).toHaveBeenCalledWith({ hinzu: [], weg: [7] }));
  });

  it('Sprechgruppen unverändert: keine Anfrage', async () => {
    const user = userEvent.setup();
    const { onPatch, onSprechgruppen } = renderFunk();
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    expect(await screen.findByRole('button', { name: 'Sprechgruppen bearbeiten' })).toBeVisible();
    expect(onPatch).not.toHaveBeenCalled();
    expect(onSprechgruppen).not.toHaveBeenCalled();
  });

  it('Funk und Telefon stehen getrennt: die Nummer nur unter „Telefon und weitere Verbindungen“', () => {
    renderFunk();
    expect(paneel()).not.toHaveTextContent('0151 23456');
    expect(within(telefonPaneel()).getByRole('link', { name: '0151 23456' })).toHaveAttribute(
      'href',
      'tel:015123456',
    );
    expect(document.body.textContent).not.toMatch(/erreichbar|kommunikationsmittel/i);
  });

  it('Verbindungen: genau `verbindungen` als Ersatzliste', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderFunk();
    await user.click(
      screen.getByRole('button', { name: 'Telefon und weitere Verbindungen bearbeiten' }),
    );
    await user.click(screen.getByRole('button', { name: 'Verbindung hinzufügen' }));
    await user.type(screen.getByRole('textbox', { name: 'Nummer oder Adresse 2' }), 'zug1@drk.de');
    await user.click(screen.getByRole('combobox', { name: 'Mittel 2' }));
    await user.click(await screen.findByTitle('E-Mail'));
    await user.click(
      screen.getByRole('button', { name: 'Telefon und weitere Verbindungen speichern' }),
    );
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Telefon und weitere Verbindungen', {
        verbindungen: [
          { mittel: 'mobil', wert: '0151 23456' },
          { mittel: 'email', wert: 'zug1@drk.de' },
        ],
      }),
    );
  });

  it('alle Verbindungen entfernt: `verbindungen: []`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderFunk();
    await user.click(
      screen.getByRole('button', { name: 'Telefon und weitere Verbindungen bearbeiten' }),
    );
    await user.click(screen.getByRole('button', { name: 'Verbindung 1 entfernen' }));
    await user.click(
      screen.getByRole('button', { name: 'Telefon und weitere Verbindungen speichern' }),
    );
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Telefon und weitere Verbindungen', {
        verbindungen: [],
      }),
    );
  });

  it('ohne Recht: nur die Werte, kein Stift', () => {
    renderFunk(einheit(), false);
    expect(within(paneel()).queryAllByRole('button')).toHaveLength(0);
    expect(within(telefonPaneel()).queryAllByRole('button')).toHaveLength(0);
    expect(telefonPaneel()).toHaveTextContent('0151 23456');
  });
});
