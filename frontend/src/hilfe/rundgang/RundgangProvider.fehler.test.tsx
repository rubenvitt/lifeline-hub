import { Component, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { neuerQueryClient } from '../../test/utils';
import { server } from '../../test/server';
import { RundgangProvider, useRundgang, useRundgangOrt } from './RundgangProvider';

// Die Tour scheitert (Chunk nicht ladbar offline oder nach einem Deploy; Renderfehler): beides
// landet bei derselben Fehlergrenze.
const tour = vi.hoisted(() => ({ gerendert: 0 }));
vi.mock('./RundgangTour', () => ({
  default: () => {
    tour.gerendert++;
    throw new Error('Tour nicht verfügbar');
  },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuthOptional: () => ({ benutzer: { id: 1 }, geraet: null }),
}));
vi.mock('../../components/useViewport', () => ({
  useViewport: () => ({ abBreite: () => true, istBeruehrung: false }),
}));

beforeEach(() => {
  server.use(
    http.get('/api/user-settings', () => HttpResponse.json({ eintraege: {} })),
    http.put('/api/user-settings/:s', () => HttpResponse.json({ eintraege: {} })),
  );
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
    () => ({ length: 1 }) as unknown as DOMRectList,
  );
});
afterEach(() => vi.restoreAllMocks());

/** Steht für die Wurzel-Fehlergrenze der App (`Fehlergrenze rahmen="wurzel"`). */
const wurzelFehler = vi.fn();
class Wurzel extends Component<{ children: ReactNode }, { fehler: boolean }> {
  state = { fehler: false };
  static getDerivedStateFromError() {
    return { fehler: true };
  }
  componentDidCatch(e: unknown) {
    wurzelFehler(e);
  }
  render() {
    return this.state.fehler ? <p>Wurzelfehler</p> : this.props.children;
  }
}

let starte: (() => void) | undefined;
function Seite() {
  useRundgangOrt('liste', false);
  starte = useRundgang().starte;
  return <div data-lfh="einsatzkachel">Seite steht</div>;
}

describe('RundgangProvider · Chunk-Fehler (LLH-1990)', () => {
  it('ein Ladefehler der Tour lässt die Seite stehen', async () => {
    render(
      <Wurzel>
        <QueryClientProvider client={neuerQueryClient()}>
          <RundgangProvider>
            <Seite />
          </RundgangProvider>
        </QueryClientProvider>
      </Wurzel>,
    );
    act(() => starte!());
    await new Promise((r) => setTimeout(r, 800));
    await waitFor(() => expect(screen.getByText('Seite steht')).toBeInTheDocument());
    expect(tour.gerendert).toBeGreaterThan(0);
    expect(wurzelFehler).not.toHaveBeenCalled();
  });
});
