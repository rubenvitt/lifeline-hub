import { render, screen } from '@testing-library/react';
import { ConfigProvider, theme } from 'antd';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';
import FeldLabel from './FeldLabel';

/** Bespoke Render: `renderMitProviders` verdrahtet einen nackten ConfigProvider ohne
 *  Algorithmus — für die Hell/Dunkel-Gegenprobe braucht es beide Modi. */
function renderMitModus(ui: ReactElement, dunkel: boolean) {
  return render(
    <ConfigProvider theme={{ algorithm: dunkel ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
      {ui}
    </ConfigProvider>,
  );
}

describe('FeldLabel', () => {
  it('beschriftet das Feld über ein echtes <label>; der sichtbare Text ist der Accessible Name', () => {
    render(
      <FeldLabel text="Fachaufgabe" htmlFor="fa">
        <input id="fa" type="text" />
      </FeldLabel>,
    );
    expect(screen.getByText('Fachaufgabe').tagName).toBe('LABEL');
    expect(screen.getByRole('textbox', { name: 'Fachaufgabe' })).toBeInTheDocument();
  });

  it('trägt die Metadaten-Stimme aus E: gesperrte Versalien, kleine Schrift, gedämpfte Farbe', () => {
    render(
      <FeldLabel text="Organisation" htmlFor="org">
        <input id="org" type="text" />
      </FeldLabel>,
    );
    const stil = screen.getByText('Organisation').style;
    expect(stil.textTransform).toBe('uppercase');
    expect(stil.letterSpacing).toBe('2.2px');
    expect(stil.fontSize).toBe('12px'); // token.fontSizeSM
  });

  it('nimmt die Farbe aus dem Theme — hell und dunkel unterscheiden sich (Dunkelmodus-Defekt)', () => {
    // Regressionspin auf Inspector.tsx:109/:120: dort stand `rgba(0,0,0,0.45)` HART,
    // also schwarze Beschriftung auf dunklem Grund. Ein harter Wert liefert in beiden
    // Modi denselben String — genau das schlägt hier fehl.
    const hell = renderMitModus(
      <FeldLabel text="Modus" htmlFor="m">
        <input id="m" type="text" />
      </FeldLabel>,
      false,
    );
    const farbeHell = screen.getByText('Modus').style.color;
    hell.unmount();

    renderMitModus(
      <FeldLabel text="Modus" htmlFor="m">
        <input id="m" type="text" />
      </FeldLabel>,
      true,
    );
    const farbeDunkel = screen.getByText('Modus').style.color;

    expect(farbeHell).not.toBe('');
    expect(farbeDunkel).not.toBe(farbeHell);
  });

  it('liefert auch mit gewähltem Select-Wert den reinen Beschriftungstext als Accessible Name', () => {
    // Gemessen: umschlösse das <label> das Feld, zöge es dessen Teilbaum in den Namen —
    // „Fachaufgabe Rettungswesen/Sanität down" statt „Fachaufgabe". Deshalb steht die
    // Beschriftung über dem Feld und die Assoziation läuft über htmlFor/id.
    render(
      <FeldLabel text="Fachaufgabe" htmlFor="fa">
        <Select
          id="fa"
          value="rettungswesen"
          options={[{ value: 'rettungswesen', label: 'Rettungswesen/Sanität' }]}
        />
      </FeldLabel>,
    );
    expect(screen.getByText('Rettungswesen/Sanität')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Fachaufgabe' })).toBeInTheDocument();
  });
});
