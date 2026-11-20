import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { TEST_VORSCHLAEGE } from '../test/fuehrungsfunktionen';
import { EmpfaengerWahl } from './EmpfaengerWahl';

/** Hält den Wert wie ein `Form.Item` und meldet jede Änderung an `onChange`. */
function Huelle({ onChange }: { onChange: (werte: string[]) => void }) {
  const [werte, setWerte] = useState<string[]>([]);
  return (
    <>
      <EmpfaengerWahl
        aria-label="Verteiler"
        abschnitte={[
          { id: 1, name: 'EA Süd' },
          { id: 4, name: 'Sanitätsdienst' },
        ]}
        einheiten={[
          { id: 2, name: '1. Zug' },
          { id: 3, name: 'Logistiktrupp' },
        ]}
        vorschlaege={TEST_VORSCHLAEGE}
        value={werte}
        onChange={(w) => {
          setWerte(w);
          onChange(w);
        }}
      />
      <input aria-label="Nächstes Feld" />
    </>
  );
}

function rendern() {
  const onChange = vi.fn<(werte: string[]) => void>();
  renderMitProviders(<Huelle onChange={onChange} />);
  return { onChange, feld: screen.getByLabelText('Verteiler') };
}

/** Die offene Auswahlliste. */
const liste = () =>
  document.querySelector<HTMLElement>('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')!;

