import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { offeneRueckfrage } from '../../test/rueckfrage';
import { renderMitProviders } from '../../test/utils';
import type { FreiesZeichen } from '../../api/types';
import { ConfigProvider, theme } from 'antd';
import FreiesZeichenInspector, { type FreiesZeichenInspectorProps } from './FreiesZeichenInspector';
import { parseAnySpec, serializeAnySpec } from '@einsatzzeichen/core';
import { PALETTE, type AnySpec } from '@einsatzzeichen/schema';
import { FREIES_ZEICHEN_TINTE } from './marker';
import { antdToken, farbenDunkel } from '../../theme/tokens';
import type { FreiesZeichenUpdate } from '../../api/types';

/** Ein Altzeichen (Altspalten, kein `zeichen_spec`): der Bestand vor LFH-836. */
const basis: FreiesZeichen = {
  id: 42,
  einsatz_id: 1,
  lat: 50.1,
  lon: 8.6,
  grundzeichen: 'taktische-formation',
  organisation: 'feuerwehr',
  fachaufgabe: 'brandbekaempfung',
  symbol: null,
  einheit: 'zug',
  funktion: null,
  farbe: '#ff0000',
  label: 'Zug 1',
  erstellt_von: 1,
  erstellt_at: '',
  geaendert_at: '',
};

const OHNE_ALTFELDER = {
  grundzeichen: null,
  organisation: null,
  fachaufgabe: null,
  symbol: null,
  einheit: null,
  funktion: null,
  farbe: null,
};

/** Ein Zeichen mit `zeichen_spec`, wie es ein neuer Client speichert. */
const specZeile = (spec: AnySpec, rest: Partial<FreiesZeichen> = {}): FreiesZeichen => ({
  ...basis,
  ...OHNE_ALTFELDER,
  zeichen_spec: serializeAnySpec(spec),
  ...rest,
});

/** Der Stand nach dem eigenen PATCH: der Server schreibt die Spec und leert die Altspalten. */
const nachPatch = (gesendet: FreiesZeichenUpdate, geaendert_at: string): FreiesZeichen => ({
  ...basis,
  ...OHNE_ALTFELDER,
  ...gesendet,
  geaendert_at,
});

/** Die Zeichenbeschreibung eines gesendeten PATCH. */
const gesendeteSpec = (aufruf: FreiesZeichenUpdate): AnySpec => parseAnySpec(aufruf.zeichen_spec);

function renderInspector(
  opts: {
    zeichen?: FreiesZeichen;
    darfSchreiben?: boolean;
    onAendern?: FreiesZeichenInspectorProps['onAendern'];
    onLoeschen?: FreiesZeichenInspectorProps['onLoeschen'];
  } = {},
) {
  const onAendern = opts.onAendern ?? vi.fn<FreiesZeichenInspectorProps['onAendern']>();
  const onLoeschen = opts.onLoeschen ?? vi.fn<FreiesZeichenInspectorProps['onLoeschen']>();
  const element = (zeichen: FreiesZeichen) => (
    <FreiesZeichenInspector
      zeichen={zeichen}
      darfSchreiben={opts.darfSchreiben ?? true}
      onSchliessen={() => {}}
      onAendern={onAendern}
      onLoeschen={onLoeschen}
      ansichten={[]}
      onVerschieben={() => {}}
    />
  );
  const ergebnis = renderMitProviders(element(opts.zeichen ?? basis));
  /** Neuer Serverstand, wie ihn die Live-Invalidierung bringt (gleiche `id`, kein Remount). */
  const serverstand = (zeichen: FreiesZeichen) => ergebnis.rerender(element(zeichen));
  return { onAendern, onLoeschen, serverstand, unmount: ergebnis.unmount };
}

