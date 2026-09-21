import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import { dichten } from '../../theme/tokens';
import { KlappPaneel, PANEEL_VORGABE, klappKopfStil, paneeleLesen } from './KlappPaneel';

describe('KlappPaneel', () => {
  it('trägt den Zustand als aria-expanded und rendert den Körper nur offen', () => {
    const onUmschalten = vi.fn();
    const { rerender } = renderMitProviders(
      <KlappPaneel
        titel="Fachebenen"
        kennung="fachebenen"
        offen={false}
        onUmschalten={onUmschalten}
      >
        Inhalt
      </KlappPaneel>,
    );
    const kopf = screen.getByRole('button', { name: 'Fachebenen' });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Inhalt')).not.toBeInTheDocument();
    fireEvent.click(kopf);
    expect(onUmschalten).toHaveBeenCalledTimes(1);
    rerender(
      <KlappPaneel titel="Fachebenen" kennung="fachebenen" offen onUmschalten={onUmschalten}>
        Inhalt
      </KlappPaneel>,
    );
    expect(kopf).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    // Der Knopf zeigt auf den Körper, den er steuert.
    expect(document.getElementById(kopf.getAttribute('aria-controls')!)).toHaveTextContent(
      'Inhalt',
    );
  });

  it('steht als Überschrift im Baum — der Knopf liegt IN ihr', () => {
    renderMitProviders(
      <KlappPaneel titel="Einsatzort" kennung="einsatzort" offen onUmschalten={() => {}}>
        x
      </KlappPaneel>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Einsatzort' })).toBeInTheDocument();
  });
});

describe('klappKopfStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    padding: dichten[stufe].abstand.md,
    paddingXS: dichten[stufe].abstand.xs,
  });

  it('trägt den Boden aus controlHeight über alle drei Stufen', () => {
    expect(klappKopfStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(klappKopfStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(klappKopfStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });
});

describe('paneeleLesen', () => {
  it('fällt ohne oder bei kaputtem Eintrag auf die Vorgabe', () => {
    expect(paneeleLesen(null)).toEqual(PANEEL_VORGABE);
    expect(paneeleLesen('{kaputt')).toEqual(PANEEL_VORGABE);
  });

  it('übernimmt nur gültige Einträge bekannter Paneele', () => {
    const z = paneeleLesen(JSON.stringify({ bilder: true, zeichnen: 'ja', fremd: true }));
    expect(z.bilder).toBe(true);
    expect(z.zeichnen).toBe(PANEEL_VORGABE.zeichnen);
    expect('fremd' in z).toBe(false);
  });
});
