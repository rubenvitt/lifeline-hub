import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import WarnstufenHinweis from './WarnstufenHinweis';
import Sammelbanner from './Sammelbanner';
import Filterhinweis from './Filterhinweis';
import GefahrenStufe from '../../pages/gefahren/GefahrenStufe';
import WetterKopfMarke from '../../wetter/WetterKopfMarke';
import Eingangsband from '../../alarm/Eingangsband';

/**
 * Warnhinweise in mindestens 14 px mit Gewicht 600 (Spec `schriftskala`, „Warnhinweise in
 * mindestens 14 px“; LLH-1773). Jeder Baustein, der das Wort eines Warnhinweises setzt, trägt die
 * Rolle `warnung`: Stufe `text` (14 px in `kompakt`, wächst mit der Dichte), Gewicht 600.
 * Mutationsprobe: `...schriftStil('warnung')` in einem der Bausteine entfernt → sein Fall rot.
 */
function istWarnung(el: HTMLElement) {
  expect(el.style.fontSize).toBe('var(--lfh-groesse-text)');
  expect(el.style.fontWeight).toBe('600');
}

describe('Warnhinweise tragen die Rolle warnung', () => {
  it('WarnstufenHinweis', () => {
    const { container } = renderMitProviders(
      <WarnstufenHinweis ton="alarm">Warnstufe akut</WarnstufenHinweis>,
    );
    istWarnung(container.querySelector<HTMLElement>('[data-lfh="warnstufe-hinweis"]')!);
  });

  it('GefahrenStufe: das Wort der Stufe', () => {
    renderMitProviders(<GefahrenStufe stufe="hoch" />);
    istWarnung(screen.getByText('hoch'));
  });

  it('Sammelbanner: die Mitteilung', () => {
    renderMitProviders(<Sammelbanner>14 neue Einträge</Sammelbanner>);
    istWarnung(screen.getByText('14 neue Einträge'));
  });

  it('Filterhinweis: das Wort „Gefiltert“', () => {
    renderMitProviders(
      <Filterhinweis treffer={7} merkmale={['Meldung']} onZuruecksetzen={vi.fn()} />,
    );
    istWarnung(screen.getByText('Gefiltert'));
  });

  it('WetterKopfMarke: das Stufenwort', () => {
    renderMitProviders(
      <WetterKopfMarke
        warnung={{ stufe: 'schwer', stufenwort: 'Unwetterwarnung', text: 'Sturm', weitere: 0 }}
        ziel="/wetter"
      />,
    );
    istWarnung(screen.getByText('Unwetterwarnung'));
  });

  it('Eingangsband: der Titel ist der Alarmhinweis', () => {
    render(
      <Eingangsband
        titel="Neue Meldung"
        aktion={{ text: 'Öffnen', beiKlick: () => {} }}
        beiSchliessen={() => {}}
      >
        Inhalt
      </Eingangsband>,
    );
    istWarnung(screen.getByRole('status'));
  });
});
