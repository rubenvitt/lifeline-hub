import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { waehleMenueEintrag } from '../../test/menue';
import ArchivSchluessel, { schluesselZustand } from './ArchivSchluessel';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

import { useAuth } from '../../auth/AuthContext';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

/** Archiv-Schlüssel der Organisation (LLH-1494). */

const schluessel = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  bezeichnung: `Tresor ${id}`,
  fingerabdruck: `ab12:cd34:ef56:00${id}0`,
  geprueft_at: '2026-11-12 08:00:00',
  angelegt_at: '2026-11-12 07:55:00',
  gesperrt: false,
  ...extra,
});

const PROBE =
  '-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24\n-----END AGE ENCRYPTED FILE-----';

function stelleBereit(liste: unknown[] = [schluessel(1)]) {
  const aufrufe: { pfad: string; body: unknown }[] = [];
  let lauf = 0;
  server.use(
    http.get('/api/org-archiv-schluessel', () => HttpResponse.json(liste)),
    http.post('/api/org-archiv-schluessel', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: 'eintragen', body });
      return HttpResponse.json(
        {
          empfaenger: schluessel(2, { bezeichnung: body.bezeichnung, geprueft_at: null }),
          probe: PROBE,
        },
        { status: 201 },
      );
    }),
    http.post('/api/org-archiv-schluessel/:id/pruefen', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      aufrufe.push({ pfad: `pruefen ${String(params.id)}`, body });
      lauf += 1;
      if (lauf === 1) {
        return HttpResponse.json({ error: 'Der Code stimmt nicht.' }, { status: 422 });
      }
      return HttpResponse.json(schluessel(Number(params.id), { bezeichnung: 'Tresor KV' }));
    }),
    http.delete('/api/org-archiv-schluessel/:id', ({ params }) => {
      aufrufe.push({ pfad: `entfernen ${String(params.id)}`, body: null });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return aufrufe;
}

describe('ArchivSchluessel (LLH-1494)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
  });

  it('nennt Fingerabdruck und Zustand und warnt bei nur einem geprüften Schlüssel', async () => {
    stelleBereit([schluessel(1), schluessel(3, { geprueft_at: null })]);
    renderMitProviders(<ArchivSchluessel />);
    expect(await screen.findByText('Tresor 1')).toBeInTheDocument();
    expect(screen.getByText(/ab12:cd34:ef56:0030 · Probe offen/)).toBeInTheDocument();
    expect(screen.getByText('Nur ein geprüfter Schlüssel')).toBeInTheDocument();
  });

  it('trägt einen Schlüssel ein, zeigt die Probe und prüft den Code', async () => {
    const aufrufe = stelleBereit([]);
    const user = userEvent.setup();
    renderMitProviders(<ArchivSchluessel />);
    await screen.findByText('Noch kein Archiv-Schlüssel');
    expect(screen.getByText('Ohne geprüften Schlüssel kein Archiv')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Schlüssel eintragen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Archiv-Schlüssel eintragen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Bezeichnung' }), 'Tresor KV');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Öffentlicher Schlüssel' }),
      ' age1abc ',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Eintragen' }));
    await waitFor(() =>
      expect(aufrufe).toEqual([
        { pfad: 'eintragen', body: { schluessel: 'age1abc', bezeichnung: 'Tresor KV' } },
      ]),
    );

    const probe = await screen.findByRole('dialog', { name: 'Probe für Tresor KV' });
    expect(within(probe).getByText(/BEGIN AGE ENCRYPTED FILE/)).toBeInTheDocument();
    const code = within(probe).getByRole('textbox', { name: 'Code' });
    await user.type(code, '11111111');
    await user.click(within(probe).getByRole('button', { name: 'Prüfen' }));
    // Ein falscher Code: der Dialog bleibt offen und nennt den Grund.
    expect(await within(probe).findByText('Der Code stimmt nicht.')).toBeInTheDocument();
    await user.clear(code);
    await user.type(code, '12345678');
    await user.click(within(probe).getByRole('button', { name: 'Prüfen' }));
    // Bestanden: die Quittung nennt den Schlüssel.
    expect(await screen.findByText('Tresor KV geprüft')).toBeInTheDocument();
    expect(aufrufe.slice(1)).toEqual([
      { pfad: 'pruefen 2', body: { code: '11111111' } },
      { pfad: 'pruefen 2', body: { code: '12345678' } },
    ]);
  });

  it('entfernt erst nach Rückfrage und nennt beim letzten geprüften die Folge', async () => {
    const aufrufe = stelleBereit();
    renderMitProviders(<ArchivSchluessel />);
    await screen.findByText('Tresor 1');
    await waehleMenueEintrag(
      screen.getByRole('button', { name: 'Aktionen zu Archiv-Schlüssel Tresor 1' }),
      /Entfernen/,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Tresor 1 entfernen?' });
    expect(within(dialog).getByText(/archiviert der Hub keine Einsätze mehr/)).toBeInTheDocument();
    expect(aufrufe).toEqual([]);
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(aufrufe).toEqual([{ pfad: 'entfernen 1', body: null }]));
  });

  it('lädt ohne System-Admin nichts', async () => {
    vi.mocked(useAuth).mockReturnValue(authWertFixture(benutzerFixture()));
    const abrufe = vi.fn();
    server.use(
      http.get('/api/org-archiv-schluessel', () => {
        abrufe();
        return HttpResponse.json([]);
      }),
    );
    renderMitProviders(<ArchivSchluessel />);
    expect(await screen.findByRole('heading', { name: 'Archiv-Schlüssel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Schlüssel eintragen/ })).not.toBeInTheDocument();
    expect(abrufe).not.toHaveBeenCalled();
  });

  it('beschreibt geprüft, offen und gesperrt als Wort', () => {
    const zeit = (w: string) => w.slice(11, 16);
    expect(schluesselZustand(schluessel(1) as never, zeit)).toBe(
      'ab12:cd34:ef56:0010 · geprüft 08:00',
    );
    expect(schluesselZustand(schluessel(1, { geprueft_at: null }) as never, zeit)).toBe(
      'ab12:cd34:ef56:0010 · Probe offen',
    );
    expect(
      schluesselZustand(schluessel(1, { geprueft_at: null, gesperrt: true }) as never, zeit),
    ).toBe('ab12:cd34:ef56:0010 · Probe gesperrt');
  });
});
