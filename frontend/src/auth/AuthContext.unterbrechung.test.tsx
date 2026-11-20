/**
 * LLH-1770: Eine 401 im laufenden Betrieb unterbricht die Sitzung, statt abzumelden. Die Seite
 * bleibt montiert, die Platte wird geräumt, die Anmeldung derselben Person löst auf, eine andere
 * Person lädt die Seite neu.
 *
 * Nacktes `render` wie in `AuthContext.pruefen.test.tsx`: der Test-Rahmen brächte einen zweiten
 * AuthProvider mit.
 */
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { setzeErwartetenBenutzer } from '../api/client';
import { lagebildLesen, lagebildLoeschenPlatte } from '../offline/lagebildSpeicher';
import { AuthProvider, useAuth } from './AuthContext';
import {
  BENUTZER_PRUEFEN,
  SITZUNG_ABGELAUFEN,
  SITZUNG_WIEDERHERGESTELLT,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';
import { istSitzungGesperrt, sitzungEntsperren, warteAufSitzung } from './sitzungsSperre';
import * as neuLaden from './seiteNeuLaden';
import * as webPush from '../alarm/webPush';
import * as geraetRaeumung from '../offline/geraetRaeumung';

const anna = {
  id: 1,
  anzeigename: 'Anna Admin',
  benutzername: 'anna',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};
const bruno = { ...anna, id: 2, anzeigename: 'Bruno Beispiel', benutzername: 'bruno' };
const geraet = { ...anna, id: 3, geraet: { id: 9, bezeichnung: 'UHS-Tablet' } };

let sitzung: typeof anna | null;
let loginAls: typeof anna;
let logoutAufrufe: number;
let qc: QueryClient;

beforeEach(() => {
  sitzung = anna;
  loginAls = anna;
  logoutAufrufe = 0;
  server.use(
    http.get('/api/auth/me', () =>
      sitzung === null
        ? HttpResponse.json({ error: 'x' }, { status: 401 })
        : HttpResponse.json(sitzung),
    ),
    http.post('/api/auth/login', () => {
      sitzung = loginAls;
      return HttpResponse.json(loginAls);
    }),
    http.post('/api/auth/logout', () => {
      logoutAufrufe++;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  vi.spyOn(neuLaden, 'seiteNeuLaden').mockImplementation(() => {});
  vi.spyOn(webPush, 'pushAbgleichen').mockResolvedValue(undefined as never);
});

afterEach(async () => {
  cleanup();
  sitzungEntsperren('beendet');
  sitzungsMeldungZuruecksetzen();
  setzeErwartetenBenutzer(null);
  vi.restoreAllMocks();
  await lagebildLoeschenPlatte();
});

let auth: ReturnType<typeof useAuth>;

function Sonde() {
  auth = useAuth();
  const { benutzer, unterbrechung, konflikt, login } = auth;
  return (
    <div>
      <span data-testid="name">{benutzer ? benutzer.anzeigename : 'anonym'}</span>
      <span data-testid="unterbrechung">{unterbrechung ? unterbrechung.bisher.benutzername : '—'}</span>
      <span data-testid="konflikt">{konflikt ? konflikt.jetzt.anzeigename : '—'}</span>
      <button onClick={() => void login(loginAls.benutzername, 'pw')}>login</button>
    </div>
  );
}

async function starte() {
  qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Sonde />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin'));
  // Das Lagebild ist angelegt, bevor die Unterbrechung es räumen soll.
  await waitFor(async () => expect(await lagebildLesen()).toBeDefined());
}

async function unterbreche() {
  sitzung = null;
  let ergebnis = false;
  act(() => {
    ergebnis = auth.unterbrechen();
  });
  expect(ergebnis).toBe(true);
  await waitFor(() => expect(screen.getByTestId('unterbrechung')).toHaveTextContent('anna'));
}

describe('Sitzung unterbrochen (LLH-1770)', () => {
  it('unterbricht: Benutzer bleibt, Platte leer, Query-Cache bleibt, Leseanfragen gesperrt', async () => {
    const platte = vi.spyOn(geraetRaeumung, 'geraetPlatteRaeumen');
    const alles = vi.spyOn(geraetRaeumung, 'geraetRaeumen');
    await starte();
    qc.setQueryData(['probe'], 'Stand');
    await unterbreche();
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    expect(istSitzungGesperrt()).toBe(true);
    await waitFor(async () => expect(await lagebildLesen()).toBeUndefined());
    expect(qc.getQueryData(['probe'])).toBe('Stand');
    expect(platte).toHaveBeenCalledTimes(1);
    expect(alles).not.toHaveBeenCalled();
  });

  it('eine zweite Unterbrechung ändert nichts und meldet „steht schon“', async () => {
    await starte();
    await unterbreche();
    const seit = auth.unterbrechung?.seit;
    let ergebnis = false;
    act(() => {
      ergebnis = auth.unterbrechen();
    });
    expect(ergebnis).toBe(true);
    expect(auth.unterbrechung?.seit).toBe(seit);
  });

  it('ein gekoppeltes Gerät wird nicht unterbrochen', async () => {
    sitzung = geraet as typeof anna;
    qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Sonde />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin'));
    let ergebnis = true;
    act(() => {
      ergebnis = auth.unterbrechen();
    });
    expect(ergebnis).toBe(false);
    expect(auth.unterbrechung).toBeNull();
  });

  it('Anmeldung derselben Person löst auf ohne Neuladen', async () => {
    await starte();
    await unterbreche();
    const wartend = warteAufSitzung();
    const wieder = vi.fn();
    window.addEventListener(SITZUNG_WIEDERHERGESTELLT, wieder);
    const invalidieren = vi.spyOn(qc, 'invalidateQueries');
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('unterbrechung')).toHaveTextContent('—'));
    window.removeEventListener(SITZUNG_WIEDERHERGESTELLT, wieder);
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    expect(neuLaden.seiteNeuLaden).not.toHaveBeenCalled();
    expect(wieder).toHaveBeenCalledTimes(1);
    await expect(wartend).resolves.toBe(true);
    expect(invalidieren).toHaveBeenCalled();
    expect(webPush.pushAbgleichen).toHaveBeenCalledWith(1, { nurBeiBedarf: true });
    // Das Lagebild wird wieder vorgehalten.
    await waitFor(async () => expect((await lagebildLesen())?.benutzer.id).toBe(1));
  });

  it('Anmeldung einer anderen Person lädt neu und übernimmt sie nicht', async () => {
    window.history.pushState({}, '', '/einsaetze/4/meldungen?neu=1');
    await starte();
    await unterbreche();
    loginAls = bruno;
    await userEvent.click(screen.getByText('login'));
    await waitFor(() =>
      expect(neuLaden.seiteNeuLaden).toHaveBeenCalledWith('/einsaetze/4/meldungen?neu=1'),
    );
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    expect(await lagebildLesen()).toBeUndefined();
    window.history.pushState({}, '', '/');
  });

  it('der Passkey-Weg (aktualisiere) unterscheidet ebenso', async () => {
    await starte();
    await unterbreche();
    sitzung = bruno;
    await act(() => auth.aktualisiere());
    expect(neuLaden.seiteNeuLaden).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    sitzung = anna;
    await act(() => auth.aktualisiere());
    await waitFor(() => expect(screen.getByTestId('unterbrechung')).toHaveTextContent('—'));
    expect(neuLaden.seiteNeuLaden).toHaveBeenCalledTimes(1);
  });

  it('Anmeldung derselben Person in einem anderen Tab löst über die Prüfung auf', async () => {
    await starte();
    await unterbreche();
    sitzung = anna;
    act(() => void window.dispatchEvent(new Event(BENUTZER_PRUEFEN)));
    await waitFor(() => expect(screen.getByTestId('unterbrechung')).toHaveTextContent('—'));
    expect(istSitzungGesperrt()).toBe(false);
  });

  it('andere Person in einem anderen Tab: Konflikt, die Unterbrechung endet ohne Räumen', async () => {
    await starte();
    await unterbreche();
    const alles = vi.spyOn(geraetRaeumung, 'geraetRaeumen');
    const wartend = warteAufSitzung();
    sitzung = bruno;
    act(() => void window.dispatchEvent(new Event(BENUTZER_PRUEFEN)));
    await waitFor(() => expect(screen.getByTestId('konflikt')).toHaveTextContent('Bruno Beispiel'));
    expect(screen.getByTestId('unterbrechung')).toHaveTextContent('—');
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    await expect(wartend).resolves.toBe(false);
    expect(alles).not.toHaveBeenCalled();
  });

  it('die Prüfung unterbricht bei 401 und meldet den Ablauf, ohne abzumelden', async () => {
    await starte();
    const ablauf = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, ablauf);
    sitzung = null;
    act(() => void window.dispatchEvent(new Event(BENUTZER_PRUEFEN)));
    await waitFor(() => expect(screen.getByTestId('unterbrechung')).toHaveTextContent('anna'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, ablauf);
    expect(ablauf).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    expect(logoutAufrufe).toBe(0);
  });

  it('unterbrechungBeenden meldet lokal ab und entsperrt mit „beendet“', async () => {
    await starte();
    await unterbreche();
    const wartend = warteAufSitzung();
    const alles = vi.spyOn(geraetRaeumung, 'geraetRaeumen');
    await act(() => auth.unterbrechungBeenden());
    expect(screen.getByTestId('name')).toHaveTextContent('anonym');
    expect(screen.getByTestId('unterbrechung')).toHaveTextContent('—');
    await expect(wartend).resolves.toBe(false);
    expect(alles).toHaveBeenCalledWith('sitzungsende');
    expect(logoutAufrufe).toBe(0);
  });
});
