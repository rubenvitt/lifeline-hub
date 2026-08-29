import { http, HttpResponse } from 'msw';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonenDetailPage from './PersonenDetailPage';
import type { Person, PersonDetail, Sichtungskategorie } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { erzeugeQueryClient } from '../api/queryClient';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): so prüfen die Rollen-Tests die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1, anzeigename: 'Nutzer', benutzername: 'nutzer', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const detail = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
  name: 'Mustermann', vorname: 'Max', geschlecht: 'maennlich', geburtsdatum: null,
  alter_geschaetzt: 40, herkunft_adresse: null, antreff_ort: 'Brücke', melder_kontakt: null,
  notiz: null, erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1, storniert_at: null,
  aktuelle_sichtung: null, aktuelle_sichtung_at: null, aktueller_verbleib: null,
  aktuelle_uhs_id: null, aktueller_platz_id: null,
  sichtungen: [], notizen: [], verbleib: [], abgleiche: [],
} as PersonDetail;

function render(
  einsatzObj: typeof einsatzAktiv,
  person: PersonDetail,
  extra: Parameters<typeof server.use> = [],
  cacheBehalten = false,
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personen/10/audit', () => HttpResponse.json([])),
  );
  // extra-Handler separat prependen, damit sie Vorrang vor den Default-Handlern haben.
  if (extra.length > 0) server.use(...extra);
  const client = cacheBehalten
    ? erzeugeQueryClient({
        queries: { retry: false, gcTime: 60_000 },
        mutations: { retry: false },
      })
    : undefined;
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<div>LISTE</div>} />
        <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
        <Route path="/einsaetze/:id/tiere/:tierId" element={<div>TIERE-DETAIL</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/personen/10', client },
  );
}

function renderBei(route: string) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<div>LISTE</div>} />
        <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
        <Route path="/einsaetze/:id/tiere/:tierId" element={<div>TIERE-DETAIL</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('PersonenDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger Personen-ID auf die Personen-Liste um', async () => {
    renderBei('/einsaetze/1/personen/abc');
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('verlinkt „Als Geschädigte" auf die Schaden-Detailseite (LFH-148)', async () => {
    const schaden = {
      id: 99, einsatz_id: 1, registrier_nr: 5, typ: 'sachschaden', ausmass: 'gering', status: 'offen',
    };
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([schaden])),
    ]);
    await klappeZuordnungenAuf();
    const link = await screen.findByRole('link', { name: /sachschaden/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/schaeden/99');
  });
});

/**
 * Ladehoheit (LFH-340 · C5, Befund M40).
 *
 * Die Seite setzte beim Öffnen sechs Abfragen ab — Einsatz, Detail, zugeordnete Tiere,
 * zugeordnete Schäden, UHS-Liste und Zugriffs-Audit —, um eine nachgetragene Sichtung zu
 * ermöglichen. Fünf davon speisen Blöcke, die erst nach dem Aufklappen etwas anzeigen.
 */
describe('PersonenDetailPage — Ladehoheit', () => {
  /** Pfade der abgesetzten Einsatz-Abfragen, in Reihenfolge. `/auth/me` zählt nicht mit. */
  function zaehleAbfragen(): { pfade: string[]; loesen: () => void } {
    const pfade: string[] = [];
    const horcher = ({ request }: { request: Request }) => {
      const pfad = new URL(request.url).pathname;
      if (pfad.startsWith('/api/einsaetze/')) pfade.push(pfad);
    };
    server.events.on('request:start', horcher);
    return { pfade, loesen: () => server.events.removeListener('request:start', horcher) };
  }

  it('setzt beim Öffnen höchstens zwei Abfragen ab', async () => {
    const { pfade, loesen } = zaehleAbfragen();
    try {
      render(einsatzAktiv, detail);
      await screen.findByRole('heading', { name: /Person R-001/ });
      expect(pfade).toEqual(['/api/einsaetze/1', '/api/einsaetze/1/personen/10']);
    } finally {
      loesen();
    }
  });

  /**
   * Die zweite Hälfte, und ohne sie belegte die erste nichts: „höchstens zwei" wäre auch
   * grün, wenn die Zuordnungen gar nicht mehr lüden.
   */
  it('lädt die Zuordnungen erst beim Aufklappen', async () => {
    const { pfade, loesen } = zaehleAbfragen();
    try {
      render(einsatzAktiv, detail);
      await screen.findByRole('heading', { name: /Person R-001/ });
      expect(screen.queryByText('Zugeordnete Tiere')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Zuordnungen/ }));
      expect(await screen.findByText('Zugeordnete Tiere')).toBeInTheDocument();
      await vi.waitFor(() => {
        expect(pfade).toContain('/api/einsaetze/1/tiere');
        expect(pfade).toContain('/api/einsaetze/1/schaeden');
        expect(pfade).toContain('/api/einsaetze/1/uhs');
      });
    } finally {
      loesen();
    }
  });

  it('lädt das Zugriffs-Audit erst beim Aufklappen', async () => {
    const { pfade, loesen } = zaehleAbfragen();
    try {
      render(einsatzAktiv, detail);
      await screen.findByRole('heading', { name: /Person R-001/ });
      expect(pfade).not.toContain('/api/einsaetze/1/personen/10/audit');

      await userEvent.click(screen.getByRole('button', { name: /Zugriffs-Audit/ }));
      await vi.waitFor(() => expect(pfade).toContain('/api/einsaetze/1/personen/10/audit'));
    } finally {
      loesen();
    }
  });
});

