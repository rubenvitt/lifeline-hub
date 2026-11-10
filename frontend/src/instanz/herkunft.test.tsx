import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HerkunftAbzeichen, herkunftVon, VomHubGesperrt, VOM_HUB_TEXT } from './herkunft';

const anzeige = {
  quelle: 'Hub DRK Landesverband',
  vom_hub: { fahrzeug: ['3', '4'], fuehrungsfunktion: ['s1'] },
  admins_ohne_passkey: [],
};

describe('Herkunft der Stammdaten (LLH-1493)', () => {
  it('kennt „vom Hub“ und „nur hier“ nur, solange die Org eine Quelle hat', () => {
    expect(herkunftVon(anzeige, 'fahrzeug', 3)).toBe('vom_hub');
    expect(herkunftVon(anzeige, 'fahrzeug', 9)).toBe('nur_hier');
    expect(herkunftVon(anzeige, 'fuehrungsfunktion', 's1')).toBe('vom_hub');
    expect(herkunftVon(anzeige, 'material', 3)).toBe('nur_hier');
    expect(herkunftVon({ vom_hub: {}, admins_ohne_passkey: [] }, 'fahrzeug', 3)).toBeNull();
    expect(herkunftVon(undefined, 'fahrzeug', 3)).toBeNull();
  });

  it('Abzeichen sagt die Herkunft in Worten, ohne Quelle nichts', () => {
    const { rerender, container } = render(
      <HerkunftAbzeichen herkunft="vom_hub" quelle="Hub DRK" />,
    );
    expect(screen.getByText('vom Hub')).toHaveAttribute(
      'title',
      'Kommt aus Hub DRK und wird dort gepflegt',
    );
    rerender(<HerkunftAbzeichen herkunft="nur_hier" />);
    expect(screen.getByText('nur hier')).toBeInTheDocument();
    rerender(<HerkunftAbzeichen herkunft={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('gesperrte Zeile nennt den Grund wie der Server', () => {
    render(<VomHubGesperrt />);
    expect(screen.getByText(VOM_HUB_TEXT)).toBeInTheDocument();
    expect(VOM_HUB_TEXT).toBe('Wird am Hub gepflegt');
  });
});