describe('FreiesZeichenInspector', () => {
  it('rendert mit vorbelegtem Picker (Grundzeichen des Records gewählt)', () => {
    renderInspector();
    expect(kachel('Taktische Formation')).toHaveAttribute('aria-checked', 'true');
  });

  it('nimmt dem Kartenklick nicht den Fokus (kein autoFokus im Inspector)', () => {
    renderInspector();
    expect(screen.getByLabelText('Grundzeichen suchen')).not.toHaveFocus();
  });

  // Das Zeichen wird hart gelöscht — Rückfrage mit rotem OK-Knopf, die das Zeichen beim Namen
  // nennt.
  it('„Löschen" fragt erst nach und löscht erst auf Bestätigung, genau einmal', async () => {
    const { onLoeschen } = renderInspector();
    // Auslöser und OK heißen beide „Löschen", und die Rückfrage bleibt in jsdom im Baum — also den
    // Auslöser vorher greifen.
    const ausloeser = screen.getByRole('button', { name: 'Löschen' });
    await userEvent.click(ausloeser);

    const rueckfrage = await offeneRueckfrage();
    expect(onLoeschen).not.toHaveBeenCalled();
    expect(rueckfrage).toHaveTextContent('„Zug 1“ löschen?');
    const ok = within(rueckfrage).getByRole('button', { name: 'Löschen' });
    expect(ok).toHaveClass('ant-btn-dangerous');

    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Abbrechen' }));
    expect(onLoeschen).not.toHaveBeenCalled();

    await userEvent.click(ausloeser);
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Löschen' }),
    );
    expect(onLoeschen).toHaveBeenCalledTimes(1);
  });

  it('ohne Bezeichnung nennt die Rückfrage das Zeichen wie der Kartenkopf', async () => {
    renderInspector({ zeichen: { ...basis, label: null } });
    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await offeneRueckfrage()).toHaveTextContent('„Taktisches Zeichen“ löschen?');
  });

  it('zeigt KEINEN „Im Fach-Modul öffnen"-Link', () => {
    renderInspector();
    expect(screen.queryByText(/Fach-Modul/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('meldet onAendern mit Zeichen und Bezeichnung bei einer Edit-Auswahl', async () => {
    const { onAendern } = renderInspector();
    const org = screen.getAllByLabelText('Organisation')[0];
    fireEvent.mouseDown(org.closest('.ant-select')?.querySelector('.ant-select-selector') ?? org);
    const opt = await screen.findAllByText('Technisches Hilfswerk');
    await userEvent.click(opt[opt.length - 1]);
    await waitFor(() => expect(onAendern).toHaveBeenCalled());
    const gesendet = vi.mocked(onAendern).mock.calls[0][0];
    expect(gesendet.label).toBe('Zug 1');
    expect(gesendeteSpec(gesendet)).toMatchObject({ kind: 'formation', organization: 'thw' });
  });

  it('read-only (darfSchreiben=false): keine Edit-Controls, zeigt die Werte', () => {
    renderInspector({ darfSchreiben: false });
    // Keine interaktiven Selects/Buttons.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
    // Werte als Text, aus der wirksamen Zeichenbeschreibung.
    expect(screen.getByText('Taktische Formation')).toBeInTheDocument();
    expect(screen.getByText('Feuerwehr')).toBeInTheDocument();
    expect(screen.getByText('Zug')).toBeInTheDocument();
  });
});

const kachel = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'Grundzeichen' })).getByRole('radio', { name });

/**
 * Entprelltes Schreiben: im Raster meldet jeder Pfeilschritt eine Auswahl, und jedes `onAendern`
 * ist ein PATCH samt Live-Ereignis.
 */
