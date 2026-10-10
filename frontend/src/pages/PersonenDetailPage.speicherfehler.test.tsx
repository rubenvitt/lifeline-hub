import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonenDetailPage from './PersonenDetailPage';
import type { PersonDetail, Tier } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { erzeugeQueryClient } from '../api/queryClient';
import { alsSchadenAuswahl } from '../api/einsatzSchaden';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): Dialoge nennen
 * den Grund und warten auf die Antwort, Formulare und Blöcke tragen ihn selbst, Zeilen an sich,
 * Kopfaktionen im Seitenhinweis. Kein Fehler-Toast.
 */

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const einsatzAktiv = einsatzFixture();

const detail = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
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
  aktuelle_sichtung: null,
  aktuelle_sichtung_at: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
} as PersonDetail;

const uhsListe = [
  {
    id: 5,
    einsatz_id: 1,
    bezeichnung: 'BHP 50',
    typ: 'behandlungsplatz',
    status: 'aktiv',
    abschnitt_id: null,
    standort: null,
    notiz: null,
  },
];

const tier = {
  id: 30,
  einsatz_id: 1,
  registrier_nr: 7,
  status: 'aktiv',
  spezies: 'hund',
  rasse_beschreibung: null,
  rufname: 'Rex',
  geschlecht: null,
  alter_geschaetzt: null,
  farbe_beschreibung: null,
  kennzeichnung: null,
  groesse_gewicht: null,
  halter_person_id: 10,
  halter_kontakt: null,
  antreff_ort: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  halter_registrier_nr: 1,
} as unknown as Tier;
const zweitesTier = { ...tier, id: 31, registrier_nr: 8, rufname: 'Bello' } as Tier;
const freiesTier = { ...tier, id: 40, registrier_nr: 9, rufname: 'Minka', halter_person_id: null };

const schaden = {
  id: 50,
  einsatz_id: 1,
  registrier_nr: 9,
  status: 'offen',
  typ: 'sachschaden',
  ausmass: 'gering',
  ort: 'Weg 2',
  beschreibung: '',
  geschaedigt_person_id: 10,
  geschaedigt_personal_id: null,
  geschaedigt_organisation_id: null,
  geschaedigt_kontakt: null,
  uebergeben_an: null,
  uebergeben_at: null,
  abschluss_grund: null,
  abschluss_at: null,
  erfasst_at: '2026-05-29 10:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-29 10:00:00',
  geaendert_von: 1,
  storniert_at: null,
  storniert_von: null,
  geschaedigt_registrier_nr: 1,
  geschaedigt_storniert_at: null,
};
const freierSchaden = { ...schaden, id: 51, registrier_nr: 11, geschaedigt_person_id: null };

const abgelehnt = (text: string, status = 422) => HttpResponse.json({ error: text }, { status });
/** Eine Antwort, die nie kommt: geprüft wird der Zustand, solange sie aussteht. */
const nie = () => new Promise<never>(() => {});

function render(
  person: PersonDetail,
  extra: Parameters<typeof server.use> = [],
  cacheBehalten = false,
) {
  server.use(
    meHandler(benutzerFixture()),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
    http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
    http.get('/api/einsaetze/1/personen/10/audit', () => HttpResponse.json([])),
  );
  if (extra.length > 0) server.use(...extra);
  const client = cacheBehalten
    ? erzeugeQueryClient({
        queries: { retry: false, gcTime: 60_000 },
        mutations: { retry: false },
      })
    : undefined;
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personen" element={<div>LISTE</div>} />
      <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
    </Routes>,
    { route: '/einsaetze/1/personen/10', client },
  );
}

const kopfueberschrift = () => screen.findByRole('heading', { name: /Person R-001/ });
const keinToast = () => expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
const seitenHinweis = () => document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');

async function ausMenue(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: /Weitere Aktionen/ }));
  const menue = document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
  expect(menue).not.toBeNull();
  await userEvent.click(within(menue as HTMLElement).getByRole('menuitem', { name }));
}

async function klappeZuordnungenAuf() {
  await kopfueberschrift();
  await userEvent.click(screen.getByRole('button', { name: /Zuordnungen/ }));
}

/**
 * Der offene Dialog. rc-dialog friert den Inhalt eines schließenden Dialogs ein, und jsdom beendet
 * die Animation nie: ein geschlossener steht als `.ant-zoom-leave` weiter im Baum.
 */
