import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neuerQueryClient } from '../../test/utils';
import { server } from '../../test/server';
import { RundgangProvider, useRundgang, useRundgangOrt } from './RundgangProvider';
import type { RundgangTeil } from './rundgangSchluessel';

const auth = vi.hoisted(() => ({
  wert: { benutzer: { id: 1 }, geraet: null } as { benutzer: unknown; geraet: unknown } | null,
}));
vi.mock('../../auth/AuthContext', () => ({ useAuthOptional: () => auth.wert }));
const viewport = vi.hoisted(() => ({ md: true }));
vi.mock('../../components/useViewport', () => ({
  useViewport: () => ({
    abBreite: (p: string) => (p === 'md' ? viewport.md : true),
    istBeruehrung: false,
  }),
}));

let geschrieben: string[];
beforeEach(() => {
  geschrieben = [];
  auth.wert = { benutzer: { id: 1 }, geraet: null };
  viewport.md = true;
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => ({ length: 1 }) as unknown as DOMRectList,
  );
  server.use(
    http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege: {} })),
    http.put('/api/benutzer-einstellungen/:s', ({ params }) => {
      geschrieben.push(String(params.s));
      return HttpResponse.json({ eintraege: {} });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

let starteAussen: (() => void) | undefined;
function Ort({
  teil,
  selbst,
  ziele = true,
}: {
  teil: RundgangTeil;
  selbst: boolean;
  ziele?: boolean;
}) {
  useRundgangOrt(teil, selbst);
  const { ort, starte } = useRundgang();
  starteAussen = starte;
  return (
    <div>
      <span data-testid="ort">{ort ?? 'kein'}</span>
      {ziele && (
        <>
          <div data-lfh="einsatzkachel">Kachel</div>
          <button data-lfh="suche-ausloeser">Suchen</button>
          <button data-lfh="hilfe-knopf">?</button>
          <button data-lfh="benutzermenue">Menü</button>
        </>
      )}
    </div>
  );
}

function zeige(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={neuerQueryClient()}>
      <RundgangProvider>{ui}</RundgangProvider>
    </QueryClientProvider>,
  );
}

const ERSTER = 'Einsätze';

describe('RundgangProvider (LLH-1990)', () => {
  it('starte öffnet die erste Sprechblase und merkt den Teil sofort', async () => {
    zeige(<Ort teil="liste" selbst={false} />);
    expect(screen.getByTestId('ort').textContent).toBe('liste');
    act(() => starteAussen!());
    expect(await screen.findByText(ERSTER)).toBeInTheDocument();
    expect(screen.getByText('1/4')).toBeInTheDocument();
    await waitFor(() => expect(geschrieben).toEqual(['rundgang_liste_gesehen']));
  });

  it('Weiter bis Fertig schließt', async () => {
    zeige(<Ort teil="liste" selbst={false} />);
    act(() => starteAussen!());
    await screen.findByText(ERSTER);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull());
  });

  it('Rundgang beenden und Esc schließen', async () => {
    zeige(<Ort teil="liste" selbst={false} />);
    act(() => starteAussen!());
    await screen.findByText(ERSTER);
    fireEvent.click(screen.getByRole('button', { name: 'Rundgang beenden' }));
    await waitFor(() => expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull());
    act(() => starteAussen!());
    await screen.findByText(ERSTER);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull());
  });

  it('Selbststart einmal je Ort', async () => {
    const { rerender } = zeige(<Ort teil="liste" selbst />);
    await screen.findByText(ERSTER);
    fireEvent.click(screen.getByRole('button', { name: 'Rundgang beenden' }));
    await waitFor(() => expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull());
    rerender(
      <QueryClientProvider client={neuerQueryClient()}>
        <RundgangProvider>
          <Ort teil="liste" selbst />
        </RundgangProvider>
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull();
  });

  it('unter Browser-Automatisierung kein Selbststart, auf Wunsch schon', async () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    try {
      zeige(<Ort teil="liste" selbst />);
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull();
      act(() => starteAussen!());
      expect(await screen.findByText(ERSTER)).toBeInTheDocument();
    } finally {
      delete (navigator as { webdriver?: boolean }).webdriver;
    }
  });

  it('ohne sichtbares Ziel kein Start und nichts gemerkt', async () => {
    zeige(<Ort teil="liste" selbst={false} ziele={false} />);
    act(() => starteAussen!());
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull();
    expect(geschrieben).toEqual([]);
  });

  it('Handschirm und Gerätekonto: kein Starter, kein Selbststart', async () => {
    viewport.md = false;
    const a = zeige(<Ort teil="liste" selbst />);
    expect(starteAussen).toBeUndefined();
    a.unmount();
    viewport.md = true;
    auth.wert = { benutzer: { id: 1 }, geraet: { id: 3 } };
    zeige(<Ort teil="liste" selbst />);
    expect(starteAussen).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull();
  });

  it('verlässt man den Ort, geht der Rundgang zu', async () => {
    const { rerender } = zeige(<Ort teil="liste" selbst={false} />);
    act(() => starteAussen!());
    await screen.findByText(ERSTER);
    rerender(
      <QueryClientProvider client={neuerQueryClient()}>
        <RundgangProvider>
          <span>anderswo</span>
        </RundgangProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.querySelector('[data-lfh="rundgang"]')).toBeNull());
  });
});
