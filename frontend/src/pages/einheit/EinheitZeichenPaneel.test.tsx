import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import type { Einheit } from '../../api/types';
import EinheitZeichenPaneel, { type EinheitZeichenHandler } from './EinheitZeichenPaneel';

/**
 * Paneel „Taktisches Zeichen“ (LLH-1036, design.md D4): Fachaufgabe und Organisation je an ihrer
 * Zeile, genau ein `tz_*`-Feld je Anfrage. Dass der Body am Lageweg genau dieses Feld trägt, belegt
 * `api/einheiten.test.ts`; den ganzen Weg `EinheitDetailPage.test.tsx`.
 */

function einheit(o: Partial<Einheit> = {}): Einheit {
  return {
    id: 10,
    name: '1. Zug',
    typ_label: 'Zug',
    tz_fachaufgabe: null,
    tz_organisation: null,
    ...o,
  } as unknown as Einheit;
}

function renderZeichen(
  e: Einheit = einheit(),
  { orgDefault = null, canEdit = true }: { orgDefault?: string | null; canEdit?: boolean } = {},
) {
  const onPatchZeichen = vi.fn<EinheitZeichenHandler>().mockResolvedValue(undefined);
  renderMitProviders(
    <EinheitZeichenPaneel
      einheit={e}
      canEdit={canEdit}
      orgDefault={orgDefault}
      onPatchZeichen={onPatchZeichen}
    />,
  );
  return { onPatchZeichen };
}

const paneel = () => screen.getByRole('region', { name: 'Taktisches Zeichen' });
const vorgabe = () => paneel().querySelector('[data-lfh="zeichen-vorgabe"]');

describe('EinheitZeichenPaneel', () => {
  it('Organisation: genau `tz_organisation`, die Vorschau zeigt den Entwurf', async () => {
    const user = userEvent.setup();
    const { onPatchZeichen } = renderZeichen();
    await user.click(screen.getByRole('button', { name: 'Organisation eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Organisation' }));
    await user.click(await screen.findByTitle('THW'));
    expect(paneel().querySelector('[data-lfh="einheit-zeichen"] svg desc')).toHaveTextContent(
      'Organisation: Technisches Hilfswerk',
    );
    await user.click(screen.getByRole('button', { name: 'Organisation speichern' }));
    await waitFor(() => expect(onPatchZeichen).toHaveBeenCalledTimes(1));
    expect(onPatchZeichen).toHaveBeenCalledWith('Organisation', { tz_organisation: 'thw' });
  });

  it('Fachaufgabe: genau `tz_fachaufgabe`', async () => {
    const user = userEvent.setup();
    const { onPatchZeichen } = renderZeichen();
    await user.click(screen.getByRole('button', { name: 'Fachaufgabe eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Fachaufgabe' }));
    await user.click(await screen.findByTitle('Betreuung'));
    await user.click(screen.getByRole('button', { name: 'Fachaufgabe speichern' }));
    await waitFor(() =>
      expect(onPatchZeichen).toHaveBeenCalledWith('Fachaufgabe', { tz_fachaufgabe: 'betreuung' }),
    );
  });

  it('geleert geht `null`', async () => {
    const user = userEvent.setup();
    const { onPatchZeichen } = renderZeichen(einheit({ tz_fachaufgabe: 'betreuung' }));
    await user.click(screen.getByRole('button', { name: 'Fachaufgabe bearbeiten' }));
    const feld = screen.getByRole('combobox', { name: 'Fachaufgabe' }).closest('.ant-select')!;
    await user.click(feld.querySelector('.ant-select-clear')!);
    await user.click(screen.getByRole('button', { name: 'Fachaufgabe speichern' }));
    await waitFor(() =>
      expect(onPatchZeichen).toHaveBeenCalledWith('Fachaufgabe', { tz_fachaufgabe: null }),
    );
  });

  it('leere Organisation mit Vorgabe: „Vorgabe der Organisation: …“', () => {
    renderZeichen(einheit(), { orgDefault: 'thw' });
    expect(vorgabe()).toHaveTextContent('Vorgabe der Organisation: THW');
  });

  it('eigene Organisation: kein Vorgabe-Text', () => {
    renderZeichen(einheit({ tz_organisation: 'feuerwehr' }), { orgDefault: 'thw' });
    expect(within(paneel()).getByText('Feuerwehr')).toBeInTheDocument();
    expect(vorgabe()).toBeNull();
  });

  it('ohne Vorgabe der Organisation: kein Vorgabe-Text', () => {
    renderZeichen(einheit(), { orgDefault: null });
    expect(vorgabe()).toBeNull();
  });

  it('ohne Recht: kein Stift', () => {
    renderZeichen(einheit({ tz_organisation: 'thw' }), { canEdit: false });
    expect(within(paneel()).queryAllByRole('button')).toHaveLength(0);
    expect(paneel()).toHaveTextContent('THW');
  });
});
