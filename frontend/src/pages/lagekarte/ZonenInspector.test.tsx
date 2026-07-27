import { type Mock, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import type { Gefahrengebiet, LageZone } from '../../api/types';
import ZonenInspector, { type ZonenInspectorProps } from './ZonenInspector';

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
  onAendern?: Mock<ZonenInspectorProps['onAendern']>;
  onLoeschen?: Mock<ZonenInspectorProps['onLoeschen']>;
  onMatrixOeffnen?: Mock<ZonenInspectorProps['onMatrixOeffnen']>;
}) {
  const onAendern = opts.onAendern ?? vi.fn<ZonenInspectorProps['onAendern']>();
  const onLoeschen = opts.onLoeschen ?? vi.fn<ZonenInspectorProps['onLoeschen']>();
  const onMatrixOeffnen = opts.onMatrixOeffnen ?? vi.fn<ZonenInspectorProps['onMatrixOeffnen']>();
  renderMitProviders(
    <ZonenInspector
      zone={opts.zone ?? basisZone}
      gebiete={opts.gebiete ?? [gebiet]}
      darfSchreiben={opts.darfSchreiben ?? true}
      onSchliessen={() => {}}
      onAendern={onAendern}
      onMatrixOeffnen={onMatrixOeffnen}
      onLoeschen={onLoeschen}
      ansichten={[]}
    />,
  );
  return { onAendern, onLoeschen, onMatrixOeffnen };
}

describe('ZonenInspector — Gefahrengebiet-Gruppe', () => {
  it('zeigt das Gruppen-Dropdown mit dem aktuellen Gebiet', () => {
    renderInspector({});
    // Der Inspector soll ein Dropdown für die Gruppen-Zugehörigkeit zeigen.
    expect(screen.getAllByLabelText('Gehört zu Gefahrengebiet')[0]).toBeInTheDocument();
    // Seit LFH-328 trägt ein echtes <label> den Namen (kein aria-label mehr): der sichtbare
    // Text ist der Accessible Name, der gewählte Gebietsname steckt NICHT darin.
    expect(screen.getByRole('combobox', { name: 'Gehört zu Gefahrengebiet' })).toBeInTheDocument();
  });

  it('zeigt den Button „Gefahrenmatrix bearbeiten" bei gesetzter gefahrengebiet_id', () => {
    renderInspector({});
    expect(screen.getByRole('button', { name: /Gefahrenmatrix bearbeiten/i })).toBeInTheDocument();
  });

  it('ruft onMatrixOeffnen mit der gefahrengebiet_id auf', async () => {
    const onMatrixOeffnen = vi.fn<ZonenInspectorProps['onMatrixOeffnen']>();
    renderInspector({ onMatrixOeffnen });
    await userEvent.click(screen.getByRole('button', { name: /Gefahrenmatrix bearbeiten/i }));
    expect(onMatrixOeffnen).toHaveBeenCalledWith(10);
  });

  it('wählt ein anderes Gebiet → ruft onAendern mit gefahrengebiet_id auf', async () => {
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>();
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
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>();
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

describe('ZonenInspector — Kennzahlen (LFH-146)', () => {
  const polygonZone: LageZone = {
    ...basisZone,
    typ: 'freie_skizze',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[8, 50], [8.02, 50], [8.02, 50.02], [8, 50.02], [8, 50]]],
    }),
    gefahrengebiet_id: null,
  };
  const linienZone: LageZone = {
    ...basisZone,
    typ: 'absperrgrenze',
    geometrie_typ: 'LineString',
    geometrie: JSON.stringify({ type: 'LineString', coordinates: [[8, 50], [8, 51]] }),
    gefahrengebiet_id: null,
  };

  it('zeigt Fläche und Umfang für eine Polygon-Zone', () => {
    renderInspector({ zone: polygonZone, gebiete: [] });
    expect(screen.getByText('Fläche')).toBeInTheDocument();
    expect(screen.getByText('Umfang')).toBeInTheDocument();
    // ein plausibler, lokalisierter Flächenwert (m²/ha/km²) ist zu sehen
    expect(screen.getByText(/\d.*(m²|ha|km²)/)).toBeInTheDocument();
    expect(screen.queryByText('Länge')).not.toBeInTheDocument();
  });

  it('zeigt Länge (statt Fläche) für eine Linien-Zone', () => {
    renderInspector({ zone: linienZone, gebiete: [] });
    expect(screen.getByText('Länge')).toBeInTheDocument();
    expect(screen.queryByText('Fläche')).not.toBeInTheDocument();
    expect(screen.getByText(/\bkm\b/)).toBeInTheDocument(); // 1° ≈ 111 km
  });

  it('zeigt höchste Warnstufe und Zonen-Anzahl für ein Gefahrengebiet', () => {
    const zone: LageZone = {
      ...basisZone,
      geometrie: JSON.stringify({
        type: 'Polygon',
        coordinates: [[[8, 50], [8.01, 50], [8.01, 50.01], [8, 50.01], [8, 50]]],
      }),
    };
    const g: Gefahrengebiet = { ...gebiet, hoechste_warnstufe: 'hoch', zonen_ids: [1, 2, 3] };
    renderInspector({ zone, gebiete: [g] });
    expect(screen.getByText('Höchste Warnstufe')).toBeInTheDocument();
    expect(screen.getByText('Hoch')).toBeInTheDocument();
    expect(screen.getByText('Zonen')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('rendert keine Kennzahl bei unparsebarer Geometrie (kein Crash)', () => {
    // basisZone.geometrie === '{}' → parseGeometry liefert null
    renderInspector({ zone: { ...basisZone, gefahrengebiet_id: null }, gebiete: [] });
    expect(screen.queryByText('Fläche')).not.toBeInTheDocument();
    expect(screen.queryByText('Länge')).not.toBeInTheDocument();
  });
});
