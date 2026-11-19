import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulGesperrt from './ModulGesperrt';
import { modulRegistry } from './modulRegistry';

/** Hinweis des Modulwächters (LFH-888, Spec `modul-freigabe`). */
const lagemeldungen = modulRegistry.find((m) => m.key === 'lagemeldungen')!;

function PfadAnzeige() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

function rendern(ausgeblendet: boolean, freigabenPfad?: string, einsatzleitung?: string[]) {
  return renderMitProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <ModulGesperrt
              modul={lagemeldungen}
              ausgeblendet={ausgeblendet}
              rueckweg={{ pfad: '/einsaetze/7/ueberblick', label: 'Überblick öffnen' }}
              freigabenPfad={freigabenPfad}
              einsatzleitung={einsatzleitung}
            />
            <PfadAnzeige />
          </>
        }
      />
    </Routes>,
    { route: '/einsaetze/7/lagemeldungen' },
  );
}

describe('ModulGesperrt (LFH-888)', () => {
  it('nennt das Modul als Hauptüberschrift und „Keine Berechtigung“ als Grund', () => {
    rendern(false);
    expect(screen.getByRole('heading', { level: 1, name: /Lagemeldungen/ })).toBeInTheDocument();
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
    // Eine kurze Sperrzeile, kein Satz über die Einstellungen (LFH-1078).
    expect(screen.getByText('Für die eigene Rolle nicht freigegeben')).toBeInTheDocument();
    expect(screen.queryByText(/ausgeblendet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Einstellungen › Module/)).not.toBeInTheDocument();
  });

  it('Gliederung: das h1 steht vor der Paneel-Überschrift (h2)', () => {
    rendern(false);
    const ebenen = screen.getAllByRole('heading').map((h) => h.tagName);
    expect(ebenen).toEqual(['H1', 'H2']);
  });

  it('ein ausgeblendetes Modul heißt „ausgeblendet“, nicht „nicht freigegeben“', () => {
    rendern(true);
    expect(screen.getByText('In diesem Einsatz ausgeblendet')).toBeInTheDocument();
    expect(screen.queryByText(/nicht freigegeben/)).not.toBeInTheDocument();
  });

  it('genau eine Primäraktion: der Rückweg navigiert', async () => {
    rendern(false);
    const knoepfe = screen.getAllByRole('button');
    expect(knoepfe).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Überblick öffnen' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/ueberblick');
  });

  it('wer die Freigaben verwaltet, bekommt „Modulfreigaben öffnen“ als zweite Aktion (LFH-1078)', async () => {
    rendern(true, '/einsaetze/7/einstellungen/module');
    const knopf = screen.getByRole('button', { name: 'Modulfreigaben öffnen' });
    // Der Rückweg bleibt die eine Primäraktion.
    expect(knopf).not.toHaveClass('ant-btn-primary');
    expect(screen.getByRole('button', { name: 'Überblick öffnen' })).toHaveClass('ant-btn-primary');
    await userEvent.click(knopf);
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/einstellungen/module');
  });

  // --- Ansprechpartner (LLH-1819) ---

  it('nennt die Einsatzleitung beim Namen, alle in Reihenfolge', () => {
    rendern(false, undefined, ['Anna Muster', 'Ben Beispiel']);
    expect(
      screen.getByText('Freigabe erteilt die Einsatzleitung: Anna Muster, Ben Beispiel'),
    ).toBeInTheDocument();
  });

  it('ohne bekannte Einsatzleitung steht der Satz ohne Namen und ohne Doppelpunkt', () => {
    rendern(false, undefined, []);
    expect(screen.getByText('Freigabe erteilt die Einsatzleitung.')).toBeInTheDocument();
  });

  it('ohne geladene Liste steht der Satz ohne Namen', () => {
    rendern(false);
    expect(screen.getByText('Freigabe erteilt die Einsatzleitung.')).toBeInTheDocument();
  });

  it('wer die Freigaben verwaltet, bekommt keinen Ansprechpartner, nur den Knopf', () => {
    rendern(false, '/einsaetze/7/einstellungen/module', ['Anna Muster']);
    expect(screen.queryByText(/Freigabe erteilt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Anna Muster/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modulfreigaben öffnen' })).toBeInTheDocument();
  });

  it('auch ein ausgeblendetes Modul nennt die Einsatzleitung', () => {
    rendern(true, undefined, ['Anna Muster']);
    expect(
      screen.getByText('Freigabe erteilt die Einsatzleitung: Anna Muster'),
    ).toBeInTheDocument();
  });
});
