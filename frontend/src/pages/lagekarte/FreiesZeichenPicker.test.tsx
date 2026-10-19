import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { parseAnySpec, serializeAnySpec } from '@einsatzzeichen/core';
import { PALETTE, type AnySpec } from '@einsatzzeichen/schema';
import { renderMitProviders } from '../../test/utils';
import type { FreiesZeichenUpdate } from '../../api/types';
import { farbenDunkel } from '../../theme/tokens';
import { ConfigProvider, theme } from 'antd';
import { antdToken, farbenHell } from '../../theme/tokens';
import FreiesZeichenPicker, {
  ganzeReihenHoehe,
  kachelFarben,
  kachelStil,
  type FreiesZeichenPickerProps,
  type ZeichenEntwurf,
} from './FreiesZeichenPicker';
import { merkeZuletztVerwendet } from './zuletztVerwendet';
import { FARB_NAMEN } from './zeichenWahl';

beforeEach(() => localStorage.clear());

/** Ein Entwurf aus einer Zeichenbeschreibung, wie ihn der Aufrufer hält. */
const wertAus = (spec: AnySpec, rest: Partial<FreiesZeichenUpdate> = {}): FreiesZeichenUpdate => ({
  zeichen_spec: serializeAnySpec(spec),
  ...rest,
});

/** Die Zeichenbeschreibung des letzten Aufrufs eines `onChange`/`onAbsenden`. */
function zuletzt(fn: Mock): AnySpec {
  const aufruf = fn.mock.calls[fn.mock.calls.length - 1]?.[0] as ZeichenEntwurf | undefined;
  expect(aufruf, 'kein Aufruf').toBeDefined();
  expect(aufruf!.zeichen_spec, 'Entwurf ohne Zeichen').not.toBeNull();
  return parseAnySpec(aufruf!.zeichen_spec!);
}

function render(wert: FreiesZeichenUpdate, extra: Partial<FreiesZeichenPickerProps> = {}) {
  const onChange = (extra.onChange ?? vi.fn()) as Mock<FreiesZeichenPickerProps['onChange']>;
  const onAbsenden = (extra.onAbsenden ?? vi.fn()) as Mock<
    NonNullable<FreiesZeichenPickerProps['onAbsenden']>
  >;
  const ergebnis = renderMitProviders(
    <FreiesZeichenPicker wert={wert} onChange={onChange} onAbsenden={onAbsenden} />,
  );
  return { onChange, onAbsenden, ...ergebnis };
}

/**
 * Wie {@link render}, aber gesteuert wie in Leiste und Dialog: der Aufrufer hält den Entwurf und
 * gibt ihn zurück. Dazu der Knopf „Platzieren“ der Leiste, gesperrt ohne Zeichen.
 */
function renderGesteuert(start: ZeichenEntwurf) {
  const onChange = vi.fn<(e: ZeichenEntwurf) => void>();
  const onAbsenden = vi.fn<(spec: FreiesZeichenUpdate) => void>();
  function Leiste() {
    const [wert, setWert] = useState<ZeichenEntwurf>(start);
    return (
      <>
        <FreiesZeichenPicker
          wert={wert}
          onChange={(e) => {
            onChange(e);
            setWert(e);
          }}
          onAbsenden={onAbsenden}
        />
        <button
          type="button"
          disabled={wert.zeichen_spec == null}
          onClick={() => wert.zeichen_spec != null && onAbsenden(wert as FreiesZeichenUpdate)}
        >
          Platzieren
        </button>
      </>
    );
  }
  const ergebnis = renderMitProviders(<Leiste />);
  return { onChange, onAbsenden, ...ergebnis };
}

// antd-Selects können bei getByLabelText mehrfach matchen → über die Anzahl testen.
const sichtbar = (label: string) => screen.queryAllByLabelText(label).length > 0;

/** Kachel-Abfragen immer innerhalb ihres Rasters: Grundzeichen- und Symbolkatalog teilen Namen. */
const raster = (name: string) => within(screen.getByRole('radiogroup', { name }));

/**
 * Eingabefelder, getrennt nach „offen" und „hinter Details" — über DOM-Container, nicht
 * `toBeVisible` (jsdom rechnet kein Layout).
 */
