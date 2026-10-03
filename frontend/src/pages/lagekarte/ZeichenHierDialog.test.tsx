import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import ZeichenHierDialog from './ZeichenHierDialog';

beforeEach(() => localStorage.clear());

/**
 * „Hier Zeichen setzen“ aus dem Kontextmenü (LFH-776, D7): Zeichenwahl im Dialog, „Setzen“ legt an
 * der Stelle an — kein zweiter Tipp auf die Karte.
 */
function aufbau(extra: { laeuft?: boolean; quelle?: 'maus' | 'touch' } = {}) {
  const onSetzen = vi.fn();
  const onAbbrechen = vi.fn();
  const r = renderMitProviders(
    <ZeichenHierDialog
      offen
      quelle={extra.quelle ?? 'maus'}
      laeuft={extra.laeuft ?? false}
      onSetzen={onSetzen}
      onAbbrechen={onAbbrechen}
    />,
  );
  return { ...r, onSetzen, onAbbrechen };
}

const dialog = () => screen.getByRole('dialog', { name: 'Zeichen hier setzen' });
const raster = (name: string) => within(dialog()).getByRole('radiogroup', { name });

describe('ZeichenHierDialog (LFH-776)', () => {
  it('„Setzen“ meldet das gewählte Zeichen', async () => {
    const { onSetzen, onAbbrechen } = aufbau();
    await userEvent.click(within(raster('Grundzeichen')).getByRole('radio', { name: 'Person' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Setzen' }));
    expect(onSetzen).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ grundzeichen: 'person' }),
    );
    expect(onAbbrechen).not.toHaveBeenCalled();
  });

  it('Enter im Picker wirkt wie „Setzen“', () => {
    const { onSetzen } = aufbau();
    const kachel = within(raster('Grundzeichen')).getByRole('radio', { name: 'Person' });
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    expect(onSetzen).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ grundzeichen: 'person' }),
    );
  });

  it('während des Speicherns ist „Setzen“ gesperrt und meldet nichts', async () => {
    const { onSetzen } = aufbau({ laeuft: true });
    const knopf = within(dialog()).getByRole('button', { name: /Setzen/ });
    await userEvent.click(knopf);
    const kachel = within(raster('Grundzeichen')).getByRole('radio', { name: 'Person' });
    fireEvent.keyDown(kachel, { key: 'Enter' });
    expect(onSetzen).not.toHaveBeenCalled();
  });

  it('„Abbrechen“ und Esc legen nichts an', async () => {
    const { onSetzen, onAbbrechen } = aufbau();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalledOnce();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(onAbbrechen).toHaveBeenCalledTimes(2));
    expect(onSetzen).not.toHaveBeenCalled();
  });

  it('fokussiert die Suche nur bei der Maus, am Touchschirm nicht (Bildschirmtastatur)', async () => {
    const maus = aufbau({ quelle: 'maus' });
    await waitFor(() => expect(within(dialog()).getByLabelText('Grundzeichen suchen')).toHaveFocus());
    maus.unmount();
    aufbau({ quelle: 'touch' });
    await new Promise((r) => setTimeout(r, 30));
    expect(within(dialog()).getByLabelText('Grundzeichen suchen')).not.toHaveFocus();
  });
});
