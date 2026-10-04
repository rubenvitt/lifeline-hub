import { type Mock, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { offeneRueckfrage } from '../../test/rueckfrage';
import { renderMitProviders } from '../../test/utils';
import type { Gefahrengebiet, LageZone } from '../../api/types';
import ZonenInspector, { type ZonenInspectorProps } from './ZonenInspector';
import { FREIE_SKIZZE_VORGABE, zoneStil } from './zonenStil';

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
    <ZonenInspector zone={opts.zone ?? basisZone} {...gemeinsameProps} />,
  );
  return {
    onAendern,
    onLoeschen,
    onMatrixOeffnen,
    ...ergebnis,
    rerenderZone: (zone: LageZone) =>
      ergebnis.rerender(<ZonenInspector zone={zone} {...gemeinsameProps} />),
  };
}

describe('ZonenInspector — Gefahrengebiet-Gruppe', () => {
  it('hält Eingaben kontrolliert und quittiert den laufenden Speichervorgang sichtbar', async () => {
    let freigeben: (() => void) | undefined;
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>(
      () =>
        new Promise<void>((resolve) => {
          freigeben = resolve;
        }),
    );
    renderInspector({ onAendern });

    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.type(label, 'Nordzone');
    fireEvent.blur(label);

    expect(onAendern).toHaveBeenCalledWith({ label: 'Nordzone' });
    expect(label).toHaveValue('Nordzone');
    expect(screen.getByText('speichert …')).toBeInTheDocument();
    expect(label).toBeDisabled();

    await act(async () => {
      freigeben?.();
    });
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
    expect(screen.getAllByLabelText('Gehört zu Gefahrengebiet')[0]).toBeInTheDocument();
    // Ein echtes <label> trägt den Namen: der sichtbare Text ist der Accessible Name, der gewählte
    // Gebietsname steckt nicht darin.
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
});

/**
 * Rückfrage vor dem Aufheben: die Zone wird hart gelöscht, also unumkehrbar — in beiden Zweigen,
 * nicht nur bei einem Gefahrengebiet mit Warnstufen. Der OK-Knopf trägt `danger`.
 */
describe('ZonenInspector — Rückfrage vor dem Aufheben (LFH-710)', () => {
  it.each([
    ['ohne Warnstufen', [gebiet], /endgültig gelöscht/],
    ['mit Warnstufen', [gebietMitWarnstufe], /Matrix verloren/],
  ])('%s: erst die Rückfrage, dann genau ein Aufheben', async (_fall, gebiete, hinweis) => {
    const { onLoeschen } = renderInspector({ gebiete });
    await userEvent.click(screen.getByRole('button', { name: 'Zone aufheben' }));

    const rueckfrage = await offeneRueckfrage();
    expect(onLoeschen).not.toHaveBeenCalled();
    expect(rueckfrage).toHaveTextContent('Zone aufheben?');
    expect(rueckfrage).toHaveTextContent(hinweis);
    const ok = within(rueckfrage).getByRole('button', { name: 'Aufheben' });
    expect(ok).toHaveClass('ant-btn-dangerous');

    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Abbrechen' }));
    expect(onLoeschen).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Zone aufheben' }));
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Aufheben' }),
    );
    expect(onLoeschen).toHaveBeenCalledTimes(1);
  });

  it('die Rückfrage nennt die Zone beim Namen, den auch die Karte zeigt', async () => {
    renderInspector({ zone: { ...basisZone, label: 'Sperrzone Süd' } });
    await userEvent.click(screen.getByRole('button', { name: 'Zone aufheben' }));
    expect(await offeneRueckfrage()).toHaveTextContent('„Sperrzone Süd“');
  });
});

describe('ZonenInspector — Kennzahlen (LFH-146)', () => {
  const polygonZone: LageZone = {
    ...basisZone,
    typ: 'freie_skizze',
    geometrie_typ: 'Polygon',
    geometrie: JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [8, 50],
          [8.02, 50],
          [8.02, 50.02],
          [8, 50.02],
          [8, 50],
        ],
      ],
    }),
    gefahrengebiet_id: null,
  };
  const linienZone: LageZone = {
    ...basisZone,
    typ: 'absperrgrenze',
    geometrie_typ: 'LineString',
    geometrie: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [8, 50],
        [8, 51],
      ],
    }),
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
        coordinates: [
          [
            [8, 50],
            [8.01, 50],
            [8.01, 50.01],
            [8, 50.01],
            [8, 50],
          ],
        ],
      }),
    };
    const g: Gefahrengebiet = { ...gebiet, hoechste_warnstufe: 'hoch', zonen_ids: [1, 2, 3] };
    renderInspector({ zone, gebiete: [g] });
    expect(screen.getByText('Höchste Warnstufe')).toBeInTheDocument();
    // Das Label kommt aus `warnstufeKarte` (Statusfarb-Vertrag), klein wie alle Status-Labels. Der
    // WARNSTUFEN-Katalog bleibt für Auswahl-Dropdowns.
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
    // antds `Space` filtert `false`/`null` als Kind heraus, wickelt aber eine Komponente, die null
    // rendert, trotzdem in ein `.ant-space-item` — ein unbedingtes `<GeoKennzahlen>` erzeugte eine
    // sichtbare Lücke. Die Bedingung gehört an die Aufrufstelle.
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
  // Träger der Zusicherung ist der Reset-Effekt in `ZonenInspector` (Vergleich gegen
  // `entwurfZoneId`), nicht ein `key` in `LagekartePage` — der wäre eine zweite Wahrheit. Ohne ihn
  // stünden beim Wechsel A→B die Werte von A im Feld, und ein bloßer Fokuswechsel schriebe sie auf
  // Zone B.
  const zoneA: LageZone = {
    ...basisZone,
    id: 1,
    typ: 'freie_skizze',
    label: 'Alpha',
    notiz: 'NotizA',
    // jsdom sanitisiert `input[type=color]` auf Kleinbuchstaben-Hex — ein Großbuchstabe käme als
    // '#000000' zurück.
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

  /**
   * Sichtbarer Wert eines antd-Select — das `combobox` selbst ist ohne Suche leer. antd 6 rendert
   * die gewählte Option als `.ant-select-content`.
   */
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

    // Ein reiner Fokuswechsel darf kein PATCH auslösen: der Entwurf trägt schon die Werte von B.
    await userEvent.click(label);
    fireEvent.blur(label);
    await userEvent.click(notiz);
    fireEvent.blur(notiz);
    await userEvent.click(farbe);
    fireEvent.blur(farbe);
    expect(onAendern).not.toHaveBeenCalled();

    // Gegenaussage — sonst wäre „nicht aufgerufen" auch ohne `onBlur` grün: eine echte Eingabe auf
    // B muss ankommen.
    await userEvent.clear(label);
    await userEvent.type(label, 'Charlie');
    fireEvent.blur(label);
    expect(onAendern).toHaveBeenCalledWith({ label: 'Charlie' });
  });

  it('trägt eine nach dem Wechsel eintreffende Quittung von A nicht an B', async () => {
    let freigeben: (() => void) | undefined;
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>(
      () =>
        new Promise<void>((resolve) => {
          freigeben = resolve;
        }),
    );
    const { rerenderZone } = renderInspector({ zone: zoneA, onAendern });

    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.type(label, 'X');
    fireEvent.blur(label);
    expect(screen.getByText('speichert …')).toBeInTheDocument();

    rerenderZone(zoneB);
    expect(screen.queryByText('speichert …')).not.toBeInTheDocument();

    // Der Lauf von A löst erst jetzt auf — ohne invalidierten Zähler stünde an Zone B „gespeichert"
    // für einen fremden Vorgang.
    await act(async () => {
      freigeben?.();
    });
    expect(screen.queryByText('gespeichert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Bravo');
  });

  it('quittiert weiter, wenn während des Speicherns ein Same-ID-Refetch eintrifft', async () => {
    // Gegenaussage: das Invalidieren des Lauf-Zählers gehört hinter den Same-ID-Riegel. Der eigene
    // Speichervorgang ändert die Werte, an denen der Effekt hängt — ein Increment davor ließe
    // „gespeichert" nie erscheinen.
    let freigeben: (() => void) | undefined;
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>(
      () =>
        new Promise<void>((resolve) => {
          freigeben = resolve;
        }),
    );
    const { rerenderZone } = renderInspector({ zone: zoneA, onAendern });

    const label = screen.getByRole('textbox', { name: 'Label' });
    await userEvent.type(label, 'X');
    fireEvent.blur(label);
    expect(screen.getByText('speichert …')).toBeInTheDocument();

    // Gleiche id, geänderte Werte — genau das, was der eigene Refetch liefert.
    rerenderZone({ ...zoneA, label: 'AlphaX' });

    await act(async () => {
      freigeben?.();
    });
    expect(await screen.findByText('gespeichert')).toBeInTheDocument();
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

    // Die tragenden Aussagen hängen an `entwurf.typ`, nicht an antd-Interna.
    expect(screen.queryByLabelText('Farbe')).not.toBeInTheDocument();
    expect(screen.getByText('Gehört zu Gefahrengebiet')).toBeInTheDocument();
    expect(gewaehlt(screen.getByRole('combobox', { name: 'Zonen-Typ' }))).toBe('Gefahrengebiet');
  });
});

