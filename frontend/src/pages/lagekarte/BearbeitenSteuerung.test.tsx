import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import BearbeitenSteuerung from './BearbeitenSteuerung';

function rendere(p: Partial<Parameters<typeof BearbeitenSteuerung>[0]> = {}) {
  const props = {
    aktiv: true,
    titel: 'Absperrbereich «Nord» bearbeiten',
    punkte: 4,
    figur: 'flaeche' as const,
    kreis: false,
    geaendert: false,
    kannEntfernen: false,
    kannZurueck: false,
    onEntfernen: vi.fn(),
    onZurueck: vi.fn(),
    onUebernehmen: vi.fn(),
    onAbbrechen: vi.fn(),
    ...p,
  };
  renderMitProviders(<BearbeitenSteuerung {...props} />);
  return props;
}

/** Band der punktweisen Bearbeitung (LLH-1344, design.md D2). */
describe('BearbeitenSteuerung', () => {
  it('rendert nichts, wenn nicht aktiv', () => {
    rendere({ aktiv: false });
    expect(document.querySelector('[data-lfh="bearbeiten-steuerung"]')).toBeNull();
  });

  it('zeigt Titel und Punktzahl; ohne Änderung ist „Übernehmen“ gesperrt', () => {
    rendere();
    expect(screen.getByText('Absperrbereich «Nord» bearbeiten')).toBeInTheDocument();
    expect(screen.getByText('4 Punkte')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Punkt entfernen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Letzte Änderung zurück' })).toBeDisabled();
  });

  it('ohne Änderung beendet Esc wie „Abbrechen“ (Kappe), mit Änderung nicht', () => {
    rendere();
    expect(screen.getByRole('button', { name: /Abbrechen/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Escape',
    );
  });

  it('mit Änderung: Übernehmen, Entfernen und Zurück rufen ihre Handlung', () => {
    const p = rendere({ geaendert: true, kannEntfernen: true, kannZurueck: true });
    expect(screen.getByRole('button', { name: /Abbrechen/ })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Punkt entfernen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Letzte Änderung zurück' }));
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(p.onEntfernen).toHaveBeenCalledTimes(1);
    expect(p.onZurueck).toHaveBeenCalledTimes(1);
    expect(p.onUebernehmen).toHaveBeenCalledTimes(1);
  });

  it('eine Kreiszone nennt vorher die Folge', () => {
    rendere({ kreis: true });
    expect(screen.getByText('Danach kein Kreis mehr: Mitte und Radius entfallen.')).toBeVisible();
  });

  it('ohne Kreis kein Hinweis', () => {
    rendere();
    expect(document.querySelector('[data-lfh="bearbeiten-kreis-hinweis"]')).toBeNull();
  });

  it('während des Speicherns ist alles außer dem ladenden Knopf gesperrt', () => {
    rendere({ geaendert: true, kannEntfernen: true, kannZurueck: true, speichernLaeuft: true });
    expect(screen.getByRole('button', { name: 'Punkt entfernen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Abbrechen/ })).toBeDisabled();
  });

  it('über der Grenze des Servers: Hinweis, „Übernehmen“ gesperrt', () => {
    rendere({ punkte: 5_000, geaendert: true });
    expect(screen.getByText(/zu viele Punkte/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  });
});
