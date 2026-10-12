import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { TEST_VORSCHLAEGE } from '../test/fuehrungsfunktionen';
import { EmpfaengerWahl } from './EmpfaengerWahl';

/** Hält den Wert wie ein `Form.Item` und meldet jede Änderung an `onChange`. */
function Huelle({
  onChange,
  commitSearchOnBlur,
}: {
  onChange: (werte: string[]) => void;
  commitSearchOnBlur?: boolean;
}) {
  const [werte, setWerte] = useState<string[]>([]);
  return (
    <>
      <EmpfaengerWahl
        aria-label="Verteiler"
        abschnitte={[{ id: 1, name: 'EA Süd' }]}
        einheiten={[{ id: 2, name: '1. Zug' }]}
        vorschlaege={TEST_VORSCHLAEGE}
        value={werte}
        onChange={(w) => {
          setWerte(w);
          onChange(w);
        }}
        commitSearchOnBlur={commitSearchOnBlur}
      />
      <input aria-label="Nächstes Feld" />
    </>
  );
}

function rendern(over: { commitSearchOnBlur?: boolean } = {}) {
  const onChange = vi.fn<(werte: string[]) => void>();
  renderMitProviders(<Huelle onChange={onChange} {...over} />);
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
  it('Enter übernimmt den getippten Text als Freitext-Tag', async () => {
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

  it('mit commitSearchOnBlur übernimmt das Verlassen den Text wie im Auftrag', async () => {
    const { onChange, feld } = rendern({ commitSearchOnBlur: true });
    await userEvent.type(feld, 'Lagezentrum');
    await userEvent.click(screen.getByLabelText('Nächstes Feld'));
    expect(onChange).toHaveBeenLastCalledWith(['Lagezentrum']);
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
    await userEvent.click(offen.getByTitle('1. Zug'));
    expect(onChange).toHaveBeenLastCalledWith(['abschnitt:1', 'einheit:2']);
  });

  it('bietet „Fachberater: <Tipptext>“ an und übernimmt nur die Wahl', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'THW');
    await userEvent.click(await screen.findByTitle('Fachberater: THW'));
    expect(onChange).toHaveBeenLastCalledWith(['funktion:fachberater:THW']);
  });
});