describe('ZonenInspector — Evakuierungsbezirk (LFH-673)', () => {
  const bezirksZone: LageZone = {
    ...basisZone,
    id: 7,
    typ: 'evakuierungsbezirk',
    gefahrengebiet_id: null,
    evakuierungsbezirk_id: 5,
  };
  const UFER = {
    id: 5,
    einsatz_id: 1,
    bezeichnung: 'Uferstraße 12–40',
    plan_personen: 640,
    plan_erhebung: 'geschaetzt' as const,
    raeumung: 'laeuft' as const,
    flaechen: 1,
    angelegt_at: '2026-09-24 08:00:00',
    stand: { id: 1, evakuiert: 480, erhebung: 'gezaehlt' as const, zeitpunkt_at: '' },
  };
  const HAFEN = { ...UFER, id: 6, bezeichnung: 'Hafenviertel', flaechen: 0, stand: undefined };

  function mitBezirk(
    opts: { zone?: LageZone; darfSchreiben?: boolean; betreuungFrei?: boolean } = {},
  ) {
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>(() => Promise.resolve());
    renderMitProviders(
      <ZonenInspector
        zone={opts.zone ?? bezirksZone}
        gebiete={[]}
        darfSchreiben={opts.darfSchreiben ?? true}
        onSchliessen={() => {}}
        onAendern={onAendern}
        onMatrixOeffnen={vi.fn()}
        onLoeschen={vi.fn()}
        ansichten={[]}
        bezirke={[UFER, HAFEN]}
        betreuungFrei={opts.betreuungFrei ?? true}
        bezirkPfad={(id) => `/einsaetze/1/betreuung?bezirk=${id}`}
      />,
    );
    return { onAendern };
  }

  it('zeigt Räumung und Stand des zugeordneten Bezirks und springt ins Modul', () => {
    mitBezirk();
    expect(screen.getByText('läuft')).toBeInTheDocument();
    expect(screen.getByText(/480 · von/)).toBeInTheDocument();
    const sprung = screen.getByRole('link', { name: 'Betreuung zu Uferstraße 12–40' });
    expect(sprung).toHaveAttribute('href', '/einsaetze/1/betreuung?bezirk=5');
  });

  it('Auswahl eines anderen Bezirks und „nicht zugeordnet" schicken den PATCH', async () => {
    const { onAendern } = mitBezirk();
    const feld = screen.getByLabelText('Gehört zu Evakuierungsbezirk');
    await userEvent.click(feld);
    await userEvent.click(await screen.findByTitle('Hafenviertel'));
    await waitFor(() => expect(onAendern).toHaveBeenCalledWith({ evakuierungsbezirk_id: 6 }));
    await userEvent.click(feld);
    await userEvent.click(await screen.findByTitle('nicht zugeordnet'));
    await waitFor(() =>
      expect(onAendern).toHaveBeenLastCalledWith({ evakuierungsbezirk_id: null }),
    );
  });

  it('ohne Modulrecht: keine Auswahl, keine Bezirksangaben, nur der Grund', () => {
    mitBezirk({ betreuungFrei: false });
    expect(screen.queryByLabelText('Gehört zu Evakuierungsbezirk')).toBeNull();
    expect(screen.queryByText('Uferstraße 12–40')).toBeNull();
    expect(screen.queryByText('läuft')).toBeNull();
    expect(screen.getByText(/nur mit Zugriff auf das Modul Betreuung/)).toBeInTheDocument();
  });

  it('an anderen Zonentypen erscheint nichts vom Bezirk', () => {
    mitBezirk({ zone: { ...basisZone, typ: 'absperrbereich', gefahrengebiet_id: null } });
    expect(screen.queryByLabelText('Gehört zu Evakuierungsbezirk')).toBeNull();
  });
});

