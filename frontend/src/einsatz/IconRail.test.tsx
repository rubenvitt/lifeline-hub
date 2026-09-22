import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { theme } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten, farbenDunkel, rahmenFarben } from '../theme/tokens';
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

  // Neuentwurf „Instrumententafel" (21.09.2026), Entscheidung 2 des Auftraggebers: die aktive
  // Kategorie trägt eine 2-px-Marke in `marke` (Rot = Marke) auf NEUTRALER Fläche. Das dreht
  // die A2-Aussage „aktiv = blaue Bedienfläche" bewusst um — aber nicht „Rot bedient nichts":
  // die Fläche bleibt neutral, rot ist allein die schmale Ortsmarke. Beides wird hier gepinnt,
  // weil der Gate-5-Hexscan nur sieht, DASS kein Literal dasteht, nicht welche Rolle gewählt wurde.
  it('markiert die aktive Kategorie mit der roten Marke auf neutraler Fläche (Neuentwurf)', () => {
    renderMitProviders(
      <>
        <TokenSonde />
        <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />
      </>,
    );
    const alarm = screen.getByTestId('token').getAttribute('data-alarm')!;
    const aktiv = screen.getByRole('button', { name: 'Lage' });
    // Die Marke ist die Markenrolle, nicht die Alarmrolle — und nicht die Bedienfarbe.
    expect(aktiv.style.boxShadow).toContain('2px 0 0');
    expect(rahmenFarben.marke).toBe(farbenDunkel.marke);
    expect(rahmenFarben.marke).not.toBe(alarm);
    // Die FLÄCHE ist neutral (`flaeche3`), keine rote und keine blaue Vollfläche mehr.
    expect(aktiv).toHaveStyle({ backgroundColor: rahmenFarben.aktiv });
    expect(aktiv).not.toHaveStyle({ backgroundColor: farbenDunkel.bedien });
    expect(aktiv).not.toHaveStyle({ backgroundColor: farbenDunkel.marke });

    // Gegenprobe: die inaktive Kategorie trägt weder Marke noch Fläche — sonst wäre die
    // Aussage oben trivial.
    const inaktiv = screen.getByRole('button', { name: 'Führung' });
    expect(inaktiv.style.boxShadow).toBe('none');
    expect(inaktiv).not.toHaveStyle({ backgroundColor: rahmenFarben.aktiv });
  });

  it('setzt „Einstellungen" abgesetzt an den Fuß — sechs Ziele bleiben in EINER Landmarke', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Kategorien' });
    expect(nav.querySelectorAll('button')).toHaveLength(6);
    const fuss = nav.querySelector('[data-lfh="rail-fuss"]')!;
    expect(fuss).not.toBeNull();
    expect(fuss.querySelectorAll('button')).toHaveLength(1);
    expect(fuss.querySelector('button')).toHaveAttribute('aria-label', 'Einstellungen');
  });

  it('meldet Klick mit dem Kategorie-Key', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={onKlick} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));
    expect(onKlick).toHaveBeenCalledWith('erfassung');
  });

  it('zeigt jedes Kurzetikett als sichtbaren Text — ohne Hover', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    // `getByText`, NICHT `getByRole(name:)`: der Name kam schon vorher aus `aria-label`
    // und wäre auch bei rein bebilderten Knöpfen grün. Die Aussage von Befund H8 ist,
    // dass ein Text SICHTBAR im Baum steht — auf dem Führungs-Tablet gibt es kein Hover.
    // Seit dem Neuentwurf ist es das Kurzetikett (9 px Versalien in 60 px Rail); der volle
    // Name bleibt `aria-label` und `title`.
    for (const k of kategorien) {
      expect(screen.getByText(k.kurz)).toBeVisible();
      if (k.kurz !== k.label) {
        expect(screen.getByRole('button', { name: k.label })).toHaveAttribute('title', k.label);
      }
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
    paddingXS: dichten[s].abstand.xs,
  });
  const hoehe = (s: keyof typeof dichten) => railZielStil(tokenFuer(s), { aktiv: false }).minHeight;

  it('hält die Entwurfshöhe 62 als Boden — über dem A1-Boden von 48 px', () => {
    // `Math.max`, nicht `??`: mit `??` stände in der kompakten Stufe 30 — unter dem
    // A1-Boden, den die Rail seit LFH-329 trägt.
    expect(hoehe('kompakt')).toBe(62);
    expect(hoehe('komfortabel')).toBe(62);
    expect(hoehe('handschuh')).toBe(72);
  });

  it('wächst mit der Staffel, statt auf dem Boden zu kleben', () => {
    expect(hoehe('kompakt')).toBeLessThan(hoehe('handschuh') as number);
  });

  it('trägt ZWEI Angaben, nicht eine (LFH-365)', () => {
    // Konkreter Wert als LITERAL: `paddingXS` der Stufe (7) senkrecht, waagerecht 2 px —
    // die 60-px-Rail hat für eine mitwachsende Seitenpolsterung keinen Platz.
    const stil = railZielStil(tokenFuer('handschuh'), { aktiv: false });
    expect(stil.minHeight).toBe(72);
    expect(stil.padding).toBe('7px 2px');
  });
});
