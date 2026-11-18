import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import { FORM_ZEICHEN, Status, StatusZelle } from './Status';

describe('StatusZelle', () => {
  it('zeigt die Zahl auf getönter Fläche und trägt das Wort für Vorleser mit', () => {
    renderMitProviders(<StatusZelle ton="normal" wert={2} wort="bereit" />);
    const zelle = document.querySelector<HTMLElement>('[data-lfh="status-zelle"]')!;
    expect(zelle).toHaveTextContent('2 bereit');
    expect(zelle).toHaveAttribute('title', 'bereit');
    expect(zelle).toHaveStyle({
      background: farbenHell.normalFlaeche,
      color: farbenHell.normalText,
    });
  });

  it('das Wort ist nur visuell verborgen, nicht aus dem Baum genommen', () => {
    renderMitProviders(<StatusZelle ton="alarm" wert={3} wort="Ausfall" />);
    const wort = screen.getByText('Ausfall', { exact: false });
    expect(wort).not.toHaveAttribute('aria-hidden');
    expect(wort).toHaveStyle({ position: 'absolute', width: '1px' });
  });
});

describe('Status', () => {
  it('randlos, getönt, Größe normal 24 px mit 12-px-Schrift', () => {
    renderMitProviders(<Status ton="normal" wort="verfügbar" />);
    const s = document.querySelector<HTMLElement>('[data-lfh="status"]')!;
    expect(s).toHaveStyle({
      height: '24px',
      fontSize: '12px',
      background: farbenHell.normalFlaeche,
      color: farbenHell.normalText,
    });
    expect(s.style.border).toBe('');
    expect(s.style.borderColor).toBe('');
    expect(s.dataset.ton).toBe('normal');
  });

  it('Größe klein: 20 px mit 11-px-Schrift', () => {
    renderMitProviders(<Status ton="alarm" wort="Ausfall" groesse="klein" />);
    const s = document.querySelector<HTMLElement>('[data-lfh="status"]')!;
    expect(s).toHaveStyle({ height: '20px', fontSize: '11px' });
    expect(s.dataset.groesse).toBe('klein');
  });

  it.each([
    ['alarm', '▲'],
    ['achtung', '▮'],
    ['normal', '●'],
  ] as const)('%s trägt ohne Angabe das Formzeichen %s, nicht im Text', (ton, zeichen) => {
    renderMitProviders(<Status ton={ton} wort="w" />);
    const s = document.querySelector<HTMLElement>('[data-lfh="status"]')!;
    expect(FORM_ZEICHEN[s.dataset.form as keyof typeof FORM_ZEICHEN]).toBe(zeichen);
    expect(s.className).toContain('lfh-form');
    expect(s).toHaveTextContent(/^w$/);
  });

  it('neutral und bedien tragen kein Zeichen; `form={null}` unterdrückt eines', () => {
    renderMitProviders(
      <>
        <Status ton="neutral" wort="gebunden" />
        <Status ton="bedien" wort="in Planung" />
        <Status ton="alarm" wort="ohne" form={null} />
      </>,
    );
    for (const s of document.querySelectorAll<HTMLElement>('[data-lfh="status"]'))
      expect(s.dataset.form).toBeUndefined();
  });

  it('nimmt eine Darstellung aus dem Statusvertrag; die Rolle `marke` erscheint neutral', () => {
    renderMitProviders(
      <>
        <Status darstellung={{ rolle: 'achtung', label: 'vermisst', form: 'kreis' }} />
        <Status darstellung={{ rolle: 'marke', label: 'Signatur' }} />
      </>,
    );
    expect(screen.getByText('vermisst').closest('[data-lfh="status"]')).toHaveAttribute(
      'data-ton',
      'achtung',
    );
    expect(screen.getByText('vermisst').closest('[data-lfh="status"]')).toHaveAttribute(
      'data-form',
      'kreis',
    );
    expect(screen.getByText('Signatur').closest('[data-lfh="status"]')).toHaveAttribute(
      'data-ton',
      'neutral',
    );
  });

  it('eine Mandantenfarbe bleibt Punkt neben der Rollenfläche', () => {
    renderMitProviders(<Status ton="normal" wort="frei" farbe=" #ff00ff " />);
    const s = document.querySelector<HTMLElement>('[data-lfh="status"]')!;
    expect(s).toHaveStyle({ background: farbenHell.normalFlaeche });
    expect(s.querySelector('[data-lfh="mandantenfarbe"]')).toHaveStyle({
      backgroundColor: '#ff00ff',
    });
  });

  it('Code in Mono 500, mit `trenner` der FMS-Punkt', () => {
    renderMitProviders(<Status ton="neutral" code="S4" wort="Am Einsatzort" trenner />);
    expect(screen.getByText('S4')).toHaveStyle({ fontWeight: '500' });
    expect(screen.getByText('·')).toHaveAttribute('aria-hidden', 'true');
  });
});
