import { type Mock, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
  const gemeinsameProps = {
    gebiete: opts.gebiete ?? [gebiet],
    darfSchreiben: opts.darfSchreiben ?? true,
    onSchliessen: () => {},
    onAendern,
    onMatrixOeffnen,
    onLoeschen,
    ansichten: [],
  } satisfies Omit<ZonenInspectorProps, 'zone'>;
  const ergebnis = renderMitProviders(
    <ZonenInspector
      zone={opts.zone ?? basisZone}
      {...gemeinsameProps}
    />,
  );
  return {
    onAendern,
    onLoeschen,
    onMatrixOeffnen,
    ...ergebnis,
    rerenderZone: (zone: LageZone) => ergebnis.rerender(
      <ZonenInspector zone={zone} {...gemeinsameProps} />,
    ),
  };
}

describe('ZonenInspector — Gefahrengebiet-Gruppe', () => {
  it('hält Eingaben kontrolliert und quittiert den laufenden Speichervorgang sichtbar', async () => {
    let freigeben: (() => void) | undefined;
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>(() =>
      new Promise<void>((resolve) => { freigeben = resolve; }));
    renderInspector({ onAendern });

    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.type(label, 'Nordzone');
    fireEvent.blur(label);

    expect(onAendern).toHaveBeenCalledWith({ label: 'Nordzone' });
    expect(label).toHaveValue('Nordzone');
    expect(screen.getByText('speichert …')).toBeInTheDocument();
    expect(label).toBeDisabled();

    await act(async () => { freigeben?.(); });
    expect(await screen.findByText('gespeichert')).toBeInTheDocument();
    expect(label).toBeEnabled();
  });

  it('bewahrt einen noch nicht geblurten Entwurf bei einem Same-ID-Refetch', async () => {
    const { rerenderZone } = renderInspector({});
    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.type(label, 'lokaler Entwurf');

    rerenderZone({ ...basisZone, label: 'neuer Serverstand', notiz: 'extern geändert' });

    expect(label).toHaveValue('lokaler Entwurf');
  });

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
    // Das Label kommt seit LFH-328 aus `warnstufeKarte` (Statusfarb-Vertrag) und nicht
    // mehr aus dem WARNSTUFEN-Katalog: klein wie alle anderen Status-Labels des Vertrags
    // ('aktiv', 'geplant', 'aufgelöst'). Der Katalog bleibt für Auswahl-Dropdowns.
    expect(screen.getByText('hoch')).toBeInTheDocument();
    expect(screen.getByText('Zonen')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('rendert keine Kennzahl bei unparsebarer Geometrie (kein Crash)', () => {
    // basisZone.geometrie === '{}' → parseGeometry liefert null
    renderInspector({ zone: { ...basisZone, gefahrengebiet_id: null }, gebiete: [] });
    expect(screen.queryByText('Fläche')).not.toBeInTheDocument();
    expect(screen.queryByText('Länge')).not.toBeInTheDocument();
  });

  it('hinterlässt ohne Kennzahlen keine leere Space-Zeile', () => {
    // antds `Space` filtert `false`/`null` als KIND heraus, wickelt aber eine Komponente,
    // die null RENDERT, trotzdem in ein `.ant-space-item` (gemessen: 3 statt 2). Ein
    // unbedingt eingehängtes `<GeoKennzahlen>` erzeugte damit im häufigen Fall (freie
    // Skizze, unparsebare Geometrie) eine sichtbare Lücke. Die Bedingung gehört deshalb
    // an die Aufrufstelle, nicht nur in die Komponente.
    const { container: ohne } = renderInspector({
      zone: { ...basisZone, gefahrengebiet_id: null },
      gebiete: [],
    });
    const { container: mit } = renderInspector({ zone: polygonZone, gebiete: [] });
    const zaehle = (c: HTMLElement) => c.querySelectorAll('.ant-space-item').length;
    expect(zaehle(ohne)).toBe(zaehle(mit) - 1);
  });
});

describe('ZonenInspector — Zonenwechsel (LFH-349/H43)', () => {
  // Träger der Zusicherung ist der Reset-Effekt IN `ZonenInspector` (Vergleich gegen
  // `entwurfZoneId`), NICHT ein `key` an der Aufrufstelle in `LagekartePage`. Ein `key`
  // daneben wäre eine zweite Wahrheit; hier wird deshalb der Effekt gepinnt.
  //
  // Der historische Fehler (H43): Bezeichnung/Farbe/Notiz waren unkontrolliert
  // (`defaultValue`), beim Wechsel A→B standen also weiter die Werte von A im Feld — und ein
  // bloßer Fokuswechsel im Label-Feld schrieb `onAendern({ label: 'Alpha' })` auf Zone B.
  // Behoben wurde das mit LFH-334 (kontrollierte Felder + Reset-Effekt); hier kommt der
  // fehlende Regressionstest nach.
  const zoneA: LageZone = {
    ...basisZone,
    id: 1,
    typ: 'freie_skizze',
    label: 'Alpha',
    notiz: 'NotizA',
    // jsdom sanitisiert `input[type=color]` auf `#` + sechs KLEINbuchstaben-Hexziffern —
    // ein Großbuchstabe im Fixture käme als '#000000' zurück.
    farbe: '#ff0000',
    gefahrengebiet_id: null,
  };
  const zoneB: LageZone = {
    ...zoneA,
    id: 2,
    label: 'Bravo',
    notiz: 'NotizB',
    farbe: '#00ff00',
  };

  /** Sichtbarer Wert eines antd-Select — das `combobox` selbst ist ohne Suche leer.
   *  antd 6 rendert die gewählte Option als `.ant-select-content` (nicht mehr
   *  `-selection-item`); Präzedenz `stammdaten/EtbBausteinFormModal.test.tsx:88`. */
  const gewaehlt = (combobox: HTMLElement) =>
    combobox.closest('.ant-select')?.querySelector('.ant-select-content')?.textContent;

  it('zeigt nach dem Wechsel A→B die Werte von B und schreibt beim bloßen Blur nicht', async () => {
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>();
    const { rerenderZone } = renderInspector({ zone: zoneA, gebiete: [], onAendern });

    const label = screen.getByRole('textbox', { name: 'Label' });
    const farbe = screen.getByLabelText('Farbe');
    const notiz = screen.getByRole('textbox', { name: 'Notiz' });
    expect(label).toHaveValue('Alpha');
    expect(notiz).toHaveValue('NotizA');
    expect(farbe).toHaveValue('#ff0000');

    // `rerender` ist act-gewickelt: der Reset-Effekt ist danach durch.
    rerenderZone(zoneB);

    expect(label).toHaveValue('Bravo');
    expect(notiz).toHaveValue('NotizB');
    expect(farbe).toHaveValue('#00ff00');

    // Reiner Fokuswechsel ohne Eingabe darf KEIN PATCH auslösen: der Entwurf trägt bereits
    // die Werte von B, der onBlur-Vergleich gegen `zone.*` findet also keine Änderung.
    await userEvent.click(label);
    fireEvent.blur(label);
    await userEvent.click(notiz);
    fireEvent.blur(notiz);
    await userEvent.click(farbe);
    fireEvent.blur(farbe);
    expect(onAendern).not.toHaveBeenCalled();

    // Gegenaussage — ohne sie wäre „nicht aufgerufen" auch bei ersatzlos entferntem `onBlur`
    // grün: eine echte Eingabe auf B muss weiterhin ankommen.
    await userEvent.clear(label);
    await userEvent.type(label, 'Charlie');
    fireEvent.blur(label);
    expect(onAendern).toHaveBeenCalledWith({ label: 'Charlie' });
  });

  it('trägt eine nach dem Wechsel eintreffende Quittung von A nicht an B', async () => {
    let freigeben: (() => void) | undefined;
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>(() =>
      new Promise<void>((resolve) => { freigeben = resolve; }));
    const { rerenderZone } = renderInspector({ zone: zoneA, onAendern });

    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.type(label, 'X');
    fireEvent.blur(label);
    expect(screen.getByText('speichert …')).toBeInTheDocument();

    rerenderZone(zoneB);
    expect(screen.queryByText('speichert …')).not.toBeInTheDocument();

    // Der Lauf von A löst erst JETZT auf — ohne invalidierten Zähler stünde an Zone B
    // „gespeichert" für einen Vorgang, der nie zu ihr gehörte.
    await act(async () => { freigeben?.(); });
    expect(screen.queryByText('gespeichert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Bravo');
  });

  it('zieht beim Wechsel auch den Typ nach (Farbfeld weg, Gebiets-Zuordnung da)', () => {
    const gefahrenZone: LageZone = {
      ...zoneB,
      typ: 'gefahrengebiet',
      farbe: null,
      gefahrengebiet_id: 10,
    };
    const { rerenderZone } = renderInspector({ zone: zoneA, gebiete: [gebiet] });

    expect(screen.getByLabelText('Farbe')).toBeInTheDocument();
    expect(screen.queryByText('Gehört zu Gefahrengebiet')).not.toBeInTheDocument();

    rerenderZone(gefahrenZone);

    // Die beiden tragenden Aussagen hängen direkt an `entwurf.typ` und nicht an
    // antd-Interna — der Text der Auswahlanzeige ist nur die Zusatzprobe.
    expect(screen.queryByLabelText('Farbe')).not.toBeInTheDocument();
    expect(screen.getByText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
    expect(gewaehlt(screen.getByRole('combobox', { name: 'Zonen-Typ' }))).toBe('Gefahrengebiet');
  });
});