/**
 * Kopfleiste (LFH-340 · C5, Befund M37).
 *
 * Der Kopf trug sieben gleichrangige Knöpfe — bis zu vier Statuswechsel, Bearbeiten,
 * Stornieren und ein „Zurück zur Liste" neben dem Breadcrumb — und **keine** Primäraktion.
 * Es gab also nichts, was sagte, was hier zu tun ist.
 */
/**
 * Das Menü der Kopfleiste öffnen und den Eintragsknoten des GEÖFFNETEN Portals liefern.
 *
 * `.ant-dropdown:not(.ant-dropdown-hidden)` ist Pflicht, nicht Zierde: antd lässt die
 * Portale geschlossener Dropdowns im Baum stehen, ein blankes `[role="menu"]` fände also
 * auch abgeräumte Menüs.
 */
async function oeffneKopfmenue(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: /Weitere Aktionen/ }));
  const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  expect(menue).not.toBeNull();
  return menue as HTMLElement;
}

/** Eine Aktion aus dem Kopfmenü auslösen (Teilstring, wie bei antd-Icons im Eintrag nötig). */
async function ausMenue(name: RegExp) {
  const menue = await oeffneKopfmenue();
  await userEvent.click(within(menue).getByRole('menuitem', { name }));
}

/**
 * Den Zuordnungs-Abschnitt aufklappen. Seit LFH-340 · C5 (Befund M40) liegen Tiere, Schäden
 * und UHS-Verortung eingeklappt und laden erst dann — jeder Test, der einen dieser Blöcke
 * greift, muss ihn vorher öffnen. Ohne `forceRender` sind sie vorher gar nicht im Baum.
 */
async function klappeZuordnungenAuf() {
  await screen.findByRole('heading', { name: /Person R-001/ });
  await userEvent.click(screen.getByRole('button', { name: /Zuordnungen/ }));
}

describe('PersonenDetailPage — Kopfleiste', () => {
  /**
   * Die Primärknöpfe IM KOPF — über die Marke des Primitivs eingegrenzt, nicht global
   * gezählt. Global wäre die Aussage falsch: der Verlauf trägt ein Notiz-Formular, dessen
   * Absende-Knopf zu Recht primär ist und mit der Kopfleiste nichts zu tun hat.
   */
  function kopfPrimaeraktionen(): HTMLElement[] {
    const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]');
    if (!kopf) return [];
    return [...kopf.querySelectorAll('button')].filter((b) =>
      [...b.classList].some((k) => k.endsWith('-btn-primary')),
    );
  }

  it('trägt genau eine Primäraktion, und sie hängt am Zustand: ungesichtet → „Sichten"', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const primaer = kopfPrimaeraktionen();
    expect(primaer).toHaveLength(1);
    expect(primaer[0]).toHaveAccessibleName('Sichten');
  });

  it('… und bei einer gesichteten Person ist es „Verbleib erfassen"', async () => {
    const patient = { ...detail, status: 'betroffen', aktuelle_sichtung: 'sk2' } as PersonDetail;
    render(einsatzAktiv, patient);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const primaer = kopfPrimaeraktionen();
    expect(primaer).toHaveLength(1);
    expect(primaer[0]).toHaveAccessibleName('Verbleib erfassen');
  });

  it('bündelt die Statuswechsel im Menü und lässt „Zurück zur Liste" weg', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    // Der Breadcrumb trägt den Rückweg — ein zweiter Knopf daneben ist eine Aktion ohne Anlass.
    expect(screen.queryByRole('button', { name: 'Zurück zur Liste' })).not.toBeInTheDocument();
    /**
     * Die belastbare Negativaussage ist „KEIN direkter Knopf", nicht „kein Eintrag":
     * rc-dropdown mountet sein Portal lazy, ein `queryByRole('menuitem')` vor dem ersten
     * Öffnen ist immer `null` und färbte einen reinen Rollentausch trivial grün.
     */
    expect(screen.queryByRole('button', { name: '→ vermisst' })).not.toBeInTheDocument();
    const menue = await oeffneKopfmenue();
    expect(within(menue).getByRole('menuitem', { name: /vermisst/ })).toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: /Stornieren/ })).toBeInTheDocument();
  });

  /**
   * Der Abstand zwischen „Rot" und dem Rest (LFH-363). `aktionsabstand.guard.test.ts` kann
   * das hier NICHT prüfen: sein Scanner matcht `<Button` mit `danger` im Tag und sieht einen
   * `danger`-MENÜEINTRAG nicht. Die Datei gehört deshalb in keine seiner beiden Listen —
   * geprüft wird stattdessen genau hier, dass das Löschen hinter einem Trenner steht.
   */
  it('trennt „Stornieren" durch einen Menü-Trenner vom Rest', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const menue = await oeffneKopfmenue();
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);
    const eintraege = [...menue.querySelectorAll('[role="menuitem"], .ant-dropdown-menu-item-divider')];
    const trenner = eintraege.findIndex((e) => e.classList.contains('ant-dropdown-menu-item-divider'));
    const storno = eintraege.findIndex((e) => (e.textContent ?? '').includes('Stornieren'));
    expect(trenner).toBeGreaterThan(-1);
    expect(storno).toBeGreaterThan(trenner);
  });

  it('ein umkehrbarer Statuswechsel läuft ohne Rückfrage', async () => {
    let gerufen: { status?: string } = {};
    render(einsatzAktiv, detail, [
      http.post('/api/einsaetze/1/personen/10/status', async ({ request }) => {
        gerufen = (await request.json()) as { status?: string };
        return HttpResponse.json({ ...detail, status: 'vermisst' });
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const menue = await oeffneKopfmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /vermisst/ }));
    await vi.waitFor(() => expect(gerufen.status).toBe('vermisst'));
  });

  it('„verstorben" fragt über einen Dialog zurück, nicht über ein Popconfirm', async () => {
    let gerufen: { status?: string } = {};
    render(einsatzAktiv, detail, [
      http.post('/api/einsaetze/1/personen/10/status', async ({ request }) => {
        gerufen = (await request.json()) as { status?: string };
        return HttpResponse.json({ ...detail, status: 'verstorben' });
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const menue = await oeffneKopfmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /verstorben/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/verstorben/i);
    // Die tragende Hälfte: bis zur Bestätigung ist NICHTS passiert.
    expect(gerufen.status).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Status setzen' }));
    await vi.waitFor(() => expect(gerufen.status).toBe('verstorben'));
  });

  it('ohne Schreibrecht steht weder Primäraktion noch Auslöser', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).not.toBeInTheDocument();
    expect(kopfPrimaeraktionen()).toHaveLength(0);
  });
});

