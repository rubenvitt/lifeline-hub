import { describe, expect, it } from 'vitest';
import { kraftZeileStil } from './KraefteOhneBrSidebar';
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