describe('FreiesZeichenInspector — entprelltes Schreiben (LFH-716)', () => {
  afterEach(() => vi.useRealTimers());

  it('schreibt beim bloßen Öffnen nichts', () => {
    vi.useFakeTimers();
    const { onAendern } = renderInspector();
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).not.toHaveBeenCalled();
  });

  it('fasst schnelle Auswahlwechsel zu EINEM Schreibvorgang mit dem letzten Stand zusammen', () => {
    vi.useFakeTimers();
    const { onAendern } = renderInspector();
    for (const name of ['Person', 'Gefahr', 'Gebäude']) {
      fireEvent.click(kachel(name));
      act(() => vi.advanceTimersByTime(200));
    }
    expect(onAendern).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(gesendeteSpec(vi.mocked(onAendern).mock.calls[0][0])).toMatchObject({
      kind: 'building',
    });
  });

  it('holt eine Änderung nach, die beim Schließen noch in der Frist stand', () => {
    vi.useFakeTimers();
    const { onAendern, unmount } = renderInspector();
    fireEvent.click(kachel('Person'));
    unmount();
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(gesendeteSpec(vi.mocked(onAendern).mock.calls[0][0])).toMatchObject({ kind: 'person' });
  });

  it('schreibt beim Schließen ohne Änderung nichts', () => {
    vi.useFakeTimers();
    const { onAendern, unmount } = renderInspector();
    unmount();
    expect(onAendern).not.toHaveBeenCalled();
  });

  // Das Paar zum Riegel gegen den Fremd-Refetch: ohne eigene Änderung folgt der Inspector dem
  // Server; mit eigener sendet er genau einmal und nicht erneut, wenn der eigene Stand zurückkommt.
  it('übernimmt eine fremde Änderung, solange nichts Eigenes offen ist, und schreibt nichts', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    serverstand({ ...basis, grundzeichen: 'person', geaendert_at: 'später' });
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).not.toHaveBeenCalled();
    expect(kachel('Person')).toHaveAttribute('aria-checked', 'true');
  });

  it('sendet eine eigene Änderung genau einmal, auch wenn der eigene Stand zurückkommt', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    fireEvent.click(kachel('Person'));
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledTimes(1);
    const gesendet = vi.mocked(onAendern).mock.calls[0][0];
    serverstand(nachPatch(gesendet, 'später'));
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).toHaveBeenCalledTimes(1);
  });

  it('folgt nach dem eigenen Schreiben wieder fremden Änderungen', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    fireEvent.click(kachel('Person'));
    act(() => vi.advanceTimersByTime(700));
    const gesendet = vi.mocked(onAendern).mock.calls[0][0];
    serverstand(nachPatch(gesendet, 't1'));
    serverstand(specZeile({ kind: 'hazard' }, { geaendert_at: 't2' }));
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(kachel('Gefahr')).toHaveAttribute('aria-checked', 'true');
  });

  // Ein Merker, der ohne Sendung stehen bleibt, schaltete die Übernahme fremder Änderungen
  // dauerhaft ab.
  it('Klick auf die schon gewählte Kachel, danach eine fremde Änderung: nichts zurückschreiben', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    fireEvent.click(kachel('Taktische Formation'));
    act(() => vi.advanceTimersByTime(1000));
    serverstand({ ...basis, label: 'Fremd', geaendert_at: 'x' });
    act(() => vi.advanceTimersByTime(1000));
    expect(onAendern).not.toHaveBeenCalled();
  });

  it('hin und zurück in der Frist, danach eine fremde Änderung: nichts zurückschreiben', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    fireEvent.click(kachel('Person'));
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(kachel('Taktische Formation'));
    act(() => vi.advanceTimersByTime(1000));
    serverstand({ ...basis, label: 'Fremd', geaendert_at: 'x' });
    act(() => vi.advanceTimersByTime(1000));
    expect(onAendern).not.toHaveBeenCalled();
  });

  // „Bezeichnung" zeigt nach einer fremden Änderung nicht den alten Wortlaut und schreibt ihn beim
  // Verlassen nicht zurück.
  it('Bezeichnung nach fremder Änderung: zeigt den neuen Wortlaut und schreibt beim Verlassen nichts', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    serverstand({ ...basis, label: 'Fremd', geaendert_at: 'x' });
    const feld = screen.getByLabelText('Bezeichnung');
    expect(feld).toHaveValue('Fremd');
    fireEvent.focus(feld);
    fireEvent.blur(feld);
    act(() => vi.advanceTimersByTime(1000));
    expect(onAendern).not.toHaveBeenCalled();
  });

  it('eine getippte Bezeichnung geht beim Verlassen entprellt raus', () => {
    vi.useFakeTimers();
    const { onAendern } = renderInspector();
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'Zug 2' } });
    fireEvent.blur(feld);
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(onAendern).toHaveBeenCalledWith(expect.objectContaining({ label: 'Zug 2' }));
  });

  it('Enter in der Bezeichnung übernimmt im Inspector den Wortlaut (ohne Platzieren)', () => {
    vi.useFakeTimers();
    const { onAendern } = renderInspector();
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'Zug 3' } });
    fireEvent.keyDown(feld, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledWith(expect.objectContaining({ label: 'Zug 3' }));
    expect(feld).toHaveValue('Zug 3');
  });

  // Eine offene eigene Änderung gewinnt gegen einen neuen Serverstand in ihrer Frist.
  it('eine offene eigene Änderung überlebt einen fremden Serverstand und wird gesendet', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    fireEvent.click(kachel('Person'));
    act(() => vi.advanceTimersByTime(200));
    serverstand({ ...basis, grundzeichen: 'gefahr', geaendert_at: 'x' });
    expect(kachel('Person')).toHaveAttribute('aria-checked', 'true');
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(gesendeteSpec(vi.mocked(onAendern).mock.calls[0][0])).toMatchObject({ kind: 'person' });
  });

  // Nach „Löschen" holt der Abbau keine offene Änderung nach — ein PATCH auf das gelöschte Zeichen
  // endete in 404.
  it('„Löschen" verwirft eine offene Änderung, statt sie beim Abbau nachzuholen', () => {
    vi.useFakeTimers();
    const { onAendern, onLoeschen, unmount } = renderInspector();
    fireEvent.click(kachel('Person'));
    // Verworfen wird erst beim Bestätigen der Rückfrage.
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const rueckfrage = document.querySelector<HTMLElement>('.ant-popconfirm');
    expect(rueckfrage).not.toBeNull();
    fireEvent.click(within(rueckfrage!).getByRole('button', { name: 'Löschen' }));
    expect(onLoeschen).toHaveBeenCalledTimes(1);
    unmount();
    expect(onAendern).not.toHaveBeenCalled();
  });
});