function felder() {
  const wurzel = document.querySelector('[data-lfh="zeichen-picker"]')!;
  const details = wurzel.querySelector('[data-lfh="zeichen-details"]');
  const alle = Array.from(wurzel.querySelectorAll('input, textarea'));
  return {
    alle,
    offen: alle.filter((f) => !details?.contains(f)),
    imDetail: alle.filter((f) => details?.contains(f)),
  };
}

/** Öffnet die antd-Auswahl mit diesem Namen und liefert die Namen ihrer (gerenderten) Optionen. */
async function optionenVon(label: string, suche?: string): Promise<string[]> {
  const feld = screen.getAllByLabelText(label)[0];
  fireEvent.mouseDown(feld.closest('.ant-select')?.querySelector('.ant-select-selector') ?? feld);
  // Tippen filtert (jsdom rendert von der virtuellen Liste nur den Anfang).
  if (suche) {
    const eingabe = feld.closest('.ant-select')!.querySelector('input')!;
    fireEvent.change(eingabe, { target: { value: suche } });
  }
  await waitFor(() =>
    expect(
      document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'),
    ).not.toBeNull(),
  );
  const offen = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')!;
  return Array.from(offen.querySelectorAll('.ant-select-item-option')).map(
    (o) => o.getAttribute('title') ?? '',
  );
}

/** Wählt in der offenen Auswahl die Option mit diesem Namen. */
function waehle(name: string) {
  const offen = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')!;
  fireEvent.click(offen.querySelector(`.ant-select-item-option[title="${name}"]`)!);
}

const FORMATION = wertAus({ kind: 'formation' });
const PERSON = wertAus({ kind: 'person' });

