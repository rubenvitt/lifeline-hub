import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten, farbenHell } from '../theme/tokens';
import WerkzeugZelle, { werkzeugZelleStil } from './WerkzeugZelle';
import type { SichtbaresWerkzeug } from './werkzeuge';

const tokenFuer = (stufe: keyof typeof dichten) => ({
  controlHeight: dichten[stufe].zeilenhoehe,
  padding: dichten[stufe].abstand.md,
  paddingLG: dichten[stufe].abstand.lg,
  marginXS: dichten[stufe].abstand.xs,
});

const auftraege: SichtbaresWerkzeug = {
  zustand: 'frei',
  key: 'auftraege',
  label: 'Aufträge',
  modulKey: 'auftraege',
  pfad: (id) => `/einsaetze/${id}/auftraege`,
};

describe('werkzeugZelleStil (Handgebautes Bedienziel)', () => {
  it('hält den Boden der Dichtestufe: 30 / 48 / 72 px', () => {
    const hoehe = (s: keyof typeof dichten) =>
      werkzeugZelleStil(farbenHell, tokenFuer(s), 'neutral', 'daten').ziel.minHeight;
    expect(hoehe('kompakt')).toBe(30);
    expect(hoehe('komfortabel')).toBe(48);
    expect(hoehe('handschuh')).toBe(72);
  });

  it('Achtung legt eine Kante auf, neutral keine', () => {
    expect(
      werkzeugZelleStil(farbenHell, tokenFuer('kompakt'), 'achtung', 'daten').kante,
    ).not.toBeNull();
    expect(
      werkzeugZelleStil(farbenHell, tokenFuer('kompakt'), 'neutral', 'daten').kante,
    ).toBeNull();
  });
});

describe('WerkzeugZelle', () => {
  it('springt in das Ziel und nennt Name, Zahl und Notiz im zugänglichen Namen', () => {
    renderMitProviders(
      <WerkzeugZelle
        einsatzId={7}
        werkzeug={auftraege}
        zahl={{ zustand: 'daten', wert: '2', notiz: '1 überfällig', ton: 'achtung' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Aufträge, 2, 1 überfällig' });
    expect(link).toHaveAttribute('href', '/einsaetze/7/auftraege');
    expect(link).toHaveAttribute('data-ton', 'achtung');
  });

  it('ohne Zahl bleibt es ein Sprung mit dem Namen', () => {
    renderMitProviders(<WerkzeugZelle einsatzId={7} werkzeug={auftraege} zahl={null} />);
    expect(screen.getByRole('link', { name: 'Aufträge' })).toBeInTheDocument();
  });

  it('lädt: „····“ statt einer Zahl, keine Behauptung über die Menge', () => {
    renderMitProviders(
      <WerkzeugZelle
        einsatzId={7}
        werkzeug={auftraege}
        zahl={{ zustand: 'laden', notiz: 'lädt' }}
      />,
    );
    expect(screen.getByText('····')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('link', { name: 'Aufträge, lädt' })).toBeInTheDocument();
  });

  it('nicht geladen: „?“ als unbekannter Stand, der Grund im Namen', () => {
    renderMitProviders(
      <WerkzeugZelle
        einsatzId={7}
        werkzeug={auftraege}
        zahl={{ zustand: 'fehler', notiz: 'nicht geladen' }}
      />,
    );
    expect(screen.getByText('?')).toHaveAttribute('title', 'Stand unbekannt');
    expect(screen.getByRole('link', { name: 'Aufträge, nicht geladen' })).toBeInTheDocument();
  });

  it('gesperrt: kein Link, keine Zahl, der Grund steht sichtbar am Werkzeug', () => {
    renderMitProviders(
      <WerkzeugZelle einsatzId={7} werkzeug={{ ...auftraege, zustand: 'gesperrt' }} zahl={null} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Aufträge (Keine Berechtigung)' })).toBeDisabled();
  });
});