function offenerDialog() {
  return waitFor(() => {
    const offen = screen.getAllByRole('dialog').filter((d) => d.closest('.ant-zoom-leave') == null);
    expect(offen).toHaveLength(1);
    return offen[0];
  });
}
const schliesst = (dialog: HTMLElement) =>
  waitFor(() => expect(dialog.closest('.ant-zoom-leave')).not.toBeNull());

async function waehle(dialog: HTMLElement, feld: string | RegExp, eintrag: RegExp) {
  await userEvent.click(within(dialog).getByRole('combobox', { name: feld }));
  await userEvent.click(await screen.findByTitle(eintrag));
}

describe('PersonenDetailPage — Sichtung im Dialog (LFH-1077)', () => {
  async function sichte() {
    await userEvent.click(await screen.findByRole('button', { name: 'Sichten' }));
    const dialog = await offenerDialog();
    await waehle(dialog, /Kategorie/, /^SK II$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    return dialog;
  }

  it('nennt den Grund im Dialog, der Dialog bleibt offen, kein Toast', async () => {
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/sichtung', () => abgelehnt('Person storniert')),
    ]);
    const dialog = await sichte();

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Sichtung nicht gespeichert');
    expect(grund).toHaveTextContent('Person storniert');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    keinToast();
  });

  it('das nächste Absenden räumt den Grund, Abbrechen ist bis zur Antwort gesperrt', async () => {
    let zweiter = false;
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/sichtung', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Person storniert');
      }),
    ]);
    const dialog = await sichte();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Abbrechen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/sichtung', () => abgelehnt('Person storniert')),
    ]);
    const dialog = await sichte();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    const wieder = await offenerDialog();
    expect(within(wieder).queryByRole('alert')).toBeNull();
  });
});