describe('FreiesZeichenInspector — Symbolkachel (LFH-797)', () => {
  /** CSS-Normalform einer Farbe (jsdom liest `style.borderColor` als `rgb(…)`). */
  const css = (farbe: string) => {
    const probe = document.createElement('div');
    probe.style.color = farbe;
    return probe.style.color;
  };
  const kachelImNachtmodus = (zeichen: FreiesZeichen) => {
    renderMitProviders(
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: antdToken(farbenDunkel) }}>
        <FreiesZeichenInspector
          zeichen={zeichen}
          darfSchreiben={false}
          onSchliessen={() => {}}
          onAendern={() => {}}
          onLoeschen={() => {}}
          ansichten={[]}
          onVerschieben={() => {}}
        />
      </ConfigProvider>,
    );
    return document.querySelector<HTMLElement>('[data-lfh="auswahl-kachel"]')!;
  };

  it('zeigt ein farbloses Zeichen im Nachtmodus mit Rahmen in der Textrolle, nicht in der Kartentinte', () => {
    const zelle = kachelImNachtmodus(specZeile({ kind: 'formation' }));
    expect(zelle.querySelector('svg')).not.toBeNull();
    expect(zelle.style.borderColor).toBe(css(farbenDunkel.text2));
    expect(zelle.style.borderColor).not.toBe(css(FREIES_ZEICHEN_TINTE));
  });

  it('zeigt eine Gefahr mit roter Füllung mit Rahmen im Rot der Palette', () => {
    const zelle = kachelImNachtmodus(specZeile({ kind: 'hazard', technicalFill: 'rot' }));
    expect(zelle.querySelector('svg')).not.toBeNull();
    expect(zelle.style.borderColor).toBe(css(PALETTE.rot));
  });

  it('bildet die Hexfarbe einer alten Gefahr auf das Rot der Palette ab', () => {
    const zelle = kachelImNachtmodus({ ...basis, grundzeichen: 'gefahr', farbe: '#cc0000' });
    expect(zelle.style.borderColor).toBe(css(PALETTE.rot));
  });
});

describe('FreiesZeichenInspector — Altzeichen (LFH-836)', () => {
  afterEach(() => vi.useRealTimers());

  it('speichert ein Altzeichen beim Ändern als Zeichenbeschreibung', () => {
    vi.useFakeTimers();
    const { onAendern } = renderInspector();
    fireEvent.click(kachel('Person'));
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledTimes(1);
    const gesendet = vi.mocked(onAendern).mock.calls[0][0];
    // Nur `zeichen_spec` und Bezeichnung: keine Altfelder mehr im Body.
    expect(Object.keys(gesendet).sort()).toEqual(['label', 'zeichen_spec']);
    expect(gesendeteSpec(gesendet)).toMatchObject({ kind: 'person', organization: 'feuerwehr' });
  });

  it('nennt bei einem vereinfacht dargestellten Altzeichen die Alt-Kennung', () => {
    renderInspector({
      zeichen: {
        ...basis,
        grundzeichen: 'person',
        organisation: null,
        fachaufgabe: null,
        einheit: null,
        funktion: 'fuehrungskraft',
        farbe: null,
      },
      darfSchreiben: false,
    });
    const hinweis = document.querySelector('[data-lfh="zeichen-vereinfacht"]');
    expect(hinweis).toHaveTextContent('vereinfacht dargestellt');
    expect(hinweis).toHaveTextContent('person · fuehrungskraft');
  });

  it('zeigt den Platzhalter für ein Altzeichen ohne Nachfolger, mit Hinweis', () => {
    renderInspector({
      zeichen: { ...basis, ...OHNE_ALTFELDER, grundzeichen: 'ohne', symbol: 'fernschreiben' },
      darfSchreiben: false,
    });
    expect(document.querySelector('[data-lfh="zeichen-vereinfacht"]')).toHaveTextContent(
      'vereinfacht dargestellt · ohne · fernschreiben',
    );
    expect(screen.getByText('Punkt')).toBeInTheDocument();
  });

  it('zeigt keinen Hinweis bei einem vollständig dargestellten Zeichen', () => {
    renderInspector({ zeichen: specZeile({ kind: 'person' }), darfSchreiben: false });
    expect(document.querySelector('[data-lfh="zeichen-vereinfacht"]')).toBeNull();
  });
});
