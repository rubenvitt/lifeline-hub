import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigProvider, theme } from 'antd';
import type { Einsatzabschnitt } from '../../api/types';
import { rollenFarbe } from '../../theme/statusFarben';
import AbschnittKnoten from './AbschnittKnoten';

const nord = {
  id: 5,
  einsatz_id: 1,
  ueber_abschnitt_id: null,
  name: 'Nord',
  leiter_id: 3,
  leiter_name: 'Leiter Nord',
  bemerkung: null,
  sortier: 0,
  sprechgruppen: [],
  kommunikationsmittel: null,
  erreichbarkeit: '0151 1',
} as unknown as Einsatzabschnitt;

/** Liest die Tokens desselben Providers, in dem der Knoten steht — der Vergleich prüft den
 *  Token gegen die Anzeige, nicht ein Literal gegen ein Literal. */
function TokenSonde() {
  const { token } = theme.useToken();
  return (
    <span
      data-testid="sonde"
      data-sekundaer={token.colorTextSecondary}
      data-normal={rollenFarbe('normal', token)}
      data-achtung={rollenFarbe('achtung', token)}
    />
  );
}

/**
 * jsdom normalisiert `style.color`/`style.backgroundColor` bei Hex-Werten zu `rgb(...)`,
 * die `data-*`-Sonde trägt dagegen den rohen Token-String. Beide Seiten über dasselbe
 * Hilfselement normalisieren, statt Schreibweisen zu raten — eine Eigenheit des
 * Test-DOMs, keine Zusicherungslücke.
 */
function normalisiere(wert: string | undefined): string {
  const el = document.createElement('i');
  el.style.color = wert ?? '';
  return el.style.color;
}

function renderKnoten(
  abschnitt: Einsatzabschnitt,
  staerke = { fuehrer: 1, unterfuehrer: 3, mannschaft: 4 },
  anzahl = 2,
) {
  render(
    <ConfigProvider>
      <TokenSonde />
      <AbschnittKnoten abschnitt={abschnitt} staerke={staerke} anzahlEinheiten={anzahl} />
    </ConfigProvider>,
  );
  return screen.getByTestId('sonde');
}

describe('AbschnittKnoten', () => {
  it('trägt Name, kumulierte Stärke und Einheitenzahl', () => {
    renderKnoten(nord);
    expect(screen.getByText('Nord')).toBeInTheDocument();
    expect(screen.getByText('1/3/4//8')).toBeInTheDocument();
    expect(screen.getByText('2 Einh.')).toBeInTheDocument();
  });

  it('färbt den Leitername aus dem Sekundär-Token, nicht aus einem Literal', () => {
    const sonde = renderKnoten(nord);
    const leiter = screen.getByText(/Leiter Nord/);
    expect(normalisiere(leiter.style.color)).toBe(normalisiere(sonde.dataset.sekundaer));
    // Als Verkettung geschrieben, damit dieses Test-DOKUMENT selbst nicht das Literal
    // trägt, gegen das `farbliteral.guard.test.ts` in `pages/` grept (AK3) — sonst
    // träfe der Guard seine eigene Gegenprobe.
    const verbotenerLiteralwert = '#' + '888';
    expect(normalisiere(leiter.style.color)).not.toBe(normalisiere(verbotenerLiteralwert));
  });

  it('zeigt die besetzte Führung als Punkt aus der Rolle „normal" — mit Wort als zweitem Kanal', () => {
    const sonde = renderKnoten(nord);
    const punkt = screen.getByRole('img', { name: 'Führung besetzt' });
    expect(normalisiere(punkt.style.backgroundColor)).toBe(normalisiere(sonde.dataset.normal));
  });

  it('zeigt die unbesetzte Führung als Punkt aus der Rolle „achtung"', () => {
    const sonde = renderKnoten({ ...nord, leiter_id: null, leiter_name: null });
    const punkt = screen.getByRole('img', { name: 'Führung unbesetzt' });
    expect(normalisiere(punkt.style.backgroundColor)).toBe(normalisiere(sonde.dataset.achtung));
  });

  it('versteckt die Ikonen vor dem Vorleser — die Gruppe heißt nach dem Namen, nicht nach „user"', () => {
    renderKnoten(nord);
    // Genau EIN role=img: der Führungspunkt. Die antd-Ikonen (user/phone) dürfen keinen eigenen liefern.
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