describe('PersonenDetailPage — med. Verlauf', () => {
  it('Re-Sichten ruft erfasseSichtung mit SK II', async () => {
    let gerufen: { kategorie?: string } = {};
    render(einsatzAktiv, detail, [
      http.post('/api/einsaetze/1/personen/10/sichtung', async ({ request }) => {
        gerufen = await request.json() as { kategorie?: string };
        return HttpResponse.json({ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'sk2',
          notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }, { status: 201 });
      }),
    ]);
    // Seit LFH-340 · C5 ist das die PRIMÄRAKTION des Kopfes, und sie heißt bei einer
    // ungesichteten Person „Sichten" — „Re-Sichten" wäre für die erste Sichtung falsch.
    await userEvent.click(await screen.findByRole('button', { name: 'Sichten' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Kategorie/ }));
    await userEvent.click(await screen.findByText('SK II'));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await vi.waitFor(() => expect(gerufen.kategorie).toBe('sk2'));
  });

  it('zeigt bei Sichtung=tot den Hinweis „Status → verstorben"', async () => {
    const totDetail = { ...detail, aktuelle_sichtung: 'tot' as Sichtungskategorie, aktuelle_sichtung_at: '2026-05-27 10:00:00',
      sichtungen: [{ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'tot' as Sichtungskategorie,
        notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }] } as PersonDetail;
    render(einsatzAktiv, totDetail);
    expect(await screen.findByRole('button', { name: /Status → verstorben/ })).toBeInTheDocument();
  });

  it('zeigt die Chronologie-Zeiten taktisch formatiert (LFH-141), nicht als Rohstring', async () => {
    const mitSichtung = {
      ...detail,
      sichtungen: [{ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'sk2' as Sichtungskategorie,
        notiz: 'Befund', gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }],
    } as PersonDetail;
    render(einsatzAktiv, mitSichtung);
    await screen.findByRole('heading', { name: /Person R-001/ });
    // Der Chronologie-Zeitstempel erscheint als taktische DTG (dt. Monatskürzel), nicht roh.
    expect(
      await screen.findByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/),
    ).toBeInTheDocument();
    expect(screen.queryByText('2026-05-27 10:00:00')).not.toBeInTheDocument();
  });
});

