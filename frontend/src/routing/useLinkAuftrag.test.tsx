import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { ReactNode } from 'react';
import { useLinkAuftrag } from './useLinkAuftrag';

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

function useSonde() {
  return {
    a: useLinkAuftrag(),
    b: useLinkAuftrag(),
    location: useLocation(),
    navigate: useNavigate(),
  };
}

describe('useLinkAuftrag (LLH-1361)', () => {
  it('räumt die genannten Parameter, lässt die übrigen stehen und verbraucht den Eintrag', async () => {
    const { result } = renderHook(useSonde, {
      wrapper: wrapper('/x?zentrum=1,2&ansicht=3&zurueck=1'),
    });
    expect(result.current.a.verbraucht()).toBe(false);
    const alt = result.current.a;
    act(() => alt.raeume('zentrum', 'zurueck'));
    // Der alte Stand (Render vor dem Commit der Räumung) ist verbraucht.
    expect(alt.verbraucht()).toBe(true);
    await waitFor(() => expect(result.current.location.search).toBe('?ansicht=3'));
  });

  it('der nächste Verlaufseintrag ist frisch, auch mit demselben Auftrag', async () => {
    const { result } = renderHook(useSonde, { wrapper: wrapper('/x?zentrum=1,2') });
    act(() => result.current.a.raeume('zentrum'));
    await waitFor(() => expect(result.current.location.search).toBe(''));
    act(() => {
      void result.current.navigate('/x?zentrum=1,2');
    });
    await waitFor(() => expect(result.current.location.search).toBe('?zentrum=1,2'));
    expect(result.current.a.verbraucht()).toBe(false);
  });

  it('weiter verbraucht den Eintrag und ersetzt die Adresse', async () => {
    const { result } = renderHook(useSonde, { wrapper: wrapper('/x?bezirk=5') });
    const alt = result.current.a;
    act(() => alt.weiter((p) => p.set('ansicht', '2')));
    expect(alt.verbraucht()).toBe(true);
    await waitFor(() => expect(result.current.location.search).toBe('?bezirk=5&ansicht=2'));
    expect(result.current.a.verbraucht()).toBe(false);
  });

  it('zwei Aufträge eines Links verbrauchen einander nicht', () => {
    const { result } = renderHook(useSonde, { wrapper: wrapper('/x?abschnitt=3&zentrum=1,2') });
    const { a, b } = result.current;
    act(() => a.raeume('abschnitt'));
    expect(a.verbraucht()).toBe(true);
    expect(b.verbraucht()).toBe(false);
  });

  it('zwei Aufträge eines Eintrags räumen gemeinsam, keiner stellt den Parameter des anderen wieder her', async () => {
    const { result } = renderHook(useSonde, {
      wrapper: wrapper('/x?gefahrengebiet=10&evakuierungsbezirk=5&ansicht=3'),
    });
    // Beide Effekte laufen im selben Commit, also mit demselben Stand.
    const { a, b } = result.current;
    act(() => {
      a.raeume('gefahrengebiet');
      b.raeume('evakuierungsbezirk');
    });
    await waitFor(() => expect(result.current.location.search).toBe('?ansicht=3'));
  });

  it('ein Ansichtswechsel nach einer Räumung desselben Eintrags behält die Räumung', async () => {
    const { result } = renderHook(useSonde, {
      wrapper: wrapper('/x?gefahrengebiet=10&evakuierungsbezirk=5'),
    });
    const { a, b } = result.current;
    act(() => {
      a.raeume('gefahrengebiet');
      b.weiter((p) => p.set('ansicht', '2'));
    });
    await waitFor(() =>
      expect(result.current.location.search).toBe('?evakuierungsbezirk=5&ansicht=2'),
    );
  });
});