describe('PersonenDetailPage — Zuweisungen im Dialog (LFH-1077)', () => {
  it('UHS zuweisen: Grund im Dialog; Abbrechen und Wiederöffnen räumen ihn', async () => {
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', () => abgelehnt('UHS ist voll')),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'UHS zuweisen' }));
    const dialog = await offenerDialog();
    await waehle(dialog, 'Unfallhilfsstelle', /^BHP 50$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuweisen' }));

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht zugewiesen');
    expect(grund).toHaveTextContent('UHS ist voll');
    keinToast();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'UHS zuweisen' }));
    expect(within(await offenerDialog()).queryByRole('alert')).toBeNull();
  });

  it('Tier zuweisen: Grund im Dialog, kein Toast', async () => {
    render(detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('halter_person_id') ? [] : [freiesTier],
        ),
      ),
      http.patch('/api/einsaetze/1/tiere/40', () => abgelehnt('Tier hat schon einen Halter')),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Tier zuweisen' }));
    const dialog = await offenerDialog();
    await waehle(dialog, 'Tier', /Minka/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuweisen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Tier hat schon einen Halter',
    );
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    keinToast();
  });

  it('Schaden zuweisen: Grund im Dialog, kein Toast', async () => {
    render(detail, [
      http.get('/api/einsaetze/1/schaeden/auswahl', () =>
        HttpResponse.json(
          [freierSchaden].map((s) =>
            alsSchadenAuswahl(s as Parameters<typeof alsSchadenAuswahl>[0]),
          ),
        ),
      ),
      http.patch('/api/einsaetze/1/schaeden/51', () => abgelehnt('Schaden abgeschlossen')),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden zuweisen' }));
    const dialog = await offenerDialog();
    await waehle(dialog, 'Schaden', /S-011/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuweisen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Schaden abgeschlossen');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    keinToast();
  });
});

describe('PersonenDetailPage — Statuswechsel (LFH-1077)', () => {
  it('ein umkehrbarer Wechsel aus dem Kopf meldet die Ablehnung im Seitenhinweis', async () => {
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/status', () => abgelehnt('Übergang nicht erlaubt')),
    ]);
    await kopfueberschrift();
    await ausMenue(/vermisst/);

    const grund = await waitFor(() => {
      const g = seitenHinweis()?.querySelector<HTMLElement>('[role="alert"]');
      expect(g).toBeTruthy();
      return g as HTMLElement;
    });
    expect(grund).toHaveTextContent('Status nicht geändert');
    expect(grund).toHaveTextContent('Übergang nicht erlaubt');
    keinToast();
  });

  it('der nächste Wechsel räumt den Seitenhinweis', async () => {
    let zweiter = false;
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/status', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Übergang nicht erlaubt');
      }),
    ]);
    await kopfueberschrift();
    await ausMenue(/vermisst/);
    await screen.findByText('Übergang nicht erlaubt');

    await ausMenue(/vermisst/);
    await waitFor(() => expect(screen.queryByText('Übergang nicht erlaubt')).toBeNull());
  });

  it('die Rückfrage öffnet ohne den Grund eines früheren Wechsels', async () => {
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/status', () => abgelehnt('Übergang nicht erlaubt')),
    ]);
    await kopfueberschrift();
    await ausMenue(/vermisst/);
    await screen.findByText('Übergang nicht erlaubt');

    await ausMenue(/verstorben/);
    expect(within(await offenerDialog()).queryByRole('alert')).toBeNull();
  });

  describe('„verstorben“ mit Rückfrage', () => {
    async function bestaetige() {
      await kopfueberschrift();
      await ausMenue(/verstorben/);
      const dialog = await offenerDialog();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Status setzen' }));
      return dialog;
    }

    it('die Rückfrage wartet auf die Antwort und schließt erst beim Erfolg', async () => {
      let antworte: () => void = () => {};
      render(detail, [
        http.post('/api/einsaetze/1/personen/10/status', async () => {
          await new Promise<void>((r) => (antworte = r));
          return HttpResponse.json({ ...detail, status: 'verstorben' });
        }),
      ]);
      const dialog = await bestaetige();

      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled(),
      );
      expect(dialog.closest('.ant-zoom-leave')).toBeNull();
      await act(async () => antworte());
      await schliesst(dialog);
    });

    it('eine Ablehnung steht in der Rückfrage, nicht im Seitenhinweis, kein Toast', async () => {
      render(detail, [
        http.post('/api/einsaetze/1/personen/10/status', () => abgelehnt('Sichtung fehlt')),
      ]);
      const dialog = await bestaetige();

      const grund = await within(dialog).findByRole('alert');
      expect(grund).toHaveTextContent('Status nicht geändert');
      expect(grund).toHaveTextContent('Sichtung fehlt');
      expect(dialog.closest('.ant-zoom-leave')).toBeNull();
      expect(seitenHinweis()?.querySelector('[role="alert"]') ?? null).toBeNull();
      keinToast();
    });

    it('das nächste Bestätigen räumt den Grund', async () => {
      let zweiter = false;
      render(detail, [
        http.post('/api/einsaetze/1/personen/10/status', async () => {
          if (zweiter) return nie();
          zweiter = true;
          return abgelehnt('Sichtung fehlt');
        }),
      ]);
      const dialog = await bestaetige();
      await within(dialog).findByRole('alert');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Status setzen' }));
      await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    });

    it('Abbrechen räumt den Grund, auch aus dem Seitenhinweis; Wiederöffnen zeigt keinen', async () => {
      render(detail, [
        http.post('/api/einsaetze/1/personen/10/status', () => abgelehnt('Sichtung fehlt')),
      ]);
      const dialog = await bestaetige();
      await within(dialog).findByRole('alert');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      await waitFor(() =>
        expect(seitenHinweis()?.querySelector('[role="alert"]') ?? null).toBeNull(),
      );
      await ausMenue(/verstorben/);
      expect(within(await offenerDialog()).queryByRole('alert')).toBeNull();
    });
  });
});

describe('PersonenDetailPage — Stornieren mit Rückfrage (LFH-1077)', () => {
  async function storniere() {
    await kopfueberschrift();
    await ausMenue(/Stornieren/);
    const dialog = await offenerDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stornieren' }));
    return dialog;
  }

  it('die Rückfrage wartet und nennt eine Ablehnung, kein Toast', async () => {
    render(detail, [
      http.delete('/api/einsaetze/1/personen/10', () => abgelehnt('Bereits storniert')),
    ]);
    const dialog = await storniere();

    const grund = await within(dialog).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht storniert');
    expect(grund).toHaveTextContent('Bereits storniert');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    expect(screen.queryByText('LISTE')).toBeNull();
    keinToast();
  });

  it('Abbrechen ist bis zur Antwort gesperrt; das nächste Absenden räumt den Grund', async () => {
    let zweiter = false;
    render(detail, [
      http.delete('/api/einsaetze/1/personen/10', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Bereits storniert');
      }),
    ]);
    const dialog = await storniere();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Stornieren' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
  });

  it('Abbrechen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    render(detail, [
      http.delete('/api/einsaetze/1/personen/10', () => abgelehnt('Bereits storniert')),
    ]);
    const dialog = await storniere();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await ausMenue(/Stornieren/);
    expect(within(await offenerDialog()).queryByRole('alert')).toBeNull();
  });
});