describe('ZonenInspector — Vorgabefarbe der freien Skizze (LFH-797)', () => {
  const farbloseSkizze: LageZone = {
    ...basisZone,
    typ: 'freie_skizze',
    farbe: null,
    gefahrengebiet_id: null,
  };

  it('zeigt die Vorgabe der Karte im Farbfeld und schreibt beim bloßen Blur nichts', async () => {
    const onAendern = vi.fn<ZonenInspectorProps['onAendern']>();
    renderInspector({ zone: farbloseSkizze, gebiete: [], onAendern });

    const farbe = screen.getByLabelText('Farbe');
    // Eine Quelle: Farbfeld und Kartendarstellung lesen dieselbe Vorgabe.
    expect(farbe).toHaveValue(FREIE_SKIZZE_VORGABE);
    expect(zoneStil('freie_skizze', null).lineColor).toBe(FREIE_SKIZZE_VORGABE);

    await userEvent.click(farbe);
    fireEvent.blur(farbe);
    expect(onAendern).not.toHaveBeenCalled();

    // Gegenaussage: eine echte Farbwahl kommt an.
    fireEvent.change(farbe, { target: { value: '#00ff00' } });
    fireEvent.blur(farbe);
    expect(onAendern).toHaveBeenCalledWith({ farbe: '#00ff00' });
  });
});
