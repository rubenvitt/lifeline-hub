// src/etb/BausteinPlatzhalterModal.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import BausteinPlatzhalterModal from './BausteinPlatzhalterModal';

const einsatz = {
  id: 1,
  bezeichnung: 'Test',
  stichwort: null,
  leitstellen_nr: null,
  einsatzort: null,
} as unknown as EinsatzAnzeige;

function baustein(over: Partial<EtbBaustein> = {}): EtbBaustein {
  return {
    id: 1,
    label: 'B',
    typ: 'meldung',
    inhalt: 'Melder {melder} meldet',
    meldeweg: null,
    veranlassung: null,
    sortier: 0,
    ...over,
  };
}

describe('BausteinPlatzhalterModal', () => {
  it('fragt manuelle Platzhalter ab und liefert eingesetzte Felder', async () => {
    const onEinsetzen = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={baustein()}
        einsatz={einsatz}
        onEinsetzen={onEinsetzen}
        onAbbrechenAll={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText('melder'), 'Florian');
    await userEvent.click(screen.getByRole('button', { name: 'Einsetzen' }));
    await waitFor(() => expect(onEinsetzen).toHaveBeenCalledTimes(1));
    expect(onEinsetzen.mock.calls[0][0]).toMatchObject({ inhalt: 'Melder Florian meldet' });
  });

  it('fokussiert nur das erste dynamische Platzhalterfeld', () => {
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={baustein({ inhalt: '{melder} an {ziel}' })}
        einsatz={einsatz}
        onEinsetzen={vi.fn()}
        onAbbrechenAll={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('melder')).toHaveFocus();
    expect(screen.getByLabelText('ziel')).not.toHaveFocus();
  });

  it('Enter in einem Platzhalterfeld setzt den Baustein ein', async () => {
    const onEinsetzen = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={baustein()}
        einsatz={einsatz}
        onEinsetzen={onEinsetzen}
        onAbbrechenAll={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText('melder'), 'Florian{Enter}');
    await waitFor(() => expect(onEinsetzen).toHaveBeenCalledTimes(1));
    expect(onEinsetzen.mock.calls[0][0]).toMatchObject({ inhalt: 'Melder Florian meldet' });
  });

  it('der sichtbare Submit-Button setzt den Baustein ein', async () => {
    const onEinsetzen = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={baustein()}
        einsatz={einsatz}
        onEinsetzen={onEinsetzen}
        onAbbrechenAll={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText('melder'), 'Florian');
    await userEvent.click(screen.getByRole('button', { name: 'Einsetzen' }));
    await waitFor(() => expect(onEinsetzen).toHaveBeenCalledTimes(1));
  });

  it('Abbrechen leert eingegebene Platzhalterwerte', async () => {
    const onAbbrechenAll = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={baustein()}
        einsatz={einsatz}
        onEinsetzen={vi.fn()}
        onAbbrechenAll={onAbbrechenAll}
      />,
    );
    const feld = screen.getByLabelText('melder');
    await userEvent.type(feld, 'Florian');
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onAbbrechenAll).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText('melder')).toHaveValue(''));
  });

  it('setzt Baustein ohne Platzhalter sofort ein (kein Modal)', async () => {
    const onEinsetzen = vi.fn();
    renderMitProviders(
      <BausteinPlatzhalterModal
        baustein={baustein({ inhalt: 'Bereitstellung' })}
        einsatz={einsatz}
        onEinsetzen={onEinsetzen}
        onAbbrechenAll={vi.fn()}
      />,
    );
    await waitFor(() => expect(onEinsetzen).toHaveBeenCalledTimes(1));
    expect(onEinsetzen.mock.calls[0][0]).toMatchObject({ inhalt: 'Bereitstellung' });
  });
});