describe('PersonenDetailPage — Bearbeiten und Notiz (LFH-1077)', () => {
  it('Bearbeiten: der Grund steht am Formular, das Formular bleibt, kein Toast', async () => {
    render(detail, [
      http.patch('/api/einsaetze/1/personen/10', () => abgelehnt('Geburtsdatum ungültig')),
    ]);
    await kopfueberschrift();
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    const grund = await screen.findByRole('alert');
    expect(grund).toHaveTextContent('Geburtsdatum ungültig');
    expect(grund.closest('form')).not.toBeNull();
    keinToast();
  });

  it('Bearbeiten: das nächste Speichern räumt den Grund; Abbrechen ist bis dahin gesperrt', async () => {
    let zweiter = false;
    render(detail, [
      http.patch('/api/einsaetze/1/personen/10', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Geburtsdatum ungültig');
      }),
    ]);
    await kopfueberschrift();
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await screen.findByText('Geburtsdatum ungültig');

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByText('Geburtsdatum ungültig')).toBeNull());
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Bearbeiten: Abbrechen und erneutes Öffnen zeigen keinen alten Grund', async () => {
    render(detail, [
      http.patch('/api/einsaetze/1/personen/10', () => abgelehnt('Geburtsdatum ungültig')),
    ]);
    await kopfueberschrift();
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await screen.findByText('Geburtsdatum ungültig');

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await ausMenue(/Bearbeiten/);
    await screen.findByRole('button', { name: 'Speichern' });
    expect(screen.queryByText('Geburtsdatum ungültig')).toBeNull();
  });

  it('Bearbeiten: der Sperrkonflikt (409) fragt weiter nach und steht nicht am Formular', async () => {
    render(detail, [
      http.patch('/api/einsaetze/1/personen/10', () => abgelehnt('Zwischenzeitlich geändert', 409)),
    ]);
    await kopfueberschrift();
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('button', { name: 'Überschreiben' })).toBeInTheDocument();
    expect(document.querySelector('form [role="alert"]')).toBeNull();
  });

  it('Notiz: der Grund steht am Notizformular, der Text bleibt; das nächste Absenden räumt', async () => {
    let zweiter = false;
    render(detail, [
      http.post('/api/einsaetze/1/personen/10/notizen', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Person storniert');
      }),
    ]);
    await kopfueberschrift();
    const feld = screen.getByRole('textbox', { name: /Verlaufsnotiz/ });
    await userEvent.type(feld, 'trinkt Wasser');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz anlegen' }));

    const grund = await screen.findByRole('alert');
    expect(grund).toHaveTextContent('Notiz nicht angelegt');
    expect(grund).toHaveTextContent('Person storniert');
    expect(feld).toHaveValue('trinkt Wasser');
    keinToast();

    await userEvent.click(screen.getByRole('button', { name: 'Notiz anlegen' }));
    await waitFor(() => expect(screen.queryByText('Person storniert')).toBeNull());
  });
});

