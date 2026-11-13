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
  onUebernahme?: (u: unknown) => void;
  enterSendet?: boolean;
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

  /**
   * Tastaturregel (Spec `stammdaten-feld`, Anforderung „Tastatur“; design.md D5 der Change
   * `kwc2yszv-etb-neuentwurf`): der oberste passende Vorschlag ist markiert, Enter und Tab nehmen
   * ihn, Freitext trotz Treffer über den letzten Eintrag „„…“ als Freitext übernehmen“. Die Regel
   * gilt im Modus mit Referenz wie im Modus `nurText` (ETB, Meldungsformular).
   *
   * Die Pfeiltasten der offenen Liste wertet rc-select über das alte `which` aus (`OptionList`), das
   * `userEvent` nicht setzt: ↓/↑ in der offenen Liste gehen per `fireEvent` mit `keyCode`/`which`
   * (wie die Falle zu antds `Editable`, `frontend/AGENTS.md`). Enter und Tab nimmt das Feld selbst
   * (nach `key`); `userEvent` sendet bei nicht verhindertem Enter das Formular und bewegt bei nicht
   * verhindertem Tab den Fokus wie der Browser.
   */
  describe.each([
    ['mit Referenz', false],
    ['nurText', true],
  ] as const)('Tastatur (%s)', (_modus, nurText) => {
    const textVon = (w: unknown) => (typeof w === 'string' ? w : (w as StammdatenWert).text);
    const sanitaet: Vorschlagsquelle = {
      id: 'einheitenEinsatz',
      gruppe: 'einsatz',
      eintraege: [
        { label: 'Sanitätsgruppe UHS', wert: 'Sanitätsgruppe UHS' },
        { label: 'Sanitätszug Musterstadt', wert: 'Sanitätszug Musterstadt' },
      ],
    };

    /** Feld mit Formular, Absende-Knopf und einem Folgefeld, wie in einer Erfassung. */
    function Formular(props: Parameters<typeof MitWert>[0] & { absenden?: () => void }) {
      const { absenden, ...rest } = props;
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            absenden?.();
          }}
        >
          <MitWert nurText={nurText} {...rest} />
          <input aria-label="Inhalt" />
          <button type="submit">Erfassen</button>
        </form>
      );
    }

    const aktiverEintrag = () =>
      offeneListe()?.querySelector('.ant-select-item-option-active')?.getAttribute('title');

    it('Enter nach dem Tippen übernimmt den obersten Vorschlag, schließt und sendet nicht', async () => {
      const absenden = vi.fn();
      const onWert = vi.fn();
      const onWahl = vi.fn();
      renderMitProviders(
        <Formular quellen={[einsatz]} absenden={absenden} onWert={onWert} onWahl={onWahl} />,
      );
      await userEvent.type(feld(), 'Flo');
      await waitFor(() => expect(aktiverEintrag()).toBe('Florian 1'));
      await userEvent.keyboard('{Enter}');
      expect(feld()).toHaveValue('Florian 1');
      expect(textVon(onWert.mock.lastCall?.[0])).toBe('Florian 1');
      expect(onWahl).toHaveBeenCalledWith(expect.objectContaining({ wert: 'Florian 1' }));
      expect(absenden).not.toHaveBeenCalled();
      await waitFor(() => expect(offeneListe()).toBeNull());
      expect(marke()).toHaveTextContent('Im Einsatz');
      // Bei geschlossener Liste gilt die Erfassungs-Norm: Enter sendet.
      await userEvent.keyboard('{Enter}');
      expect(absenden).toHaveBeenCalledTimes(1);
      expect(offeneListe()).toBeNull();
    });

    it('markiert den obersten passenden Vorschlag, auch wenn ein späterer mit dem Text beginnt', async () => {
      const zugtrupp: Vorschlagsquelle = {
        id: 'einheitenEinsatz',
        gruppe: 'einsatz',
        eintraege: [{ label: 'Zugtrupp Florian', wert: 'Zugtrupp Florian' }],
      };
      const florian: Vorschlagsquelle = {
        id: 'funkrufnamenStammdaten',
        gruppe: 'stammdaten',
        eintraege: [{ label: 'Florian 1', wert: 'Florian 1' }],
      };
      renderMitProviders(<Formular quellen={[zugtrupp, florian]} />);
      await userEvent.type(feld(), 'Flo');
      await waitFor(() => expect(aktiverEintrag()).toBe('Zugtrupp Florian'));
      await userEvent.keyboard('{Enter}');
      expect(feld()).toHaveValue('Zugtrupp Florian');
    });

    it('Tab nach dem Tippen übernimmt den obersten Vorschlag und springt ins nächste Feld', async () => {
      const onWert = vi.fn();
      renderMitProviders(<Formular quellen={[sanitaet]} onWert={onWert} />);
      await userEvent.type(feld(), 'San');
      await waitFor(() => expect(aktiverEintrag()).toBe('Sanitätsgruppe UHS'));
      await userEvent.tab();
      expect(textVon(onWert.mock.lastCall?.[0])).toBe('Sanitätsgruppe UHS');
      expect(feld()).toHaveValue('Sanitätsgruppe UHS');
      expect(screen.getByRole('textbox', { name: 'Inhalt' })).toHaveFocus();
      await waitFor(() => expect(offeneListe()).toBeNull());
    });

    it('Tab hält den Fokus nicht fest: rc-selects Tab-Griff (`which` 9) kommt nicht zum Zug', async () => {
      const onWert = vi.fn();
      renderMitProviders(<Formular quellen={[sanitaet]} onWert={onWert} />);
      await userEvent.type(feld(), 'San');
      await waitFor(() => expect(aktiverEintrag()).toBe('Sanitätsgruppe UHS'));
      await Promise.resolve();
      // Wie der Browser: mit `which`. rc-select verhinderte sonst die Taste (`OptionList`, „Select
      // (Tab / Enter)“), und der Fokus bliebe im Feld.
      const durchgelassen = fireEvent.keyDown(feld(), { key: 'Tab', keyCode: 9, which: 9 });
      expect(durchgelassen).toBe(true);
      expect(textVon(onWert.mock.lastCall?.[0])).toBe('Sanitätsgruppe UHS');
      // Auch Umschalt+Tab und Tab bei geschlossener Liste bleiben frei.
      expect(fireEvent.keyDown(feld(), { key: 'Tab', keyCode: 9, which: 9, shiftKey: true })).toBe(
        true,
      );
      expect(fireEvent.keyDown(feld(), { key: 'Tab', keyCode: 9, which: 9 })).toBe(true);
    });

    it('Umschalt+Tab verlässt das Feld rückwärts und lässt den getippten Text stehen', async () => {
      renderMitProviders(
        <>
          <input aria-label="Davor" />
          <Formular quellen={[sanitaet]} />
        </>,
      );
      await userEvent.type(feld(), 'San');
      await waitFor(() => expect(offeneListe()).not.toBeNull());
      await userEvent.tab({ shift: true });
      expect(screen.getByRole('textbox', { name: 'Davor' })).toHaveFocus();
      expect(feld()).toHaveValue('San');
    });

    it('der letzte Eintrag nimmt den getippten Text als Freitext; er trägt „frei“', async () => {
      const onWert = vi.fn();
      const onWahl = vi.fn();
      renderMitProviders(<Formular quellen={[einsatz]} onWert={onWert} onWahl={onWahl} />);
      await userEvent.type(feld(), 'Flo');
      await waitFor(() =>
        expect(listenFolge()).toEqual([
          '# Im Einsatz',
          'Florian 1',
          '„Flo“ als Freitext übernehmen',
        ]),
      );
      await userEvent.click(
        offeneListe()!.querySelector<HTMLElement>('[title="„Flo“ als Freitext übernehmen"]')!,
      );
      expect(feld()).toHaveValue('Flo');
      expect(textVon(onWert.mock.lastCall?.[0])).toBe('Flo');
      if (!nurText) expect(onWert).toHaveBeenLastCalledWith({ text: 'Flo' });
      expect(onWahl).not.toHaveBeenCalled();
      expect(marke()).toHaveTextContent('frei');
      await waitFor(() => expect(offeneListe()).toBeNull());
    });

    it('der Freitext-Eintrag lässt sich per Tastatur wählen und nimmt den Text unverändert', async () => {
      const absenden = vi.fn();
      const onEnter = vi.fn();
      renderMitProviders(<Formular quellen={[einsatz]} absenden={absenden} onEnter={onEnter} />);
      await userEvent.type(feld(), 'Flo ');
      await waitFor(() => expect(aktiverEintrag()).toBe('Florian 1'));
      fireEvent.keyDown(feld(), { key: 'ArrowDown', keyCode: 40, which: 40 });
      await waitFor(() => expect(aktiverEintrag()).toBe('„Flo “ als Freitext übernehmen'));
      // Das Versprechen hinter `onActive` (rc-select `onActiveValue`) muss durch sein.
      await Promise.resolve();
      await userEvent.keyboard('{Enter}');
      expect(feld()).toHaveValue('Flo ');
      expect(onEnter).toHaveBeenCalledWith('Flo ');
      expect(absenden).not.toHaveBeenCalled();
      expect(marke()).toHaveTextContent('frei');
    });

    it('kein Vorschlag passt: Enter übernimmt den getippten Text als freien Wert und sendet nicht', async () => {
      const absenden = vi.fn();
      const onEnter = vi.fn();
      renderMitProviders(<Formular quellen={[einsatz]} absenden={absenden} onEnter={onEnter} />);
      await userEvent.type(feld(), 'Abschnitt Nord');
      await waitFor(() =>
        expect(listenFolge()).toEqual(['„Abschnitt Nord“ als Freitext übernehmen']),
      );
      await userEvent.keyboard('{Enter}');
      expect(feld()).toHaveValue('Abschnitt Nord');
      expect(onEnter).toHaveBeenCalledWith('Abschnitt Nord');
      expect(absenden).not.toHaveBeenCalled();
      expect(marke()).toHaveTextContent('frei');
      await waitFor(() => expect(offeneListe()).toBeNull());
    });

    it('kein Vorschlag passt: Tab und Verlassen behalten den getippten Text', async () => {
      renderMitProviders(<Formular quellen={[einsatz]} />);
      await userEvent.type(feld(), 'Abschnitt Nord');
      await userEvent.tab();
      expect(screen.getByRole('textbox', { name: 'Inhalt' })).toHaveFocus();
      expect(feld()).toHaveValue('Abschnitt Nord');

      await userEvent.clear(feld());
      await userEvent.type(feld(), 'Abschnitt Süd');
      await userEvent.click(screen.getByRole('textbox', { name: 'Inhalt' }));
      expect(feld()).toHaveValue('Abschnitt Süd');
      expect(marke()).toHaveTextContent('frei');
    });

    it('ein stehender Wert ohne passenden Vorschlag öffnet beim Klick keine Liste; Escape bricht ab', async () => {
      const onEscape = vi.fn();
      renderMitProviders(<MitWert nurText={nurText} quellen={[einsatz]} onEscape={onEscape} />);
      await userEvent.type(feld(), 'Abschnitt Nord');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(offeneListe()).toBeNull());
      await userEvent.click(document.body);
      // Wieder hinein, ohne zu tippen: nur der Freitext-Eintrag passte, eine Liste wäre Lärm.
      await userEvent.click(feld());
      expect(offeneListe()).toBeNull();
      await userEvent.keyboard('{Escape}');
      expect(onEscape).toHaveBeenCalledTimes(1);
      // Wer tippt, sieht den Eintrag wieder.
      await userEvent.type(feld(), ' 2');
      await waitFor(() =>
        expect(listenFolge()).toEqual(['„Abschnitt Nord 2“ als Freitext übernehmen']),
      );
    });

    it('ein Text, der genau einem Vorschlag gleicht, bekommt keinen Freitext-Eintrag', async () => {
      renderMitProviders(<Formular quellen={[einsatz]} />);
      await userEvent.type(feld(), 'Florian 1');
      await waitFor(() => expect(listenFolge()).toEqual(['# Im Einsatz', 'Florian 1']));
    });

    it('Vorschlag per Tastatur: ↓, ↓ und Enter übernehmen den zweiten Vorschlag, nichts wird gesendet', async () => {
      const absenden = vi.fn();
      const onWahl = vi.fn();
      renderMitProviders(<Formular quellen={[sanitaet]} absenden={absenden} onWahl={onWahl} />);
      await userEvent.click(feld());
      await userEvent.keyboard('{Escape}');
      expect(offeneListe()).toBeNull();
      await userEvent.keyboard('{ArrowDown}');
      await waitFor(() => expect(aktiverEintrag()).toBe('Sanitätsgruppe UHS'));
      fireEvent.keyDown(feld(), { key: 'ArrowDown', keyCode: 40, which: 40 });
      await waitFor(() => expect(aktiverEintrag()).toBe('Sanitätszug Musterstadt'));
      await Promise.resolve();
      const durchgelassen = fireEvent.keyDown(feld(), { key: 'Enter', keyCode: 13, which: 13 });
      expect(durchgelassen).toBe(false);
      expect(onWahl).toHaveBeenCalledWith(
        expect.objectContaining({ wert: 'Sanitätszug Musterstadt' }),
      );
      expect(feld()).toHaveValue('Sanitätszug Musterstadt');
      expect(absenden).not.toHaveBeenCalled();
    });

    it('Escape schließt erst die Liste und lässt den Text stehen, danach meldet das Feld Escape weiter', async () => {
      const onEscape = vi.fn();
      renderMitProviders(<MitWert nurText={nurText} quellen={[einsatz]} onEscape={onEscape} />);
      await userEvent.type(feld(), 'Flo');
      await waitFor(() => expect(offeneListe()).not.toBeNull());
      await userEvent.keyboard('{Escape}');
      expect(onEscape).not.toHaveBeenCalled();
      expect(feld()).toHaveValue('Flo');
      await waitFor(() => expect(offeneListe()).toBeNull());
      await userEvent.keyboard('{Escape}');
      expect(onEscape).toHaveBeenCalledTimes(1);
      expect(feld()).toHaveValue('Flo');
    });

    it('meldet jede Übernahme mit ihrem Weg (Enter, Tab, Klick)', async () => {
      const onUebernahme = vi.fn();
      renderMitProviders(<Formular quellen={[sanitaet]} onUebernahme={onUebernahme} />);
      await userEvent.type(feld(), 'San');
      await waitFor(() => expect(aktiverEintrag()).toBe('Sanitätsgruppe UHS'));
      await userEvent.keyboard('{Enter}');
      expect(onUebernahme).toHaveBeenLastCalledWith({
        text: 'Sanitätsgruppe UHS',
        vorschlag: expect.objectContaining({ wert: 'Sanitätsgruppe UHS' }),
        weg: 'enter',
        ausListe: true,
      });
      // Enter bei geschlossener Liste meldet den stehenden Text.
      await userEvent.keyboard('{Enter}');
      expect(onUebernahme).toHaveBeenLastCalledWith({
        text: 'Sanitätsgruppe UHS',
        weg: 'enter',
        ausListe: false,
      });

      await userEvent.clear(feld());
      await userEvent.type(feld(), 'Zug');
      await waitFor(() => expect(aktiverEintrag()).toBe('Sanitätszug Musterstadt'));
      await userEvent.click(
        offeneListe()!.querySelector<HTMLElement>('[title="„Zug“ als Freitext übernehmen"]')!,
      );
      expect(onUebernahme).toHaveBeenLastCalledWith({ text: 'Zug', weg: 'klick', ausListe: true });

      await userEvent.clear(feld());
      await userEvent.type(feld(), 'San');
      await waitFor(() => expect(aktiverEintrag()).toBe('Sanitätsgruppe UHS'));
      await userEvent.tab();
      expect(onUebernahme).toHaveBeenLastCalledWith({
        text: 'Sanitätsgruppe UHS',
        vorschlag: expect.objectContaining({ wert: 'Sanitätsgruppe UHS' }),
        weg: 'tab',
        ausListe: true,
      });
      expect(onUebernahme).toHaveBeenCalledTimes(4);
    });

    it('mit enterSendet={false} sendet auch Enter bei geschlossener Liste nicht', async () => {
      const absenden = vi.fn();
      const onUebernahme = vi.fn();
      renderMitProviders(
        <Formular
          quellen={[einsatz]}
          absenden={absenden}
          enterSendet={false}
          onUebernahme={onUebernahme}
        />,
      );
      await userEvent.type(feld(), 'Flo{Enter}');
      await waitFor(() => expect(offeneListe()).toBeNull());
      await userEvent.keyboard('{Enter}');
      expect(absenden).not.toHaveBeenCalled();
      expect(onUebernahme).toHaveBeenCalledTimes(2);
      expect(onUebernahme).toHaveBeenLastCalledWith({
        text: 'Florian 1',
        weg: 'enter',
        ausListe: false,
      });
    });
  });
});

