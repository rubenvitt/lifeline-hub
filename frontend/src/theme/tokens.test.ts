/**
 * Die Dichte-Staffel als Träger (LFH-328 · A2, aus A1 Festlegung 4).
 *
 * A2 baut den TRÄGER, nicht die Umschaltung: `antdToken()` nimmt die Stufe als
 * Parameter entgegen, die aktive Stufe bleibt fest `kompakt`. Die Kontext- oder
 * Benutzerwahl ist B5. Was dieser Test beweisen muss, sagt die Spec §2.1
 * wörtlich: „dass die drei Stufen unterschiedliche Tokens erzeugen".
 *
 * Deshalb prüft er nicht nur `controlHeight`/`fontSize`, sondern auch die
 * Abstände: ein `antdToken`, das die Stufe entgegennimmt, `padding*` aber
 * weiterhin aus der Modulkonstante liest, wäre bei allen anderen Erwartungen
 * grün und trotzdem halb verdrahtet.
 */
import { describe, expect, it } from 'vitest';
import { abstand, antdToken, dichten, farbenHell, flaeche, type Dichte } from './tokens';
// Eigene Importzeile, damit der geschlossene §2.2-Pin unten in einem reinen
// Additions-Diff stehen bleibt (eine erweiterte Importzeile wäre eine Änderung).
import { seitenrinne } from './tokens';

/** `ThemeConfig['token']` ist optional getypt — hier nicht wegcasten, sondern
 *  laut scheitern, wenn `antdToken` nichts liefert. */
function tokenFuer(dichte: Dichte) {
  const t = antdToken(farbenHell, dichte);
  if (!t) throw new Error(`antdToken lieferte keine Tokens für ${dichte}`);
  return t;
}

describe('Dichte-Staffel (A1 Festlegung 4)', () => {
  it('trägt die drei in A1 festgelegten Steuerhöhen', () => {
    expect(dichten.kompakt.zeilenhoehe).toBe(30);
    expect(dichten.komfortabel.zeilenhoehe).toBe(48);
    expect(dichten.handschuh.zeilenhoehe).toBe(72);
  });

  it('lässt die Grundschrift nur einmal steigen — Handschuh ändert die Hand, nicht das Auge', () => {
    expect(dichten.kompakt.schriftgroesse).toBe(13.5);
    expect(dichten.komfortabel.schriftgroesse).toBe(15);
    expect(dichten.handschuh.schriftgroesse).toBe(15);
  });

  it('staffelt das Abstandsraster mit (die xs/sm-Werte sind abgeleitet)', () => {
    expect(dichten.kompakt.abstand).toEqual({ xs: 3, sm: 7, md: 11, lg: 18 });
    expect(dichten.komfortabel.abstand).toEqual({ xs: 5, sm: 11, md: 18, lg: 28 });
    expect(dichten.handschuh.abstand).toEqual({ xs: 7, sm: 16, md: 26, lg: 44 });
  });

  it('hält `abstand` als A0-Export am Leben — er IST die kompakte Stufe', () => {
    expect(abstand).toBe(dichten.kompakt.abstand);
  });

  it('setzt controlHeight und fontSize aus der gewählten Stufe', () => {
    expect(tokenFuer('handschuh').controlHeight).toBe(72);
    expect(tokenFuer('komfortabel').fontSize).toBe(15);
  });

  it('führt die Stufe bis in die Abstände durch, nicht nur bis zur Steuerhöhe', () => {
    const t = tokenFuer('handschuh');
    expect(t.padding).toBe(dichten.handschuh.abstand.md);
    expect(t.paddingSM).toBe(dichten.handschuh.abstand.sm);
    expect(t.paddingXS).toBe(dichten.handschuh.abstand.xs);
    expect(t.paddingLG).toBe(dichten.handschuh.abstand.lg);
    expect(t.margin).toBe(dichten.handschuh.abstand.md);
    expect(t.marginSM).toBe(dichten.handschuh.abstand.sm);
    expect(t.marginXS).toBe(dichten.handschuh.abstand.xs);
    expect(t.marginLG).toBe(dichten.handschuh.abstand.lg);
  });

  it('erzeugt für jede Stufe einen anderen Token-Satz (Spec §2.1)', () => {
    const saetze = (['kompakt', 'komfortabel', 'handschuh'] as const).map((d) =>
      JSON.stringify(antdToken(farbenHell, d)),
    );
    expect(new Set(saetze).size).toBe(3);
  });

  it('bleibt ohne Dichte-Argument auf der kompakten Stufe (A0-Verhalten unverändert)', () => {
    expect(antdToken(farbenHell)).toEqual(antdToken(farbenHell, 'kompakt'));
  });
});

describe('Flächenmaße als Token', () => {
  it('exportiert Flächenmaße als Token statt als verstreute Pixel', () => {
    expect(flaeche.seiteSchmal).toBeGreaterThan(0);
    expect(flaeche.zustandOben).toBeGreaterThan(0);
  });

  it('trägt die fünf gemessenen Baselines aus der Spec §2.2', () => {
    expect(flaeche).toEqual({
      seiteSchmal: 900,
      seiteBreit: 960,
      zustandOben: 80,
      kachelMin: 260,
      kachelMinKlein: 220,
    });
  });
});

/**
 * Die Seitenrinne ist die VIEWPORT-Achse, nicht die Dichte-Achse und keine
 * §2.2-Baseline — deshalb ein eigener Export statt zweier Schlüssel in
 * `flaeche` (dessen `toEqual`-Pin oben ist erschöpfend und trüge sonst einen
 * Namen, der nicht mehr stimmt). Träger im Browser ist die Custom-Property in
 * `rollen.css`; dass beide Seiten dieselben Stufen tragen, bewacht
 * `rollen.guard.test.ts`.
 */
describe('Seitenrinne (LFH-329 · B1)', () => {
  it('exportiert die Seitenrinne als Viewport-Paar (LFH-329 · B1)', () => {
    expect(seitenrinne).toEqual({ breit: 24, schmal: 12 });
    // Benannte Diagnose gegen ein vertauschtes Paar: ein `toEqual` allein
    // meldet nur einen Objektdiff, nicht die verdrehte Richtung.
    expect(seitenrinne.schmal).toBeLessThan(seitenrinne.breit);
  });
});
