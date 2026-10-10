import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { sendeBreitenAenderung, setzeViewportBreite } from '../test/viewport';
import { renderMitProviders, setzeOnline } from '../test/utils';
import type { Person } from '../api/types';
import PersonenPage from './PersonenPage';
import { queueLeerenFuerTests } from '../offline/queue';
import { offlineQuittungsKanalZuruecksetzenFuerTests } from '../offline/ereignisse';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): die Maske nennt
 * ihre Ablehnung im Dialog, der Abgleich-Vorschlag an seiner Zeile oder in seinem Dialog; ist die
 * Zeile weggefiltert, im Seitenhinweis. Kein Fehler-Toast, der Erfolgs-Toast bleibt.
 */

class StummerKanal {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

beforeEach(async () => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', StummerKanal);
  setzeOnline(true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  server.use(http.get('/api/einsaetze/:einsatzId/uhs', () => HttpResponse.json([])));
  await queueLeerenFuerTests();
});
afterEach(() => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  vi.unstubAllGlobals();
});

const basis: Person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'betroffen',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
};
const gefunden = { ...basis, id: 20, registrier_nr: 7, name: 'Funde' };
const vermisstA = {
  ...basis,
  id: 11,
  registrier_nr: 2,
  name: 'Alpha',
  status: 'vermisst' as const,
};
const vermisstB = { ...basis, id: 12, registrier_nr: 3, name: 'Beta', status: 'vermisst' as const };

const abgelehnt = (text: string, status = 422) => HttpResponse.json({ error: text }, { status });
const nie = () => new Promise<never>(() => {});
const abgleich = (vermisstId: number) => ({
  id: 1,
  einsatz_id: 1,
  vermisst_person_id: vermisstId,
  gefunden_person_id: 20,
  status: 'verdacht',
  erstellt_at: '2026-05-27 10:00:00',
  erstellt_von: 1,
  entschieden_at: null,
  entschieden_von: null,
});

function render(personen: unknown[]) {
  server.use(
    meHandler(benutzerFixture()),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture())),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
    </Routes>,
    { route: '/einsaetze/1/personen' },
  );
}

const keinFehlerToast = () =>
  expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
const seitenGrund = () =>
  document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"] [role="alert"]');

/** Der offene Dialog; ein schließender bleibt in jsdom als `.ant-zoom-leave` im Baum. */
function offenerDialog() {
  return waitFor(() => {
    const offen = screen.getAllByRole('dialog').filter((d) => d.closest('.ant-zoom-leave') == null);
    expect(offen).toHaveLength(1);
    return offen[0];
  });
}

describe('PersonenPage — Maske „Betroffene erfassen“ (LFH-1077)', () => {
  async function erfasseImDialog() {
    await userEvent.click(await screen.findByRole('button', { name: 'Betroffene erfassen' }));
    const dialog = await offenerDialog();
    await userEvent.type(within(dialog).getByLabelText('Antreffort'), 'Sammelstelle Süd');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    return dialog;
  }

  it('nennt den Grund im Dialog, behält die Eingabe, kein Toast', async () => {
    server.use(http.post('/api/einsaetze/1/personen', () => abgelehnt('Sichtung unbekannt')));
    render([]);
    const dialog = await erfasseImDialog();

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Person nicht erfasst');
    expect(grund).toHaveTextContent('Sichtung unbekannt');
    expect(within(dialog).getByLabelText('Antreffort')).toHaveValue('Sammelstelle Süd');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    // Die Erfassungszeile darunter bleibt still: der Grund gehört der Maske.
    expect(document.querySelector('[data-lfh="erfassungsband"] [role="alert"]')).toBeNull();
  });

  it('das nächste Absenden räumt den Grund; Abbrechen ist bis zur Antwort gesperrt', async () => {
    let zweiter = false;
    server.use(
      http.post('/api/einsaetze/1/personen', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Sichtung unbekannt');
      }),
    );
    render([]);
    const dialog = await erfasseImDialog();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Abbrechen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    server.use(http.post('/api/einsaetze/1/personen', () => abgelehnt('Sichtung unbekannt')));
    render([]);
    const dialog = await erfasseImDialog();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Betroffene erfassen' }));
    expect(within(await offenerDialog()).queryByRole('alert')).toBeNull();
  });
});