describe('PersonenDetailPage — Zuordnungen und Abgleich (LFH-1077)', () => {
  it('Austragen: der Grund steht an der UHS-Verortung, kein Toast', async () => {
    render({ ...detail, aktuelle_uhs_id: 5 } as PersonDetail, [
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', () => abgelehnt('Bereits entlassen')),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Austragen' }));

    const grund = await screen.findByRole('alert');
    expect(grund).toHaveTextContent('Nicht ausgetragen');
    expect(grund).toHaveTextContent('Bereits entlassen');
    expect(grund.closest('[data-lfh="uhs-verortung"]')).not.toBeNull();
    keinToast();
  });

  /**
   * `useMutation` verfolgt nur den letzten Aufruf; die Gründe kommen je Zeile aus den Callbacks.
   */
  it('Tier lösen: zwei Zeilen nebenläufig, die Ablehnung steht an ihrer Zeile', async () => {
    let lehneAb: () => void = () => {};
    render(detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('halter_person_id') ? [tier, zweitesTier] : [],
        ),
      ),
      http.patch('/api/einsaetze/1/tiere/30', async () => {
        await new Promise<void>((r) => (lehneAb = r));
        return abgelehnt('Tier storniert');
      }),
      http.patch('/api/einsaetze/1/tiere/31', () =>
        HttpResponse.json({ ...zweitesTier, halter_person_id: null }),
      ),
    ]);
    await klappeZuordnungenAuf();
    const zeile = async (nr: string) =>
      (await screen.findByText(new RegExp(nr))).closest('[data-lfh="zuordnung"]') as HTMLElement;
    await userEvent.click(within(await zeile('T-007')).getByRole('button', { name: 'lösen' }));
    await userEvent.click(within(await zeile('T-008')).getByRole('button', { name: 'lösen' }));
    await act(async () => lehneAb());

    expect(await within(await zeile('T-007')).findByText('Tier storniert')).toHaveAttribute(
      'data-fehler',
    );
    expect((await zeile('T-008')).querySelector('[data-fehler]')).toBeNull();
    keinToast();
  });

  it('Tier lösen: ist die Zeile fort, steht der Grund im Seitenhinweis', async () => {
    const { client } = render(
      detail,
      [
        http.get('/api/einsaetze/1/tiere', ({ request }) =>
          HttpResponse.json(
            new URL(request.url).searchParams.has('halter_person_id') ? [tier] : [],
          ),
        ),
        http.patch('/api/einsaetze/1/tiere/30', () => abgelehnt('Tier storniert')),
      ],
      true,
    );
    await klappeZuordnungenAuf();
    await screen.findByText(/T-007/);
    await userEvent.click(screen.getByRole('button', { name: 'lösen' }));
    await screen.findByText('Tier storniert');

    act(() => client.setQueryData(einsatzKeys.tiereHalter(1, 10), []));
    const grund = await waitFor(() => {
      const g = seitenHinweis()?.querySelector<HTMLElement>('[role="alert"]');
      expect(g).toBeTruthy();
      return g as HTMLElement;
    });
    expect(grund).toHaveTextContent('Tier T-007 nicht gelöst');
    expect(grund).toHaveTextContent('Tier storniert');
  });

  it('Schaden lösen: der Grund steht an der Zeile, das nächste Lösen räumt ihn', async () => {
    let zweiter = false;
    render(detail, [
      http.get('/api/einsaetze/1/schaeden', ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('geschaedigt_person_id') ? [schaden] : [],
        ),
      ),
      http.patch('/api/einsaetze/1/schaeden/50', async () => {
        if (zweiter) return nie();
        zweiter = true;
        return abgelehnt('Schaden abgeschlossen');
      }),
    ]);
    await klappeZuordnungenAuf();
    await screen.findByText(/S-009/);
    await userEvent.click(screen.getByRole('button', { name: 'lösen' }));

    expect(await screen.findByText('Schaden abgeschlossen')).toHaveAttribute('data-fehler');
    keinToast();
    await userEvent.click(screen.getByRole('button', { name: 'lösen' }));
    await waitFor(() => expect(screen.queryByText('Schaden abgeschlossen')).toBeNull());
  });

  it('Abgleich entscheiden: der Grund steht am Abgleich, kein Toast', async () => {
    const vermisst = {
      ...detail,
      status: 'vermisst' as const,
      abgleiche: [
        {
          id: 5,
          einsatz_id: 1,
          vermisst_person_id: 10,
          gefunden_person_id: 21,
          status: 'verdacht',
          erstellt_at: '2026-05-27 10:00:00',
          erstellt_von: 1,
          entschieden_at: null,
          entschieden_von: null,
        },
      ],
    } as PersonDetail;
    render(vermisst, [
      http.post('/api/einsaetze/1/personen/10/abgleich/5/entscheidung', () =>
        abgelehnt('Abgleich bereits entschieden'),
      ),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    const grund = await screen.findByText('Abgleich bereits entschieden');
    expect(grund).toHaveAttribute('data-fehler');
    expect(grund.closest('li')).toHaveTextContent('R-021');
    keinToast();
  });
});

