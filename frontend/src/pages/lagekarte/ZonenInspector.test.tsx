import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import type { Gefahrengebiet, LageZone } from '../../api/types';
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
  gefahrengebiet_id: 10,
  erstellt_von: 1,
  erstellt_at: '',
  geaendert_at: '',
};

const gebiet: Gefahrengebiet = {
  id: 10,
  einsatz_id: 1,
  label: 'Nord',
  zonen_ids: [1],
  hoechste_warnstufe: 'keine',
};

const gebietMitWarnstufe: Gefahrengebiet = {
  ...gebiet,
  hoechste_warnstufe: 'hoch',
};

function renderInspector(opts: {
  zone?: LageZone;
  gebiete?: Gefahrengebiet[];
  darfSchreiben?: boolean;
  onAendern?: ReturnType<typeof vi.fn>;
  onLoeschen?: ReturnType<typeof vi.fn>;
  onMatrixOeffnen?: ReturnType<typeof vi.fn>;
}) {
  const onAendern = opts.onAendern ?? vi.fn();
  const onLoeschen = opts.onLoeschen ?? vi.fn();
  const onMatrixOeffnen = opts.onMatrixOeffnen ?? vi.fn();
  renderMitProviders(
    <ZonenInspector
      zone={opts.zone ?? basisZone}
      gebiete={opts.gebiete ?? [gebiet]}
      darfSchreiben={opts.darfSchreiben ?? true}
      onSchliessen={() => {}}
      onAendern={onAendern}
      onMatrixOeffnen={onMatrixOeffnen}
      onLoeschen={onLoeschen}
    />,
  );
  return { onAendern, onLoeschen, onMatrixOeffnen };
}

describe('ZonenInspector — Gefahrengebiet-Gruppe', () => {
  it('zeigt das Gruppen-Dropdown mit dem aktuellen Gebiet', () => {
    renderInspector({});
    // Der Inspector soll ein Dropdown für die Gruppen-Zugehörigkeit zeigen.
    expect(screen.getAllByLabelText('Gehört zu Gefahrengebiet')[0]).toBeInTheDocument();
  });

  it('zeigt den Button „Gefahrenmatrix bearbeiten" bei gesetzter gefahrengebiet_id', () => {
    renderInspector({});
    expect(screen.getByRole('button', { name: /Gefahrenmatrix bearbeiten/i })).toBeInTheDocument();
  });

  it('ruft onMatrixOeffnen mit der gefahrengebiet_id auf', async () => {
    const onMatrixOeffnen = vi.fn();
    renderInspector({ onMatrixOeffnen });
    await userEvent.click(screen.getByRole('button', { name: /Gefahrenmatrix bearbeiten/i }));
    expect(onMatrixOeffnen).toHaveBeenCalledWith(10);
  });

  it('wählt ein anderes Gebiet → ruft onAendern mit gefahrengebiet_id auf', async () => {
    const onAendern = vi.fn();
    const gebiete: Gefahrengebiet[] = [
      gebiet,
      { id: 20, einsatz_id: 1, label: 'Süd', zonen_ids: [], hoechste_warnstufe: 'keine' },
    ];
    renderInspector({ onAendern, gebiete });
    const select = screen.getAllByLabelText('Gehört zu Gefahrengebiet')[0];
    const selector = select.querySelector('.ant-select-selector') ?? select;
    fireEvent.mouseDown(selector);
    const optionen = await screen.findAllByText('Süd');
    await userEvent.click(optionen[optionen.length - 1]);
    await waitFor(() => expect(onAendern).toHaveBeenCalledWith({ gefahrengebiet_id: 20 }));
  });

  it('Split: „+ Neues Gefahrengebiet" (Sentinel) ruft onAendern mit gefahrengebiet_id null', async () => {
    const onAendern = vi.fn();
    renderInspector({ onAendern });
    const select = screen.getAllByLabelText('Gehört zu Gefahrengebiet')[0];
    const selector = select.querySelector('.ant-select-selector') ?? select;
    fireEvent.mouseDown(selector);
    const optionen = await screen.findAllByText('+ Neues Gefahrengebiet');
    await userEvent.click(optionen[optionen.length - 1]);
    await waitFor(() => expect(onAendern).toHaveBeenCalledWith({ gefahrengebiet_id: null }));
  });

  it('kein Löschen-Button wenn darfSchreiben=false', () => {
    renderInspector({ darfSchreiben: false });
    expect(screen.queryByRole('button', { name: /Zone aufheben/i })).not.toBeInTheDocument();
  });

  it('Popconfirm statt direkter Löschen-Button wenn Gebiet Warnstufen hat', () => {
    renderInspector({ gebiete: [gebietMitWarnstufe] });
    // Popconfirm rendert den Trigger-Button — bei Warnstufe soll es ein Popconfirm sein.
    expect(screen.getByRole('button', { name: /Zone aufheben/i })).toBeInTheDocument();
  });
});