describe('PersonenDetailPage — Stammdaten', () => {
  it('rollt nur den Status zurück und bewahrt neuere Listen- und Detailfelder', async () => {
    const mitVerlauf = {
      ...detail,
      notizen: [{
        id: 7, einsatz_id: 1, person_id: 10, text: 'bestehender Verlauf',
        erfasst_at: '2026-05-27 09:30:00', erfasst_von: 1,
      }],
    } as PersonDetail;
    const anderePerson: Person = {
      ...detail,
      id: 11,
      registrier_nr: 2,
      name: 'Andere Person',
    };
    let statusFreigeben!: () => void;
    let refetchFreigeben!: () => void;
    const statusGate = new Promise<void>((resolve) => { statusFreigeben = resolve; });
    const refetchGate = new Promise<void>((resolve) => { refetchFreigeben = resolve; });
    let detailAbrufe = 0;
    const { client } = render(einsatzAktiv, mitVerlauf, [
      http.get('/api/einsaetze/1/personen/10', async () => {
        detailAbrufe += 1;
        if (detailAbrufe > 1) await refetchGate;
        return HttpResponse.json(mitVerlauf);
      }),
      http.post('/api/einsaetze/1/personen/10/status', async () => {
        await statusGate;
        return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 500 });
      }),
    ], true);
    await screen.findByRole('heading', { name: /Person R-001/ });
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), [mitVerlauf, anderePerson]);
    });

    // Statuswechsel liegen seit LFH-340 · C5 im Kopfmenü, nicht als eigener Knopf.
    await ausMenue(/vermisst/);
    await vi.waitFor(() => {
      const optimistisch = client.getQueryData<PersonDetail>(einsatzKeys.person(1, 10));
      expect(optimistisch?.status).toBe('vermisst');
      expect(optimistisch?.notizen).toEqual(mitVerlauf.notizen);
    });

    const neueNotiz = {
      id: 8,
      einsatz_id: 1,
      person_id: 10,
      text: 'während der Mutation eingetroffen',
      erfasst_at: '2026-05-27 09:45:00',
      erfasst_von: 2,
    };
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), (aktuell) =>
        aktuell?.map((eintrag) => eintrag.id === 10
          ? { ...eintrag, name: 'Neuer Listenname' }
          : { ...eintrag, notiz: 'Andere Zeile aktualisiert' }));
      client.setQueryData<PersonDetail>(einsatzKeys.person(1, 10), (aktuell) => aktuell && ({
        ...aktuell,
        name: 'Neuer Detailname',
        notizen: [...aktuell.notizen, neueNotiz],
      }));
    });

    await act(async () => { statusFreigeben(); });
    await vi.waitFor(() => {
      const zurueckgerollt = client.getQueryData<PersonDetail>(einsatzKeys.person(1, 10));
      expect(zurueckgerollt?.status).toBe('erfasst');
      expect(zurueckgerollt?.name).toBe('Neuer Detailname');
      expect(zurueckgerollt?.notizen).toEqual([...mitVerlauf.notizen, neueNotiz]);
    });
    const liste = client.getQueryData<Person[]>(einsatzKeys.personen(1));
    expect(liste?.find((eintrag) => eintrag.id === 10)).toMatchObject({
      status: 'erfasst',
      name: 'Neuer Listenname',
    });
    expect(liste?.find((eintrag) => eintrag.id === 11)?.notiz).toBe('Andere Zeile aktualisiert');
    await act(async () => { refetchFreigeben(); });
  });

  it('überschreibt beim Fehler keinen inzwischen neueren Statusstand', async () => {
    let statusFreigeben!: () => void;
    let refetchFreigeben!: () => void;
    const statusGate = new Promise<void>((resolve) => { statusFreigeben = resolve; });
    const refetchGate = new Promise<void>((resolve) => { refetchFreigeben = resolve; });
    let detailAbrufe = 0;
    const { client } = render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', async () => {
        detailAbrufe += 1;
        if (detailAbrufe > 1) await refetchGate;
        return HttpResponse.json(detail);
      }),
      http.post('/api/einsaetze/1/personen/10/status', async () => {
        await statusGate;
        return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 500 });
      }),
    ], true);
    await screen.findByRole('heading', { name: /Person R-001/ });
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), [detail]);
    });

    // Statuswechsel liegen seit LFH-340 · C5 im Kopfmenü, nicht als eigener Knopf.
    await ausMenue(/vermisst/);
    await vi.waitFor(() => {
      expect(client.getQueryData<PersonDetail>(einsatzKeys.person(1, 10))?.status).toBe('vermisst');
    });
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), (aktuell) =>
        aktuell?.map((eintrag) => ({
          ...eintrag,
          status: 'vermisst',
          name: 'Neuer Listenstand',
          geaendert_at: '2026-05-27 09:15:00',
        })));
      client.setQueryData<PersonDetail>(einsatzKeys.person(1, 10), (aktuell) => aktuell && ({
        ...aktuell,
        status: 'vermisst',
        name: 'Neuer Detailstand',
        geaendert_at: '2026-05-27 09:15:00',
      }));
    });

    await act(async () => { statusFreigeben(); });
    await vi.waitFor(() => {
      expect(client.getQueryData<PersonDetail>(einsatzKeys.person(1, 10))).toMatchObject({
        status: 'vermisst',
        name: 'Neuer Detailstand',
        geaendert_at: '2026-05-27 09:15:00',
      });
    });
    expect(client.getQueryData<Person[]>(einsatzKeys.personen(1))?.[0]).toMatchObject({
      status: 'vermisst',
      name: 'Neuer Listenstand',
      geaendert_at: '2026-05-27 09:15:00',
    });
    await act(async () => { refetchFreigeben(); });
  });

  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, detail);
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
    expect(screen.getByText('Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Brücke')).toBeInTheDocument();
  });

  it('Einsatzleitung kann bearbeiten und speichern', async () => {
    // Robust: kein getByLabelText (antd Form bindet label/htmlFor nicht zuverlässig).
    // Edit-Modus öffnen, das mit initialValues={p} vorbefüllte Formular direkt speichern
    // und den PATCH-Aufruf verifizieren.
    let gesendet = false;
    render(einsatzAktiv, detail, [
      http.patch('/api/einsaetze/1/personen/10', async () => {
        gesendet = true;
        return HttpResponse.json({ ...detail });
      }),
    ]);
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(gesendet).toBe(true));
  });

  it('friert Formularwerte und CAS-Basis gemeinsam ein, auch wenn der Detailstand refetcht', async () => {
    let koerper: Record<string, unknown> | undefined;
    const { client } = render(einsatzAktiv, detail, [
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...detail, name: 'Lokaler Name' });
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(client.getQueryCache().find({ queryKey: einsatzKeys.person(1, 10) })?.options.retry).toBe(false);

    await ausMenue(/Bearbeiten/);
    const name = screen.getByDisplayValue('Mustermann');
    await userEvent.clear(name);
    await userEvent.type(name, 'Lokaler Name');

    act(() => {
      client.setQueryData<PersonDetail>(einsatzKeys.person(1, 10), {
        ...detail,
        name: 'Externer Name',
        geaendert_at: '2026-05-27 09:15:00',
      });
    });
    expect(name).toHaveValue('Lokaler Name');

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(koerper).toBeDefined());
    expect(koerper?.name).toBe('Lokaler Name');
    expect(koerper?.basis_geaendert_at).toBe('2026-05-27 09:00:00');
  });

  it('zeigt bei 409 den Konfliktdialog; „Überschreiben" sendet ohne Baseline (LFH-241/F10)', async () => {
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, detail, [
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        // Erster Save (mit Baseline) → 409; der Overwrite (ohne Baseline) → Erfolg.
        if (koerper.length === 1) {
          return HttpResponse.json({ error: 'Zwischenzeitlich geändert' }, { status: 409 });
        }
        return HttpResponse.json({ ...detail });
      }),
    ]);
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    // Konfliktdialog erscheint statt eines stillen Overwrites.
    await userEvent.click(await screen.findByRole('button', { name: 'Überschreiben' }));
    await vi.waitFor(() => expect(koerper).toHaveLength(2));
    // Erster Request trug den beim Laden gelesenen Stand; der Overwrite bewusst nicht.
    expect(koerper[0].basis_geaendert_at).toBe('2026-05-27 09:00:00');
    expect(koerper[1].basis_geaendert_at).toBeUndefined();
  });

  it('ein zweiter 409 auf den Overwrite zeigt die Servermeldung statt erneut den Dialog (LFH-351)', async () => {
    // Die Personen-Route kennt einen zweiten 409, der kein CAS-Konflikt ist: `fordere_aktiv`
    // („Einsatz ist abgeschlossen und schreibgeschützt") greift VOR der CAS-Prüfung und lässt
    // sich per `overwrite` nicht umgehen. Ohne den `!v.overwrite`-Zweig öffnete jeder
    // Overwrite denselben Dialog erneut — die echte Servermeldung käme nie.
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, detail, [
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ error: 'Einsatz ist abgeschlossen und schreibgeschützt' }, { status: 409 });
      }),
    ]);
    await ausMenue(/Bearbeiten/);
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Überschreiben' }));
    await vi.waitFor(() => expect(koerper).toHaveLength(2));
    // Die Servermeldung belegt den else-Zweig (`fehler`); ein zweiter Dialog wäre das Rennen
    // aus H65, dessen einziger Ausweg „Neu laden" ist.
    expect(await screen.findByText('Einsatz ist abgeschlossen und schreibgeschützt')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Überschreiben' })).toHaveLength(1);
  });

  it('Beobachter sieht keinen Bearbeiten-Button', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('zeigt Stammdaten UND med. Verlauf gleichzeitig (zwei Spalten, ohne Tabs)', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.getByText('Stammdaten')).toBeInTheDocument();
    expect(screen.getByText(/Chronologischer Verlauf/)).toBeInTheDocument();
    // Keine Tab-Leiste mehr:
    expect(screen.queryByRole('tab', { name: 'Medizinischer Verlauf' })).not.toBeInTheDocument();
  });
});

