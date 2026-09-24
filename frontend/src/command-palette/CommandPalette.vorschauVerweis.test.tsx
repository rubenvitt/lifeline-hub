// frontend/src/command-palette/CommandPalette.vorschauVerweis.test.tsx
//
// Verweise in der Vorschau schließen die Palette (LFH-664, Spec „Verweise in der Vorschau
// schließen die Palette"). Eine Meldungsvorschau trägt „↗ Auftrag", eine Auftragsvorschau
// „↗ ETB-Eintrag" — ohne Riegel navigierte die App UNTER der offenen Palette weg.
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { Link } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { CommandPalette } from './CommandPalette';
import type { Befehl } from './typen';

vi.mock('./Vorschau', () => ({
  Vorschau: () => (
    <div>
      <Link to="/einsaetze/5/auftraege?auftrag=3">↗ Auftrag</Link>
      <p>Florian meldet Lage</p>
    </div>
  ),
}));

function person(): Befehl {
  return {
    id: 'datensatz:personen:11',
    gruppe: 'datensaetze',
    label: 'Florian Mustermann',
    kontext: 'Personen',
    ziel: '/einsaetze/5/personen/11',
    vorschau: { art: 'person', einsatzId: 5, id: 11 },
    ausfuehren: vi.fn(),
  };
}

async function inDerVorschau() {
  const schliesse = vi.fn();
  renderMitProviders(<CommandPalette befehle={[person()]} schliesse={schliesse} />);
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('region', { name: /^Vorschau/ })).toBeInTheDocument();
  return schliesse;
}

describe('CommandPalette · Verweise in der Vorschau (LFH-664)', () => {
  it('ein Klick auf einen Verweis schließt die Palette', async () => {
    const schliesse = await inDerVorschau();
    await userEvent.click(screen.getByRole('link', { name: '↗ Auftrag' }));
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('ein Klick auf Text oder „Zurück" lässt sie offen', async () => {
    const schliesse = await inDerVorschau();
    await userEvent.click(screen.getByText('Florian meldet Lage'));
    await userEvent.click(screen.getByRole('button', { name: /Zurück/ }));
    expect(schliesse).not.toHaveBeenCalled();
  });

  it('Esc von einem fokussierten Verweis führt eine Ebene zurück, nicht hinaus', async () => {
    const schliesse = await inDerVorschau();
    const verweis = screen.getByRole('link', { name: '↗ Auftrag' });
    verweis.focus();
    const nichtVerhindert = fireEvent.keyDown(verweis, { key: 'Escape' });
    expect(nichtVerhindert).toBe(false);
    expect(screen.queryByRole('region', { name: /^Vorschau/ })).toBeNull();
    expect(schliesse).not.toHaveBeenCalled();
  });
});
