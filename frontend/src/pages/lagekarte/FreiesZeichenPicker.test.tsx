import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import type { FreiesZeichenUpdate } from '../../api/types';
import { farbenDunkel } from '../../theme/tokens';
import FreiesZeichenPicker, {
  kachelFarben,
  kachelStil,
  zeichenName,
  type FreiesZeichenPickerProps,
} from './FreiesZeichenPicker';
import { merkeZuletztVerwendet } from './zuletztVerwendet';

beforeEach(() => localStorage.clear());

function render(wert: FreiesZeichenUpdate, extra: Partial<FreiesZeichenPickerProps> = {}) {
  const onChange = extra.onChange ?? vi.fn<FreiesZeichenPickerProps['onChange']>();
  const onAbsenden =
    extra.onAbsenden ?? vi.fn<NonNullable<FreiesZeichenPickerProps['onAbsenden']>>();
  const ergebnis = renderMitProviders(
    <FreiesZeichenPicker wert={wert} onChange={onChange} onAbsenden={onAbsenden} />,
  );
  return { onChange, onAbsenden, ...ergebnis };
}

// getByLabelText kann bei antd-Selects mehrfach matchen → über Anzahl testen (robust).
const sichtbar = (label: string) => screen.queryAllByLabelText(label).length > 0;

/** Kachel-Abfragen laufen IMMER innerhalb ihres Rasters. Grundzeichen- und Symbolkatalog
 *  teilen sich Namen („Person", „Hubschrauber") — eine ungebundene Abfrage fände zwei. */
const raster = (name: string) => within(screen.getByRole('radiogroup', { name }));

/** Eingabefelder, getrennt nach „steht offen da" und „liegt hinter Details" — über
 *  DOM-Container, NICHT über `toBeVisible` (jsdom rechnet kein Layout). */
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