describe('PersonenDetailPage — Abgleich / Tiere / Schäden', () => {
  it('Einsatzleitung kann einen Verdachts-Abgleich bestätigen', async () => {
    const vermissteDetail = {
      ...detail,
      status: 'vermisst' as const,
      abgleiche: [{
        id: 5, einsatz_id: 1, vermisst_person_id: 10, gefunden_person_id: 21,
        status: 'verdacht', erstellt_at: '2026-05-27 10:00:00', erstellt_von: 1,
        entschieden_at: null, entschieden_von: null,
      }],
    } as PersonDetail;
    let entscheidung: string | undefined;
    render(einsatzAktiv, vermissteDetail, [
      http.post('/api/einsaetze/1/personen/10/abgleich/5/entscheidung', async ({ request }) => {
        entscheidung = ((await request.json()) as { entscheidung: string }).entscheidung;
        return HttpResponse.json({ ...vermissteDetail.abgleiche[0], status: 'bestaetigt' });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await vi.waitFor(() => expect(entscheidung).toBe('bestaetigt'));
  });

  it('zeigt den „Zugeordnete Tiere"-Block und verlinkt auf die Tier-Detailseite', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('halter_person_id') === '10') {
          return HttpResponse.json([{
            id: 30, einsatz_id: 1, registrier_nr: 7, status: 'aktiv', spezies: 'hund',
            rasse_beschreibung: null, rufname: 'Rex', geschlecht: null, alter_geschaetzt: null,
            farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
            halter_person_id: 10, halter_kontakt: null, antreff_ort: null, notiz: null,
            abschluss_grund: null, abschluss_ziel: null, erfasst_at: '2026-05-27 09:00:00',
            erfasst_von: 1, geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1,
            storniert_at: null, halter_registrier_nr: 1, halter_storniert_at: null,
          }]);
        }
        return HttpResponse.json([]);
      }),
    ]);
    await klappeZuordnungenAuf();
    expect(await screen.findByText(/Zugeordnete Tiere/i)).toBeInTheDocument();
    expect(await screen.findByText(/T-007/)).toBeInTheDocument();
    expect(screen.getByText(/Rex/)).toBeInTheDocument();
    // Klick auf den Tier-Tag deeplinkt auf die Tier-Detail-Vollseite (LFH-147), nicht mehr auf die Liste.
    await userEvent.click(screen.getByText(/Rex/));
    expect(await screen.findByText('TIERE-DETAIL')).toBeInTheDocument();
  });

  it('zeigt den „Als Geschädigte bei Schäden"-Block im Personen-Drawer', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('geschaedigt_person_id') === '10') {
          return HttpResponse.json([{
            id: 7, einsatz_id: 1, registrier_nr: 3, status: 'offen', typ: 'umweltschaden',
            ausmass: 'mittel', ort: 'Hauptstr. 1', beschreibung: '', geschaedigt_person_id: 10,
            geschaedigt_kontakt: null, uebergeben_an: null, uebergeben_at: null,
            abschluss_grund: null, abschluss_at: null, erfasst_at: '2026-05-29 10:00:00',
            erfasst_von: 1, geaendert_at: '2026-05-29 10:00:00', geaendert_von: 1,
            storniert_at: null, storniert_von: null, geschaedigt_registrier_nr: null,
            geschaedigt_storniert_at: null,
          }]);
        }
        return HttpResponse.json([]);
      }),
    ]);
    await klappeZuordnungenAuf();
    expect(await screen.findByText(/Als Geschädigte bei Schäden/i)).toBeInTheDocument();
    expect(await screen.findByText((t) => t.includes('S-003'))).toBeInTheDocument();
  });
});

