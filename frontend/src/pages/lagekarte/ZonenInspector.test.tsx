import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import type { LageZone } from '../../api/types';
import ZonenInspector from './ZonenInspector';

const basisZone: LageZone = {
  id: 1,
  einsatz_id: 1,
  typ: 'gefahrengebiet',
  geometrie_typ: 'Polygon',
  geometrie: '{}',
  label: null,
  farbe: null,
  notiz: null,
  gefahrentyp: null,
  schutzobjekt: null,
  erstellt_von: 1,
  erstellt_at: '',
  geaendert_at: '',
};

/** Öffnet ein antd-Select (per aria-label) und klickt die genannte Option im Dropdown. */
async function waehle(label: string, option: string) {
  // antd rendert das aria-label sowohl am Wrapper-div als auch am Platzhalter-Text;
  // getAllByLabelText + [0] greift deterministisch den Select-Wrapper.
  const select = screen.getAllByLabelText(label)[0];
  // antd öffnet das Dropdown auf mousedown des Selektors (nicht zuverlässig per click).
  const selector = select.querySelector('.ant-select-selector') ?? select;
  fireEvent.mouseDown(selector);
  // Option im geöffneten Dropdown klicken (Muster wie GefahrenPage-Test).
  const optionen = await screen.findAllByText(option);
  await userEvent.click(optionen[optionen.length - 1]);
}

describe('ZonenInspector — Gefahren-Zuordnung', () => {
  it('etabliert eine Zuordnung erst beim vollständigen Paar mit BEIDEN Feldern in einem PATCH', async () => {
    const onAendern = vi.fn();
    renderMitProviders(
      <ZonenInspector
        zone={basisZone}
        darfSchreiben
        onSchliessen={() => {}}
        onAendern={onAendern}
        onLoeschen={() => {}}
      />,
    );

    // Schutzobjekt ist anfangs disabled (kein Gefahrentyp gewählt).
    const schutzobjekt = screen.getAllByLabelText('Schutzobjekt')[0];
    expect(schutzobjekt).toHaveClass('ant-select-disabled');

    // Gefahrentyp wählen → nur Entwurf, KEIN PATCH (schutzobjekt noch leer).
    // (Atemgifte/Menschen: gültige Kombination und beide am Listenanfang → nicht von der antd-Virtualisierung verdeckt.)
    await waehle('Gefahrentyp', 'Atemgifte');
    expect(onAendern).not.toHaveBeenCalled();

    // Schutzobjekt wählen → genau EIN PATCH mit BEIDEN Feldern.
    await waehle('Schutzobjekt', 'Menschen');
    await waitFor(() =>
      expect(onAendern).toHaveBeenCalledWith({ gefahrentyp: 'atemgifte', schutzobjekt: 'menschen' }),
    );
    expect(onAendern).toHaveBeenCalledTimes(1);
  });
});