/**
 * Trefflächen (design.md D6): die Vorschlagszeilen sind antds Optionen, deren Höhe
 * `optionHeight = controlHeight` ist — im Handschuh also 72 px. Das Feld setzt kein eigenes Maß;
 * belegt am CSS, das antd im Theme der App erzeugt (wie die Vorschauen des Design Systems), weil
 * jsdom kein Layout misst (`frontend/AGENTS.md`, Erfassungs-Norm, letzter Punkt).
 */
describe('StammdatenFeld — nichts übernehmen, was niemand gemeint hat (kwc2yszv, Review E1)', () => {
  const zwoelf: Vorschlagsquelle = {
    id: 'funkrufnamenEinsatz',
    gruppe: 'einsatz',
    eintraege: [{ label: 'Florian 12', wert: 'Florian 12' }],
  };
  const eins: Vorschlagsquelle = {
    id: 'fahrzeugeStammdaten',
    gruppe: 'stammdaten',
    eintraege: [{ label: 'Florian 1', wert: 'Florian 1' }],
  };

  it('Enter nach exakt „Florian 1“ nimmt „Florian 1“, nicht den obersten „Florian 12“', async () => {
    const onWert = vi.fn();
    renderMitProviders(<MitWert nurText quellen={[zwoelf, eins]} onWert={onWert} />);
    await userEvent.type(feld(), 'Florian 1');
    await waitFor(() => expect(offeneListe()).not.toBeNull());
    await userEvent.keyboard('{Enter}');
    expect(feld()).toHaveValue('Florian 1');
  });

  it('Tab ohne Tippen nimmt keinen Vorschlag: ein stehender Wert bleibt', async () => {
    function Stehend() {
      const [wert, setWert] = useState('Flor');
      return (
        <>
          <StammdatenFeld
            nurText
            aria-label="Absender"
            quellen={[zwoelf, eins]}
            value={wert}
            onChange={setWert}
          />
          <input aria-label="danach" />
        </>
      );
    }
    renderMitProviders(<Stehend />);
    // Ein Klick öffnet die Liste (rc-select öffnet beim Mausdruck); getippt ist nichts.
    await userEvent.click(feld());
    await waitFor(() => expect(offeneListe()).not.toBeNull());
    await userEvent.tab();
    expect(feld()).toHaveValue('Flor');
    expect(screen.getByRole('textbox', { name: 'danach' })).toHaveFocus();
  });
});

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
