import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import PaneelZustand, { PaneelLink, type PaneelDatenzustand } from './PaneelZustand';

function rendere(zustand: PaneelDatenzustand) {
  const onLeerAktion = vi.fn();
  const onNeuladen = vi.fn();
  renderMitProviders(
    <PaneelZustand
      zustand={zustand}
      titel="Meldungen"
      leerText="Keine offenen Meldungen."
      leerAktion="Meldung erfassen"
      onLeerAktion={onLeerAktion}
      onNeuladen={onNeuladen}
    >
      <p>Inhalt</p>
    </PaneelZustand>,
  );
  return { onLeerAktion, onNeuladen };
}

describe('PaneelZustand', () => {
  it('zeigt im Datenzweig die Kinder und sonst nichts', () => {
    rendere('daten');
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('benennt den Ladezustand und zeigt die Kinder nicht', () => {
    rendere('laden');
    const laden = screen.getByLabelText('Meldungen wird geladen');
    expect(laden).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Inhalt')).toBeNull();
  });

  it('unterscheidet Fehler von leer — Alarm, „Stand unbekannt" und Neuladen', async () => {
    const { onNeuladen, onLeerAktion } = rendere('fehler');
    const alarm = screen.getByRole('alert');
    // LITERALE: der Wortlaut ist die Zusicherung „nicht als Lage melden".
    expect(alarm).toHaveTextContent('Daten nicht abrufbar');
    expect(alarm).toHaveTextContent('Stand unbekannt — nicht als Lage melden.');
    expect(screen.queryByText('Keine offenen Meldungen.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(onNeuladen).toHaveBeenCalledTimes(1);
    expect(onLeerAktion).not.toHaveBeenCalled();
  });

  it('bietet im Leerzustand eine Aktion statt einer Sackgasse', async () => {
    const { onLeerAktion } = rendere('leer');
    expect(screen.getByText('Keine offenen Meldungen.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onLeerAktion).toHaveBeenCalledTimes(1);
  });
});

describe('PaneelLink', () => {
  it('trägt das Wort als Namen, der Pfeil ist Dekoration', async () => {
    const onKlick = vi.fn();
    renderMitProviders(<PaneelLink label="Alle Meldungen" onKlick={onKlick} />);
    const knopf = screen.getByRole('button', { name: 'Alle Meldungen' });
    expect(knopf).toHaveTextContent('↗');
    await userEvent.click(knopf);
    expect(onKlick).toHaveBeenCalledTimes(1);
  });
});
