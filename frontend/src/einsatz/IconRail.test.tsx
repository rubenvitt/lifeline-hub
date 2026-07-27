import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { theme } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import IconRail from './IconRail';
import { kategorien } from './modulRegistry';

/** Legt die Token-Werte des UMGEBENDEN Providers als data-Attribute ab. Bewusst so und
 *  nicht über `theme.getDesignToken()`: nur damit ist garantiert derselbe Token im Spiel,
 *  den die Komponente im selben Render-Pfad sieht. */
function TokenSonde() {
  const { token } = theme.useToken();
  return (
    <div data-testid="token" data-bedien={token.colorPrimary} data-alarm={token.colorError} />
  );
}

describe('IconRail', () => {
  it('rendert je Kategorie einen Button mit Label als aria-label', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    for (const k of kategorien) {
      expect(screen.getByRole('button', { name: k.label })).toBeInTheDocument();
    }
  });

  it('markiert die aktive Kategorie via aria-current', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Lage' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Führung' })).not.toHaveAttribute('aria-current');
  });

  // Der Kern von LFH-328/A2: die aktive Fläche trug das Marken-Rot als Hex-Kopie. „Rot bedient
  // nichts" (LFH-315/A0) — sie gehört auf die Bedienfarbe. Der Gate-5-Hexscan kann das NICHT
  // prüfen: er sieht nur, dass kein Literal mehr dasteht, nicht welche Rolle gewählt wurde.
  it('färbt den aktiven Zustand mit der Bedienfarbe — nicht mit der Alarmfarbe', () => {
    renderMitProviders(
      <>
        <TokenSonde />
        <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />
      </>,
    );
    const sonde = screen.getByTestId('token');
    const bedien = sonde.getAttribute('data-bedien')!;
    const alarm = sonde.getAttribute('data-alarm')!;
    expect(bedien).not.toBe(alarm);

    const aktiv = screen.getByRole('button', { name: 'Lage' });
    expect(aktiv).toHaveStyle({ backgroundColor: bedien });
    expect(aktiv).not.toHaveStyle({ backgroundColor: alarm });

    // Die inaktive Fläche trägt die Bedienfarbe NICHT — sonst wäre der Vergleich oben trivial.
    // (`transparent` ist als Erwartung untauglich: jsdom rechnet es auf `rgba(0, 0, 0, 0)` um.)
    expect(screen.getByRole('button', { name: 'Führung' })).not.toHaveStyle({
      backgroundColor: bedien,
    });
  });

  it('meldet Klick mit dem Kategorie-Key', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={onKlick} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));
    expect(onKlick).toHaveBeenCalledWith('erfassung');
  });
});
