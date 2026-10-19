import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import FeldFehler, { feldFehlerStil } from './FeldFehler';

describe('FeldFehler', () => {
  it('steht als Fehlerzeile mit Marke und Kennung unter der Eingabe', () => {
    renderMitProviders(
      <>
        <input aria-label="Ort" aria-describedby="ort-fehler" aria-invalid="true" />
        <FeldFehler id="ort-fehler">Ort ist Pflicht</FeldFehler>
      </>,
    );
    const zeile = screen.getByText('Ort ist Pflicht');
    expect(zeile).toHaveAttribute('data-fehler');
    expect(zeile).toHaveAttribute('id', 'ort-fehler');
    // Über `aria-describedby` hört der Vorleser den Grund mit dem Feld. Mutationsprobe: ohne `id`
    // an der Zeile bleibt die Beschreibung leer, der Test wird rot.
    expect(screen.getByRole('textbox', { name: 'Ort' })).toHaveAccessibleDescription(
      'Ort ist Pflicht',
    );
  });

  it('liest `alarmText` wie die Formularmeldung, nie antds Füllfarbe', () => {
    renderMitProviders(<FeldFehler>Höchstens 120 Jahre</FeldFehler>);
    // Nacktes `ConfigProvider` (`test/utils.tsx`): heller Grund. Mutationsprobe: `rollen.alarm`
    // statt `alarmText` macht den Test rot.
    expect(screen.getByText('Höchstens 120 Jahre').style.color).toBe(
      hexAlsRgb(farbenHell.alarmText),
    );
  });

  it('rendert ohne Grund nichts, damit kein leerer Abstand unter dem Feld steht', () => {
    const { container } = renderMitProviders(
      <>
        <FeldFehler id="leer" />
        <FeldFehler id="falsch">{false}</FeldFehler>
        <FeldFehler id="nichts">{''}</FeldFehler>
      </>,
    );
    expect(container.querySelector('[data-fehler]')).toBeNull();
  });

  it('nimmt Schrift und Zeilenhöhe der antd-Formularmeldung (eine Optik)', () => {
    const stil = feldFehlerStil(farbenHell, { fontSize: 13, lineHeight: 1.5 });
    expect(stil).toMatchObject({
      color: farbenHell.alarmText,
      fontSize: 13,
      lineHeight: 1.5,
    });
  });
});

/** `#rrggbb` → `rgb(r, g, b)`, wie jsdom eine Inline-Farbe zurückgibt. */
function hexAlsRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