describe('PersonenDetailPage — Robustheit', () => {
  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });

  it('zeigt das Patient-Tag bei gesichteter Person (SK I)', async () => {
    const patient = { ...detail, status: 'betroffen', aktuelle_sichtung: 'sk1',
      aktuelle_sichtung_at: '2026-05-27 10:00:00' } as PersonDetail;
    render(einsatzAktiv, patient);
    expect((await screen.findAllByText('Patient')).length).toBeGreaterThan(0);
  });

  it('zeigt KEIN Patient-Tag bei unverletzter Person', async () => {
    const unverletzt = { ...detail, status: 'betroffen', aktuelle_sichtung: 'unverletzt',
      aktuelle_sichtung_at: '2026-05-27 10:00:00' } as PersonDetail;
    render(einsatzAktiv, unverletzt);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByText('Patient')).not.toBeInTheDocument();
  });
});

// LFH-152: Gegenrichtung zum UHS-Grundriss — Person von ihrer Detailseite aus einer
// UHS/einem Platz zuweisen (eintritt/wechsel), austragen (austritt); art spiegelt die
// belegMut-Logik des Grundrisses (aktuelle_uhs_id ? 'wechsel' : 'eintritt').
const uhsListe = [
  { id: 5, einsatz_id: 1, bezeichnung: 'BHP 50', typ: 'behandlungsplatz', status: 'aktiv', abschnitt_id: null, standort: null, notiz: null },
  { id: 6, einsatz_id: 1, bezeichnung: 'PA 1', typ: 'patientenablage', status: 'aktiv', abschnitt_id: null, standort: null, notiz: null },
];