describe('FreiesZeichenPicker — Grundzeichen als Bild-Raster', () => {
  it('zeigt den vollen Katalog als Kacheln, ohne dass etwas geöffnet werden muss', () => {
    render({ grundzeichen: 'taktische-formation' });
    // „Kein Grundzeichen" und „Stelle, Einrichtung" liegen NICHT im kuratierten
    // Objekttyp-Set → sie belegen den vollen Katalog.
    const gz = raster('Grundzeichen');
    expect(gz.getByRole('radio', { name: 'Kein Grundzeichen' })).toBeInTheDocument();
    expect(gz.getByRole('radio', { name: 'Stelle, Einrichtung' })).toBeInTheDocument();
    expect(gz.getByRole('radio', { name: 'Hubschrauber' })).toBeInTheDocument();
  });

  it('trägt auf jeder Kachel BEIDES: das gezeichnete Zeichen und seinen Namen', () => {
    render({ grundzeichen: 'person' });
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Person' });
    const bild = kachel.querySelector('svg');
    expect(bild).not.toBeNull();
    // Gleichheit, nicht „enthält": nur sie fängt einen Namensbeitrag aus dem SVG.
    expect(bild!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(kachel).toHaveAccessibleName('Person');
    expect(within(kachel).getByText('Person')).toBeInTheDocument();
  });

  it('macht die Auswahl maschinenlesbar, nicht nur farblich', () => {
    render({ grundzeichen: 'person' });
    const gz = raster('Grundzeichen');
    expect(gz.getByRole('radio', { name: 'Person' })).toHaveAttribute('aria-checked', 'true');
    expect(gz.getByRole('radio', { name: 'Befehlsstelle' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('meldet beim Kachelklick die volle Spec und strippt die nicht mehr akzeptierten Overlays', async () => {
    const { onChange } = render({
      grundzeichen: 'person',
      funktion: 'fuehrungskraft',
      fachaufgabe: 'brandbekaempfung',
      symbol: 'drehleiter',
    });
    await userEvent.click(raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' }));
    // „ohne" akzeptiert nur symbol → funktion + fachaufgabe werden gestrippt, symbol bleibt.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        grundzeichen: 'ohne',
        funktion: null,
        fachaufgabe: null,
        symbol: 'drehleiter',
      }),
    );
  });

  it('schränkt die Kacheln über das Suchfeld ein', () => {
    render({ grundzeichen: 'person' });
    fireEvent.change(screen.getByLabelText('Grundzeichen suchen'), {
      target: { value: 'hubschr' },
    });
    expect(raster('Grundzeichen').getByRole('radio', { name: 'Hubschrauber' })).toBeInTheDocument();
    // Gegenaussage: was nicht passt, ist WEG — sonst filtert er nichts.
    expect(raster('Grundzeichen').queryByRole('radio', { name: 'Person' })).toBeNull();
  });

  it('sagt es, wenn die Suche nichts findet', () => {
    render({ grundzeichen: 'person' });
    fireEvent.change(screen.getByLabelText('Grundzeichen suchen'), { target: { value: 'xyzzy' } });
    expect(screen.getByText('Kein Treffer')).toBeInTheDocument();
  });

  it('setzt den Fokus beim Öffnen ins Grundzeichen-Suchfeld', () => {
    render({ grundzeichen: 'person' });
    expect(screen.getByLabelText('Grundzeichen suchen')).toHaveFocus();
  });

  it('lässt den Fokus in Ruhe, wo der Picker dauerhaft steht (Inspector)', () => {
    renderMitProviders(
      <FreiesZeichenPicker
        wert={{ grundzeichen: 'person' }}
        onChange={vi.fn()}
        autoFokus={false}
      />,
    );
    expect(screen.getByLabelText('Grundzeichen suchen')).not.toHaveFocus();
  });

  it('bewegt die Auswahl mit den Pfeiltasten und ist EIN Tabstopp', () => {
    const { onChange } = render({ grundzeichen: 'ohne' });
    const erste = raster('Grundzeichen').getByRole('radio', { name: 'Kein Grundzeichen' });
    erste.focus();
    fireEvent.keyDown(erste, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ grundzeichen: 'taktische-formation' }),
    );
    // Nur die gewählte Kachel ist tabbierbar.
    expect(erste).toHaveAttribute('tabindex', '0');
    expect(
      raster('Grundzeichen').getByRole('radio', { name: 'Taktische Formation' }),
    ).toHaveAttribute('tabindex', '-1');
  });
});

describe('FreiesZeichenPicker — Symbole als Bild-Raster', () => {
  it('zeigt die Symbole als Kacheln mit eigener Suche und einem Weg zurück auf „kein Symbol"', () => {
    const { onChange } = render({ grundzeichen: 'ohne', symbol: 'drehleiter' });
    expect(raster('Symbol').getByRole('radio', { name: 'Drehleiter' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.change(screen.getByLabelText('Symbol suchen'), { target: { value: 'drehl' } });
    expect(raster('Symbol').queryByRole('radio', { name: 'Bagger' })).toBeNull();
    // „Kein Symbol" überlebt den Filter.
    fireEvent.click(raster('Symbol').getByRole('radio', { name: 'Kein Symbol' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ symbol: null }));
  });
});

describe('FreiesZeichenPicker — accepts-Gating', () => {
  it('blendet nicht-akzeptierte Overlays aus („ohne" akzeptiert laut Katalog nur symbol)', () => {
    render({ grundzeichen: 'ohne' });
    expect(sichtbar('Symbol')).toBe(true);
    expect(sichtbar('Fachaufgabe')).toBe(false);
    expect(sichtbar('Organisation')).toBe(false);
    expect(sichtbar('Einheit')).toBe(false);
    expect(sichtbar('Funktion')).toBe(false);
  });

  it('zeigt Funktion nur für „person", nicht für „taktische-formation"', () => {
    const { rerender } = renderMitProviders(
      <FreiesZeichenPicker wert={{ grundzeichen: 'person' }} onChange={vi.fn()} />,
    );
    expect(sichtbar('Funktion')).toBe(true);
    expect(sichtbar('Fachaufgabe')).toBe(true);
    rerender(
      <FreiesZeichenPicker wert={{ grundzeichen: 'taktische-formation' }} onChange={vi.fn()} />,
    );
    expect(sichtbar('Funktion')).toBe(false);
    expect(sichtbar('Einheit')).toBe(true);
  });
});

describe('FreiesZeichenPicker — Feldbudget: Sekundäres hinter „Details"', () => {
  it('lässt offen nur die zwei Suchfelder stehen, der Rest liegt im Detail-Bereich', () => {
    render({ grundzeichen: 'person' });
    const { offen, imDetail, alle } = felder();
    expect(offen).toHaveLength(2);
    // Zweite Hälfte: die Felder sind WEGGERÄUMT, nicht abwesend — ohne `forceRender` wäre
    // die erste Aussage trivial erfüllt.
    expect(imDetail.length).toBeGreaterThanOrEqual(5);
    expect(alle.length).toBeGreaterThan(offen.length);
  });

  it('ist zugeklappt und öffnet auf Klick', async () => {
    render({ grundzeichen: 'person' });
    const kopf = screen.getByRole('button', { name: /Details/ });
    const eintrag = kopf.closest('.ant-collapse-item')!;
    expect(eintrag).not.toHaveClass('ant-collapse-item-active');
    await userEvent.click(kopf);
    await waitFor(() => expect(eintrag).toHaveClass('ant-collapse-item-active'));
  });

  it('meldet Änderungen an der Bezeichnung beim Verlassen als volle Spec', () => {
    const { onChange } = render({ grundzeichen: 'taktische-formation' });
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'EA Nord' } });
    fireEvent.blur(feld);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ grundzeichen: 'taktische-formation', label: 'EA Nord' }),
    );
  });
});