describe('PersonenDetailPage — Wechsel zu einer anderen Person (LFH-1077)', () => {
  /** Die Route hat keinen `key`: dieselbe Seite zeigt nach dem Wechsel die nächste Person. */
  function Wechsel() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => void navigate('/einsaetze/1/personen/11')}>
        Zur zweiten Person
      </button>
    );
  }
  const zweite = { ...detail, id: 11, registrier_nr: 11, aktuelle_uhs_id: 5 } as PersonDetail;

  function renderMitWechsel(person: PersonDetail, extra: Parameters<typeof server.use> = []) {
    server.use(
      meHandler(benutzerFixture()),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)),
      http.get('/api/einsaetze/1/personen/11', () => HttpResponse.json(zweite)),
      http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
      http.get('/api/einsaetze/1/personen/:pid/audit', () => HttpResponse.json([])),
    );
    if (extra.length > 0) server.use(...extra);
    return renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/personen/10' },
    );
  }
  const zurZweiten = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Zur zweiten Person' }));
    await screen.findByRole('heading', { name: /Person R-011/ });
  };

  it('räumt Notiz-, Bearbeiten- und Austrags-Grund und den getippten Notiztext', async () => {
    renderMitWechsel({ ...detail, aktuelle_uhs_id: 5 } as PersonDetail, [
      http.post('/api/einsaetze/1/personen/10/notizen', () => abgelehnt('Person storniert')),
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', () => abgelehnt('Bereits entlassen')),
      http.patch('/api/einsaetze/1/personen/10', () => abgelehnt('Geburtsdatum ungültig')),
    ]);
    await kopfueberschrift();
    await userEvent.type(screen.getByRole('textbox', { name: /Verlaufsnotiz/ }), 'trinkt Wasser');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz anlegen' }));
    await screen.findByText('Person storniert');
    await userEvent.click(screen.getByRole('button', { name: /Zuordnungen/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Austragen' }));
    await screen.findByText('Bereits entlassen');
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await screen.findByText('Geburtsdatum ungültig');

    await zurZweiten();
    expect(screen.queryByText('Person storniert')).toBeNull();
    expect(screen.queryByText('Bereits entlassen')).toBeNull();
    expect(screen.queryByText('Geburtsdatum ungültig')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Die Bearbeitung gehört zur ersten Person; ihr Speichern träfe sonst die zweite.
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
    expect(screen.getByRole('textbox', { name: /Verlaufsnotiz/ })).toHaveValue('');
  });

  it('eine erst nach dem Wechsel scheiternde Zeilenaktion meldet nicht bei der neuen Person', async () => {
    let lehneAb: () => void = () => {};
    renderMitWechsel(detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get('halter_person_id') === '10' ? [tier] : [],
        ),
      ),
      http.patch('/api/einsaetze/1/tiere/30', async () => {
        await new Promise<void>((r) => (lehneAb = r));
        return abgelehnt('Tier storniert');
      }),
    ]);
    await klappeZuordnungenAuf();
    await screen.findByText(/T-007/);
    await userEvent.click(screen.getByRole('button', { name: 'lösen' }));

    await zurZweiten();
    await act(async () => {
      lehneAb();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText('Tier storniert')).toBeNull();
    expect(seitenHinweis()).toBeNull();
  });
});

describe('PersonenDetailPage — Austragen und neue Verortung (LFH-1077)', () => {
  it('eine gelungene UHS-Zuweisung räumt den Grund eines gescheiterten Austragens', async () => {
    render({ ...detail, aktuelle_uhs_id: 5 } as PersonDetail, [
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', async ({ request }) => {
        const body = (await request.json()) as { art: string };
        return body.art === 'austritt'
          ? abgelehnt('Bereits entlassen')
          : HttpResponse.json({ ...detail, aktuelle_uhs_id: 5 });
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Austragen' }));
    await screen.findByText('Bereits entlassen');

    await userEvent.click(screen.getByRole('button', { name: 'UHS ändern' }));
    const dialog = await offenerDialog();
    await waehle(dialog, 'Unfallhilfsstelle', /^BHP 50$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuweisen' }));
    await schliesst(dialog);
    await waitFor(() => expect(screen.queryByText('Bereits entlassen')).toBeNull());
  });
});
