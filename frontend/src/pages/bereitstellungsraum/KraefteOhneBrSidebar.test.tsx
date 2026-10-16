import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Einheit } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import KraefteOhneBrSidebar, { kraftZeileStil } from './KraefteOhneBrSidebar';
import { dichten, type Dichte } from '../../theme/tokens';

/**
 * Zeilen der Seitenleiste „Kräfte ohne BR“ (LFH-968): Zwischen zwei „zuweisen“-Knöpfen standen
 * fest 6 px, auch im Handschuh. Der Abstand kommt jetzt aus der Dichte-Staffel. Die Sollwerte
 * stehen als Literale (Bedien-Leitlinie, Kriterium 2: komfortabel ≥ 8, handschuh ≥ 16), sonst
 * prüfte der Test den Token gegen sich selbst. Den gemessenen Abstand trägt
 * `e2e/gate3-trefflaeche.spec.ts`.
 */
const tokenFuer = (stufe: Dichte) => ({
  marginXS: dichten[stufe].abstand.xs,
  marginSM: dichten[stufe].abstand.sm,
});

describe('kraftZeileStil (LFH-968)', () => {
  it('rückt zwei Zeilen um den Zielabstand der Stufe auseinander', () => {
    expect(kraftZeileStil(tokenFuer('komfortabel')).marginBottom).toBeGreaterThanOrEqual(8);
    expect(kraftZeileStil(tokenFuer('handschuh')).marginBottom).toBeGreaterThanOrEqual(16);
  });

  it('folgt der Stufe: kompakt bleibt enger als handschuh', () => {
    expect(kraftZeileStil(tokenFuer('kompakt')).marginBottom).toBeLessThan(
      kraftZeileStil(tokenFuer('handschuh')).marginBottom,
    );
  });

  it('der Abstand zwischen Name und Knopf kommt aus dem Token, kein Literal', () => {
    expect(kraftZeileStil({ marginXS: 101, marginSM: 202 })).toMatchObject({
      gap: 101,
      marginBottom: 202,
    });
  });
});

describe('KraefteOhneBrSidebar: „Im Einsatz“ eingeklappt (LLH-1075, design.md D14)', () => {
  const eh = (id: number, name: string, mehr: Partial<Einheit> = {}) =>
    ({
      id,
      name,
      typ_label: null,
      abschnitt_id: null,
      abschnitt_name: null,
      ueber_einheit_id: null,
      aktueller_br_id: null,
      ...mehr,
    }) as unknown as Einheit;

  function zeige(onZuweisenEinheit = vi.fn()) {
    renderMitProviders(
      <KraefteOhneBrSidebar
        alleEinheiten={[
          eh(1, 'Zug Nord', { abschnitt_id: 3, abschnitt_name: 'Nord' }),
          eh(2, 'Zug Süd', { abschnitt_id: 3, abschnitt_name: 'Nord' }),
          eh(3, 'GW-L'),
        ]}
        alleFahrzeuge={[]}
        brEinheiten={[]}
        brFahrzeuge={[]}
        schreibgeschuetzt={false}
        onZuweisenEinheit={onZuweisenEinheit}
        onZuweisenFahrzeug={vi.fn()}
      />,
    );
    return onZuweisenEinheit;
  }

  it('„Erwartet“ steht offen, „Im Einsatz“ eingeklappt mit Anzahl', () => {
    zeige();
    expect(screen.getByRole('button', { name: 'GW-L zuweisen' })).toBeInTheDocument();
    const kopf = screen.getByRole('button', { name: /Im Einsatz/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(kopf).toHaveTextContent('2');
    expect(screen.queryByRole('button', { name: 'Zug Nord zuweisen' })).toBeNull();
  });

  it('aufgeklappt weist „zuweisen“ unverändert zu', async () => {
    const onZuweisen = zeige();
    await userEvent.click(screen.getByRole('button', { name: /Im Einsatz/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Zug Nord zuweisen' }));
    expect(onZuweisen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
