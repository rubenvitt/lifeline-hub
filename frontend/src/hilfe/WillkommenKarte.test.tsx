import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neuerQueryClient } from '../test/utils';
import { server } from '../test/server';
import WillkommenKarte from './WillkommenKarte';
import { istWillkommenOffen } from './willkommen';

const auth = vi.hoisted(() => ({
  wert: { benutzer: { id: 1 }, geraet: null } as { benutzer: unknown; geraet: unknown } | null,
}));
vi.mock('../auth/AuthContext', () => ({ useAuthOptional: () => auth.wert }));

const TITEL = 'Willkommen bei Lifeline Hub';

function zeige() {
  return render(
    <QueryClientProvider client={neuerQueryClient()}>
      <MemoryRouter>
        <WillkommenKarte />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stand(eintraege: Record<string, string>) {
  server.use(http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege })));
}

beforeEach(() => {
  auth.wert = { benutzer: { id: 1 }, geraet: null };
});

describe('istWillkommenOffen', () => {
  it('offen nur bei geladenem Stand ohne Schlüssel', () => {
    expect(istWillkommenOffen(undefined)).toBe(false);
    expect(istWillkommenOffen({ eintraege: {} })).toBe(true);
    expect(
      istWillkommenOffen({ eintraege: { willkommen_geschlossen: '2026-11-19 09:00:00' } }),
    ).toBe(false);
  });
});

describe('WillkommenKarte', () => {
  it('erscheint ohne Schlüssel und führt zu Hilfe, „?“ und Einweisung', async () => {
    stand({});
    zeige();
    expect(await screen.findByText(TITEL)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Einweisung lesen' })).toHaveAttribute(
      'href',
      // Die Gruppe „Alle“ ist die Vorgabe der Hilfe und steht deshalb nicht in der Adresse.
      '/hilfe',
    );
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('bleibt weg, wenn sie schon geschlossen wurde', async () => {
    let geladen = false;
    server.use(
      http.get('/api/benutzer-einstellungen', () => {
        geladen = true;
        return HttpResponse.json({ eintraege: { willkommen_geschlossen: '2026-11-01 08:00:00' } });
      }),
    );
    zeige();
    await waitFor(() => expect(geladen).toBe(true));
    expect(screen.queryByText(TITEL)).toBeNull();
  });

  it('bleibt bei einem Abruffehler weg', async () => {
    let geladen = false;
    server.use(
      http.get('/api/benutzer-einstellungen', () => {
        geladen = true;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    zeige();
    await waitFor(() => expect(geladen).toBe(true));
    expect(screen.queryByText(TITEL)).toBeNull();
  });

  it('„Verstanden“ schreibt den Zeitpunkt und blendet aus', async () => {
    stand({});
    let wert: string | undefined;
    server.use(
      http.put('/api/benutzer-einstellungen/willkommen_geschlossen', async ({ request }) => {
        wert = ((await request.json()) as { wert: string }).wert;
        return HttpResponse.json({ eintraege: { willkommen_geschlossen: wert } });
      }),
    );
    zeige();
    fireEvent.click(await screen.findByRole('button', { name: 'Verstanden' }));
    await waitFor(() => expect(wert).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/));
    expect(screen.queryByText(TITEL)).toBeNull();
  });

  it('ein Fehler beim Schließen lässt die Karte trotzdem verschwinden', async () => {
    stand({});
    server.use(
      http.put(
        '/api/benutzer-einstellungen/willkommen_geschlossen',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    zeige();
    fireEvent.click(await screen.findByRole('button', { name: 'Verstanden' }));
    expect(screen.queryByText(TITEL)).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(TITEL)).toBeNull();
  });

  it('erscheint nicht auf dem gekoppelten Gerät', async () => {
    auth.wert = { benutzer: { id: 1 }, geraet: { id: 4 } };
    stand({});
    zeige();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(TITEL)).toBeNull();
  });
});
