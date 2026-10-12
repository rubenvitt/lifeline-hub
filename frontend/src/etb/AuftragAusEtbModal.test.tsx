import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import type { EtbEintragAnzeige } from '../api/types';
import AuftragAusEtbModal from './AuftragAusEtbModal';

vi.mock('../fuehrung/useFunktionsVorschlaege', async () => ({
  useFunktionsVorschlaege: (await import('../test/fuehrungsfunktionen')).vorschlaegeFuer,
}));

/** LLH-1091: auch aus dem ETB steht die Einheit vor dem Auftrag (FwDV 100). */
describe('AuftragAusEtbModal — Reihenfolge nach FwDV 100 (LLH-1091)', () => {
  it('zeigt den Empfänger vor dem vorbelegten Auftragstext und fokussiert ihn', async () => {
    renderMitProviders(
      <AuftragAusEtbModal
        eintrag={{ id: 7, inhalt: 'Deich bei km 3 bricht' } as EtbEintragAnzeige}
        abschnitte={[]}
        einheiten={[]}
        senden={false}
        onAbbrechen={vi.fn()}
        onAnlegen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const etiketten = [...dialog.querySelectorAll('.ant-form-item-label label')].map(
      (l) => l.textContent,
    );
    expect(etiketten.slice(0, 2)).toEqual(['Empfänger', 'Auftrag / Was']);
    expect(within(dialog).getByLabelText('Auftrag / Was')).toHaveValue('Deich bei km 3 bricht');
    await waitFor(() => expect(within(dialog).getByLabelText('Empfänger')).toHaveFocus());
  });
});
