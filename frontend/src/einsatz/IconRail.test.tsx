import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { theme } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten, farbenDunkel } from '../theme/tokens';
import IconRail, { railZielStil } from './IconRail';
import { kategorien } from './modulRegistry';

/** Legt die Token-Werte des UMGEBENDEN Providers als data-Attribute ab. Bewusst so und
 *  nicht über `theme.getDesignToken()`: nur damit ist garantiert derselbe Token im Spiel,
 *  den die Komponente im selben Render-Pfad sieht. */
function TokenSonde() {
  const { token } = theme.useToken();
  return <div data-testid="token" data-bedien={token.colorPrimary} data-alarm={token.colorError} />;
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
    // Geprüft wird die ROLLE, nicht der Modus-Wert: die Rail ist in beiden Modi eine
    // dunkle Fläche und trägt deshalb `farbenDunkel.bedien` (8,67:1) statt des hellen
    // Bedien-Tokens, das auf dunklem Grund nur 2,93:1 erreicht und WCAG 1.4.11 (3:1 für
    // Zustandsanzeige) verfehlt. Entscheidend bleibt: Bedienfarbe, nicht Alarmfarbe.
    expect(aktiv).toHaveStyle({ backgroundColor: farbenDunkel.bedien });
    expect(aktiv).not.toHaveStyle({ backgroundColor: alarm });
    expect(farbenDunkel.bedien).not.toBe(alarm);

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

  it('zeigt jede Kategoriebezeichnung als sichtbaren Text — ohne Hover', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    // `getByText`, NICHT `getByRole(name:)`: der Name kam schon vorher aus `aria-label`
    // und wäre auch bei rein bebilderten Knöpfen grün. Die Aussage von Befund H8 ist,
    // dass der Text SICHTBAR im Baum steht — auf dem Führungs-Tablet gibt es kein Hover.
    //
    // Dieser Test trägt die GANZE Aussage „nicht mehr nur im Tooltip" allein, ohne
    // Interaktion: kein `userEvent.hover`, kein Fokus. Ein früherer Gegentest wollte
    // zusätzlich `.ant-tooltip` im Baum verneinen — das ist eine Attrappe, keine
    // zweite Zusicherung: antd mountet Tooltip-Inhalt erst bei `open` (ohne Hover nie
    // im Baum, mit oder ohne diese Änderung) und rendert ihn bei offenem Zustand
    // ohnehin per Portal an `document.body`, außerhalb des RTL-`container`. Ein
    // `querySelector('.ant-tooltip')` wäre vor UND nach dem Umbau `null` gewesen. Wer
    // die Tooltip-Abwesenheit zusätzlich belegen will, braucht einen Timeout-Test auf
    // ein Portal, das nie kommt — das ist kein Beweis. Diese `getByText`-Schleife
    // dagegen wäre rot, fände sie den Text nur im (ungeöffneten) Tooltip.
    for (const k of kategorien) {
      expect(screen.getByText(k.label)).toBeVisible();
    }
  });
});

/**
 * Die Zielhöhe OHNE zu rendern — `test/utils.tsx:31` montiert ein nacktes `ConfigProvider`
 * ohne unser Theme, `useToken()` liefert dort den antd-Seed (`controlHeight: 32`), also
 * keine der Stufen 30/48/72. Bauform 1:1 nach `ModulPanel.test.tsx:216-247`.
 *
 * Die Böden stehen als LITERALE da und werden NICHT aus `dichten` zurückgelesen — sonst
 * prüfte der Test den Token gegen sich selbst.
 */
describe('IconRail · Dichte', () => {
  const tokenFuer = (s: keyof typeof dichten) => ({
    controlHeight: dichten[s].zeilenhoehe,
    padding: dichten[s].abstand.md,
    paddingSM: dichten[s].abstand.sm,
    fontSizeSM: 12,
  });
  const hoehe = (s: keyof typeof dichten) => railZielStil(tokenFuer(s), { aktiv: false }).minHeight;

  it('hält den A1-Boden von 48 px in JEDER Stufe', () => {
    // Der Kern des Pakets: `Math.max`, nicht `??`. Mit `??` stände in der kompakten
    // Stufe 30 — unter dem A1-Boden, den die Rail seit LFH-329 trägt.
    expect(hoehe('kompakt')).toBe(48);
    expect(hoehe('komfortabel')).toBe(48);
    expect(hoehe('handschuh')).toBe(72);
  });

  it('wächst mit der Staffel, statt auf dem Boden zu kleben', () => {
    expect(hoehe('kompakt')).toBeLessThan(hoehe('handschuh') as number);
  });

  it('trägt ZWEI Angaben, nicht eine (LFH-365)', () => {
    // Die Polsterung allein trägt den Boden nicht, `minHeight` allein klebt den Text
    // im Handschuh-Betrieb an die Kante. `toBeTruthy()` allein würde nur Anwesenheit
    // belegen, nicht Korrektheit — deshalb der konkrete Wert als LITERAL: `paddingSM`
    // der Stufe (16) senkrecht, `padding` der Stufe (26) waagerecht auf 8 gedeckelt
    // (`Math.min(token.padding, 8)` in `railZielStil`).
    const stil = railZielStil(tokenFuer('handschuh'), { aktiv: false });
    expect(stil.minHeight).toBe(72);
    expect(stil.padding).toBe('16px 8px');
  });
});
