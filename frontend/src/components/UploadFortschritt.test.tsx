import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UploadFortschrittAnzeige, { ansageText, sichtbarerText } from './UploadFortschritt';

describe('UploadFortschritt (LFH-654)', () => {
  it('zeigt im Senden die ganzzahlige Prozentzahl', () => {
    expect(sichtbarerText({ phase: 'senden', anteil: 0.256 })).toBe('Wird hochgeladen · 25 %');
  });

  it('zeigt ohne bekannte Gesamtgröße keine Zahl', () => {
    expect(sichtbarerText({ phase: 'senden', anteil: null })).toBe('Wird hochgeladen');
  });

  it('zeigt in der Prüfphase keine Zahl', () => {
    expect(sichtbarerText({ phase: 'pruefen' })).toBe('Datei wird geprüft');
  });

  it('sagt nur in 10-%-Schritten an, nicht bei jedem Ereignis', () => {
    expect(ansageText({ phase: 'senden', anteil: 0.21 })).toBe('Wird hochgeladen · 20 %');
    expect(ansageText({ phase: 'senden', anteil: 0.29 })).toBe('Wird hochgeladen · 20 %');
    expect(ansageText({ phase: 'senden', anteil: 0.3 })).toBe('Wird hochgeladen · 30 %');
    expect(ansageText({ phase: 'pruefen' })).toBe('Datei wird geprüft');
  });

  it('rendert Balken mit Wert, sichtbares Etikett und eine höfliche Ansage-Region', () => {
    render(<UploadFortschrittAnzeige stand={{ phase: 'senden', anteil: 0.42 }} />);
    expect(screen.getByText('Wird hochgeladen · 42 %')).toBeInTheDocument();
    const balken = screen.getByRole('progressbar', { name: 'Wird hochgeladen · 42 %' });
    expect(balken).toHaveAttribute('aria-valuenow', '42');
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent('Wird hochgeladen · 40 %');
  });

  it('trägt ohne bekannte Größe keinen Zahlenwert am Balken', () => {
    render(<UploadFortschrittAnzeige stand={{ phase: 'senden', anteil: null }} />);
    const balken = screen.getByRole('progressbar', { name: 'Wird hochgeladen' });
    expect(balken).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('rendert ohne Stand nichts', () => {
    const { container } = render(<UploadFortschrittAnzeige stand={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
