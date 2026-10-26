import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzBenachrichtigungen from './EinsatzBenachrichtigungen';

/**
 * Sektion „Benachrichtigungen“ (LLH-1421, Spec `benachrichtigungen`, „Vorgabe je Funktion am
 * Einsatz“): je Eingangsart die Funktionen, für die sie still ist; speichert je Zeile sofort.
 */

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, system_rolle: 'benutzer', org_id: 1 } }),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('../../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
}));

vi.mock('../../api/benachrichtigungen', () => ({
  ladeBenachrichtigungVorgaben: vi.fn(),
  setzeBenachrichtigungVorgabe: vi.fn(),
}));

import { ladeEinsatz, ladeEinstellungen } from '../../api/einsaetze';
import {
  ladeBenachrichtigungVorgaben,
  setzeBenachrichtigungVorgabe,
} from '../../api/benachrichtigungen';
import { ApiError } from '../../api/client';
import type { BenachrichtigungVorgaben } from '../../api/types';

const VORGABEN: BenachrichtigungVorgaben = {
  funktionen: [
    { funktion: 'el', name: 'EL' },
    { funktion: 's1', name: 'S1' },
    { funktion: 's2', name: 'S2' },
    { funktion: 'ohne', name: 'ohne Funktion' },
  ],
  arten: [
    { art: 'meldung', still: [] },
    { art: 'lagebericht', still: ['el', 's1', 's2', 'ohne'] },
  ],
};

function einsatz(meine_rolle: string, status = 'aktiv') {
  return { id: 1, org_id: 1, bezeichnung: 'Lage', status, meine_rolle } as never;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/einstellungen/benachrichtigungen"
        element={<EinsatzBenachrichtigungen />}
      />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/benachrichtigungen' },
  );
}

/** Die Zeile einer Art. */
function zeile(art: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-vorgabe-zeile="${art}"]`);
  if (!el) throw new Error(`keine Zeile ${art}`);
  return el;
}

/** Wählt in der Auswahl der Zeile `name` die Funktion `label` dazu. */
async function waehle(name: string, label: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: `Still für: ${name}` }));
  const option = await waitFor(() => {
    const o = document.querySelector<HTMLElement>(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${label}"]`,
    );
    if (!o) throw new Error(`keine Option ${label}`);
    return o;
  });
  fireEvent.click(option);
}

describe('EinsatzBenachrichtigungen (LLH-1421)', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz('einsatzleitung'));
    vi.mocked(ladeEinstellungen).mockResolvedValue({ einsatz_id: 1 } as never);
    vi.mocked(ladeBenachrichtigungVorgaben).mockResolvedValue(structuredClone(VORGABEN));
    vi.mocked(setzeBenachrichtigungVorgabe).mockReset();
  });

  it('zeigt je Eingang eine Zeile mit den Funktionen, für die er still ist', async () => {
    rendern();

    expect(
      await screen.findByRole('combobox', { name: 'Still für: Neue Meldung und Lagemeldung' }),
    ).toBeEnabled();
    expect(within(zeile('meldung')).queryByText('S1')).toBeNull();
    expect(within(zeile('lagebericht')).getByText('S1')).toBeInTheDocument();
    expect(within(zeile('lagebericht')).getByText('ohne Funktion')).toBeInTheDocument();
    // Jede Zeile speichert sofort: keine Speicher-Leiste.
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
  });

  it('speichert eine Änderung sofort per PUT und zeigt den Wert vor der Antwort', async () => {
    let antworten: (v: unknown) => void = () => {};
    vi.mocked(setzeBenachrichtigungVorgabe).mockImplementation(
      () => new Promise((r) => (antworten = r as never)),
    );
    rendern();

    await waehle('Neue Meldung und Lagemeldung', 'S2');

    await waitFor(() =>
      expect(setzeBenachrichtigungVorgabe).toHaveBeenCalledWith(1, 'meldung', ['s2']),
    );
    // Optimistisch: der Wert steht, bevor der Server antwortet.
    expect(within(zeile('meldung')).getByText('S2')).toBeInTheDocument();
    antworten({ art: 'meldung', still: ['s2'] });
    await waitFor(() => expect(within(zeile('meldung')).getByText('S2')).toBeInTheDocument());
  });

  it('scheitert das Speichern, springt nur diese Zeile zurück und trägt die Marke', async () => {
    vi.mocked(setzeBenachrichtigungVorgabe).mockRejectedValue(
      new ApiError(409, 'Einsatz ist abgeschlossen'),
    );
    rendern();

    await waehle('Neue Meldung und Lagemeldung', 'S2');

    await waitFor(() => expect(zeile('meldung')).toHaveAttribute('data-fehler', 'true'));
    expect(within(zeile('meldung')).queryByText('S2')).toBeNull();
    expect(zeile('lagebericht')).not.toHaveAttribute('data-fehler');
    expect(within(zeile('lagebericht')).getByText('S2')).toBeInTheDocument();
    expect(await screen.findByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
  });

  it('ohne Verwaltungsrecht nur lesend, mit Hinweis und Wort an der Zeile', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz('beobachter'));
    rendern();

    const auswahl = await screen.findByRole('combobox', {
      name: 'Still für: Neue Meldung und Lagemeldung',
    });
    expect(auswahl).toBeDisabled();
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="rechte-hinweis"]')).not.toBeNull(),
    );
    expect(within(zeile('meldung')).getByText('nur lesen')).toBeInTheDocument();
  });

  it('ein abgeschlossener Einsatz sperrt auch die Einsatzleitung', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue(einsatz('einsatzleitung', 'abgeschlossen'));
    rendern();

    expect(
      await screen.findByRole('combobox', { name: 'Still für: Neue Meldung und Lagemeldung' }),
    ).toBeDisabled();
    expect(within(zeile('meldung')).queryByText('nur lesen')).toBeNull();
  });
});
