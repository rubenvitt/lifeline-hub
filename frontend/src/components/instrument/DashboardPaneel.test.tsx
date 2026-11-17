import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import DashboardPaneel, { type DashboardZustand } from './DashboardPaneel';
import { DashboardFlaeche, PaneelReihe, paneelReiheSpalten } from './DashboardFlaeche';
import { PANEEL_FEHLER_TITEL, PANEEL_LADEN_TEXT } from './PaneelZustand';

function rendere(zustand: DashboardZustand) {
  const onSprung = vi.fn();
  const onLeer = vi.fn();
  const onNeuladen = vi.fn();
  renderMitProviders(
    <DashboardPaneel
      titel="Sichtung"
      zustand={zustand}
      meta="12 erfasst"
      sprung={{ label: 'Betroffene', onKlick: onSprung }}
      leerText="Noch keine Personen erfasst."
      gesperrtText="Modul Personen nicht freigegeben."
      leerAktion={{ label: 'Person aufnehmen', onKlick: onLeer }}
      onNeuladen={onNeuladen}
    >
      <p>Inhalt</p>
    </DashboardPaneel>,
  );
  return { onSprung, onLeer, onNeuladen };
}

describe('DashboardPaneel', () => {
  it('trägt Augenbraue, Meta und den Sprung „… ↗“ im Kopf und zeigt die Daten', async () => {
    const { onSprung } = rendere('daten');
    expect(screen.getByRole('region', { name: 'Sichtung' })).toBeInTheDocument();
    expect(screen.getByText('12 erfasst')).toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Betroffene' }));
    expect(onSprung).toHaveBeenCalledOnce();
  });

  it('liegt ohne eigenen Rand im Fugenraster', () => {
    rendere('daten');
    const paneel = screen.getByRole('region', { name: 'Sichtung' });
    expect(paneel.style.borderStyle === 'none' || paneel.style.border === 'none').toBe(true);
  });

  it('Laden: „wird abgerufen“, keine Daten', () => {
    rendere('laden');
    expect(screen.getByLabelText('Sichtung wird geladen')).toHaveTextContent(PANEEL_LADEN_TEXT);
    expect(screen.queryByText('Inhalt')).toBeNull();
  });

  it('Fehler: „Stand unbekannt“ mit Neuladen, nie leer', async () => {
    const { onNeuladen } = rendere('fehler');
    expect(screen.getByRole('alert')).toHaveTextContent(PANEEL_FEHLER_TITEL);
    expect(screen.queryByText('Noch keine Personen erfasst.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(onNeuladen).toHaveBeenCalledOnce();
  });

  it('Leer: Satz und Ausweg', async () => {
    const { onLeer } = rendere('leer');
    expect(screen.getByText('Noch keine Personen erfasst.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Person aufnehmen' }));
    expect(onLeer).toHaveBeenCalledOnce();
  });

  it('Gesperrt: Grund statt Fehler, kein Sprung, keine Leeraktion', () => {
    rendere('gesperrt');
    expect(screen.getByText('Modul Personen nicht freigegeben.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Inhalt')).toBeNull();
  });
});

describe('DashboardPaneel · Kopf-Aktion (LLH-1815)', () => {
  function mitKopfAktion(zustand: DashboardZustand, sprung = true) {
    const onAktion = vi.fn();
    renderMitProviders(
      <DashboardPaneel
        titel="Einsatz starten"
        zustand={zustand}
        sprung={sprung ? { label: 'Einsatzdaten', onKlick: vi.fn() } : undefined}
        kopfAktion={{ label: 'Ausblenden', onKlick: onAktion }}
        leerText="leer"
        gesperrtText="gesperrt"
        onNeuladen={vi.fn()}
      >
        <p>Inhalt</p>
      </DashboardPaneel>,
    );
    return onAktion;
  }

  it('steht als Knopf ohne „↗“ im Kopf, hinter dem Sprung, und handelt', async () => {
    const onAktion = mitKopfAktion('daten');
    const kopf = screen.getByRole('region', { name: 'Einsatz starten' });
    const aktion = screen.getByRole('button', { name: 'Ausblenden' });
    expect(aktion).toHaveTextContent(/^Ausblenden$/);
    expect(aktion.closest('[data-lfh="paneel-kopf-rechts"]')).not.toBeNull();
    const sprung = screen.getByRole('button', { name: 'Einsatzdaten' });
    expect(sprung.compareDocumentPosition(aktion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kopf).toContainElement(aktion);
    await userEvent.click(aktion);
    expect(onAktion).toHaveBeenCalledOnce();
  });

  it('bleibt in jedem Zustand stehen, auch ohne Sprung und gesperrt', () => {
    mitKopfAktion('gesperrt', false);
    expect(screen.getByRole('button', { name: 'Ausblenden' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Einsatzdaten' })).toBeNull();
  });
});

describe('PaneelReihe', () => {
  it('teilt bis zu drei Paneele 1fr 1fr 1.1fr, darunter gestapelt', () => {
    expect(paneelReiheSpalten(true, 3)).toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr)');
    expect(paneelReiheSpalten(true, 2)).toBe('minmax(0, 1fr) minmax(0, 1.1fr)');
    expect(paneelReiheSpalten(true, 1)).toBe('minmax(0, 1fr)');
    expect(paneelReiheSpalten(false, 3)).toBe('minmax(0, 1fr)');
  });

  it('zählt nur gerenderte Paneele und setzt die Kennung', () => {
    const { container } = renderMitProviders(
      <DashboardFlaeche kennung="lagebild">
        <PaneelReihe kennung="lagebild-paneele">
          <div>a</div>
          {false}
          <div>b</div>
        </PaneelReihe>
      </DashboardFlaeche>,
    );
    const flaeche = container.querySelector<HTMLElement>('[data-lfh="lagebild"]')!;
    const reihe = container.querySelector<HTMLElement>('[data-lfh="lagebild-paneele"]')!;
    expect(flaeche).toContainElement(reihe);
    expect(reihe.style.display).toBe('grid');
    expect(reihe.children).toHaveLength(2);
  });
});
