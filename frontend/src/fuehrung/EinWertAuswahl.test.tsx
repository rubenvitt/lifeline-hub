import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { TEST_VORSCHLAEGE } from '../test/fuehrungsfunktionen';
import { EinWertAuswahl, letzterWert } from './EinWertAuswahl';

/** Hält den Wert wie ein `Form.Item` mit `getValueFromEvent={letzterWert}`. */
function Huelle({ onChange }: { onChange: (werte: string[]) => void }) {
  const [werte, setWerte] = useState<string[]>([]);
  return (
    <>
      <EinWertAuswahl
        aria-label="Führungsstelle"
        vorschlaege={TEST_VORSCHLAEGE}
        value={werte}
        onChange={(w) => {
          const einer = letzterWert(w);
          setWerte(einer);
          onChange(einer);
        }}
      />
      <input aria-label="Nächstes Feld" />
    </>
  );
}

function rendern() {
  const onChange = vi.fn<(werte: string[]) => void>();
  renderMitProviders(<Huelle onChange={onChange} />);
  return { onChange, feld: screen.getByLabelText('Führungsstelle') };
}

const enter = (feld: HTMLElement) =>
  fireEvent.keyDown(feld, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });

/** Tastaturregel der Vorschlagsfelder (LLH-1753, `VorschlagsSelect`). */
describe('EinWertAuswahl', () => {
  it('Enter nimmt den markierten Katalogtreffer, nicht den Tipptext', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Lage');
    enter(feld);
    expect(onChange).toHaveBeenLastCalledWith(['funktion:s2']);
    expect(feld).toHaveAttribute('aria-expanded', 'false');
  });

  it('Tab nimmt den Treffer und springt ins nächste Feld', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'S3');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(['funktion:s3']);
    expect(screen.getByLabelText('Nächstes Feld')).toHaveFocus();
  });

  it('ohne Treffer nimmt Enter den Tipptext als Freitext', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Lagezentrum');
    enter(feld);
    expect(onChange).toHaveBeenLastCalledWith(['Lagezentrum']);
  });

  it('eine neue Wahl ersetzt die alte', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Lage');
    enter(feld);
    await userEvent.type(feld, 'S3');
    enter(feld);
    expect(onChange).toHaveBeenLastCalledWith(['funktion:s3']);
  });

  it('Verlassen ohne Treffer nimmt den Tipptext als Freitext (Entscheidung 20.11.2026)', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Florian Leitung');
    await userEvent.click(screen.getByLabelText('Nächstes Feld'));
    expect(onChange).toHaveBeenLastCalledWith(['Florian Leitung']);
  });

  it('Verlassen mit Treffer nimmt nichts, weder Fragment noch Treffer', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Lage');
    await userEvent.click(screen.getByLabelText('Nächstes Feld'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Tab nach Freitext ohne Treffer nimmt ihn genau einmal', async () => {
    const { onChange, feld } = rendern();
    await userEvent.type(feld, 'Florian Leitung');
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(['Florian Leitung']);
  });
});