describe('EmpfaengerWahl (kz5udbog D7)', () => {
  it('Blur nach Tippen erzeugt keinen Tag', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Lagezentrum');
    await userEvent.click(screen.getByLabelText('Nächstes Feld'));

    expect(onChange).not.toHaveBeenCalled();
    expect(feld).toHaveValue('');
    // Kein Tag im Feld; die schließende Liste darf die Option noch tragen.
    expect(
      within(feld.closest<HTMLElement>('.ant-select')!).queryByTitle('Lagezentrum'),
    ).toBeNull();
  });

  /**
   * rc-selects Optionsliste liest beim Enter das alte `which`, das `userEvent` nicht setzt; die
   * Taste geht deshalb über `fireEvent` mit `keyCode` (Falle wie bei antds `Editable`).
   */
  it('ohne Stammdatentreffer übernimmt Enter den getippten Text als Freitext', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Lagezentrum');
    fireEvent.keyDown(feld, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    expect(onChange).toHaveBeenLastCalledWith(['Lagezentrum']);
  });

  it('das Komma trennt Empfänger', async () => {
    const { onChange, feld } = rendern();
    fireEvent.change(feld, { target: { value: 'Lagezentrum,ILS,' } });
    expect(onChange).toHaveBeenLastCalledWith(['Lagezentrum', 'ILS']);
  });

  it('Sachgebiet zeigt Besetzung im Vorschlag, der Wert trägt keinen Namen', async () => {
    const { onChange, feld } = rendern();
    await userEvent.click(feld);
    await userEvent.click(await screen.findByTitle('S2 – Lage (Müller)'));
    expect(onChange).toHaveBeenLastCalledWith(['funktion:s2']);
  });

  it('drei Gruppen: Einsatzabschnitte, Einheiten, Funktionen', async () => {
    const { onChange, feld } = rendern();
    await userEvent.click(feld);
    await screen.findByTitle('EA Süd');
    const offen = within(liste());
    for (const gruppe of ['Einsatzabschnitte', 'Einheiten', 'Funktionen']) {
      expect(offen.getByText(gruppe)).toBeInTheDocument();
    }
    await userEvent.click(offen.getByTitle('EA Süd'));
    // Nach einer Wahl schließt die Liste (LLH-1753); der zweite Empfänger öffnet sie neu.
    await userEvent.click(feld);
    await userEvent.click(within(liste()).getByTitle('1. Zug'));
    expect(onChange).toHaveBeenLastCalledWith(['abschnitt:1', 'einheit:2']);
  });

  it('bietet „Fachberater: <Tipptext>“ an und übernimmt nur die Wahl', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'THW');
    await userEvent.click(await screen.findByTitle('Fachberater: THW'));
    expect(onChange).toHaveBeenLastCalledWith(['funktion:fachberater:THW']);
  });

  /**
   * Tastaturregel (LLH-1753, wie `components/StammdatenFeld.tsx`): der oberste Stammdatentreffer
   * ist markiert, Enter und Tab nehmen ihn, Freitext nur über den letzten Eintrag. Enter geht über
   * `fireEvent` mit `keyCode` (s. o.); Tab über `userEvent`, das den Fokus wie der Browser bewegt.
   */
  describe('Tastatur (LLH-1753)', () => {
    const enter = (feld: HTMLElement) =>
      fireEvent.keyDown(feld, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    const listenFolge = () =>
      [...liste().querySelectorAll<HTMLElement>('.ant-select-item-option')].map((e) => e.title);

    it('„Logistikt“ + Enter ergibt die Einheit „Logistiktrupp“ und schließt die Liste', async () => {
      const { onChange, feld } = rendern();
      await userEvent.type(feld, 'Logistikt');
      enter(feld);
      expect(onChange).toHaveBeenLastCalledWith(['einheit:3']);
      expect(feld).toHaveAttribute('aria-expanded', 'false');
      expect(feld).toHaveValue('');
    });

    it('Tab nimmt den markierten Treffer und springt ins nächste Feld', async () => {
      const { onChange, feld } = rendern();
      await userEvent.type(feld, 'Logistikt');
      await userEvent.tab();
      expect(onChange).toHaveBeenLastCalledWith(['einheit:3']);
      expect(screen.getByLabelText('Nächstes Feld')).toHaveFocus();
    });

    it('Tab nach einer Wahl springt weiter, ohne einen zweiten Eintrag zu nehmen', async () => {
      const { onChange, feld } = rendern();
      await userEvent.type(feld, 'Logistikt');
      enter(feld);
      await userEvent.tab();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Nächstes Feld')).toHaveFocus();
    });

    it('der Freitext steht als letzter Eintrag und nimmt den Tipptext nur ausdrücklich', async () => {
      const { onChange, feld } = rendern();
      await userEvent.type(feld, 'Logistikt');
      const folge = listenFolge();
      expect(folge[0]).toBe('Logistiktrupp');
      expect(folge[folge.length - 1]).toBe('„Logistikt“ als Freitext übernehmen');
      await userEvent.click(within(liste()).getByTitle('„Logistikt“ als Freitext übernehmen'));
      expect(onChange).toHaveBeenLastCalledWith(['Logistikt']);
      expect(feld).toHaveAttribute('aria-expanded', 'false');
    });

    it('ohne Treffer steht der Freitext vor „Fachberater: …“ und ist markiert', async () => {
      const { feld } = rendern();
      await userEvent.type(feld, 'Lagezentrum');
      expect(listenFolge()[0]).toBe('„Lagezentrum“ als Freitext übernehmen');
    });

    it('ohne Tippen nehmen Enter und Tab nichts', async () => {
      const { onChange, feld } = rendern();
      await userEvent.click(feld);
      await screen.findByTitle('EA Süd');
      enter(feld);
      await userEvent.click(feld);
      await userEvent.tab();
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Nächstes Feld')).toHaveFocus();
    });

    it('Umschalt+Tab nimmt nichts', async () => {
      const { onChange, feld } = rendern();
      await userEvent.type(feld, 'Logistikt');
      await userEvent.tab({ shift: true });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape schließt die offene Liste, ohne etwas zu nehmen', async () => {
      const { onChange, feld } = rendern();
      await userEvent.type(feld, 'Logistikt');
      fireEvent.keyDown(feld, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
      expect(feld).toHaveAttribute('aria-expanded', 'false');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('ein per Enter gewählter Fachberater zeigt seine Beschriftung, nicht den Code', async () => {
      const { onChange, feld } = rendern();
      await userEvent.type(feld, 'THW');
      fireEvent.keyDown(feld, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
      // rc-select meldet die Markierung erst nach einem Mikrotask (`onActive`).
      await waitFor(() =>
        expect(liste().querySelector<HTMLElement>('.ant-select-item-option-active')?.title).toBe(
          'Fachberater: THW',
        ),
      );
      enter(feld);
      expect(onChange).toHaveBeenLastCalledWith(['funktion:fachberater:THW']);
      const auswahl = feld.closest<HTMLElement>('.ant-select')!;
      expect(within(auswahl).getByTitle('Fachberater: THW')).toBeInTheDocument();
    });
  });
});
