import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { einsatzKeys } from '../api/queryKeys';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { modulRegistry } from '../einsatz/modulRegistry';
import StabPage from './StabPage';

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
/** Zählt die Antworten des Overrides-Handlers — Anker gegen das Rennen im Werkzeug-Link-Test. */
let overrideAufrufe = 0;
beforeEach(() => {
  overrideAufrufe = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

const nutzer = {
  id: 1,
  anzeigename: 'Nutzer',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
};
const einsatz = (over: object = {}) => ({
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  meine_sachgebiete: [],
  org_id: 5,
  ...over,
});
const leererStab = { anzahl_lagebesprechungen: 0, besetzung: [] };
const label = (key: string) => modulRegistry.find((m) => m.key === key)!.label;
const GRUND = 'Einsatz ist abgeschlossen und schreibgeschützt';

function Ort() {
  const ort = useLocation();
  return <output aria-label="Ort">{ort.pathname + ort.search}</output>;
}

function rendere({
  einsatzObj = einsatz(),
  stab = leererStab as object,
  stabStatus = 200,
  overrides = {} as object,
  route = '/einsaetze/1/stab',
  post = () => HttpResponse.json(leererStab, { status: 201 }) as Response,
} = {}) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      stabStatus === 200
        ? HttpResponse.json(stab)
        : HttpResponse.json({ error: 'kaputt' }, { status: stabStatus }),
    ),
    http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
    http.post('/api/einsaetze/1/stab/lagebesprechungen', () => post()),
    http.get('/api/einsaetze/1/modul-overrides', () => {
      overrideAufrufe += 1;
      return HttpResponse.json(overrides);
    }),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/stab"
        element={
          <>
            <StabPage />
            <Ort />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

async function besetzungsSektion() {
  return screen.findByRole('region', { name: 'Besetzung S1–S6' });
}
async function lagebesprechungSektion() {
  return screen.findByRole('region', { name: 'Lagebesprechung' });
}
const kopfaktion = () => screen.findByRole('button', { name: 'Lagebesprechung abschließen' });
/** Primäraktionen IM Kopf — derselbe Zuschnitt wie die Dev-Warnung von `EinsatzSeite`. */
function primaerImKopf(): number {
  const kopf = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]');
  return [...(kopf?.querySelectorAll('button') ?? [])].filter((b) =>
    [...b.classList].some((k) => k.endsWith('-btn-primary')),
  ).length;
}

describe('StabPage', () => {
  it('zeigt sechs feste Zeilen auch ohne jede Besetzung', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    await waitFor(() =>
      expect(
        within(sektion)
          .getAllByRole('heading', { level: 4 })
          .map((h) => h.textContent),
      ).toEqual([
        expect.stringContaining('S1 · Personal'),
        expect.stringContaining('S2 · Lage'),
        expect.stringContaining('S3 · Einsatz'),
        expect.stringContaining('S4 · Versorgung'),
        expect.stringContaining('S5 · Presse- und Medienarbeit'),
        expect.stringContaining('S6 · Information und Kommunikation'),
      ]),
    );
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(6);
  });

  it('nennt die Besetzung beim Wort', async () => {
    rendere({
      stab: {
        anzahl_lagebesprechungen: 0,
        besetzung: [
          {
            sachgebiet: 's2',
            besetzung_art: 'personal',
            personal_id: 99,
            name: 'Müller',
            personal_noch_disponiert: true,
            gesetzt_at: '2026-09-13 10:00:00',
            gesetzt_von_id: 1,
          },
        ],
      },
    });
    const sektion = await besetzungsSektion();
    expect(await within(sektion).findByText('Müller')).toBeInTheDocument();
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(5);
  });

  describe('Rechte-Paar', () => {
    it('mit Schreibrecht: je Zeile „Besetzung ändern", kein Rechte-Hinweis', async () => {
      rendere();
      const sektion = await besetzungsSektion();
      await waitFor(() =>
        expect(
          within(sektion).getAllByRole('button', { name: /^Besetzung ändern – S\d/ }),
        ).toHaveLength(6),
      );
      expect(screen.queryByText(/können die Besetzung ändern/)).toBeNull();
    });

    it('als Beobachter: keine Zeilenaktion, der Grund steht auf der Seite', async () => {
      rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
      const sektion = await besetzungsSektion();
      expect(
        await screen.findByText(/Nur Einsatzleitung und Führungspersonal/),
      ).toBeInTheDocument();
      expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(
        0,
      );
    });

    it('im abgeschlossenen Einsatz: keine Zeilenaktion, Hinweis nennt den Abschluss', async () => {
      rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
      await besetzungsSektion();
      expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });
  });

  it('behauptet während des Ladens keine Besetzung und keinen Termin, sperrt die Kopfaktion', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      // Antwort bleibt aus: der Abruf steht dauerhaft auf „lädt".
      http.get('/api/einsaetze/1/stab', () => new Promise<never>(() => {})),
      http.get('/api/einsaetze/1/stab/lagebesprechungen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<StabPage />} />
      </Routes>,
      { route: '/einsaetze/1/stab' },
    );
    const sektion = await besetzungsSektion();
    expect(within(sektion).getAllByRole('heading', { level: 4 })).toHaveLength(6);
    expect(within(sektion).queryByText('nicht vergeben')).toBeNull();
    expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    // Ohne Stand fehlte der Termin zur Vorbelegung — gesperrt (Gegenfall: Kopfaktion-Test unten).
    expect(await kopfaktion()).toBeDisabled();
    expect(within(await lagebesprechungSektion()).queryByText('kein Termin')).toBeNull();
  });

  it('Fehler ist nicht leer: ein gescheiterter Abruf behauptet keine sechs leeren Zeilen', async () => {
    rendere({ stabStatus: 500 });
    expect(
      await screen.findByText('Führungsorganisation konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('nicht vergeben')).toBeNull();
  });

  it('Werkzeug-Links zeigen nur freigegebene Module', async () => {
    rendere({ overrides: { chat: { sichtbar: false } } });
    await besetzungsSektion();
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    expect(within(s4).getByRole('link', { name: label('nachforderungen') })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    const s6 = screen.getByRole('group', { name: 'Werkzeuge S6' });
    // Die Gruppen stehen schon vor der Override-Antwort da (Ruling 2). Erst positiv auf die
    // Antwort warten — ein `waitFor` auf `null` wäre sonst sofort und trivial grün.
    await waitFor(() => expect(overrideAufrufe).toBe(1));
    await waitFor(() => expect(within(s6).queryByRole('link', { name: label('chat') })).toBeNull());
    expect(within(s6).getByRole('link', { name: label('einsatzabschnitte') })).toBeInTheDocument();
  });

  it('„Besetzung ändern" öffnet die Maske der Zeile', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    const knopf = await within(sektion).findByRole('button', {
      name: 'Besetzung ändern – S4 Versorgung',
    });
    await userEvent.click(knopf);
    expect(await screen.findByText('Besetzung S4 · Versorgung')).toBeInTheDocument();
  });
});

describe('StabPage · Sektion Lagebesprechung', () => {
  it('zeigt den Stand und die leere Historie', async () => {
    rendere();
    const sektion = await lagebesprechungSektion();
    expect(await within(sektion).findByText('kein Termin')).toBeInTheDocument();
    expect(
      await within(sektion).findByText('Noch keine Lagebesprechung abgeschlossen'),
    ).toBeInTheDocument();
  });

  it('Fehler ist nicht leer: ohne Stand kein „kein Termin"', async () => {
    rendere({ stabStatus: 500 });
    const sektion = await lagebesprechungSektion();
    expect(
      await within(sektion).findByText('Stand der Lagebesprechung konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(within(sektion).queryByText('kein Termin')).toBeNull();
  });
});

describe('StabPage · Kopfaktion „Lagebesprechung abschließen"', () => {
  it('ist mit Schreibrecht die eine Primäraktion und öffnet die Maske', async () => {
    rendere();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());
    expect(primaerImKopf()).toBe(1);
    await userEvent.click(knopf);
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
  });

  it('ist als Beobachter gesperrt statt versteckt, der Hinweis nennt den Grund', async () => {
    rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
    expect(await screen.findByText(/Lagebesprechungen abschließen/)).toBeInTheDocument();
    expect(await kopfaktion()).toBeDisabled();
    expect(primaerImKopf()).toBe(1);
  });

  it('ist im abgeschlossenen Einsatz gesperrt', async () => {
    rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
    await screen.findByText(/Der Einsatz ist abgeschlossen/);
    expect(await kopfaktion()).toBeDisabled();
  });

  /**
   * Ruling 4: ohne Stand fehlte der Termin zur Vorbelegung. Die Positivhälfte steht davor
   * (Schreibrecht besteht) und dahinter (derselbe Nutzer, der Stand kommt an → frei) — sonst
   * wäre „gesperrt" aus dem falschen Grund richtig.
   */
  it('ist bei dauerhaft gescheitertem Stand gesperrt, ohne eigenen Hinweis', async () => {
    rendere({ stabStatus: 500 });
    const sektion = await lagebesprechungSektion();
    expect(
      await within(sektion).findByText('Stand der Lagebesprechung konnte nicht geladen werden'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Nur Einsatzleitung/)).toBeNull());
    expect(await kopfaktion()).toBeDisabled();

    server.use(http.get('/api/einsaetze/1/stab', () => HttpResponse.json(leererStab)));
    await userEvent.click(within(sektion).getByRole('button', { name: /Wiederholen|Erneut/ }));
    await waitFor(async () => expect(await kopfaktion()).toBeEnabled());
  });

  /**
   * M3 (Ruling 13): fallen die Rechte bei offener Maske weg, ist sie weg — und sie steht nicht
   * wieder auf, wenn die Rechte zurückkommen. Die Positivhälfte (Kopfaktion wieder frei) steht
   * VOR der Negativaussage: ohne sie belegte „kein Dialog" nur eine noch gesperrte Seite.
   */
  it('schließt die Maske beim Rechteverlust und öffnet sie danach nicht von selbst', async () => {
    const { client } = rendere();
    const u = userEvent.setup();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());
    await u.click(knopf);
    await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });

    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz({ status: 'abgeschlossen' }))),
    );
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
    expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    server.use(http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())));
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.einsatz(1) }));
    await waitFor(async () => expect(await kopfaktion()).toBeEnabled());
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  /**
   * Belegt Abweichung 6: Öffnen = Montieren, jede Öffnung hat eine frische Mutation. Die Maske
   * wird beim Schliessen AUSGEHÄNGT (nicht `open=false`) — deshalb darf hier auf das Verschwinden
   * des Dialogs gewartet werden. Bleibt dieser `waitFor` rot, steht der Dialog noch in der
   * Verlassen-Bewegung: dann auf `ant-zoom-leave` umstellen (Muster `LageberichtDetailPage.test.tsx`).
   */
  it('öffnet nach einem Fehler ohne den Grund des vorigen Versuchs', async () => {
    rendere({ post: () => HttpResponse.json({ error: GRUND }, { status: 409 }) as Response });
    const u = userEvent.setup();
    const knopf = await kopfaktion();
    await waitFor(() => expect(knopf).toBeEnabled());

    await u.click(knopf);
    const erster = await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
    await u.type(within(erster).getByLabelText('Entschluss'), 'Lage unverändert');
    await u.click(within(erster).getByRole('button', { name: 'Abschließen' }));
    expect(await within(erster).findByText(GRUND)).toBeInTheDocument();

    await u.click(within(erster).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    await u.click(knopf);
    const zweiter = await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
    expect(within(zweiter).queryByText(GRUND)).toBeNull();
  });
});

describe('StabPage · ?neu=1 (Schnellaktion)', () => {
  const ort = () => screen.getByRole('status', { name: 'Ort' });

  it('öffnet die Maske mit Schreibrecht und räumt den Parameter', async () => {
    rendere({ route: '/einsaetze/1/stab?neu=1' });
    expect(
      await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/stab$/));
  });

  it('öffnet als Beobachter keine Maske, räumt den Parameter aber trotzdem', async () => {
    rendere({
      einsatzObj: einsatz({ meine_rolle: 'beobachter' }),
      route: '/einsaetze/1/stab?neu=1',
    });
    // Positiv zuerst: der Leser ist gelaufen. Sonst wäre das `null` unten trivial.
    await waitFor(() => expect(ort()).toHaveTextContent(/^\/einsaetze\/1\/stab$/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