describe('FreiesZeichenPicker — Grundzeichen als Bild-Raster', () => {
  it('zeigt die Grundzeichenarten des Vokabulars und „Kein Grundzeichen“ als Kacheln', () => {
    render(FORMATION);
    const gz = raster('Grundzeichen');
    expect(gz.getByRole('radio', { name: 'Kein Grundzeichen' })).toBeInTheDocument();
    expect(gz.getByRole('radio', { name: 'Stelle' })).toBeInTheDocument();
    expect(gz.getByRole('radio', { name: 'Luftfahrzeug' })).toBeInTheDocument();
    // 29 Arten plus „Kein Grundzeichen“.
    expect(gz.getAllByRole('radio')).toHaveLength(30);
  });

  it('trägt auf jeder Kachel BEIDES: das gezeichnete Zeichen und seinen Namen', () => {
    render(PERSON);
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Person' });
    const bild = kachel.querySelector('svg');
    expect(bild).not.toBeNull();
    // Gleichheit, nicht „enthält": nur sie fängt einen Namensbeitrag aus dem SVG.
    expect(bild!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(kachel).toHaveAccessibleName('Person');
    expect(within(kachel).getByText('Person')).toBeInTheDocument();
  });

  it('gibt jedem Kachelbild eigene SVG-ids (eigener idPrefix)', () => {
    render(PERSON);
    const ids = Array.from(document.querySelectorAll('[data-lfh="zeichen-picker"] svg [id]')).map(
      (e) => e.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('macht die Auswahl maschinenlesbar, nicht nur farblich', () => {
    render(PERSON);
    const gz = raster('Grundzeichen');
    expect(gz.getByRole('radio', { name: 'Person' })).toHaveAttribute('aria-checked', 'true');
    expect(gz.getByRole('radio', { name: 'Gefahr' })).toHaveAttribute('aria-checked', 'false');
  });

  it('verwirft beim Grundzeichenwechsel, was das neue Grundzeichen nicht zeichnet', async () => {
    const { onChange } = render(
      wertAus({ kind: 'formation', organization: 'thw', strength: 'zug' }, { label: 'Zug 1' }),
    );
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Landfahrzeug' }));
    // Das Landfahrzeug trägt keine Stärke; die Organisation bleibt, die Bezeichnung auch.
    expect(zuletzt(onChange)).toEqual({ kind: 'vehicle-land', organization: 'thw' });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].label).toBe('Zug 1');
  });

  it('schränkt die Kacheln über das Suchfeld ein, auch über den Alltagsbegriff', () => {
    render(PERSON);
    fireEvent.change(screen.getByLabelText('Grundzeichen suchen'), {
      target: { value: 'hubschr' },
    });
    expect(raster('Grundzeichen').getByRole('radio', { name: 'Luftfahrzeug' })).toBeInTheDocument();
    // Gegenaussage: was nicht passt, ist weg — sonst filtert er nichts.
    expect(raster('Grundzeichen').queryByRole('radio', { name: 'Person' })).toBeNull();
  });

  it('sagt es, wenn die Suche nichts findet', () => {
    render(PERSON);
    fireEvent.change(screen.getByLabelText('Grundzeichen suchen'), { target: { value: 'xyzzy' } });
    expect(screen.getByText('Kein Treffer')).toBeInTheDocument();
  });

  it('setzt den Fokus beim Öffnen ins Grundzeichen-Suchfeld', () => {
    render(PERSON);
    expect(screen.getByLabelText('Grundzeichen suchen')).toHaveFocus();
  });

  it('lässt den Fokus in Ruhe, wo der Picker dauerhaft steht (Inspector)', () => {
    renderMitProviders(<FreiesZeichenPicker wert={PERSON} onChange={vi.fn()} autoFokus={false} />);
    expect(screen.getByLabelText('Grundzeichen suchen')).not.toHaveFocus();
  });

  it('Pfeiltasten tragen den Fokus mit, rückwärts mit Umlauf ans Ende', () => {
    const { onChange } = render(FORMATION);
    const gz = raster('Grundzeichen');
    const erste = gz.getByRole('radio', { name: 'Kein Grundzeichen' });
    erste.focus();
    fireEvent.keyDown(erste, { key: 'ArrowDown' });
    expect(gz.getByRole('radio', { name: 'Taktische Formation' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    const alle = gz.getAllByRole('radio');
    expect(alle[alle.length - 1]).toHaveFocus();
    expect(zuletzt(onChange)).toEqual({ kind: alle[alle.length - 1].getAttribute('data-id') });
  });

  it('bewegt die Auswahl mit den Pfeiltasten und ist EIN Tabstopp', () => {
    const { onChange } = render(PERSON);
    const gz = raster('Grundzeichen');
    const person = gz.getByRole('radio', { name: 'Person' });
    person.focus();
    fireEvent.keyDown(person, { key: 'ArrowRight' });
    expect(zuletzt(onChange)).toEqual({ kind: 'vehicle-land' });
    // Nur die gewählte Kachel ist tabbierbar.
    expect(person).toHaveAttribute('tabindex', '0');
    expect(gz.getByRole('radio', { name: 'Landfahrzeug' })).toHaveAttribute('tabindex', '-1');
  });
});

describe('FreiesZeichenPicker — Symbole als Bild-Raster', () => {
  it('bietet am Grundzeichen Fähigkeiten und Zustände an, mit einem Weg zurück auf „Kein Symbol“', () => {
    const { onChange } = render(
      wertAus({ kind: 'formation', capabilities: ['rescue-aerial-ladder'] }),
    );
    const drehleiter = raster('Symbol').getByRole('radio', { name: /Drehleiter/ });
    expect(drehleiter).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('Symbol suchen'), { target: { value: 'drehl' } });
    expect(raster('Symbol').queryByRole('radio', { name: 'Brandbekämpfung' })).toBeNull();
    // „Kein Symbol" überlebt den Filter.
    fireEvent.click(raster('Symbol').getByRole('radio', { name: 'Kein Symbol' }));
    expect(zuletzt(onChange)).toEqual({ kind: 'formation' });
  });

  it('setzt einen Zustand an der Person', () => {
    const { onChange } = render(PERSON);
    fireEvent.change(screen.getByLabelText('Symbol suchen'), { target: { value: 'verletzt' } });
    fireEvent.click(raster('Symbol').getByRole('radio', { name: 'Person verletzt' }));
    expect(zuletzt(onChange)).toMatchObject({ kind: 'person', states: ['person-injured'] });
  });
});

describe('FreiesZeichenPicker — Piktogramm ohne Grundzeichen', () => {
  it('bietet nach „Kein Grundzeichen“ freistehende Piktogramme an; die Wahl setzt das Piktogramm', async () => {
    const { onChange } = renderGesteuert(FORMATION);
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }));
    // Ohne Symbol gibt es noch kein Zeichen: gemeldet wird ein Entwurf ohne Zeichen.
    expect(onChange).toHaveBeenLastCalledWith({ ...FORMATION, zeichen_spec: null });
    expect(
      raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('Symbol suchen'), { target: { value: 'Drehleiter' } });
    const kachel = raster('Symbol').getByRole('radio', { name: /Drehleiter/ });
    // Ohne Grundzeichen gibt es keine Kachel „Kein Symbol“.
    expect(raster('Symbol').queryByRole('radio', { name: 'Kein Symbol' })).toBeNull();
    fireEvent.click(kachel);
    expect(zuletzt(onChange)).toEqual({
      kind: 'pictogram',
      pictogram: 'capability.rescue-aerial-ladder',
    });
  });

  it('blendet nach „Kein Grundzeichen“ die Achsen des alten Grundzeichens unter „Details“ aus', async () => {
    renderGesteuert(FORMATION);
    expect(sichtbar('Organisation')).toBe(true);
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }));
    expect(sichtbar('Organisation')).toBe(false);
    expect(sichtbar('Einheit')).toBe(false);
    expect(sichtbar('Bezeichnung')).toBe(true);
  });

  it('zeigt ein freistehendes Zeichen mit „Kein Grundzeichen“ gewählt und ohne Details außer der Bezeichnung', () => {
    render(wertAus({ kind: 'state', state: 'damaged' }));
    expect(
      raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(raster('Symbol').getByRole('radio', { name: 'Angeschlagen' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(sichtbar('Organisation')).toBe(false);
    expect(sichtbar('Farbe')).toBe(false);
    expect(sichtbar('Bezeichnung')).toBe(true);
  });

  it('bietet ohne Grundzeichen keinen Personenzustand freistehend an', () => {
    render(wertAus({ kind: 'state', state: 'damaged' }));
    fireEvent.change(screen.getByLabelText('Symbol suchen'), {
      target: { value: 'person verletzt' },
    });
    expect(raster('Symbol').queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('FreiesZeichenPicker — nur Zeichenbares unter „Details“', () => {
  it('bietet am Landfahrzeug unter „Einheit“ keine Stärke an', async () => {
    render(wertAus({ kind: 'vehicle-land' }));
    const einheiten = await optionenVon('Einheit');
    expect(einheiten).not.toContain('Zug');
    expect(einheiten).not.toContain('Trupp');
  });

  it('bietet an der Formation die Stärken an', async () => {
    render(FORMATION);
    expect(await optionenVon('Einheit')).toEqual(expect.arrayContaining(['Trupp', 'Zug']));
  });

  it('kennt die Achse „Funktion“ nicht mehr', () => {
    render(PERSON);
    expect(sichtbar('Funktion')).toBe(false);
    expect(sichtbar('Organisation')).toBe(true);
    expect(sichtbar('Fachaufgabe')).toBe(true);
  });

  it('setzt die Fachaufgabe randbündig', async () => {
    const { onChange } = render(FORMATION);
    expect(await optionenVon('Fachaufgabe', 'Brand')).toContain('Brandbekämpfung');
    waehle('Brandbekämpfung');
    expect(zuletzt(onChange)).toEqual({ kind: 'formation', bodyMarks: ['fire-fighting'] });
  });
});

describe('FreiesZeichenPicker — Farbe aus der Palette', () => {
  it('bietet an der Gefahr nur die Farben der Palette an, keine freie Farbeingabe', async () => {
    const { onChange } = render(wertAus({ kind: 'hazard' }));
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const farben = await optionenVon('Farbe');
    expect(farben).toContain('Rot');
    // Nur Palettentoken, mit ihren Namen (jsdom rendert die virtuelle Liste nicht ganz).
    for (const f of farben) expect(Object.values(FARB_NAMEN)).toContain(f);
    waehle('Rot');
    expect(zuletzt(onChange)).toEqual({ kind: 'hazard', technicalFill: 'rot' });
  });

  it('zeigt die Palettenfarbe als Feld neben dem Namen', async () => {
    render(wertAus({ kind: 'hazard' }));
    await optionenVon('Farbe');
    const feld = document
      .querySelector('.ant-select-item-option[title="Rot"]')!
      .querySelector<HTMLElement>('[data-lfh="farbfeld"]');
    expect(feld?.style.background).not.toBe('');
    expect(feld?.getAttribute('data-farbe')).toBe(PALETTE.rot);
  });
});

describe('FreiesZeichenPicker — Feldbudget: Sekundäres hinter „Details"', () => {
  it('lässt offen nur die zwei Suchfelder stehen, der Rest liegt im Detail-Bereich', () => {
    render(PERSON);
    const { offen, imDetail, alle } = felder();
    expect(offen).toHaveLength(2);
    // Organisation, Fachaufgabe, Einheit, Farbe, Bezeichnung — weggeräumt, nicht abwesend.
    expect(imDetail.length).toBeGreaterThanOrEqual(5);
    expect(alle.length).toBeGreaterThan(offen.length);
  });

  it('ist zugeklappt und öffnet auf Klick', async () => {
    render(PERSON);
    const kopf = screen.getByRole('button', { name: /Details/ });
    const eintrag = kopf.closest('.ant-collapse-item')!;
    expect(eintrag).not.toHaveClass('ant-collapse-item-active');
    await userEvent.click(kopf);
    await waitFor(() => expect(eintrag).toHaveClass('ant-collapse-item-active'));
  });

  it('meldet Änderungen an der Bezeichnung beim Verlassen mit dem Zeichen', () => {
    const { onChange } = render(FORMATION);
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'EA Nord' } });
    fireEvent.blur(feld);
    expect(onChange).toHaveBeenCalledWith({ ...FORMATION, label: 'EA Nord' });
  });
});

describe('FreiesZeichenPicker — Enter platziert (LFH-716, D4)', () => {
  it('platziert per Enter auf einer Kachel mit dem Zeichen DIESER Kachel', () => {
    const { onAbsenden, onChange } = render({ ...FORMATION, label: 'X' });
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Person' });
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledTimes(1);
    expect(onAbsenden).toHaveBeenCalledWith({ ...PERSON, label: 'X' });
    // Auch der Entwurf zieht nach — sonst stünde nach dem Platzieren der alte in der Leiste.
    expect(zuletzt(onChange)).toEqual({ kind: 'person' });
  });

  it('Enter mit echter Tastatur auf einer Kachel: genau EIN onChange und EIN Absenden', async () => {
    // `fireEvent.keyDown` erzeugt keinen synthetischen Klick; erst die echte Tastenfolge zeigt, ob
    // der Browser auf dem `<button>` zusätzlich klickt.
    const user = userEvent.setup();
    const { onAbsenden, onChange } = render(FORMATION);
    raster('Grundzeichen').getByRole('radio', { name: 'Person' }).focus();
    await user.keyboard('{Enter}');
    expect(onAbsenden).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('platziert per Enter im Suchfeld mit dem ersten Treffer, wenn die Auswahl nicht darunter ist', () => {
    const { onAbsenden } = render(PERSON);
    const suche = screen.getByLabelText('Grundzeichen suchen');
    fireEvent.change(suche, { target: { value: 'hubschr' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(zuletzt(onAbsenden)).toEqual({ kind: 'vehicle-air' });
  });

  it('behält per Enter im Suchfeld die Auswahl, wenn sie unter den Treffern steht', () => {
    const { onAbsenden } = render(PERSON);
    const suche = screen.getByLabelText('Grundzeichen suchen');
    fireEvent.change(suche, { target: { value: 'pers' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(zuletzt(onAbsenden)).toEqual({ kind: 'person' });
  });

  it('platziert per Enter im leeren Suchfeld die aktuelle Auswahl', () => {
    const gefahr = wertAus({ kind: 'hazard', technicalFill: 'rot' });
    const { onAbsenden } = render(gefahr);
    fireEvent.keyDown(screen.getByLabelText('Grundzeichen suchen'), { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledWith(gefahr);
  });

  it('platziert NICHT per Enter im Suchfeld ohne Treffer', () => {
    const { onAbsenden } = render(PERSON);
    const suche = screen.getByLabelText('Grundzeichen suchen');
    fireEvent.change(suche, { target: { value: 'xyzzy' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(onAbsenden).not.toHaveBeenCalled();
  });

  it('nimmt im Symbol-Suchfeld den ersten ECHTEN Treffer, nicht „Kein Symbol"', () => {
    const { onAbsenden } = render(FORMATION);
    const suche = screen.getByLabelText('Symbol suchen');
    fireEvent.change(suche, { target: { value: 'drehl' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(zuletzt(onAbsenden)).toEqual({
      kind: 'formation',
      capabilities: ['rescue-aerial-ladder'],
    });
  });

  it('platziert mit der GERADE getippten Bezeichnung, nicht mit dem alten Stand', () => {
    const { onAbsenden } = render(FORMATION);
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'EA Nord' } });
    fireEvent.keyDown(feld, { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledWith({ ...FORMATION, label: 'EA Nord' });
  });

  it('platziert NICHT beim blossen Verlassen eines Feldes', () => {
    const { onAbsenden } = render(FORMATION);
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'EA Nord' } });
    fireEvent.blur(feld);
    expect(onAbsenden).not.toHaveBeenCalled();
  });

  it('wählt ohne `onAbsenden` (Inspector) per Enter nur aus', () => {
    const onChange = vi.fn();
    renderMitProviders(<FreiesZeichenPicker wert={PERSON} onChange={onChange} autoFokus={false} />);
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Gefahr' });
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(zuletzt(onChange)).toEqual({ kind: 'hazard' });
  });

  it('sendet per Enter auf „Kein Grundzeichen“ nichts, solange kein Symbol gewählt ist', () => {
    const { onAbsenden } = render(FORMATION);
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' });
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    expect(onAbsenden).not.toHaveBeenCalled();
  });
});

describe('FreiesZeichenPicker — „Kein Grundzeichen“ ohne Symbol ist noch kein Zeichen', () => {
  const vorschau = () => screen.getByLabelText('Vorschau');

  it('zeigt in der Vorschau kein Zeichen mehr, sondern „Symbol wählen“, und sperrt „Platzieren“', async () => {
    renderGesteuert(FORMATION);
    expect(vorschau().querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Platzieren' })).toBeEnabled();
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }));
    // Das vorige Zeichen (die Formation) steht nicht mehr da.
    expect(vorschau().querySelector('svg')).toBeNull();
    expect(within(vorschau()).getByText('Symbol wählen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Platzieren' })).toBeDisabled();
    // Erst ein Symbol macht es zum Zeichen.
    fireEvent.change(screen.getByLabelText('Symbol suchen'), { target: { value: 'Drehleiter' } });
    fireEvent.click(raster('Symbol').getByRole('radio', { name: /Drehleiter/ }));
    expect(vorschau().querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Platzieren' })).toBeEnabled();
  });

  it('platziert per Enter nicht, weder im Suchfeld noch in der Bezeichnung noch auf der Kachel', async () => {
    const { onAbsenden } = renderGesteuert(FORMATION);
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }));
    fireEvent.keyDown(screen.getByLabelText('Grundzeichen suchen'), { key: 'Enter' });
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' });
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    const bezeichnung = screen.getByLabelText('Bezeichnung');
    fireEvent.change(bezeichnung, { target: { value: 'EA Nord' } });
    fireEvent.keyDown(bezeichnung, { key: 'Enter' });
    expect(onAbsenden).not.toHaveBeenCalled();
  });

  it('beginnt nach „Kein Grundzeichen“ mit einem neuen Grundzeichen von vorn', async () => {
    const { onChange } = renderGesteuert(wertAus({ kind: 'formation', organization: 'thw' }));
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }));
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Person' }));
    expect(zuletzt(onChange)).toEqual({ kind: 'person' });
  });

  it('meldet bei einem schon freistehenden Zeichen auf „Kein Grundzeichen“ nichts Neues', async () => {
    const { onChange } = renderGesteuert(wertAus({ kind: 'state', state: 'damaged' }));
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Platzieren' })).toBeEnabled();
  });
});

describe('FreiesZeichenPicker — zweite Darstellungen', () => {
  const SPRACHE = wertAus({ kind: 'pictogram', pictogram: 'comms.voice' });

  it('bietet beide Formen eines J-Zeichens als Kacheln an und speichert die gewählte Variante', () => {
    const { onChange } = render(SPRACHE);
    const funk = raster('Symbol').getByRole('radio', { name: 'Sprache (Funk)' });
    const draht = raster('Symbol').getByRole('radio', { name: 'Sprache (Draht)' });
    expect(funk).toHaveAttribute('aria-checked', 'true');
    expect(draht).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(draht);
    expect(zuletzt(onChange)).toEqual({
      kind: 'pictogram',
      pictogram: 'comms.voice',
      variant: 'alternative',
    });
  });

  it('markiert die leitergebundene Form als gewählt, wenn der Entwurf sie trägt', () => {
    const { onChange } = render(
      wertAus({ kind: 'pictogram', pictogram: 'comms.voice', variant: 'alternative' }),
    );
    expect(raster('Symbol').getByRole('radio', { name: 'Sprache (Draht)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(raster('Symbol').getByRole('radio', { name: 'Sprache (Funk)' }));
    expect(zuletzt(onChange)).toEqual({ kind: 'pictogram', pictogram: 'comms.voice' });
  });

  it('findet über „Draht“ die leitergebundenen Formen und nur sie', () => {
    render(SPRACHE);
    fireEvent.change(screen.getByLabelText('Symbol suchen'), { target: { value: 'Draht' } });
    expect(raster('Symbol').getByRole('radio', { name: 'Sprache (Draht)' })).toBeInTheDocument();
    expect(
      raster('Symbol').getByRole('radio', { name: 'Datenübertragung (Draht)' }),
    ).toBeInTheDocument();
    for (const kachel of raster('Symbol').getAllByRole('radio')) {
      expect(kachel).toHaveAccessibleName(/\(Draht\)$/);
    }
  });
});

describe('FreiesZeichenPicker — zuletzt verwendet', () => {
  it('zeigt keine Leiste, solange nichts benutzt wurde', () => {
    render(PERSON);
    expect(screen.queryByRole('group', { name: 'Zuletzt verwendet' })).toBeNull();
  });

  it('übernimmt auf Klick das ganze Zeichen und lässt die Bezeichnung des Entwurfs stehen', async () => {
    const leiter = wertAus({ kind: 'person', bodyMarks: ['fire-fighting'] });
    merkeZuletztVerwendet(leiter);
    const { onChange } = render({ ...FORMATION, label: 'EA Nord' });
    const leiste = screen.getByRole('group', { name: 'Zuletzt verwendet' });
    await userEvent.click(within(leiste).getByRole('button', { name: 'Person · Brandbekämpfung' }));
    expect(onChange).toHaveBeenCalledWith({ ...leiter, label: 'EA Nord' });
  });

  it('zeigt die gemerkten Zeichen, das jüngste vorn', () => {
    merkeZuletztVerwendet(PERSON);
    merkeZuletztVerwendet(wertAus({ kind: 'hazard' }));
    render(PERSON);
    const knoepfe = within(screen.getByRole('group', { name: 'Zuletzt verwendet' })).getAllByRole(
      'button',
    );
    expect(knoepfe.map((k) => k.getAttribute('aria-label'))).toEqual(['Gefahr', 'Person']);
  });

  it('erneuert sich, wenn anderswo platziert wurde (der Picker bleibt montiert)', async () => {
    render(PERSON);
    expect(screen.queryByRole('group', { name: 'Zuletzt verwendet' })).toBeNull();
    act(() => merkeZuletztVerwendet(wertAus({ kind: 'hazard' })));
    expect(await screen.findByRole('group', { name: 'Zuletzt verwendet' })).toBeInTheDocument();
  });
});

describe('FreiesZeichenPicker — zwei Picker im selben Baum', () => {
  it('unterscheidet sie über den Auswahlzustand, nicht über den Kacheltext', async () => {
    // Auf der Lagekarte können Leisten-Picker und Inspector-Picker gleichzeitig hängen.
    renderMitProviders(
      <>
        <FreiesZeichenPicker wert={FORMATION} onChange={vi.fn()} autoFokus={false} />
        <FreiesZeichenPicker
          wert={wertAus({ kind: 'circle-12' })}
          onChange={vi.fn()}
          autoFokus={false}
        />
      </>,
    );
    expect(screen.getAllByRole('radio', { name: 'Stelle' })).toHaveLength(2);
    const vorbelegt = await screen.findAllByRole('radio', { name: 'Stelle', checked: true });
    expect(vorbelegt).toHaveLength(1);
  });
});

describe('FreiesZeichenPicker — Zeichenplatte (LFH-836)', () => {
  const css = (farbe: string) => {
    const probe = document.createElement('div');
    probe.style.background = farbe;
    return probe.style.background;
  };
  const bilderIm = (modus: 'nacht' | 'tag') => {
    renderMitProviders(
      <ConfigProvider
        theme={
          modus === 'nacht'
            ? { algorithm: theme.darkAlgorithm, token: antdToken(farbenDunkel) }
            : { token: antdToken(farbenHell) }
        }
      >
        <FreiesZeichenPicker wert={FORMATION} onChange={vi.fn()} autoFokus={false} />
      </ConfigProvider>,
    );
    // Zeichen, keine Icons (Leerkachel, Klapppfeil tragen die Hülle `anticon`).
    return Array.from(document.querySelectorAll('[data-lfh="zeichen-picker"] svg')).filter(
      (svg) => !svg.closest('.anticon'),
    );
  };

  it('legt nachts jedes Zeichen (Vorschau und Kacheln) auf die helle Zeichenplatte', () => {
    const bilder = bilderIm('nacht');
    expect(bilder.length).toBeGreaterThan(20);
    for (const svg of bilder) {
      const platte = svg.closest<HTMLElement>('[data-lfh="zeichen-platte"]');
      expect(platte, 'Zeichen ohne Platte').not.toBeNull();
      expect(platte!.style.background).toBe(css(farbenDunkel.zeichenPlatte));
    }
  });

  it('lässt die Platte am Tag durchsichtig', () => {
    const [vorschau] = bilderIm('tag');
    const platte = vorschau.closest<HTMLElement>('[data-lfh="zeichen-platte"]');
    expect(platte!.style.background).toBe(css('transparent'));
  });
});

describe('ganzeReihenHoehe (Raster ohne angeschnittene Reihe, LFH-836)', () => {
  // Drei Spalten, Reihen verschieden hoch (ein Name bricht in zwei Zeilen).
  const kacheln = [
    { oben: 0, unten: 80 },
    { oben: 0, unten: 92 },
    { oben: 0, unten: 80 },
    { oben: 96, unten: 176 },
    { oben: 96, unten: 176 },
    { oben: 96, unten: 176 },
    { oben: 180, unten: 290 },
  ];

  it('endet mit der letzten ganzen Reihe, nicht mitten in der nächsten', () => {
    expect(ganzeReihenHoehe(kacheln, 1)).toBe(92);
    expect(ganzeReihenHoehe(kacheln, 2)).toBe(176);
  });

  it('begrenzt nicht, wenn alle Reihen in die Höhe passen', () => {
    expect(ganzeReihenHoehe(kacheln, 3)).toBeUndefined();
    expect(ganzeReihenHoehe([], 4)).toBeUndefined();
  });
});

describe('FreiesZeichenPicker — reine Hilfen', () => {
  it('gibt der Kachel den Trefflächenboden der Dichte-Staffel, in jeder Stufe', () => {
    // Literale statt einer Rechnung aus dem Eingang: die Staffel 30/72 ist die Aussage.
    const kompakt = kachelStil({
      controlHeight: 30,
      paddingXS: 8,
      borderRadius: 0,
      fontSizeSM: 12,
    });
    expect(kompakt.minHeight).toBe(30);
    expect(kompakt.minWidth).toBe(30);
    const handschuh = kachelStil({
      controlHeight: 72,
      paddingXS: 8,
      borderRadius: 0,
      fontSizeSM: 12,
    });
    expect(handschuh.minHeight).toBe(72);
    expect(handschuh.minWidth).toBe(72);
    // Radius aus dem Token (Instrumententafel: 0), kein eigener Wert.
    expect(handschuh.borderRadius).toBe(0);
  });

  it('färbt die gewählte Kachel mit Bedienrand auf flaeche3, die ruhende mit Steuerrahmen auf paneel', () => {
    const r = farbenDunkel;
    expect(kachelFarben(r, true)).toMatchObject({
      borderColor: r.bedien,
      background: r.flaeche3,
      color: r.text,
    });
    expect(kachelFarben(r, false)).toMatchObject({
      borderColor: r.steuerRahmen,
      background: r.paneel,
      color: r.text,
    });
  });
});