describe('PersonenPage — Abgleich vorschlagen (LFH-1077)', () => {
  const zeile = (nr: string) => screen.getByText(nr).closest('tr') as HTMLElement;

  async function schlageVorInZeile(nr: string, gefundene = 'R-007 Funde') {
    await userEvent.click(within(zeile(nr)).getByRole('combobox'));
    const optionen = await screen.findAllByTitle(gefundene);
    await userEvent.click(optionen[optionen.length - 1]);
  }

  async function zeigeVermisste() {
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    await screen.findByText('R-003');
  }

  /**
   * `useMutation` verfolgt nur den letzten Aufruf; die Gründe kommen je Zeile aus den Callbacks.
   */
  it('zwei Zeilen nebenläufig: die Ablehnung steht an ihrer Zeile, der Erfolg im Toast', async () => {
    let lehneAb: () => void = () => {};
    server.use(
      http.post('/api/einsaetze/1/personen/11/abgleich', async () => {
        await new Promise<void>((r) => (lehneAb = r));
        return abgelehnt('Abgleich besteht schon', 409);
      }),
      http.post('/api/einsaetze/1/personen/12/abgleich', () =>
        HttpResponse.json(abgleich(12), { status: 201 }),
      ),
    );
    render([vermisstA, vermisstB, gefunden]);
    await zeigeVermisste();
    await schlageVorInZeile('R-002');
    await schlageVorInZeile('R-003');
    await screen.findByText('Verdachts-Abgleich angelegt');
    await act(async () => lehneAb());

    expect(await within(zeile('R-002')).findByText('Abgleich besteht schon')).toHaveAttribute(
      'data-fehler',
    );
    expect(zeile('R-003').querySelector('[data-fehler]')).toBeNull();
    keinFehlerToast();
    // Die Wahl im Auswahlmenü ist kein Zeilenklick: die Seite bleibt.
    expect(screen.getByRole('heading', { level: 1, name: /Betroffene/ })).toBeInTheDocument();
  });

  it('die nächste Wahl an derselben Zeile räumt den Grund', async () => {
    let zweiter = false;
    server.use(
      http.post('/api/einsaetze/1/personen/11/abgleich', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Abgleich besteht schon', 409);
      }),
    );
    render([vermisstA, vermisstB, gefunden, { ...gefunden, id: 21, registrier_nr: 8 }]);
    await zeigeVermisste();
    await schlageVorInZeile('R-002');
    await screen.findByText('Abgleich besteht schon');

    // Eine andere Wahl: dieselbe löste am ungesteuerten Feld kein `onChange` aus.
    await schlageVorInZeile('R-002', 'R-008 Funde');
    await waitFor(() => expect(screen.queryByText('Abgleich besteht schon')).toBeNull());
  });

  it('ist die Zeile weggefiltert, steht der Grund im Seitenhinweis', async () => {
    server.use(
      http.post('/api/einsaetze/1/personen/11/abgleich', () =>
        abgelehnt('Abgleich besteht schon', 409),
      ),
    );
    render([vermisstA, vermisstB, gefunden]);
    await zeigeVermisste();
    await schlageVorInZeile('R-002');
    await screen.findByText('Abgleich besteht schon');
    expect(seitenGrund()).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Betroffen' }));
    const grund = await waitFor(() => {
      const g = seitenGrund();
      expect(g).not.toBeNull();
      return g as HTMLElement;
    });
    expect(grund).toHaveTextContent('Abgleich für R-002 nicht vorgeschlagen');
    expect(grund).toHaveTextContent('Abgleich besteht schon');
    keinFehlerToast();
  });

  it('ein Einsatzwechsel räumt die Gründe der Zeilen', async () => {
    /** Das Layout keyt sein `Outlet` nicht: nach dem Wechsel bleibt es dieselbe Seite. */
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/2/personen')}>
          Zu Einsatz B
        </button>
      );
    }
    server.use(
      meHandler(benutzerFixture()),
      http.get('/api/einsaetze/:eid', ({ params }) =>
        HttpResponse.json(einsatzFixture({ id: Number(params.eid) })),
      ),
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json([vermisstA, vermisstB, gefunden]),
      ),
      http.get('/api/einsaetze/2/personen', () => HttpResponse.json([gefunden])),
      http.post('/api/einsaetze/1/personen/11/abgleich', () =>
        abgelehnt('Abgleich besteht schon', 409),
      ),
    );
    renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/personen' },
    );
    await zeigeVermisste();
    await schlageVorInZeile('R-002');
    await screen.findByText('Abgleich besteht schon');

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    await waitFor(() => expect(screen.queryByText('R-002')).toBeNull());
    await screen.findByText(/R-007/);
    expect(screen.queryByText('Abgleich besteht schon')).toBeNull();
    expect(seitenGrund()).toBeNull();
  });

  /**
   * Eine Antwort, die erst nach dem Wechsel eintrifft, gehört dem alten Einsatz (LFH-1138,
   * `frontend/AGENTS.md`, „Rückwege und Fehler“): weder an einer Zeile noch im Seitenhinweis des
   * neuen, und auch kein Erfolgs-Toast dort.
   */
  describe('späte Antwort nach dem Einsatzwechsel (LFH-1138)', () => {
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/2/personen')}>
          Zu Einsatz B
        </button>
      );
    }
    function renderMitWechsel(antwort: () => Response) {
      let gibFrei: () => void = () => {};
      let angefragt = false;
      server.use(
        meHandler(benutzerFixture()),
        http.get('/api/einsaetze/:eid', ({ params }) =>
          HttpResponse.json(einsatzFixture({ id: Number(params.eid) })),
        ),
        http.get('/api/einsaetze/1/personen', () =>
          HttpResponse.json([vermisstA, vermisstB, gefunden]),
        ),
        http.get('/api/einsaetze/2/personen', () =>
          HttpResponse.json([{ ...vermisstB, einsatz_id: 2 }, gefunden]),
        ),
        http.post('/api/einsaetze/1/personen/11/abgleich', async () => {
          angefragt = true;
          await new Promise<void>((r) => (gibFrei = r));
          return antwort();
        }),
      );
      renderMitProviders(
        <>
          <Wechsel />
          <Routes>
            <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
          </Routes>
        </>,
        { route: '/einsaetze/1/personen' },
      );
      return {
        gibFrei: () => gibFrei(),
        angefragt: () => angefragt,
      };
    }
    async function wechsleNachB() {
      await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
      await waitFor(() => expect(screen.queryByText('R-002')).toBeNull());
      await screen.findByText('R-003');
    }

    it('eine Ablehnung aus Zeile meldet im neuen Einsatz nichts', async () => {
      const lauf = renderMitWechsel(() => abgelehnt('Abgleich besteht schon', 409));
      await zeigeVermisste();
      await schlageVorInZeile('R-002');
      await waitFor(() => expect(lauf.angefragt()).toBe(true));

      await wechsleNachB();
      await act(async () => lauf.gibFrei());
      // Die Antwort ist da: ohne Riegel stünde ihr Grund jetzt im Seitenhinweis von B.
      await act(async () => {});

      expect(screen.queryByText('Abgleich besteht schon')).toBeNull();
      expect(seitenGrund()).toBeNull();
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
      keinFehlerToast();
    });

    it('ein Erfolg aus Zeile quittiert im neuen Einsatz nicht', async () => {
      const lauf = renderMitWechsel(() => HttpResponse.json(abgleich(11), { status: 201 }));
      await zeigeVermisste();
      await schlageVorInZeile('R-002');
      await waitFor(() => expect(lauf.angefragt()).toBe(true));

      await wechsleNachB();
      await act(async () => lauf.gibFrei());
      await act(async () => {});

      expect(screen.queryByText('Verdachts-Abgleich angelegt')).toBeNull();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    });
  });

  it('der Erfolg eines Zeilenvorschlags schließt keinen offenen Dialog', async () => {
    let gibFrei: () => void = () => {};
    server.use(
      http.post('/api/einsaetze/1/personen/11/abgleich', async () => {
        await new Promise<void>((r) => (gibFrei = r));
        return HttpResponse.json(abgleich(11), { status: 201 });
      }),
    );
    setzeViewportBreite(1440);
    render([vermisstA, vermisstB, gefunden]);
    await zeigeVermisste();
    await schlageVorInZeile('R-002');

    // Das Fenster wird schmal, und im Kartenzweig öffnet der Dialog für eine andere Person.
    act(() => void sendeBreitenAenderung(390));
    const karte = (await screen.findByText('R-003')).closest<HTMLElement>(
      '[data-lfh="datensicht-karte"]',
    )!;
    await userEvent.click(within(karte).getByRole('button', { name: /Abgleich vorschlagen/ }));
    const dialog = await offenerDialog();

    await act(async () => gibFrei());
    await screen.findByText('Verdachts-Abgleich angelegt');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
  });

  describe('im Dialog des Kartenzweigs', () => {
    async function schlageVorImDialog() {
      setzeViewportBreite(390);
      render([vermisstA, gefunden]);
      await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
      await userEvent.click(await screen.findByRole('button', { name: /Abgleich vorschlagen/ }));
      const dialog = await offenerDialog();
      await userEvent.click(within(dialog).getByRole('combobox', { name: 'Gefundene Person' }));
      await userEvent.click(await screen.findByTitle('R-007 Funde'));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Vorschlagen' }));
      return dialog;
    }

    it('nennt die Ablehnung im Dialog, der Dialog bleibt offen, kein Toast', async () => {
      server.use(
        http.post('/api/einsaetze/1/personen/11/abgleich', () =>
          abgelehnt('Abgleich besteht schon', 409),
        ),
      );
      const dialog = await schlageVorImDialog();

      const grund = await within(dialog).findByRole('alert');
      expect(grund).toHaveTextContent('Nicht vorgeschlagen');
      expect(grund).toHaveTextContent('Abgleich besteht schon');
      expect(dialog.closest('.ant-zoom-leave')).toBeNull();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
      // Nicht doppelt: weder an der Karte noch im Seitenhinweis.
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
      expect(seitenGrund()).toBeNull();
    });

    it('wartet auf die Antwort: Abbrechen gesperrt, das nächste Absenden räumt', async () => {
      let zweiter = false;
      server.use(
        http.post('/api/einsaetze/1/personen/11/abgleich', async () => {
          if (zweiter) return nie();
          zweiter = true;
          return abgelehnt('Abgleich besteht schon', 409);
        }),
      );
      const dialog = await schlageVorImDialog();
      await within(dialog).findByRole('alert');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Vorschlagen' }));
      await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
      expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    });

    it('Abbrechen und erneutes Öffnen zeigen keinen alten Grund', async () => {
      server.use(
        http.post('/api/einsaetze/1/personen/11/abgleich', () =>
          abgelehnt('Abgleich besteht schon', 409),
        ),
      );
      const dialog = await schlageVorImDialog();
      await within(dialog).findByRole('alert');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      await userEvent.click(screen.getByRole('button', { name: /Abgleich vorschlagen/ }));
      expect(within(await offenerDialog()).queryByRole('alert')).toBeNull();
      expect(seitenGrund()).toBeNull();
    });
  });
});