describe('PersonenDetailPage — UHS-Zuweisung (LFH-152)', () => {
  it('zeigt die aktuelle UHS-Verortung im Klartext', async () => {
    const belegt = { ...detail, aktuelle_uhs_id: 5 } as PersonDetail;
    render(einsatzAktiv, belegt, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
    ]);
    await klappeZuordnungenAuf();
    expect(await screen.findByText('BHP 50')).toBeInTheDocument();
  });

  it('weist eine noch nicht verortete Person einer UHS zu (art=eintritt)', async () => {
    let gesendet: { art?: string; uhs_id?: number } = {};
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', async ({ request }) => {
        gesendet = await request.json() as { art?: string; uhs_id?: number };
        return HttpResponse.json({ id: 1, einsatz_id: 1, person_id: 10, uhs_id: 5, platz_id: null,
          art: 'eintritt', notiz: null, zeitpunkt_at: '2026-05-27 10:00:00', erfasst_von: 1 }, { status: 201 });
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'UHS zuweisen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Unfallhilfsstelle/ }));
    await userEvent.click(await screen.findByText('BHP 50'));
    await userEvent.click(screen.getByRole('button', { name: 'Zuweisen' }));
    await vi.waitFor(() => expect(gesendet).toMatchObject({ art: 'eintritt', uhs_id: 5 }));
  });

  it('wechselt die UHS einer bereits verorteten Person (art=wechsel)', async () => {
    let gesendet: { art?: string; uhs_id?: number } = {};
    const belegt = { ...detail, aktuelle_uhs_id: 5 } as PersonDetail;
    render(einsatzAktiv, belegt, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', async ({ request }) => {
        gesendet = await request.json() as { art?: string; uhs_id?: number };
        return HttpResponse.json({ id: 2, einsatz_id: 1, person_id: 10, uhs_id: 6, platz_id: null,
          art: 'wechsel', notiz: null, zeitpunkt_at: '2026-05-27 10:00:00', erfasst_von: 1 }, { status: 201 });
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'UHS ändern' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Unfallhilfsstelle/ }));
    await userEvent.click(await screen.findByText('PA 1'));
    await userEvent.click(screen.getByRole('button', { name: 'Zuweisen' }));
    await vi.waitFor(() => expect(gesendet).toMatchObject({ art: 'wechsel', uhs_id: 6 }));
  });

  it('trägt eine verortete Person aus der UHS aus (art=austritt)', async () => {
    let gesendet: { art?: string } = {};
    const belegt = { ...detail, aktuelle_uhs_id: 5 } as PersonDetail;
    render(einsatzAktiv, belegt, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', async ({ request }) => {
        gesendet = await request.json() as { art?: string };
        return HttpResponse.json({ id: 3, einsatz_id: 1, person_id: 10, uhs_id: 5, platz_id: null,
          art: 'austritt', notiz: null, zeitpunkt_at: '2026-05-27 10:00:00', erfasst_von: 1 }, { status: 201 });
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Austragen' }));
    await vi.waitFor(() => expect(gesendet).toMatchObject({ art: 'austritt' }));
  });

  it('bietet bei gesetztem Verbleib kein Zuweisen an (Grundriss-Konsistenz)', async () => {
    const transportiert = { ...detail, aktueller_verbleib: 'transport' } as PersonDetail;
    render(einsatzAktiv, transportiert, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: 'UHS zuweisen' })).not.toBeInTheDocument();
  });

  it('bietet im UHS-Picker nur aktive UHS an (geplante ausgeschlossen)', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
        ...uhsListe,
        { id: 7, einsatz_id: 1, bezeichnung: 'BHP geplant', typ: 'behandlungsplatz', status: 'geplant', abschnitt_id: null, standort: null, notiz: null },
      ])),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'UHS zuweisen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Unfallhilfsstelle/ }));
    expect(await screen.findByText('BHP 50')).toBeInTheDocument();
    expect(screen.queryByText('BHP geplant')).not.toBeInTheDocument();
  });
});

// LFH-151: Von der Personen-Seite aus Tiere (Halter) / Schäden (Geschädigte) zuweisen + lösen.
// Der Picker bietet nur FREIE Ziele (kein Halter/Geschädigter, nicht storniert/abgeschlossen);
// Zuweisen setzt die FK + leert die konkurrierenden XOR-Slots im selben PATCH (PATCH-XOR).
const freiesTier = {
  id: 40, einsatz_id: 1, registrier_nr: 8, status: 'aktiv', spezies: 'katze',
  rasse_beschreibung: null, rufname: 'Minka', geschlecht: null, alter_geschaetzt: null,
  farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
  halter_person_id: null, halter_kontakt: null, antreff_ort: null, notiz: null,
  erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1, geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1, storniert_at: null, halter_registrier_nr: null, halter_storniert_at: null,
};
const zugeordnetesTier = { ...freiesTier, id: 30, registrier_nr: 7, spezies: 'hund', rufname: 'Rex',
  halter_person_id: 10, halter_registrier_nr: 1 };
const freierSchaden = {
  id: 50, einsatz_id: 1, registrier_nr: 9, status: 'offen', typ: 'sachschaden', ausmass: 'gering',
  ort: 'Weg 2', beschreibung: '', geschaedigt_person_id: null, geschaedigt_personal_id: null,
  geschaedigt_organisation_id: null, geschaedigt_kontakt: null, uebergeben_an: null, uebergeben_at: null,
  abschluss_grund: null, abschluss_at: null, erfasst_at: '2026-05-29 10:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-29 10:00:00', geaendert_von: 1, storniert_at: null, storniert_von: null,
  geschaedigt_registrier_nr: null, geschaedigt_storniert_at: null,
};
const zugeordneterSchaden = { ...freierSchaden, id: 7, registrier_nr: 3, typ: 'umweltschaden',
  ausmass: 'mittel', geschaedigt_person_id: 10 };

