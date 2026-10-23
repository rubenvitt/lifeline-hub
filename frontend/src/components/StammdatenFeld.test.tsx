import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createCache, extractStyle, StyleProvider } from '@ant-design/cssinjs';
import { App as AntApp, ConfigProvider } from 'antd';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { antdThema } from '../theme/tokens';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import StammdatenFeld from './StammdatenFeld';
import type { StammdatenWert, Vorschlagsquelle } from './stammdatenFeldKern';

const einsatz: Vorschlagsquelle = {
  id: 'funkrufnamenEinsatz',
  gruppe: 'einsatz',
  eintraege: [{ label: 'Florian 1', wert: 'Florian 1' }],
};
const stammdaten = (uebernahme?: Vorschlagsquelle['uebernahme']): Vorschlagsquelle => ({
  id: 'externeStellen',
  gruppe: 'stammdaten',
  eintraege: [
    {
      label: 'Demo-Leitstelle',
      wert: 'Demo-Leitstelle',
      ref: { quelle: 'externeStellen', id: 9 },
      demo: true,
    },
    { label: 'ILS Musterkreis', wert: 'ILS Musterkreis', ref: { quelle: 'externeStellen', id: 1 } },
  ],
  uebernahme,
});
const zuletzt: Vorschlagsquelle = {
  id: 'zuletztVerwendet',
  gruppe: 'zuletzt',
  eintraege: [{ label: 'Polizei vor Ort', wert: 'Polizei vor Ort' }],
};

/** Gesteuert wie in einem `Form.Item`: der Wert lebt außen. */
function MitWert({
  quellen,
  nurText = false,
  onWert,
  ...rest
}: {
  quellen: Vorschlagsquelle[];
  nurText?: boolean;
  onWert?: (w: unknown) => void;
  onWahl?: (w: unknown) => void;
  onEnter?: (t: string) => void;
  onEscape?: () => void;
}) {
  const [wert, setWert] = useState<StammdatenWert | string>(nurText ? '' : { text: '' });
  const setze = (w: StammdatenWert | string) => {
    setWert(w);
    onWert?.(w);
  };
  return nurText ? (
    <StammdatenFeld
      nurText
      aria-label="Absender"
      quellen={quellen}
      value={wert as string}
      onChange={setze}
      {...rest}
    />
  ) : (
    <StammdatenFeld
      aria-label="Absender"
      quellen={quellen}
      value={wert as StammdatenWert}
      onChange={setze}
      {...rest}
    />
  );
}

/**
 * Die Liste dieses Feldes über `aria-controls`; offen heißt `aria-expanded` (in jsdom endet antds
 * Schließanimation nie, die Liste bliebe sonst im DOM „offen“, `test/auswahlListe.ts`).
 */
function offeneListe(): HTMLElement | null {
  const eingabe = screen.getByRole('combobox', { name: 'Absender' });
  if (eingabe.getAttribute('aria-expanded') !== 'true') return null;
  const id = eingabe.getAttribute('aria-controls');
  return id
    ? (document.getElementById(id)?.closest<HTMLElement>('.ant-select-dropdown') ?? null)
    : null;
}

const marke = () => document.querySelector<HTMLElement>('[data-lfh="quellenmarke"]');

/** Gruppenüberschriften und Einträge der offenen Liste in ihrer Folge. */
function listenFolge(): string[] {
  return [
    ...(offeneListe()?.querySelectorAll<HTMLElement>(
      '.ant-select-item-group, .ant-select-item-option',
    ) ?? []),
  ].map((k) =>
    k.classList.contains('ant-select-item-group')
      ? `# ${k.textContent}`
      : (k.getAttribute('title') ?? k.textContent ?? ''),
  );
}

const feld = () => screen.getByRole('combobox', { name: 'Absender' });

