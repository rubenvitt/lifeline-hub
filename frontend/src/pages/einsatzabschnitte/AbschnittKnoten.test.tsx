import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigProvider, theme } from 'antd';
import type { Einsatzabschnitt } from '../../api/types';
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
  return <span data-testid="sonde" data-sekundaer={token.colorTextSecondary} />;
}

/**
 * jsdom normalisiert Hex-Farben in `style` zu `rgb(...)`, die `data-*`-Sonde trägt den rohen
 * Token-String — beide Seiten über dasselbe Hilfselement normalisieren.
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
    // Als Verkettung geschrieben, damit `farbliteral.guard.test.ts` diese Gegenprobe nicht selbst
    // trifft.
    const verbotenerLiteralwert = '#' + '888';
    expect(normalisiere(leiter.style.color)).not.toBe(normalisiere(verbotenerLiteralwert));
  });

  it('zeigt bei besetzter Führung den Leiternamen und kein Führungssignal', () => {
    renderKnoten(nord);
    expect(screen.getByText(/Leiter Nord/)).toBeInTheDocument();
    expect(screen.queryByText('ohne Leiter')).not.toBeInTheDocument();
    expect(document.querySelector('[data-lfh="status-chip"]')).toBeNull();
  });

  it('zeigt die unbesetzte Führung als sichtbares Wort „ohne Leiter", nicht als reinen Farbpunkt (LFH-962)', () => {
    renderKnoten({ ...nord, leiter_id: null, leiter_name: null });
    const chip = screen.getByText('ohne Leiter').closest('[data-lfh="status-chip"]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('data-ton', 'achtung');
    // Kein Punkt mehr, der die Bedeutung nur über Farbe trägt.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('zeigt den Lagezustand mit demselben Wort wie der Überblick', () => {
    renderKnoten({ ...nord, lagezustand: 'angespannt' } as Einsatzabschnitt);
    expect(screen.getByText('angespannt')).toBeInTheDocument();
    // Dieselbe Form wie im Überblick: Rollenrand am `StatusTag`, nicht Fläche oder Chip.
    const tag = screen.getByText('angespannt').closest('[data-rolle]');
    expect(tag).toHaveAttribute('data-rolle', 'achtung');
    expect(tag).toHaveAttribute('data-darstellung', 'rand');
  });

  it('lässt einen nicht beurteilten Lagezustand leer', () => {
    renderKnoten({ ...nord, lagezustand: null } as Einsatzabschnitt);
    for (const wort of ['planmäßig', 'angespannt', 'kritisch']) {
      expect(screen.queryByText(wort)).not.toBeInTheDocument();
    }
  });

  it('versteckt die Icons vor dem Vorleser — die Gruppe heißt nach dem Namen, nicht nach „user"', () => {
    renderKnoten(nord);
    // Kein role=img: die antd-Icons (user/phone) dürfen keinen eigenen liefern.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
