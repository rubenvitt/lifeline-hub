import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import { dichten } from '../../theme/tokens';
import { KlappPaneel, klappKopfStil } from './KlappPaneel';

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

  it('Untergruppe: Überschrift der dritten Ebene, Zusatz als eigenes Ziel neben dem Kopf', () => {
    renderMitProviders(
      <KlappPaneel
        titel="Wasser"
        kennung="wasser"
        ebene={3}
        einzug
        offen={false}
        onUmschalten={() => {}}
        zusatz={<button type="button">Zusatz</button>}
      >
        x
      </KlappPaneel>,
    );
    const ueberschrift = screen.getByRole('heading', { level: 3, name: 'Wasser' });
    const zusatz = screen.getByRole('button', { name: 'Zusatz' });
    // Nicht im Klappknopf und nicht in der Überschrift: ein Ziel im Ziel wäre keins.
    expect(ueberschrift).not.toContainElement(zusatz);
    expect(screen.getByRole('button', { name: 'Wasser' })).not.toContainElement(zusatz);
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