describe('FreiesZeichenPicker — Enter platziert (LFH-716, D4)', () => {
  it('platziert per Enter auf einer Kachel mit dem Zeichen DIESER Kachel', () => {
    const { onAbsenden, onChange } = render({ grundzeichen: 'taktische-formation', label: 'X' });
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Person' });
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledTimes(1);
    expect(onAbsenden).toHaveBeenCalledWith(
      expect.objectContaining({ grundzeichen: 'person', label: 'X' }),
    );
    // Auch der Entwurf zieht nach — sonst stünde nach dem Platzieren der alte in der Leiste.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ grundzeichen: 'person' }));
  });

  it('platziert per Enter im Suchfeld mit dem ersten Treffer, wenn die Auswahl nicht darunter ist', () => {
    const { onAbsenden } = render({ grundzeichen: 'person' });
    const suche = screen.getByLabelText('Grundzeichen suchen');
    fireEvent.change(suche, { target: { value: 'hubschr' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledWith(
      expect.objectContaining({ grundzeichen: 'hubschrauber' }),
    );
  });

  it('behält per Enter im Suchfeld die Auswahl, wenn sie unter den Treffern steht', () => {
    const { onAbsenden } = render({ grundzeichen: 'person' });
    const suche = screen.getByLabelText('Grundzeichen suchen');
    fireEvent.change(suche, { target: { value: 'pers' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledWith(expect.objectContaining({ grundzeichen: 'person' }));
  });

  it('platziert per Enter im leeren Suchfeld die aktuelle Auswahl', () => {
    const { onAbsenden } = render({ grundzeichen: 'befehlsstelle' });
    fireEvent.keyDown(screen.getByLabelText('Grundzeichen suchen'), { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledWith(
      expect.objectContaining({ grundzeichen: 'befehlsstelle' }),
    );
  });

  it('platziert NICHT per Enter im Suchfeld ohne Treffer', () => {
    const { onAbsenden } = render({ grundzeichen: 'person' });
    const suche = screen.getByLabelText('Grundzeichen suchen');
    fireEvent.change(suche, { target: { value: 'xyzzy' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(onAbsenden).not.toHaveBeenCalled();
  });

  it('nimmt im Symbol-Suchfeld den ersten ECHTEN Treffer, nicht „Kein Symbol"', () => {
    const { onAbsenden } = render({ grundzeichen: 'ohne' });
    const suche = screen.getByLabelText('Symbol suchen');
    fireEvent.change(suche, { target: { value: 'drehl' } });
    fireEvent.keyDown(suche, { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'drehleiter' }));
  });

  it('platziert mit der GERADE getippten Bezeichnung, nicht mit dem alten Stand', () => {
    const { onAbsenden } = render({ grundzeichen: 'taktische-formation' });
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'EA Nord' } });
    fireEvent.keyDown(feld, { key: 'Enter' });
    expect(onAbsenden).toHaveBeenCalledWith(
      expect.objectContaining({ grundzeichen: 'taktische-formation', label: 'EA Nord' }),
    );
  });

  it('platziert NICHT beim blossen Verlassen eines Feldes', () => {
    const { onAbsenden } = render({ grundzeichen: 'taktische-formation' });
    const feld = screen.getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'EA Nord' } });
    fireEvent.blur(feld);
    expect(onAbsenden).not.toHaveBeenCalled();
  });

  it('kommt ohne den Callback aus und sendet dann nichts (Inspector)', () => {
    const onChange = vi.fn();
    renderMitProviders(
      <FreiesZeichenPicker
        wert={{ grundzeichen: 'person' }}
        onChange={onChange}
        autoFokus={false}
      />,
    );
    const kachel = raster('Grundzeichen').getByRole('radio', { name: 'Person' });
    expect(() => fireEvent.keyDown(kachel, { key: 'Enter' })).not.toThrow();
    expect(() =>
      fireEvent.keyDown(screen.getByLabelText('Bezeichnung'), { key: 'Enter' }),
    ).not.toThrow();
  });
});

describe('FreiesZeichenPicker — zuletzt verwendet', () => {
  it('zeigt keine Leiste, solange nichts benutzt wurde', () => {
    render({ grundzeichen: 'person' });
    expect(screen.queryByRole('group', { name: 'Zuletzt verwendet' })).toBeNull();
  });

  it('übernimmt auf Klick das ganze Zeichen und lässt die Bezeichnung des Entwurfs stehen', async () => {
    merkeZuletztVerwendet({ grundzeichen: 'person', fachaufgabe: 'brandbekaempfung' });
    const { onChange } = render({ grundzeichen: 'taktische-formation', label: 'EA Nord' });
    const leiste = screen.getByRole('group', { name: 'Zuletzt verwendet' });
    await userEvent.click(within(leiste).getByRole('button', { name: 'Person · Brandbekämpfung' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        grundzeichen: 'person',
        fachaufgabe: 'brandbekaempfung',
        label: 'EA Nord',
      }),
    );
  });

  it('zeigt die gemerkten Zeichen, das jüngste vorn', () => {
    merkeZuletztVerwendet({ grundzeichen: 'person' });
    merkeZuletztVerwendet({ grundzeichen: 'befehlsstelle' });
    render({ grundzeichen: 'person' });
    const knoepfe = within(screen.getByRole('group', { name: 'Zuletzt verwendet' })).getAllByRole(
      'button',
    );
    expect(knoepfe.map((k) => k.getAttribute('aria-label'))).toEqual(['Befehlsstelle', 'Person']);
  });

  it('erneuert sich, wenn anderswo platziert wurde (der Picker bleibt montiert)', async () => {
    render({ grundzeichen: 'person' });
    expect(screen.queryByRole('group', { name: 'Zuletzt verwendet' })).toBeNull();
    act(() => merkeZuletztVerwendet({ grundzeichen: 'befehlsstelle' }));
    expect(await screen.findByRole('group', { name: 'Zuletzt verwendet' })).toBeInTheDocument();
  });
});

describe('FreiesZeichenPicker — zwei Picker im selben Baum', () => {
  it('unterscheidet sie über den Auswahlzustand, nicht über den Kacheltext', async () => {
    // Auf der Lagekarte können Leisten-Picker und Inspector-Picker gleichzeitig hängen.
    renderMitProviders(
      <>
        <FreiesZeichenPicker
          wert={{ grundzeichen: 'taktische-formation' }}
          onChange={vi.fn()}
          autoFokus={false}
        />
        <FreiesZeichenPicker
          wert={{ grundzeichen: 'stelle' }}
          onChange={vi.fn()}
          autoFokus={false}
        />
      </>,
    );
    expect(screen.getAllByRole('radio', { name: 'Stelle, Einrichtung' })).toHaveLength(2);
    const vorbelegt = await screen.findAllByRole('radio', {
      name: 'Stelle, Einrichtung',
      checked: true,
    });
    expect(vorbelegt).toHaveLength(1);
  });
});

describe('FreiesZeichenPicker — reine Hilfen', () => {
  it('benennt ein Zeichen aus seinen Katalog-Bestandteilen', () => {
    expect(zeichenName({ grundzeichen: 'person' })).toBe('Person');
    expect(
      zeichenName({
        grundzeichen: 'person',
        organisation: 'feuerwehr',
        funktion: 'fuehrungskraft',
      }),
    ).toBe('Person · Feuerwehr · Führungskraft');
  });

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