describe('PersonenDetailPage — Tiere/Schäden-Zuweisung (LFH-151)', () => {
  it('weist der Person ein freies Tier als Halter zu (XOR-Leerung)', async () => {
    let patch: Record<string, unknown> | null = null;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        // Anzeige-Query (Halter dieser Person) leer; Picker-Query (ohne Param) = freie Kandidaten.
        if (url.searchParams.get('halter_person_id') === '10') return HttpResponse.json([]);
        return HttpResponse.json([freiesTier]);
      }),
      http.patch('/api/einsaetze/1/tiere/40', async ({ request }) => {
        patch = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...freiesTier, halter_person_id: 10 });
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Tier zuweisen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Tier' }));
    await userEvent.click(await screen.findByText(/Minka/));
    await userEvent.click(screen.getByRole('button', { name: 'Zuweisen' }));
    await vi.waitFor(() => expect(patch).toMatchObject({ halter_person_id: 10, halter_kontakt: null }));
  });

  it('löst die Halter-Zuordnung eines zugeordneten Tiers (halter_person_id=null)', async () => {
    let patch: Record<string, unknown> | null = null;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('halter_person_id') === '10') return HttpResponse.json([zugeordnetesTier]);
        return HttpResponse.json([]);
      }),
      http.patch('/api/einsaetze/1/tiere/30', async ({ request }) => {
        patch = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...zugeordnetesTier, halter_person_id: null });
      }),
    ]);
    await klappeZuordnungenAuf();
    await screen.findByText(/T-007/);
    await userEvent.click(await screen.findByRole('button', { name: 'lösen' }));
    await vi.waitFor(() => expect(patch).toMatchObject({ halter_person_id: null }));
  });

  it('weist der Person einen freien Schaden als Geschädigte zu (XOR-Leerung)', async () => {
    let patch: Record<string, unknown> | null = null;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('geschaedigt_person_id') === '10') return HttpResponse.json([]);
        return HttpResponse.json([freierSchaden]);
      }),
      http.patch('/api/einsaetze/1/schaeden/50', async ({ request }) => {
        patch = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...freierSchaden, geschaedigt_person_id: 10 });
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden zuweisen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Schaden' }));
    await userEvent.click(await screen.findByText(/S-009/));
    await userEvent.click(screen.getByRole('button', { name: 'Zuweisen' }));
    await vi.waitFor(() => expect(patch).toMatchObject({
      geschaedigt_person_id: 10, geschaedigt_personal_id: null,
      geschaedigt_organisation_id: null, geschaedigt_kontakt: null,
    }));
  });

  it('löst die Geschädigt-Zuordnung eines Schadens (geschaedigt_person_id=null)', async () => {
    let patch: Record<string, unknown> | null = null;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('geschaedigt_person_id') === '10') return HttpResponse.json([zugeordneterSchaden]);
        return HttpResponse.json([]);
      }),
      http.patch('/api/einsaetze/1/schaeden/7', async ({ request }) => {
        patch = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...zugeordneterSchaden, geschaedigt_person_id: null });
      }),
    ]);
    await klappeZuordnungenAuf();
    await screen.findByText((t) => t.includes('S-003'));
    await userEvent.click(await screen.findByRole('button', { name: 'lösen' }));
    await vi.waitFor(() => expect(patch).toMatchObject({ geschaedigt_person_id: null }));
  });

  it('bietet im Picker nur freie Tiere an (bereits belegte werden ausgeschlossen)', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('halter_person_id') === '10') return HttpResponse.json([]);
        // Picker-Rohliste enthält ein freies UND ein bereits belegtes Tier.
        return HttpResponse.json([freiesTier, { ...zugeordnetesTier, halter_person_id: 99 }]);
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Tier zuweisen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Tier' }));
    expect(await screen.findByText(/Minka/)).toBeInTheDocument();
    expect(screen.queryByText(/Rex/)).not.toBeInTheDocument();
  });

  it('bietet im Schaden-Picker nur freie, nicht-abgeschlossene Schäden an', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('geschaedigt_person_id') === '10') return HttpResponse.json([]);
        return HttpResponse.json([
          freierSchaden, // S-009, frei + offen → im Picker
          { ...freierSchaden, id: 51, registrier_nr: 10, typ: 'brandschaden', geschaedigt_person_id: 99 }, // belegt → raus
          { ...freierSchaden, id: 52, registrier_nr: 11, typ: 'wasserschaden', status: 'abgeschlossen' }, // abgeschlossen → raus
        ]);
      }),
    ]);
    await klappeZuordnungenAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden zuweisen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Schaden' }));
    expect(await screen.findByText(/S-009/)).toBeInTheDocument();
    expect(screen.queryByText(/brandschaden/)).not.toBeInTheDocument();
    expect(screen.queryByText(/wasserschaden/)).not.toBeInTheDocument();
  });
});