describe('StammdatenFeld', () => {
  it('zeigt die Gruppen „Im Einsatz“, „Stammdaten“, „Zuletzt verwendet“, Demo-Einträge dahinter', async () => {
    renderMitProviders(<MitWert quellen={[zuletzt, stammdaten(), einsatz]} />);
    await userEvent.click(feld());
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(offeneListe()).not.toBeNull());
    expect(listenFolge()).toEqual([
      '# Im Einsatz',
      'Florian 1',
      '# Stammdaten',
      'ILS Musterkreis',
      '# Zuletzt verwendet',
      'Polizei vor Ort',
      '# Demo-Daten',
      'Demo-Leitstelle',
    ]);
  });

  it('übernimmt Freitext und markiert ihn sichtbar als „frei“', async () => {
    const onWert = vi.fn();
    renderMitProviders(<MitWert quellen={[einsatz, stammdaten()]} onWert={onWert} />);
    await userEvent.type(feld(), 'Polizei');
    expect(onWert).toHaveBeenLastCalledWith({ text: 'Polizei' });
    expect(marke()).toHaveTextContent('frei');
    expect(feld()).toHaveAttribute('aria-describedby', expect.stringContaining(marke()!.id));
  });

  it('eine Auswahl trägt ihre Quelle: Referenz im Wert, Marke „Stammdaten“', async () => {
    const onWert = vi.fn();
    const onWahl = vi.fn();
    renderMitProviders(
      <MitWert quellen={[einsatz, stammdaten()]} onWert={onWert} onWahl={onWahl} />,
    );
    await userEvent.type(feld(), 'ILS');
    await userEvent.click(
      await waitFor(() => {
        const o = offeneListe()?.querySelector<HTMLElement>('[title="ILS Musterkreis"]');
        expect(o).toBeTruthy();
        return o!;
      }),
    );
    expect(onWert).toHaveBeenLastCalledWith({
      text: 'ILS Musterkreis',
      ref: { quelle: 'externeStellen', id: 1 },
    });
    expect(onWahl).toHaveBeenCalledWith(expect.objectContaining({ wert: 'ILS Musterkreis' }));
    expect(marke()).toHaveTextContent('Stammdaten');
  });

  it('im Modus nurText ist der Wert der Text; die Marke leitet sich aus dem Treffer ab', async () => {
    const onWert = vi.fn();
    renderMitProviders(<MitWert nurText quellen={[einsatz, stammdaten()]} onWert={onWert} />);
    await userEvent.type(feld(), 'Florian 1');
    expect(onWert).toHaveBeenLastCalledWith('Florian 1');
    expect(marke()).toHaveTextContent('Im Einsatz');
  });

  describe('„In Stammdaten übernehmen“', () => {
    it('legt einen freien Wert mit Recht im Katalog an; danach trägt er die Referenz', async () => {
      const anlegen = vi.fn().mockResolvedValue({ id: 42 });
      const onWert = vi.fn();
      renderMitProviders(
        <MitWert
          quellen={[stammdaten({ ziel: 'Externe Stellen', anlegen, gesperrt: null })]}
          onWert={onWert}
        />,
      );
      await userEvent.type(feld(), 'Polizei Musterstadt');
      await userEvent.keyboard('{Escape}');
      await userEvent.click(screen.getByRole('button', { name: 'In Stammdaten übernehmen' }));
      expect(anlegen).toHaveBeenCalledWith('Polizei Musterstadt');
      await waitFor(() =>
        expect(onWert).toHaveBeenLastCalledWith({
          text: 'Polizei Musterstadt',
          ref: { quelle: 'externeStellen', id: 42 },
        }),
      );
      expect(screen.queryByRole('button', { name: 'In Stammdaten übernehmen' })).toBeNull();
    });

    it('ist ohne Recht gesperrt und nennt den Grund sichtbar', async () => {
      const anlegen = vi.fn();
      renderMitProviders(
        <MitWert
          quellen={[stammdaten({ ziel: 'Externe Stellen', anlegen, gesperrt: 'nur System-Admin' })]}
        />,
      );
      await userEvent.type(feld(), 'Polizei');
      const knopf = screen.getByRole('button', { name: 'In Stammdaten übernehmen' });
      expect(knopf).toBeDisabled();
      const grund = screen.getByText('nur System-Admin');
      expect(knopf).toHaveAttribute('aria-describedby', grund.id);
      expect(anlegen).not.toHaveBeenCalled();
    });

    it('nennt eine Ablehnung am Feld', async () => {
      const anlegen = vi.fn().mockRejectedValue(new Error('Bezeichnung schon vergeben'));
      renderMitProviders(
        <MitWert quellen={[stammdaten({ ziel: 'Externe Stellen', anlegen, gesperrt: null })]} />,
      );
      await userEvent.type(feld(), 'Polizei');
      await userEvent.click(screen.getByRole('button', { name: 'In Stammdaten übernehmen' }));
      expect(await screen.findByText(/Bezeichnung schon vergeben/)).toHaveAttribute('data-fehler');
    });

    it('fehlt bei einem Wert aus einer Quelle und ohne Katalog mit Anlage', async () => {
      renderMitProviders(<MitWert quellen={[einsatz]} />);
      await userEvent.type(feld(), 'Polizei');
      expect(marke()).toHaveTextContent('frei');
      expect(screen.queryByRole('button', { name: 'In Stammdaten übernehmen' })).toBeNull();
    });
  });

  describe('Tastatur', () => {
    /**
     * Die Pfeil- und Entertaste der offenen Liste wertet rc-select über das alte `which` aus
     * (`OptionList`), das `userEvent` nicht setzt: diese Tasten gehen per `fireEvent` mit
     * `keyCode`/`which` (wie die Falle zu antds `Editable`, `frontend/AGENTS.md`). `fireEvent`
     * liefert `false`, wenn die Taste verhindert ist — so sendet der Browser das Formular nicht.
     */
    it('↓ öffnet, ↓ markiert, Enter übernimmt den Vorschlag und verhindert das Absenden', async () => {
      const onWahl = vi.fn();
      const onEnter = vi.fn();
      renderMitProviders(<MitWert quellen={[einsatz]} onWahl={onWahl} onEnter={onEnter} />);
      await userEvent.click(feld());
      await userEvent.keyboard('{Escape}');
      expect(offeneListe()).toBeNull();
      await userEvent.keyboard('{ArrowDown}');
      await waitFor(() => expect(offeneListe()).not.toBeNull());
      fireEvent.keyDown(feld(), { key: 'ArrowDown', keyCode: 40, which: 40 });
      await waitFor(() =>
        expect(offeneListe()?.querySelector('.ant-select-item-option-active')).toHaveAttribute(
          'title',
          'Florian 1',
        ),
      );
      // Das Versprechen hinter `onActive` (rc-select `onActiveValue`) muss durch sein.
      await Promise.resolve();
      const durchgelassen = fireEvent.keyDown(feld(), { key: 'Enter', keyCode: 13, which: 13 });
      expect(durchgelassen).toBe(false);
      expect(onWahl).toHaveBeenCalledWith(expect.objectContaining({ wert: 'Florian 1' }));
      expect(onEnter).not.toHaveBeenCalled();
      expect(feld()).toHaveValue('Florian 1');
    });

    it('Enter bei offener Liste ohne Markierung übernimmt den Freitext, schließt und sendet nicht', async () => {
      const absenden = vi.fn((e: React.FormEvent) => e.preventDefault());
      const onEnter = vi.fn();
      renderMitProviders(
        <form onSubmit={absenden}>
          <MitWert quellen={[einsatz]} onEnter={onEnter} />
          <button type="submit">Erfassen</button>
        </form>,
      );
      await userEvent.type(feld(), 'Flo');
      await waitFor(() => expect(offeneListe()).not.toBeNull());
      await userEvent.keyboard('{Enter}');
      expect(onEnter).toHaveBeenCalledWith('Flo');
      expect(feld()).toHaveValue('Flo');
      expect(absenden).not.toHaveBeenCalled();
      await waitFor(() => expect(offeneListe()).toBeNull());
      // Bei geschlossener Liste gilt die Erfassungs-Norm: Enter sendet.
      await userEvent.keyboard('{Enter}');
      expect(absenden).toHaveBeenCalledTimes(1);
      expect(offeneListe()).toBeNull();
    });

    it('Escape schließt erst die Liste, danach meldet das Feld Escape weiter', async () => {
      const onEscape = vi.fn();
      renderMitProviders(<MitWert quellen={[einsatz]} onEscape={onEscape} />);
      await userEvent.type(feld(), 'Flo');
      await waitFor(() => expect(offeneListe()).not.toBeNull());
      await userEvent.keyboard('{Escape}');
      expect(onEscape).not.toHaveBeenCalled();
      await waitFor(() => expect(offeneListe()).toBeNull());
      await userEvent.keyboard('{Escape}');
      expect(onEscape).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Trefflächen (design.md D6): die Vorschlagszeilen sind antds Optionen, deren Höhe
 * `optionHeight = controlHeight` ist — im Handschuh also 72 px. Das Feld setzt kein eigenes Maß;
 * belegt am CSS, das antd im Theme der App erzeugt (wie die Vorschauen des Design Systems), weil
 * jsdom kein Layout misst (`frontend/AGENTS.md`, Erfassungs-Norm, letzter Punkt).
 */
describe('StammdatenFeld — Trefflächen je Dichte', () => {
  it.each([
    ['kompakt', 30],
    ['komfortabel', 48],
    ['handschuh', 72],
  ] as const)('%s: Vorschlagszeilen %i px', (dichte, hoehe) => {
    const cache = createCache();
    renderToString(
      <StyleProvider cache={cache}>
        <ConfigProvider theme={antdThema(true, dichte)}>
          <AntApp>
            <StammdatenFeld nurText aria-label="Absender" quellen={[einsatz]} value="" />
          </AntApp>
        </ConfigProvider>
      </StyleProvider>,
    );
    const css = extractStyle(cache, { plain: true });
    expect(css).toMatch(new RegExp(`--ant-select-option-height:\\s*${hoehe}px`));
    expect(css).toMatch(/\.ant-select-item\{[^}]*min-height:var\(--ant-select-option-height\)/);
  });
});
