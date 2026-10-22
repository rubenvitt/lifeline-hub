import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import PersonenDetailPage from './PersonenDetailPage';
import type { Person, PersonDetail, Sichtungskategorie } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { erzeugeQueryClient } from '../api/queryClient';
import { benutzerFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import { STATUS_META } from '../personen/personMeta';
import { alsSchadenAuswahl } from '../api/einsatzSchaden';

/** Die Schadenauswahl, wie der Server sie aus den Vollzeilen ableitet (LFH-1075). */
const auswahlAus = (liste: readonly object[]) =>
  liste.map((s) => alsSchadenAuswahl(s as Parameters<typeof alsSchadenAuswahl>[0]));

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): geprüft wird die Einsatz-Rolle; dass die Systemrolle
// fürs Schreiben nicht zählt, deckt schreibrecht.test.ts ab.
const nutzer = benutzerFixture();
const einsatzAktiv = einsatzFixture();
const einsatzBeobachter = einsatzFixture({ meine_rolle: 'beobachter' });

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
  versorgung: 'offen',
  aktuelle_sichtung: null,
  aktuelle_sichtung_at: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
  transporte: [],
  massnahmen: [],
  verletzungen: [],
} as PersonDetail;

/** Aufenthalt im Wartebereich einer UHS, wie der Server ihn im Detail mitliefert (LLH-1129). */
const imWartebereich = (uhs: string, uhsId = 5): PersonDetail['aufenthalt'] => ({
  uhs_id: uhsId,
  uhs_bezeichnung: uhs,
  platz_id: null,
  platz_bezeichnung: null,
  seit: '2026-05-27 09:30:00',
});

/** Der Patientenkopf (LLH-1094): das erste Paneel der Seite. */
const kopf = () => screen.getByRole('region', { name: 'Patientenkopf' });

function render(
  einsatzObj: typeof einsatzAktiv,
  person: PersonDetail,
  extra: Parameters<typeof server.use> = [],
  cacheBehalten = false,
) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personen/transportmittel', () =>
      HttpResponse.json({ im_einsatz: [], bisher: [], stamm: [] }),
    ),
    http.get('/api/einsaetze/1/personen/10/audit', () => HttpResponse.json([])),
  );
  // extra-Handler separat voranstellen, damit sie Vorrang vor den Defaults haben.
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
      <Route path="/einsaetze/:id/tiere/:tierId" element={<div>TIERE-DETAIL</div>} />
    </Routes>,
    { route: '/einsaetze/1/personen/10', client, datenRouter: true },
  );
}

function renderBei(route: string) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personen" element={<div>LISTE</div>} />
      <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
      <Route path="/einsaetze/:id/tiere/:tierId" element={<div>TIERE-DETAIL</div>} />
    </Routes>,
    { route, datenRouter: true },
  );
}

describe('PersonenDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger Personen-ID auf die Personen-Liste um', async () => {
    renderBei('/einsaetze/1/personen/abc');
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('verlinkt den Schadenbezug auf die Schaden-Detailseite (LFH-148)', async () => {
    const schaden = {
      id: 99,
      einsatz_id: 1,
      registrier_nr: 5,
      typ: 'sachschaden',
      ausmass: 'gering',
      status: 'offen',
    };
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([schaden])),
    ]);
    await klappeBezuegeAuf();
    const link = await screen.findByRole('link', { name: /sachschaden/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/schaeden/99');
  });
});

/**
 * Ladehoheit: beim Öffnen laufen nur Einsatz und Detail (Aufenthalt mit UHS- und Platzname
 * kommt mit dem Detail, LLH-1129); Tiere und Schäden laden mit dem Abschnitt „Bezüge“, die
 * Kandidaten und die UHS-Liste erst mit ihrem Dialog, das Zugriffs-Audit mit seinem Abschnitt.
 */
describe('PersonenDetailPage — Ladehoheit', () => {
  /**
   * Pfade der abgesetzten Einsatz-Abfragen, in Reihenfolge, und dieselben mit Suchteil (die
   * Bezüge und die Kandidaten treffen denselben Pfad). `/auth/me` zählt nicht mit.
   */
  function zaehleAbfragen(): { pfade: string[]; adressen: string[]; loesen: () => void } {
    const pfade: string[] = [];
    const adressen: string[] = [];
    const horcher = ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/einsaetze/')) {
        pfade.push(url.pathname);
        adressen.push(url.pathname + url.search);
      }
    };
    server.events.on('request:start', horcher);
    return {
      pfade,
      adressen,
      loesen: () => server.events.removeListener('request:start', horcher),
    };
  }

  it('setzt beim Öffnen höchstens zwei Abfragen ab', async () => {
    const { pfade, loesen } = zaehleAbfragen();
    try {
      render(einsatzAktiv, detail);
      await screen.findByRole('heading', { name: /Person R-001/ });
      // Die Modulfreigaben (Sprung-Sperre „Auf Lagekarte verorten", LFH-888) zählen nicht: sie
      // liegen in der App schon im Cache des Einsatzrahmens; nur dieser nackte Test lädt sie.
      expect(pfade.filter((p) => !p.endsWith('/modul-freigaben'))).toEqual([
        '/api/einsaetze/1',
        '/api/einsaetze/1/personen/10',
      ]);
    } finally {
      loesen();
    }
  });

  /**
   * Spec `personen-detail`, „Ein Abruf beim Öffnen“: der Kopf zeigt UHS, Wartebereich und „seit“
   * aus dem Detail, ohne die UHS-Liste zu laden.
   */
  it('zeigt den Aufenthalt im Kopf ohne weiteren Abruf für UHS- und Platznamen', async () => {
    const { pfade, loesen } = zaehleAbfragen();
    try {
      render(einsatzAktiv, {
        ...detail,
        aktuelle_uhs_id: 5,
        aufenthalt: imWartebereich('Turnhalle'),
      } as PersonDetail);
      await screen.findByRole('heading', { name: /Person R-001/ });
      expect(within(kopf()).getByText(/^Turnhalle · Wartebereich · seit/)).toBeInTheDocument();
      expect(pfade.filter((p) => !p.endsWith('/modul-freigaben'))).toEqual([
        '/api/einsaetze/1',
        '/api/einsaetze/1/personen/10',
      ]);
    } finally {
      loesen();
    }
  });

  /**
   * Die zweite Hälfte: „höchstens zwei" wäre auch grün, wenn die Bezüge gar nicht mehr lüden.
   * Die freien Kandidaten (Tierliste ohne Filter, Schadenauswahl) und die UHS-Liste laden auch
   * dann noch nicht: sie gehören zu ihren Dialogen.
   */
  it('lädt die Bezüge erst beim Aufklappen, die Kandidaten erst mit dem Dialog', async () => {
    const { pfade, adressen, loesen } = zaehleAbfragen();
    try {
      render(einsatzAktiv, detail);
      await screen.findByRole('heading', { name: /Person R-001/ });
      expect(screen.queryByText(/^Bezüge \d/)).not.toBeInTheDocument();

      await klappeBezuegeAuf();
      expect(await screen.findByText('Bezüge 0')).toBeInTheDocument();
      await waitFor(() => {
        expect(adressen).toContain('/api/einsaetze/1/tiere?halter_person_id=10');
        expect(adressen.some((a) => a.startsWith('/api/einsaetze/1/schaeden?'))).toBe(true);
      });
      expect(adressen).not.toContain('/api/einsaetze/1/tiere');
      expect(pfade).not.toContain('/api/einsaetze/1/schaeden/auswahl');
      expect(pfade).not.toContain('/api/einsaetze/1/uhs');

      await userEvent.click(screen.getByRole('button', { name: 'Bezug hinzufügen' }));
      await waitFor(() => {
        expect(adressen).toContain('/api/einsaetze/1/tiere');
        expect(pfade).toContain('/api/einsaetze/1/schaeden/auswahl');
      });
    } finally {
      loesen();
    }
  });

  it('lädt die UHS-Liste erst mit dem Dialog „In UHS aufnehmen“', async () => {
    const { pfade, loesen } = zaehleAbfragen();
    try {
      render(einsatzAktiv, detail);
      await screen.findByRole('heading', { name: /Person R-001/ });
      expect(pfade).not.toContain('/api/einsaetze/1/uhs');
      await userEvent.click(within(kopf()).getByRole('button', { name: 'In UHS aufnehmen' }));
      await waitFor(() => expect(pfade).toContain('/api/einsaetze/1/uhs'));
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
      await waitFor(() => expect(pfade).toContain('/api/einsaetze/1/personen/10/audit'));
    } finally {
      loesen();
    }
  });
});

/** Kopfleiste: genau eine Primäraktion, alles Weitere im Menü. */
/**
 * Das Menü der Kopfleiste öffnen und den Eintragsknoten des geöffneten Portals liefern.
 * `.ant-dropdown:not(.ant-dropdown-hidden)` ist Pflicht: antd lässt die Portale geschlossener
 * Dropdowns im Baum stehen.
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
 * Den Abschnitt „Bezüge“ aufklappen: Tier- und Schadenbezüge liegen eingeklappt und laden erst
 * dann. Ohne `forceRender` sind sie vorher nicht im Baum.
 */
async function klappeBezuegeAuf() {
  await screen.findByRole('heading', { name: /Person R-001/ });
  await userEvent.click(screen.getByRole('button', { name: /Bezüge/ }));
}

describe('PersonenDetailPage — Kopfleiste', () => {
  /**
   * Die Primärknöpfe im Kopf — über die Marke des Primitivs eingegrenzt, nicht global: der
   * Patientenkopf trägt eine Notizzeile, deren Absende-Knopf zu Recht primär ist.
   */
  function kopfPrimaeraktionen(): HTMLElement[] {
    const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]');
    if (!kopf) return [];
    return [...kopf.querySelectorAll('button')].filter((b) =>
      [...b.classList].some((k) => k.endsWith('-btn-primary')),
    );
  }

  /**
   * LLH-1094: Sichten und Verbleib erfassen stehen im Patientenkopf. LLH-1103: die Personendaten
   * werden feldweise geschrieben; „Bearbeiten“ gibt es nicht mehr, der Kopf trägt keine
   * Primäraktion, nur das Menü.
   */
  it.each([
    { fall: 'ungesichtet', person: detail },
    {
      fall: 'gesichtet',
      person: { ...detail, status: 'betroffen', aktuelle_sichtung: 'sk2' } as PersonDetail,
    },
  ])('trägt keine Primäraktion und kein „Bearbeiten“ ($fall)', async ({ person }) => {
    render(einsatzAktiv, person);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(kopfPrimaeraktionen()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Weitere Aktionen zu Person R-001' }),
    ).toBeInTheDocument();
  });

  it('das Menü trägt weder Sichten noch Verbleib noch Bearbeiten — die stehen im Kopf', async () => {
    const patient = { ...detail, status: 'betroffen', aktuelle_sichtung: 'sk2' } as PersonDetail;
    render(einsatzAktiv, patient);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const menue = await oeffneKopfmenue();
    expect(within(menue).queryByText(/Sichten|Verbleib|Bearbeiten/)).not.toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: /Stornieren/ })).toBeInTheDocument();
  });

  it('bündelt die Statuswechsel im Menü und lässt „Zurück zur Liste" weg', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    // Der Breadcrumb trägt den Rückweg — ein zweiter Knopf daneben wäre eine Aktion ohne Anlass.
    expect(screen.queryByRole('button', { name: 'Zurück zur Liste' })).not.toBeInTheDocument();
    /**
     * Die belastbare Negativaussage ist „kein direkter Knopf", nicht „kein Eintrag": rc-dropdown
     * mountet sein Portal lazy, `queryByRole('menuitem')` vor dem ersten Öffnen ist immer `null`.
     */
    expect(screen.queryByRole('button', { name: 'Auf „vermisst“ setzen' })).not.toBeInTheDocument();
    const menue = await oeffneKopfmenue();
    // Mit Verb statt Pfeil (LFH-944).
    expect(
      within(menue).getByRole('menuitem', { name: 'Auf „vermisst“ setzen' }),
    ).toBeInTheDocument();
    expect(within(menue).queryByText(/→/)).not.toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: /Stornieren/ })).toBeInTheDocument();
  });

  /**
   * Der Abstand zwischen „Rot" und dem Rest: `aktionsabstand.guard.test.ts` sieht einen
   * `danger`-Menüeintrag nicht (sein Scanner matcht `<Button` mit `danger`). Geprüft wird hier,
   * dass das Löschen hinter einem Trenner steht.
   */
  it('trennt „Stornieren" durch einen Menü-Trenner vom Rest', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const menue = await oeffneKopfmenue();
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);
    const eintraege = [
      ...menue.querySelectorAll('[role="menuitem"], .ant-dropdown-menu-item-divider'),
    ];
    const trenner = eintraege.findIndex((e) =>
      e.classList.contains('ant-dropdown-menu-item-divider'),
    );
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
    await waitFor(() => expect(gerufen.status).toBe('vermisst'));
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
    // Die tragende Hälfte: bis zur Bestätigung ist nichts passiert.
    expect(gerufen.status).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Status setzen' }));
    await waitFor(() => expect(gerufen.status).toBe('verstorben'));
  });

  it('ohne Schreibrecht steht weder Primäraktion noch Auslöser', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).not.toBeInTheDocument();
    expect(kopfPrimaeraktionen()).toHaveLength(0);
  });
});

describe('PersonenDetailPage — Druckansicht (LLH-1120)', () => {
  it('führt auch ohne Schreibrecht als Nebenweg auf die Druckansicht der Person', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.getByRole('link', { name: 'Druckansicht' })).toHaveAttribute(
      'href',
      '/einsaetze/1/personen/10/druck',
    );
  });
});

describe('PersonenDetailPage — Sichten, Verbleib und Notiz im Patientenkopf (LLH-1094)', () => {
  const sichtungAntwort = (kategorie: Sichtungskategorie) =>
    HttpResponse.json(
      {
        id: 1,
        einsatz_id: 1,
        person_id: 10,
        kategorie,
        notiz: null,
        gesichtet_at: '2026-05-27 10:00:00',
        gesichtet_von: 1,
      },
      { status: 201 },
    );

  it('Sichten: ein Tipp auf die Sichtung klappt die Wahl im Kopf auf, kein Dialog', async () => {
    let gerufen: { kategorie?: string } = {};
    render(einsatzAktiv, detail, [
      http.post('/api/einsaetze/1/personen/10/sichtung', async ({ request }) => {
        gerufen = (await request.json()) as { kategorie?: string };
        return sichtungAntwort('sk2');
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    // Bei einer ungesichteten Person heißt der Auslöser „Sichten“ — „Nachsichten“ wäre für die
    // erste Sichtung falsch.
    const ausloeser = within(kopf()).getByRole('button', { name: 'Sichten, bisher ungesichtet' });
    expect(ausloeser).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(ausloeser);
    expect(ausloeser).toHaveAttribute('aria-expanded', 'true');
    const paneel = within(kopf()).getByRole('region', { name: 'Sichtung erfassen' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(within(paneel).getByRole('radio', { name: /^SK II,/ }));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(gerufen.kategorie).toBe('sk2'));
    // Nach dem Erfolg klappt das Paneel zu.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Sichtung erfassen' })).toBeNull(),
    );
  });

  it('Nachsichten: danach zeigt der Kopf die neue Sichtung mit neuer Zeit', async () => {
    let stand = {
      ...detail,
      status: 'betroffen',
      aktuelle_sichtung: 'sk2',
      aktuelle_sichtung_at: '2026-05-27 09:00:00',
    } as PersonDetail;
    render(einsatzAktiv, stand, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
      http.post('/api/einsaetze/1/personen/10/sichtung', () => {
        stand = { ...stand, aktuelle_sichtung: 'sk1', aktuelle_sichtung_at: '2026-05-27 10:00:00' };
        return sichtungAntwort('sk1');
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const vorher = within(kopf()).getByText(/^gesichtet /).textContent;
    await userEvent.click(
      within(kopf()).getByRole('button', { name: 'Nachsichten, aktuell SK II · schwer' }),
    );
    const paneel = within(kopf()).getByRole('region', { name: 'Sichtung erfassen' });
    await userEvent.click(within(paneel).getByRole('radio', { name: /^SK I,/ }));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Übernehmen' }));
    expect(
      await within(kopf()).findByRole('button', { name: 'Nachsichten, aktuell SK I · akut' }),
    ).toBeInTheDocument();
    expect(within(kopf()).getByText(/^gesichtet /).textContent).not.toBe(vorher);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Verbleib erfassen klappt ein Paneel in der Ansicht auf und schickt den Verbleib', async () => {
    let gesendet: Record<string, unknown> | undefined;
    render(einsatzAktiv, { ...detail, status: 'betroffen' } as PersonDetail, [
      http.post('/api/einsaetze/1/personen/10/verbleib', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(within(kopf()).getByRole('button', { name: 'Verbleib erfassen' }));
    const paneel = within(kopf()).getByRole('region', { name: 'Verbleib erfassen' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(within(paneel).getByRole('combobox', { name: 'Art' }));
    await userEvent.click(await screen.findByTitle('Transport'));
    await userEvent.type(within(paneel).getByRole('textbox', { name: 'Ziel' }), 'KH Mitte');
    await userEvent.type(
      within(paneel).getByRole('combobox', { name: /Rettungsmittel/ }),
      'RTW 3/83-2',
    );
    await userEvent.click(within(paneel).getByRole('button', { name: 'Verbleib erfassen' }));
    await waitFor(() =>
      expect(gesendet).toMatchObject({
        art: 'transport',
        ziel: 'KH Mitte',
        transport_durch: 'fremd',
        transportmittel: 'RTW 3/83-2',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Verbleib erfassen' })).toBeNull(),
    );
  });

  it('Notiz: die Eingabezeile im Kopf legt eine Verlaufsnotiz an', async () => {
    let gesendet: { text?: string } = {};
    render(einsatzAktiv, detail, [
      http.post('/api/einsaetze/1/personen/10/notizen', async ({ request }) => {
        gesendet = (await request.json()) as { text?: string };
        return HttpResponse.json(
          {
            id: 9,
            einsatz_id: 1,
            person_id: 10,
            text: gesendet.text,
            erfasst_at: '2026-05-27 10:00:00',
            erfasst_von: 1,
          },
          { status: 201 },
        );
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const feld = within(kopf()).getByRole('textbox', { name: 'Verlaufsnotiz' });
    // Die Folge steht als Beschreibung an der Zeile, nicht als Überschrift (LFH-1078).
    expect(feld).toHaveAccessibleDescription('nicht änderbar · nicht im ETB');
    await userEvent.type(feld, 'trinkt Wasser');
    await userEvent.click(within(kopf()).getByRole('button', { name: 'Notiz anlegen' }));
    await waitFor(() => expect(gesendet.text).toBe('trinkt Wasser'));
    // Nach dem Erfolg ist die Zeile leer. Neu gesucht: antd ersetzt das Eingabeelement beim
    // Sperren während des Speicherns.
    await waitFor(() =>
      expect(within(kopf()).getByRole('textbox', { name: 'Verlaufsnotiz' })).toHaveValue(''),
    );
  });

  /** Spec `personen-detail`, „Ohne Schreibrecht“: der Kopf zeigt alles, bedient nichts. */
  it('ohne Schreibrecht zeigt der Kopf Sichtung, Zustand, Aufenthalt und Notiz nur lesend', async () => {
    render(einsatzBeobachter, {
      ...detail,
      status: 'betroffen',
      aktuelle_sichtung: 'sk2',
      aktuelle_sichtung_at: '2026-05-27 09:00:00',
      zustand: 'Verdacht auf Hüftfraktur',
      aktuelle_uhs_id: 5,
      aufenthalt: imWartebereich('Turnhalle'),
      notizen: [
        {
          id: 7,
          einsatz_id: 1,
          person_id: 10,
          text: 'trinkt Wasser',
          erfasst_at: '2026-05-27 09:30:00',
          erfasst_von: 1,
        },
      ],
    } as PersonDetail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const k = kopf();
    expect(k).toHaveTextContent('SK II · schwer');
    expect(k).toHaveTextContent('Verdacht auf Hüftfraktur');
    expect(k).toHaveTextContent(/Turnhalle · Wartebereich · seit/);
    expect(k).toHaveTextContent('trinkt Wasser');
    expect(within(k).queryAllByRole('button')).toHaveLength(0);
    expect(within(k).queryByRole('textbox')).toBeNull();
  });

  it('zeigt bei Sichtung=tot den Hinweis mit dem Personenstatus und „Auf „verstorben“ setzen"', async () => {
    const totDetail = {
      ...detail,
      aktuelle_sichtung: 'tot' as Sichtungskategorie,
      aktuelle_sichtung_at: '2026-05-27 10:00:00',
      sichtungen: [
        {
          id: 1,
          einsatz_id: 1,
          person_id: 10,
          kategorie: 'tot' as Sichtungskategorie,
          notiz: null,
          gesichtet_at: '2026-05-27 10:00:00',
          gesichtet_von: 1,
        },
      ],
    } as PersonDetail;
    render(einsatzAktiv, totDetail);
    expect(
      await screen.findByRole('button', { name: 'Auf „verstorben“ setzen' }),
    ).toBeInTheDocument();
    // Fachsprache statt Verwaltungssprache (LFH-944): der Satz nennt den Status, den die Person
    // noch hat, und kein „Admin-Status“.
    expect(
      screen.getByText(`Sichtung „tot“, Status noch „${STATUS_META[totDetail.status].label}“`),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Admin-Status|append-only|SK: /);
    // Die Notiz bleibt daneben schreibbar, jetzt als Zeile im Patientenkopf.
    expect(within(kopf()).getByRole('textbox', { name: 'Verlaufsnotiz' })).toBeInTheDocument();
  });

  it('zeigt die Chronologie-Zeiten taktisch formatiert (LFH-141), nicht als Rohstring', async () => {
    const mitSichtung = {
      ...detail,
      sichtungen: [
        {
          id: 1,
          einsatz_id: 1,
          person_id: 10,
          kategorie: 'sk2' as Sichtungskategorie,
          notiz: 'Befund',
          gesichtet_at: '2026-05-27 10:00:00',
          gesichtet_von: 1,
        },
      ],
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
      notizen: [
        {
          id: 7,
          einsatz_id: 1,
          person_id: 10,
          text: 'bestehender Verlauf',
          erfasst_at: '2026-05-27 09:30:00',
          erfasst_von: 1,
        },
      ],
    } as PersonDetail;
    const anderePerson: Person = {
      ...detail,
      id: 11,
      registrier_nr: 2,
      name: 'Andere Person',
    };
    let statusFreigeben!: () => void;
    let refetchFreigeben!: () => void;
    const statusGate = new Promise<void>((resolve) => {
      statusFreigeben = resolve;
    });
    const refetchGate = new Promise<void>((resolve) => {
      refetchFreigeben = resolve;
    });
    let detailAbrufe = 0;
    const { client } = render(
      einsatzAktiv,
      mitVerlauf,
      [
        http.get('/api/einsaetze/1/personen/10', async () => {
          detailAbrufe += 1;
          if (detailAbrufe > 1) await refetchGate;
          return HttpResponse.json(mitVerlauf);
        }),
        http.post('/api/einsaetze/1/personen/10/status', async () => {
          await statusGate;
          return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 500 });
        }),
      ],
      true,
    );
    await screen.findByRole('heading', { name: /Person R-001/ });
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), [mitVerlauf, anderePerson]);
    });

    // Statuswechsel liegen im Kopfmenü, nicht als eigener Knopf.
    await ausMenue(/vermisst/);
    await waitFor(() => {
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
        aktuell?.map((eintrag) =>
          eintrag.id === 10
            ? { ...eintrag, name: 'Neuer Listenname' }
            : { ...eintrag, notiz: 'Andere Zeile aktualisiert' },
        ),
      );
      client.setQueryData<PersonDetail>(
        einsatzKeys.person(1, 10),
        (aktuell) =>
          aktuell && {
            ...aktuell,
            name: 'Neuer Detailname',
            notizen: [...aktuell.notizen, neueNotiz],
          },
      );
    });

    await act(async () => {
      statusFreigeben();
    });
    await waitFor(() => {
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
    await act(async () => {
      refetchFreigeben();
    });
  });

  it('überschreibt beim Fehler keinen inzwischen neueren Statusstand', async () => {
    let statusFreigeben!: () => void;
    let refetchFreigeben!: () => void;
    const statusGate = new Promise<void>((resolve) => {
      statusFreigeben = resolve;
    });
    const refetchGate = new Promise<void>((resolve) => {
      refetchFreigeben = resolve;
    });
    let detailAbrufe = 0;
    const { client } = render(
      einsatzAktiv,
      detail,
      [
        http.get('/api/einsaetze/1/personen/10', async () => {
          detailAbrufe += 1;
          if (detailAbrufe > 1) await refetchGate;
          return HttpResponse.json(detail);
        }),
        http.post('/api/einsaetze/1/personen/10/status', async () => {
          await statusGate;
          return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 500 });
        }),
      ],
      true,
    );
    await screen.findByRole('heading', { name: /Person R-001/ });
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), [detail]);
    });

    // Statuswechsel liegen im Kopfmenü, nicht als eigener Knopf.
    await ausMenue(/vermisst/);
    await waitFor(() => {
      expect(client.getQueryData<PersonDetail>(einsatzKeys.person(1, 10))?.status).toBe('vermisst');
    });
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), (aktuell) =>
        aktuell?.map((eintrag) => ({
          ...eintrag,
          status: 'vermisst',
          name: 'Neuer Listenstand',
          geaendert_at: '2026-05-27 09:15:00',
        })),
      );
      client.setQueryData<PersonDetail>(
        einsatzKeys.person(1, 10),
        (aktuell) =>
          aktuell && {
            ...aktuell,
            status: 'vermisst',
            name: 'Neuer Detailstand',
            geaendert_at: '2026-05-27 09:15:00',
          },
      );
    });

    await act(async () => {
      statusFreigeben();
    });
    await waitFor(() => {
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
    await act(async () => {
      refetchFreigeben();
    });
  });

  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, detail);
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
    expect(screen.getByText('Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Brücke')).toBeInTheDocument();
  });

  it('Beobachter sieht weder „Bearbeiten“ noch einen schreibbaren Wert', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Name bearbeiten$/ })).not.toBeInTheDocument();
    expect(within(stammdatenRaster()).getByText('Mustermann')).toBeInTheDocument();
  });

  /**
   * Spec `einsatztauglichkeit-layout`, „Das Personen-Detail beginnt mit dem Patientenkopf“: eine
   * Spalte, zuerst der Kopf, dann Verlauf und Personendaten, ohne Reiter. Die Lage in der Breite
   * misst `e2e/betroffene-handy.spec.ts`; hier steht die Folge im Baum.
   */
  it('beginnt mit dem Patientenkopf, darunter Verlauf und Personendaten, ohne Reiter', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const folge = [
      kopf(),
      screen.getByText('Verlauf', { exact: true }),
      screen.getByText('Personendaten', { exact: true }),
      stammdatenRaster(),
    ];
    for (let i = 1; i < folge.length; i += 1) {
      expect(folge[i - 1].compareDocumentPosition(folge[i])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    // Die medizinische Spalte gibt es nicht mehr; ihr Inhalt steht im Kopf und im Verlauf.
    expect(screen.queryByText('Medizinischer Verlauf')).not.toBeInTheDocument();
  });
});

/**
 * Das Datenraster der Personendaten; der Kopf trägt ein eigenes („Patientenangaben“). Es heißt wie
 * sein Abschnitt („Personendaten“), nicht mehr „Stammdaten“.
 */
function stammdatenRaster(): HTMLElement {
  const r = document.querySelector<HTMLElement>('dl[aria-label="Personendaten"]');
  expect(r).not.toBeNull();
  return r!;
}

/**
 * Stammdaten im Datenraster (LFH-963, design.md D8): kein `Descriptions` mehr, nur gesetzte
 * Angaben als Feld, die leeren in EINER Zeile „Ohne Angabe: …". Dass der Patientenkopf in jeder
 * Breite über den Personendaten liegt, misst das e2e-Gate `e2e/betroffene-handy.spec.ts`.
 */
describe('PersonenDetailPage — Stammdaten im Datenraster (LFH-963)', () => {
  const raster = stammdatenRaster;
  function begriffe(): string[] {
    return [...raster().querySelectorAll('dt')].map((dt) => dt.textContent ?? '');
  }

  it('zeigt gesetzte Angaben als Begriff und Wert, ohne Descriptions', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(document.querySelector('.ant-descriptions')).toBeNull();
    const name = within(raster()).getByText('Name');
    expect(name.tagName).toBe('DT');
    expect(name.nextElementSibling).toHaveTextContent('Mustermann');
    // Das Wort der Oberfläche, nie der Wire-Wert „maennlich“.
    expect(within(raster()).getByText('Geschlecht').nextElementSibling).toHaveTextContent(
      /^männlich$/,
    );
    expect(begriffe()).toEqual(
      expect.arrayContaining(['Name', 'Vorname', 'Geschlecht', 'Alter (geschätzt)', 'Fundort']),
    );
  });

  it('sammelt leere Angaben in einer Zeile „Ohne Angabe", statt Striche zu zeigen', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    // „Zustand / Verdacht“ steht im Patientenkopf (LLH-1094), nicht ein zweites Mal hier.
    expect(screen.getByText(/^Ohne Angabe:/)).toHaveTextContent(
      'Ohne Angabe: Geburtsdatum, Herkunft / Adresse, Koordinate, Melder / Kontakt, Notiz',
    );
    for (const leer of ['Geburtsdatum', 'Herkunft / Adresse', 'Koordinate', 'Notiz']) {
      expect(begriffe()).not.toContain(leer);
    }
    expect(within(raster()).queryByText('—')).toBeNull();
  });

  it('führt „Zustand / Verdacht“ im Kopf, nicht in den Stammdaten', async () => {
    render(einsatzAktiv, { ...detail, zustand: 'Verdacht auf Hüftfraktur' } as PersonDetail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(begriffe().some((b) => b.startsWith('Zustand'))).toBe(false);
    expect(within(kopf()).getByText('Zustand / Verdacht')).toBeInTheDocument();
    expect(
      within(kopf()).getByRole('button', { name: 'Zustand / Verdacht zu R-001 bearbeiten' }),
    ).toBeInTheDocument();
  });

  it('ohne Zustand bietet der Kopf „Zustand / Verdacht … hinzufügen“ an', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(
      within(kopf()).getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    ).toBeInTheDocument();
  });

  it('zeigt die Koordinate als Feld, sobald „Auf Lagekarte verorten" angeboten wird', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(begriffe()).toContain('Koordinate');
    expect(
      within(raster()).getByRole('link', { name: 'Auf Lagekarte verorten' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Ohne Angabe:/)).not.toHaveTextContent('Koordinate');
  });

  it('nennt bei einer vermissten Person weder Zustand noch Koordinate', async () => {
    render(einsatzBeobachter, {
      ...detail,
      status: 'vermisst',
      vermisst_seit: null,
    } as PersonDetail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.getByText(/^Ohne Angabe:/)).toHaveTextContent(
      'Ohne Angabe: Geburtsdatum, Herkunft / Adresse, vermisst seit, Melder / Kontakt, Notiz',
    );
  });

  it('lässt die Zeile weg, wenn alles gesetzt ist', async () => {
    render(einsatzAktiv, {
      ...detail,
      geburtsdatum: '1980-01-01',
      herkunft_adresse: 'Hauptstr. 1',
      zustand: 'gehfähig',
      antreff_lat: 52.1,
      antreff_lon: 9.1,
      melder_kontakt: 'Nachbar',
      notiz: 'ruhig',
    } as PersonDetail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByText(/^Ohne Angabe:/)).toBeNull();
    expect(begriffe()).toContain('Notiz');
    expect(begriffe().some((b) => b.startsWith('Zustand'))).toBe(false);
  });
});

describe('PersonenDetailPage — Abgleich / Tiere / Schäden', () => {
  it('Einsatzleitung kann einen Verdachts-Abgleich bestätigen', async () => {
    const vermissteDetail = {
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
    let entscheidung: string | undefined;
    render(einsatzAktiv, vermissteDetail, [
      http.post('/api/einsaetze/1/personen/10/abgleich/5/entscheidung', async ({ request }) => {
        entscheidung = ((await request.json()) as { entscheidung: string }).entscheidung;
        return HttpResponse.json({ ...vermissteDetail.abgleiche[0], status: 'bestaetigt' });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(entscheidung).toBe('bestaetigt'));
  });

  it('zeigt den Tierbezug als Zeile in Einsatzsprache und verlinkt auf die Tier-Detailseite', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('halter_person_id') === '10') {
          return HttpResponse.json([
            {
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
              abschluss_grund: null,
              abschluss_ziel: null,
              erfasst_at: '2026-05-27 09:00:00',
              erfasst_von: 1,
              geaendert_at: '2026-05-27 09:00:00',
              geaendert_von: 1,
              storniert_at: null,
              halter_registrier_nr: 1,
              halter_storniert_at: null,
            },
          ]);
        }
        return HttpResponse.json([]);
      }),
    ]);
    await klappeBezuegeAuf();
    const zeile = await screen.findByRole('link', { name: 'Halter von T-007 · Hund „Rex“' });
    expect(screen.getByText('Bezüge 1')).toBeInTheDocument();
    // Die Zeile deeplinkt auf die Tier-Detail-Vollseite, nicht auf die Liste.
    await userEvent.click(zeile);
    expect(await screen.findByText('TIERE-DETAIL')).toBeInTheDocument();
  });

  it('zeigt den Schadenbezug in derselben Liste wie den Tierbezug', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('geschaedigt_person_id') === '10') {
          return HttpResponse.json([
            {
              id: 7,
              einsatz_id: 1,
              registrier_nr: 3,
              status: 'offen',
              typ: 'umweltschaden',
              ausmass: 'mittel',
              ort: 'Hauptstr. 1',
              beschreibung: '',
              geschaedigt_person_id: 10,
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
              geschaedigt_registrier_nr: null,
              geschaedigt_storniert_at: null,
            },
          ]);
        }
        return HttpResponse.json([]);
      }),
    ]);
    await klappeBezuegeAuf();
    const zeile = await screen.findByRole('link', {
      name: 'Geschädigt bei S-003 · umweltschaden (mittel)',
    });
    expect(zeile).toHaveAttribute('href', '/einsaetze/1/schaeden/7');
    expect(zeile.closest('[data-lfh="bezuege"]')).not.toBeNull();
    expect(screen.getByText('Bezüge 1')).toBeInTheDocument();
    // Die getrennten Blöcke der alten Zuordnungen gibt es nicht mehr.
    expect(screen.queryByText(/Als Geschädigte bei Schäden|Zugeordnete Tiere/)).toBeNull();
  });

  /** Spec `personen-detail`, „Keine Bezüge“. */
  it('ohne Bezüge zeigt der Abschnitt „Bezüge 0“ und mit Schreibrecht „Bezug hinzufügen“', async () => {
    render(einsatzAktiv, detail);
    await klappeBezuegeAuf();
    expect(await screen.findByText('Bezüge 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bezug hinzufügen' })).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="bezug"]')).toBeNull();
  });

  it('ohne Schreibrecht stehen die Bezüge ohne „Bezug hinzufügen“ und „Bezug lösen“', async () => {
    render(einsatzBeobachter, detail, [
      http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([zugeordnetesTier])),
    ]);
    await klappeBezuegeAuf();
    expect(await screen.findByRole('link', { name: /^Halter von T-007/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bezug hinzufügen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bezug zu .* lösen/ })).toBeNull();
  });
});

describe('PersonenDetailPage — Robustheit', () => {
  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });
});

/**
 * Spec `personen-detail`, „Patientenkopf beantwortet die Patientenfragen“: Sichtung mit DTG,
 * „vor n min“ (im Minutentakt) und dem Namen dessen, der bestätigt hat; Aufenthalt oder Verbleib.
 */
describe('PersonenDetailPage — Patientenkopf (LLH-1094)', () => {
  const gesichtet = {
    ...detail,
    status: 'betroffen',
    aktuelle_sichtung: 'sk1',
    aktuelle_sichtung_at: '2026-05-27 10:00:00',
    sichtungen: [
      {
        id: 1,
        einsatz_id: 1,
        person_id: 10,
        kategorie: 'sk1' as Sichtungskategorie,
        notiz: null,
        gesichtet_at: '2026-05-27 10:00:00',
        gesichtet_von: 1,
        bestaetigt_name: 'Dr. Weiß',
      },
    ],
  } as PersonDetail;

  afterEach(() => vi.useRealTimers());

  it('zeigt die Sichtung mit DTG, „vor n min“ und dem Bestätigenden; der Abstand läuft nach', async () => {
    // Nur die Uhr und die Takt-Zeitgeber laufen künstlich, mit der echten Zeit mit: Netz und
    // `findBy*` warten weiter echt.
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    vi.setSystemTime(new Date('2026-05-27T10:05:30Z'));
    render(einsatzAktiv, gesichtet);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const zeit = within(kopf()).getByText(/^gesichtet /);
    expect(zeit).toHaveTextContent(/^gesichtet \d{6} · vor 5 min · bestätigt: Dr\. Weiß$/);
    expect(within(kopf()).getByText('SK I · akut')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(zeit).toHaveTextContent('vor 6 min');
  });

  it('zeigt ungesichtet ohne Zeit und ohne erfundene Angaben', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(within(kopf()).getByText('ungesichtet')).toBeInTheDocument();
    expect(within(kopf()).queryByText(/^gesichtet /)).toBeNull();
    expect(within(kopf()).getByText('ohne Aufenthalt')).toBeInTheDocument();
  });

  it('nennt den Platz, wenn die Person auf einem liegt', async () => {
    render(einsatzAktiv, {
      ...detail,
      aktuelle_uhs_id: 5,
      aktueller_platz_id: 3,
      aufenthalt: { ...imWartebereich('Turnhalle'), platz_id: 3, platz_bezeichnung: 'Liege 3' },
    } as PersonDetail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(within(kopf()).getByText(/^Turnhalle · Liege 3 · seit/)).toBeInTheDocument();
  });

  /** Spec-Szenario „Patient nach dem Abtransport“. */
  it('zeigt nach dem Abtransport statt des Aufenthalts den Verbleib mit Transportmittel und Zeit', async () => {
    render(einsatzAktiv, {
      ...detail,
      status: 'betroffen',
      aktueller_verbleib: 'transport',
      verbleib: [
        {
          id: 3,
          einsatz_id: 1,
          person_id: 10,
          art: 'transport',
          ziel: 'KH Mitte',
          transportmittel: 'RTW 1',
          notiz: null,
          zeitpunkt_at: '2026-05-27 11:00:00',
          erfasst_von: 1,
        },
      ],
    } as unknown as PersonDetail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(within(kopf()).getByText('Verbleib')).toBeInTheDocument();
    expect(within(kopf()).queryByText('Aufenthalt')).toBeNull();
    expect(within(kopf()).getByText(/^Transport → KH Mitte \(RTW 1\) ·/)).toHaveTextContent(
      /· \d{6}$/,
    );
    // Mit Verbleib gibt es kein „In UHS aufnehmen“ (Grundriss-Konsistenz).
    expect(within(kopf()).queryByRole('button', { name: 'In UHS aufnehmen' })).toBeNull();
  });
});

// Gegenrichtung zum UHS-Grundriss: die UHS des Einsatzes für den Dialog im Patientenkopf.
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
  {
    id: 6,
    einsatz_id: 1,
    bezeichnung: 'PA 1',
    typ: 'patientenablage',
    status: 'aktiv',
    abschnitt_id: null,
    standort: null,
    notiz: null,
  },
];

/**
 * Aufenthalt im Patientenkopf (LLH-1129, Option A): „In UHS aufnehmen“ ohne UHS, sonst
 * „Verlegen“ und „Austragen“, ohne Aufklappen. Der Dialog teilt die Belegungslogik des
 * Grundrisses (aktuelle_uhs_id ? 'wechsel' : 'eintritt').
 */
describe('PersonenDetailPage — Aufenthalt im Kopf (LFH-152, LLH-1129)', () => {
  const belegungsAntwort = (art: string, uhsId: number) =>
    HttpResponse.json(
      {
        id: 1,
        einsatz_id: 1,
        person_id: 10,
        uhs_id: uhsId,
        platz_id: null,
        art,
        notiz: null,
        zeitpunkt_at: '2026-05-27 10:00:00',
        erfasst_von: 1,
      },
      { status: 201 },
    );
  const belegt = {
    ...detail,
    aktuelle_uhs_id: 5,
    aufenthalt: imWartebereich('BHP 50'),
  } as PersonDetail;

  it('nimmt eine noch nicht verortete Person in eine UHS auf (art=eintritt)', async () => {
    let gesendet: { art?: string; uhs_id?: number } = {};
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', async ({ request }) => {
        gesendet = (await request.json()) as { art?: string; uhs_id?: number };
        return belegungsAntwort('eintritt', 5);
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(within(kopf()).queryByRole('button', { name: 'Verlegen' })).toBeNull();
    expect(within(kopf()).queryByRole('button', { name: 'Austragen' })).toBeNull();
    await userEvent.click(within(kopf()).getByRole('button', { name: 'In UHS aufnehmen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('In UHS aufnehmen')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Unfallhilfsstelle/ }));
    await userEvent.click(await screen.findByText('BHP 50'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aufnehmen' }));
    await waitFor(() => expect(gesendet).toMatchObject({ art: 'eintritt', uhs_id: 5 }));
  });

  /** Spec-Szenario „Verlegen aus dem Kopf“. */
  it('verlegt eine verortete Person (art=wechsel), der Kopf zeigt danach die neue UHS', async () => {
    let gesendet: { art?: string; uhs_id?: number } = {};
    let stand = belegt;
    render(einsatzAktiv, belegt, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', async ({ request }) => {
        gesendet = (await request.json()) as { art?: string; uhs_id?: number };
        stand = { ...belegt, aktuelle_uhs_id: 6, aufenthalt: imWartebereich('PA 1', 6) };
        return belegungsAntwort('wechsel', 6);
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(within(kopf()).getByText(/^BHP 50 · Wartebereich · seit/)).toBeInTheDocument();
    expect(within(kopf()).queryByRole('button', { name: 'In UHS aufnehmen' })).toBeNull();
    await userEvent.click(within(kopf()).getByRole('button', { name: 'Verlegen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Unfallhilfsstelle/ }));
    await userEvent.click(await screen.findByText('PA 1'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verlegen' }));
    await waitFor(() => expect(gesendet).toMatchObject({ art: 'wechsel', uhs_id: 6 }));
    expect(await within(kopf()).findByText(/^PA 1 · Wartebereich · seit/)).toBeInTheDocument();
  });

  it('trägt eine verortete Person aus der UHS aus (art=austritt), ohne Aufklappen', async () => {
    let gesendet: { art?: string } = {};
    render(einsatzAktiv, belegt, [
      http.post('/api/einsaetze/1/personen/10/uhs-belegung', async ({ request }) => {
        gesendet = (await request.json()) as { art?: string };
        return belegungsAntwort('austritt', 5);
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(within(kopf()).getByRole('button', { name: 'Austragen' }));
    await waitFor(() => expect(gesendet).toMatchObject({ art: 'austritt' }));
  });

  it('bietet bei gesetztem Verbleib kein Aufnehmen an (Grundriss-Konsistenz)', async () => {
    const transportiert = { ...detail, aktueller_verbleib: 'transport' } as PersonDetail;
    render(einsatzAktiv, transportiert, [
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json(uhsListe)),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: 'In UHS aufnehmen' })).not.toBeInTheDocument();
  });

  it('ohne Schreibrecht steht der Aufenthalt ohne „Verlegen“ und „Austragen“', async () => {
    render(einsatzBeobachter, belegt);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(within(kopf()).getByText(/^BHP 50 · Wartebereich · seit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verlegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Austragen' })).toBeNull();
  });

  it('bietet im UHS-Picker nur aktive UHS an (geplante ausgeschlossen)', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/uhs', () =>
        HttpResponse.json([
          ...uhsListe,
          {
            id: 7,
            einsatz_id: 1,
            bezeichnung: 'BHP geplant',
            typ: 'behandlungsplatz',
            status: 'geplant',
            abschnitt_id: null,
            standort: null,
            notiz: null,
          },
        ]),
      ),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(within(kopf()).getByRole('button', { name: 'In UHS aufnehmen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Unfallhilfsstelle/ }));
    expect(await screen.findByText('BHP 50')).toBeInTheDocument();
    expect(screen.queryByText('BHP geplant')).not.toBeInTheDocument();
  });
});

// Von der Personen-Seite aus Tiere (Halter) / Schäden (Geschädigte) als Bezug hinzufügen und lösen.
// Die Suche bietet nur freie Ziele; Hinzufügen setzt die FK und leert die konkurrierenden XOR-Slots
// im selben PATCH.
const freiesTier = {
  id: 40,
  einsatz_id: 1,
  registrier_nr: 8,
  status: 'aktiv',
  spezies: 'katze',
  rasse_beschreibung: null,
  rufname: 'Minka',
  geschlecht: null,
  alter_geschaetzt: null,
  farbe_beschreibung: null,
  kennzeichnung: null,
  groesse_gewicht: null,
  halter_person_id: null,
  halter_kontakt: null,
  antreff_ort: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  halter_registrier_nr: null,
  halter_storniert_at: null,
};
const zugeordnetesTier = {
  ...freiesTier,
  id: 30,
  registrier_nr: 7,
  spezies: 'hund',
  rufname: 'Rex',
  halter_person_id: 10,
  halter_registrier_nr: 1,
};
const freierSchaden = {
  id: 50,
  einsatz_id: 1,
  registrier_nr: 9,
  status: 'offen',
  typ: 'sachschaden',
  ausmass: 'gering',
  ort: 'Weg 2',
  beschreibung: '',
  geschaedigt_person_id: null,
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
  geschaedigt_registrier_nr: null,
  geschaedigt_storniert_at: null,
};
const zugeordneterSchaden = {
  ...freierSchaden,
  id: 7,
  registrier_nr: 3,
  typ: 'umweltschaden',
  ausmass: 'mittel',
  geschaedigt_person_id: 10,
};

describe('PersonenDetailPage — Bezüge hinzufügen und lösen (LFH-151, LLH-1129)', () => {
  /** „Bezug hinzufügen“ öffnen und die gemeinsame Auswahl über Tiere und Schäden aufklappen. */
  async function oeffneSuche(): Promise<HTMLElement> {
    await klappeBezuegeAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Bezug hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Bezug hinzufügen')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Tier oder Schaden' }));
    return dialog;
  }

  /** Spec-Szenario „Tier als Bezug hinzufügen“: ein Knopf, eine Suche, eine Wahl. */
  it('fügt ein freies Tier als Bezug hinzu (XOR-Leerung), die Zeile steht danach in den Bezügen', async () => {
    let patch: Record<string, unknown> | null = null;
    let halterVon: object[] = [];
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        // Bezüge (Halter dieser Person) und Kandidaten (ohne Filter) treffen denselben Pfad.
        if (url.searchParams.get('halter_person_id') === '10') return HttpResponse.json(halterVon);
        return HttpResponse.json([freiesTier]);
      }),
      http.patch('/api/einsaetze/1/tiere/40', async ({ request }) => {
        patch = (await request.json()) as Record<string, unknown>;
        halterVon = [{ ...freiesTier, halter_person_id: 10 }];
        return HttpResponse.json({ ...freiesTier, halter_person_id: 10 });
      }),
    ]);
    const dialog = await oeffneSuche();
    await userEvent.type(
      within(dialog).getByRole('combobox', { name: 'Tier oder Schaden' }),
      'Minka',
    );
    await userEvent.click(await screen.findByTitle(/Minka/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() =>
      expect(patch).toMatchObject({ halter_person_id: 10, halter_kontakt: null }),
    );
    expect(
      await screen.findByRole('link', { name: 'Halter von T-008 · Katze „Minka“' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Bezüge 1')).toBeInTheDocument();
  });

  it('löst den Halter-Bezug eines Tiers (halter_person_id=null)', async () => {
    let patch: Record<string, unknown> | null = null;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('halter_person_id') === '10')
          return HttpResponse.json([zugeordnetesTier]);
        return HttpResponse.json([]);
      }),
      http.patch('/api/einsaetze/1/tiere/30', async ({ request }) => {
        patch = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...zugeordnetesTier, halter_person_id: null });
      }),
    ]);
    await klappeBezuegeAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Bezug zu T-007 lösen' }));
    await waitFor(() => expect(patch).toMatchObject({ halter_person_id: null }));
  });

  it('fügt einen freien Schaden als Bezug hinzu (XOR-Leerung)', async () => {
    let patch: Record<string, unknown> | null = null;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden/auswahl', () =>
        HttpResponse.json(auswahlAus([freierSchaden])),
      ),
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('geschaedigt_person_id') === '10') return HttpResponse.json([]);
        return HttpResponse.json([freierSchaden]);
      }),
      http.patch('/api/einsaetze/1/schaeden/50', async ({ request }) => {
        patch = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...freierSchaden, geschaedigt_person_id: 10 });
      }),
    ]);
    const dialog = await oeffneSuche();
    await userEvent.click(await screen.findByTitle(/S-009/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() =>
      expect(patch).toMatchObject({
        geschaedigt_person_id: 10,
        geschaedigt_personal_id: null,
        geschaedigt_organisation_id: null,
        geschaedigt_kontakt: null,
      }),
    );
  });

  it('löst den Geschädigt-Bezug eines Schadens (geschaedigt_person_id=null)', async () => {
    let patch: Record<string, unknown> | null = null;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/schaeden', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('geschaedigt_person_id') === '10')
          return HttpResponse.json([zugeordneterSchaden]);
        return HttpResponse.json([]);
      }),
      http.patch('/api/einsaetze/1/schaeden/7', async ({ request }) => {
        patch = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...zugeordneterSchaden, geschaedigt_person_id: null });
      }),
    ]);
    await klappeBezuegeAuf();
    await userEvent.click(await screen.findByRole('button', { name: 'Bezug zu S-003 lösen' }));
    await waitFor(() => expect(patch).toMatchObject({ geschaedigt_person_id: null }));
  });

  it('gruppiert die Kandidaten nach „Tiere (als Halter)“ und „Schäden (als Geschädigte)“', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('halter_person_id') ? [] : [freiesTier],
        ),
      ),
      http.get('/api/einsaetze/1/schaeden/auswahl', () =>
        HttpResponse.json(auswahlAus([freierSchaden])),
      ),
    ]);
    await oeffneSuche();
    expect(await screen.findByText('Tiere (als Halter)')).toBeInTheDocument();
    expect(screen.getByText('Schäden (als Geschädigte)')).toBeInTheDocument();
    expect(screen.getByTitle(/Minka/)).toBeInTheDocument();
    expect(screen.getByTitle(/S-009/)).toBeInTheDocument();
  });

  it('bietet in der Suche nur freie Tiere an (bereits belegte werden ausgeschlossen)', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('halter_person_id') === '10') return HttpResponse.json([]);
        // Die Kandidaten-Rohliste enthält ein freies UND ein bereits belegtes Tier.
        return HttpResponse.json([freiesTier, { ...zugeordnetesTier, halter_person_id: 99 }]);
      }),
    ]);
    await oeffneSuche();
    expect(await screen.findByTitle(/Minka/)).toBeInTheDocument();
    expect(screen.queryByText(/Rex/)).not.toBeInTheDocument();
  });

  it('bietet in der Suche nur freie, nicht-abgeschlossene Schäden an', async () => {
    render(einsatzAktiv, detail, [
      // Die Suche liest die Schadenauswahl (LFH-1075).
      http.get('/api/einsaetze/1/schaeden/auswahl', () => {
        return HttpResponse.json(
          auswahlAus([
            freierSchaden, // S-009, frei + offen → in der Suche
            {
              ...freierSchaden,
              id: 51,
              registrier_nr: 10,
              typ: 'brandschaden',
              geschaedigt_person_id: 99,
            }, // belegt → raus
            {
              ...freierSchaden,
              id: 52,
              registrier_nr: 11,
              typ: 'wasserschaden',
              status: 'abgeschlossen',
            }, // abgeschlossen → raus
          ]),
        );
      }),
    ]);
    await oeffneSuche();
    expect(await screen.findByTitle(/S-009/)).toBeInTheDocument();
    expect(screen.queryByText(/brandschaden/)).not.toBeInTheDocument();
    expect(screen.queryByText(/wasserschaden/)).not.toBeInTheDocument();
  });
});

describe('PersonenDetailPage — Zustand, Koordinate, vermisst seit (LFH-613)', () => {
  const mitKoordinate = {
    ...detail,
    zustand: 'gehfähig',
    // Mehr Stellen als das Textfeld zeigt — so wie ein Kartenklick sie setzt.
    antreff_lat: 52.269149,
    antreff_lon: 9.134251,
  } as PersonDetail;

  it('zeigt Zustand und Koordinate im Lesemodus; der Verorten-Link trägt den Platzier-Auftrag', async () => {
    render(einsatzAktiv, mitKoordinate);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.getByText('gehfähig')).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="koordinate"]')).toHaveTextContent('52.2691/9.1343');
    const link = screen.getByRole('link', { name: 'Auf Lagekarte verorten' });
    const ziel = new URL(link.getAttribute('href')!, 'http://x');
    expect(ziel.pathname).toBe('/einsaetze/1/lagekarte');
    expect(ziel.searchParams.get('platzieren')).toBe('person:10');
    // Mit Herkunft: die Karte bietet danach „Zurück zu R-001“ an (LLH-1125).
    expect(ziel.searchParams.get('zurueck')).toBe('1');
    // Nicht vermisst → keine Zeile „vermisst seit".
    expect(screen.queryByText('vermisst seit')).not.toBeInTheDocument();
  });

  it('gesperrte Lagekarte: „Auf Lagekarte verorten" steht gesperrt mit Grund (LFH-888)', async () => {
    render(einsatzAktiv, mitKoordinate, [
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ lagekarte: { zugriff: false } })),
      ),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const knopf = await screen.findByRole('button', { name: 'Auf Lagekarte verorten' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
    expect(screen.queryByRole('link', { name: 'Auf Lagekarte verorten' })).toBeNull();
  });

  it('zeigt Beobachtern keinen Verorten-Link', async () => {
    render(einsatzBeobachter, mitKoordinate);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.getByText('52.2691/9.1343')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Auf Lagekarte verorten' })).toBeNull();
  });

  it('vermisst: keine Koordinate, kein Verorten — ein Fundort gibt es nicht', async () => {
    const vermisst = { ...detail, status: 'vermisst' } as PersonDetail;
    render(einsatzAktiv, vermisst);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('link', { name: 'Auf Lagekarte verorten' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Koordinate / })).toBeNull();
    // Gegenaussage: „vermisst seit“ ist schreibbar.
    expect(screen.getByRole('button', { name: 'vermisst seit eintragen' })).toBeInTheDocument();
  });
});

/**
 * Personendaten feldweise in der Ansicht (LLH-1103, Spec `personendaten-bearbeiten`; Change
 * `f8218h1i-personendaten-feldweise`, design.md D1–D10). Ein PATCH je Feld mit nur diesem Feld und
 * seinem Wert beim Öffnen (`erwartet`), Rückfrage bei 409, Prüfung am Feld, Rückfrage beim
 * Verlassen, Sperre ohne Netz.
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - `onOeffnen` hält den Altwert nicht fest (Altwert aus dem jeweils aktuellen Stand): rot in
 *   „der Altwert ist der Stand beim Öffnen“.
 * - Rückfrage ohne Vergleich mit dem Stand beim Öffnen (jeder 409 fragt): rot in „ein 409 ohne
 *   Feldänderung steht am Feld“.
 * - `pruefe` am Alter entfernt: rot in „Alter über 120“.
 * - Sperre ohne Netz entfernt: rot in „ohne Netz alles gesperrt“.
 * - Provider des Merkers entfernt: rot in „Rückfrage beim Verlassen“.
 */
describe('PersonenDetailPage — Personendaten feldweise (LLH-1103)', () => {
  /**
   * Ein PATCH-Mitschnitt mit Serverstand: der PATCH antwortet mit dem Stand nach der Änderung
   * (ohne `erwartet`), der Detail-GET danach ebenso.
   */
  function patchMitschnitt(person: PersonDetail = detail) {
    const koerper: Array<Record<string, unknown>> = [];
    let stand: PersonDetail = person;
    const handler = [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        const k = (await request.json()) as Record<string, unknown>;
        koerper.push(k);
        const aenderung = { ...k };
        delete aenderung.erwartet;
        stand = { ...stand, ...aenderung } as PersonDetail;
        return HttpResponse.json(stand);
      }),
    ];
    return { koerper, handler };
  }
  const ohneAngabe = () => document.querySelector<HTMLElement>('[data-lfh="ohne-angabe"]')!;

  it('Name ergänzen: „+ Name“, ein PATCH mit nur `name`, Meldung „Name gespeichert“', async () => {
    const ohneName = { ...detail, name: null } as PersonDetail;
    const { koerper, handler } = patchMitschnitt(ohneName);
    render(einsatzAktiv, ohneName, handler);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();

    const plus = within(ohneAngabe()).getByRole('button', { name: 'Name eintragen' });
    expect(plus).toHaveTextContent('+ Name');
    await user.click(plus);
    const feld = within(ohneAngabe()).getByRole('textbox', { name: 'Name' });
    expect(feld).toHaveFocus();
    await user.type(feld, 'Müller');
    await user.click(screen.getByRole('button', { name: 'Name speichern' }));

    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0]).toEqual({ name: 'Müller', erwartet: { name: null } });
    expect(await screen.findByText('Name gespeichert')).toBeInTheDocument();
    expect(within(stammdatenRaster()).getByText('Müller')).toBeInTheDocument();
    // Der Fokus folgt der Angabe ins Raster, statt auf <body> zu fallen.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toHaveFocus(),
    );
  });

  it('Herkunft / Adresse ist reiner Text: keine Ortssuche, nichts an den Geocoder (LLH-1108)', async () => {
    const { koerper, handler } = patchMitschnitt();
    const anfragen: string[] = [];
    const merken = ({ request }: { request: Request }) => anfragen.push(request.url);
    server.events.on('request:start', merken);
    try {
      render(einsatzAktiv, detail, handler);
      await screen.findByRole('heading', { name: /Person R-001/ });
      const user = userEvent.setup();
      await user.click(
        within(ohneAngabe()).getByRole('button', { name: 'Herkunft / Adresse eintragen' }),
      );
      const feld = within(ohneAngabe()).getByRole('textbox', { name: 'Herkunft / Adresse' });
      expect(screen.queryByRole('button', { name: 'Ort suchen' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Auf Karte wählen' })).not.toBeInTheDocument();
      await user.type(feld, 'Hauptstraße 12, Musterstadt{Enter}');
      await waitFor(() => expect(koerper).toHaveLength(1));
      expect(koerper[0]).toEqual({
        herkunft_adresse: 'Hauptstraße 12, Musterstadt',
        erwartet: { herkunft_adresse: null },
      });
      expect(anfragen.filter((u) => /ort-suche|ort-vorschau/.test(u))).toEqual([]);
    } finally {
      server.events.removeListener('request:start', merken);
    }
  });

  it('Vorname ändern: nur `vorname` mit Altwert, die übrigen Felder bleiben unberührt', async () => {
    const { koerper, handler } = patchMitschnitt();
    render(einsatzAktiv, detail, handler);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Vorname bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Vorname' });
    await user.clear(feld);
    await user.type(feld, 'Moritz{Enter}');
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0]).toEqual({ vorname: 'Moritz', erwartet: { vorname: 'Max' } });
    expect(await screen.findByText('Vorname gespeichert')).toBeInTheDocument();
  });

  it('der Altwert ist der Stand beim Öffnen, auch wenn das Detail inzwischen neu kam', async () => {
    const { koerper, handler } = patchMitschnitt();
    const { client } = render(einsatzAktiv, detail, handler);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(feld);
    await user.type(feld, 'Lokal');
    act(() => {
      client.setQueryData<PersonDetail>(einsatzKeys.person(1, 10), {
        ...detail,
        name: 'Extern',
        vorname: 'Moritz',
      });
    });
    // Erst wenn der neue Stand angekommen ist, belegt der Fall etwas (der Query-Cache meldet
    // asynchron). Mutationsprobe: `ausgang` je Render aus `person` statt beim Öffnen — rot.
    expect(await screen.findByText('Moritz')).toBeInTheDocument();
    expect(feld).toHaveValue('Lokal');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0]).toEqual({ name: 'Lokal', erwartet: { name: 'Mustermann' } });
  });

  it('409: Rückfrage mit dem aktuellen Wert; „Überschreiben“ sendet ohne Altwert', async () => {
    const koerper: Array<Record<string, unknown>> = [];
    let stand: PersonDetail = detail;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        if (koerper.length === 1) {
          // B hat inzwischen „Meier“ gespeichert.
          stand = { ...detail, name: 'Meier' };
          return HttpResponse.json(
            { error: 'Das Feld wurde zwischenzeitlich geändert. Bitte neu laden.' },
            { status: 409 },
          );
        }
        return HttpResponse.json({ ...detail, name: 'Müller' });
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Müller{Enter}');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Zwischenzeitlich geändert');
    expect(dialog).toHaveTextContent('„Meier“');
    await user.click(within(dialog).getByRole('button', { name: 'Überschreiben' }));
    await waitFor(() => expect(koerper).toHaveLength(2));
    expect(koerper[0]).toEqual({ name: 'Müller', erwartet: { name: 'Mustermann' } });
    expect(koerper[1]).toEqual({ name: 'Müller' });
    expect(await screen.findByText('Name gespeichert')).toBeInTheDocument();
  });

  /**
   * B schreibt dazwischen (Spec `personendaten-bearbeiten`, „Eine offene Bearbeitung zur Zeit“):
   * ein offenes Feld bleibt an seinem Ort und mit seinem Entwurf, bis es gespeichert oder
   * abgebrochen ist, auch wenn der neue Stand es zwischen Zeile „Ohne Angabe“ und Raster
   * verschöbe. Mutationsprobe: Einordnung nach dem neuen Stand statt dem beim Öffnen — das Feld
   * hängt aus, der Entwurf ist still weg und der Merker meldet ab, rot.
   */
  it('ein offenes „+ Name“ bleibt mit Entwurf stehen, wenn ein neuer Stand einen Namen bringt', async () => {
    const ohneName = { ...detail, name: null } as PersonDetail;
    const { client } = render(einsatzAktiv, ohneName);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(within(ohneAngabe()).getByRole('button', { name: 'Name eintragen' }));
    await user.type(within(ohneAngabe()).getByRole('textbox', { name: 'Name' }), 'Mül');
    act(() => {
      client.setQueryData<PersonDetail>(einsatzKeys.person(1, 10), {
        ...ohneName,
        name: 'Meier',
        vorname: 'Moritz',
      });
    });
    // Der neue Stand ist angekommen (der Query-Cache meldet asynchron).
    expect(await within(stammdatenRaster()).findByText('Moritz')).toBeInTheDocument();
    const feld = within(ohneAngabe()).getByRole('textbox', { name: 'Name' });
    expect(feld).toHaveValue('Mül');
    expect(feld).toHaveFocus();
    // Der Merker hält weiter: die übrigen Felder bleiben gesperrt.
    expect(screen.getByText('Erst „Name“ speichern oder abbrechen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeDisabled();

    // Abgebrochen steht die Angabe dort, wo der neue Stand sie hinstellt.
    await user.click(screen.getByRole('button', { name: 'Bearbeitung von Name abbrechen' }));
    expect(within(stammdatenRaster()).getByText('Meier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeEnabled();
  });

  it('ein offener gesetzter Name bleibt mit Entwurf im Raster, wenn ein neuer Stand ihn leert', async () => {
    const { client } = render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x');
    act(() => {
      client.setQueryData<PersonDetail>(einsatzKeys.person(1, 10), {
        ...detail,
        name: null,
        vorname: 'Moritz',
      });
    });
    expect(await within(stammdatenRaster()).findByText('Moritz')).toBeInTheDocument();
    const feld = within(stammdatenRaster()).getByRole('textbox', { name: 'Name' });
    expect(feld).toHaveValue('Mustermannx');
    expect(feld).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Bearbeitung von Name abbrechen' }));
    expect(within(ohneAngabe()).getByRole('button', { name: 'Name eintragen' })).toBeEnabled();
  });

  /**
   * D2 mit Verschiebung: der 409 lädt den neuen Stand, in dem „Name“ nicht mehr leer ist. Während
   * der Rückfrage bleibt das Feld eingehängt (und die übrigen gesperrt); scheitert
   * „Überschreiben“, steht der Grund am Feld. Mutationsprobe: Einordnung nach dem neuen Stand —
   * das Feld hängt beim Neuladen aus, der zweite Fehler steht nirgends, rot.
   */
  it('409 mit Verschiebung: das Feld bleibt während der Rückfrage, ein gescheitertes Überschreiben steht am Feld', async () => {
    const ohneName = { ...detail, name: null } as PersonDetail;
    const koerper: Array<Record<string, unknown>> = [];
    let stand: PersonDetail = ohneName;
    render(einsatzAktiv, ohneName, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        if (koerper.length === 1) {
          // B hat inzwischen „Meier“ gespeichert.
          stand = { ...ohneName, name: 'Meier' };
          return HttpResponse.json(
            { error: 'Das Feld wurde zwischenzeitlich geändert. Bitte neu laden.' },
            { status: 409 },
          );
        }
        return HttpResponse.json(
          { error: 'Einsatz ist abgeschlossen und schreibgeschützt' },
          { status: 409 },
        );
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(within(ohneAngabe()).getByRole('button', { name: 'Name eintragen' }));
    await user.type(within(ohneAngabe()).getByRole('textbox', { name: 'Name' }), 'Müller{Enter}');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('„Meier“');
    expect(within(ohneAngabe()).getByRole('textbox', { name: 'Name' })).toHaveValue('Müller');
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Überschreiben' }));
    expect(
      await within(ohneAngabe()).findByText('Einsatz ist abgeschlossen und schreibgeschützt'),
    ).toBeInTheDocument();
    expect(within(ohneAngabe()).getByRole('textbox', { name: 'Name' })).toHaveValue('Müller');
    expect(koerper).toEqual([{ name: 'Müller', erwartet: { name: null } }, { name: 'Müller' }]);
    expect(screen.queryByText('Name gespeichert')).toBeNull();
  });

  /**
   * Escape (oder Schließen) der Rückfrage entscheidet nichts: weder überschreiben noch verwerfen,
   * das Feld bleibt mit dem Entwurf offen. Mutationsprobe: Escape wieder als „Verwerfen“ — das
   * Feld schließt und der Entwurf ist weg, rot.
   */
  it('409: Escape schließt die Rückfrage, das Feld bleibt mit dem Entwurf offen', async () => {
    const koerper: Array<Record<string, unknown>> = [];
    let stand: PersonDetail = detail;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        stand = { ...detail, name: 'Meier' };
        return HttpResponse.json({ error: 'geändert' }, { status: 409 });
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Müller{Enter}');
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Name speichern' })).not.toHaveClass(
        'ant-btn-loading',
      ),
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Müller');
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeDisabled();
    expect(koerper).toHaveLength(1);
    expect(screen.queryByText('Name gespeichert')).toBeNull();
  });

  it('409: „Verwerfen und neu laden“ schließt das Feld und zeigt den neuen Stand', async () => {
    const koerper: Array<Record<string, unknown>> = [];
    let stand: PersonDetail = detail;
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        stand = { ...detail, name: 'Meier' };
        return HttpResponse.json({ error: 'geändert' }, { status: 409 });
      }),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x{Enter}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Verwerfen und neu laden' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull());
    expect(koerper).toHaveLength(1);
    expect(within(stammdatenRaster()).getByText('Meier')).toBeInTheDocument();
  });

  it('ein 409 ohne Feldänderung (Einsatz abgeschlossen) steht am Feld, ohne Rückfrage', async () => {
    render(einsatzAktiv, detail, [
      http.patch('/api/einsaetze/1/personen/10', () =>
        HttpResponse.json(
          { error: 'Einsatz ist abgeschlossen und schreibgeschützt' },
          { status: 409 },
        ),
      ),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x{Enter}');
    expect(
      await screen.findByText('Einsatz ist abgeschlossen und schreibgeschützt'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mustermannx');
  });

  it('Alter über 120: „höchstens 120“ am Feld, kein Request', async () => {
    const { koerper, handler } = patchMitschnitt();
    render(einsatzAktiv, detail, handler);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alter (geschätzt) bearbeiten' }));
    const feld = screen.getByRole('spinbutton', { name: 'Alter (geschätzt)' });
    await user.clear(feld);
    await user.type(feld, '130');
    await user.click(screen.getByRole('button', { name: 'Alter (geschätzt) speichern' }));
    expect(await screen.findByText('höchstens 120')).toBeInTheDocument();
    expect(feld).toHaveAttribute('aria-invalid', 'true');
    expect(koerper).toEqual([]);
  });

  it('Geburtsdatum: „01.02.80“ wird 1980-02-01 und erscheint als 01.02.1980; Unsinn am Feld', async () => {
    const { koerper, handler } = patchMitschnitt();
    render(einsatzAktiv, detail, handler);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(within(ohneAngabe()).getByRole('button', { name: 'Geburtsdatum eintragen' }));
    const feld = screen.getByRole('textbox', { name: 'Geburtsdatum' });
    expect(feld).toHaveFocus();
    await user.type(feld, '31.02.1980{Enter}');
    expect(await screen.findByText('Tag gibt es nicht')).toBeInTheDocument();
    expect(koerper).toEqual([]);

    await user.clear(feld);
    await user.type(feld, '01.02.80{Enter}');
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0]).toEqual({ geburtsdatum: '1980-02-01', erwartet: { geburtsdatum: null } });
    expect(await within(stammdatenRaster()).findByText('01.02.1980')).toBeInTheDocument();
  });

  it('Geburtsdatum aus der Freitext-Zeit erscheint roh und geht unverändert nicht hinaus', async () => {
    const alt = { ...detail, geburtsdatum: 'ca. 1980' } as PersonDetail;
    const { koerper, handler } = patchMitschnitt(alt);
    render(einsatzAktiv, alt, handler);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(within(stammdatenRaster()).getByText('ca. 1980')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Geburtsdatum bearbeiten' }));
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText('nicht lesbar')).toBeNull();
    expect(koerper).toEqual([]);
  });

  /**
   * Überlänge als Prüfung am Feld (Spec `personendaten-bearbeiten`, „Prüfungen am Feld“): der Grund
   * steht als `FeldFehler` unter der Eingabe, die Eingabe ist `aria-invalid` und beschrieben, kein
   * Request, nie gekürzt. Mutationsprobe: zurück auf `isValid` — kein Grund, keine Beschreibung,
   * rot.
   */
  it('Name über der Grenze: Grund am Feld, kein Request, nie gekürzt', async () => {
    const { koerper, handler } = patchMitschnitt();
    render(einsatzAktiv, detail, handler);
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    // Eingefügt statt getippt: 201 Zeichen.
    await userEvent.clear(feld);
    await userEvent.paste('x'.repeat(201));
    await userEvent.keyboard('{Enter}');
    const grund = 'Name darf höchstens 200 Zeichen lang sein';
    expect(await screen.findByText(grund)).toBeInTheDocument();
    expect(feld).toHaveAttribute('aria-invalid', 'true');
    expect(feld).toHaveAccessibleDescription(grund);
    // Erst warten, dann „kein Request“ (wie Tier und Schaden): ein Request liefe asynchron.
    await waitFor(() => expect(feld).toHaveFocus());
    await new Promise((r) => setTimeout(r, 50));
    expect(koerper).toEqual([]);
    expect(feld).toHaveValue('x'.repeat(201));
  });

  describe('Koordinate (D10)', () => {
    const mitKoordinate = {
      ...detail,
      // Mehr Stellen als das Textfeld zeigt — so wie ein Kartenklick sie setzt.
      antreff_lat: 52.269149,
      antreff_lon: 9.134251,
    } as PersonDetail;

    it('eine neue Koordinate geht als Paar, der Altwert als Paar mit allen Stellen', async () => {
      const { koerper, handler } = patchMitschnitt(mitKoordinate);
      render(einsatzAktiv, mitKoordinate, handler);
      await screen.findByRole('heading', { name: /Person R-001/ });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Koordinate bearbeiten' }));
      const feld = screen.getByRole('textbox', { name: 'Koordinate' });
      expect(feld).toHaveValue('52.2691/9.1343');
      await user.clear(feld);
      await user.type(feld, '52,2691/9,1342{Enter}');
      await waitFor(() => expect(koerper).toHaveLength(1));
      expect(koerper[0]).toEqual({
        antreff_lat: 52.2691,
        antreff_lon: 9.1342,
        erwartet: { antreff_lat: 52.269149, antreff_lon: 9.134251 },
      });
    });

    it('unverändert geht nichts hinaus — keine stille Rundung auf vier Stellen', async () => {
      const { koerper, handler } = patchMitschnitt(mitKoordinate);
      render(einsatzAktiv, mitKoordinate, handler);
      await screen.findByRole('heading', { name: /Person R-001/ });
      await userEvent.click(screen.getByRole('button', { name: 'Koordinate bearbeiten' }));
      await userEvent.keyboard('{Enter}');
      expect(koerper).toEqual([]);
    });

    it('Leeren nimmt das Paar', async () => {
      const { koerper, handler } = patchMitschnitt(mitKoordinate);
      render(einsatzAktiv, mitKoordinate, handler);
      await screen.findByRole('heading', { name: /Person R-001/ });
      await userEvent.click(screen.getByRole('button', { name: 'Koordinate bearbeiten' }));
      await userEvent.clear(screen.getByRole('textbox', { name: 'Koordinate' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(koerper).toHaveLength(1));
      expect(koerper[0]).toMatchObject({ antreff_lat: null, antreff_lon: null });
    });

    it('eine unbrauchbare Koordinate steht am Feld, kein Request', async () => {
      const { koerper, handler } = patchMitschnitt();
      render(einsatzAktiv, detail, handler);
      await screen.findByRole('heading', { name: /Person R-001/ });
      // Ohne Koordinate, aber mit Verorten-Weg steht sie als Feld im Raster.
      await userEvent.click(
        within(stammdatenRaster()).getByRole('button', { name: 'Koordinate eintragen' }),
      );
      await userEvent.type(screen.getByRole('textbox', { name: 'Koordinate' }), '52.1{Enter}');
      expect(await screen.findByText(/Breite und Länge mit/)).toBeInTheDocument();
      expect(koerper).toEqual([]);
    });
  });

  it('vermisst: „vermisst seit“ schreibbar, ohne Koordinate', async () => {
    const vermisst = {
      ...detail,
      status: 'vermisst',
      vermisst_seit: '2026-05-27 06:00:00',
    } as PersonDetail;
    render(einsatzAktiv, vermisst);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.getByRole('button', { name: 'vermisst seit bearbeiten' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Koordinate / })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Auf Lagekarte verorten' })).toBeNull();
  });

  it('leere Angaben mit Schreibrecht als Knöpfe „+ …“, ohne Schreibrecht als Satz', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    for (const etikett of ['Geburtsdatum', 'Herkunft / Adresse', 'Melder / Kontakt', 'Notiz']) {
      expect(
        within(ohneAngabe()).getByRole('button', { name: `${etikett} eintragen` }),
      ).toHaveTextContent(`+ ${etikett}`);
    }
  });

  it('eine offene Bearbeitung zur Zeit: die übrigen Felder gesperrt, der Grund steht einmal oben', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x');
    const grund = 'Erst „Name“ speichern oder abbrechen';
    expect(screen.getAllByText(grund)).toHaveLength(1);
    const vorname = screen.getByRole('button', { name: 'Vorname bearbeiten' });
    expect(vorname).toBeDisabled();
    expect(vorname).toHaveAccessibleDescription(`Max ${grund}`);
    expect(
      within(ohneAngabe()).getByRole('button', { name: 'Geburtsdatum eintragen' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Bearbeitung von Name abbrechen' }));
    expect(screen.getByRole('button', { name: 'Vorname bearbeiten' })).toBeEnabled();
    expect(screen.queryByText(grund)).toBeNull();
  });

  it('Rückfrage beim Verlassen: „Bleiben“ behält „Mül“, „Verwerfen“ wechselt in die Liste', async () => {
    render(einsatzAktiv, { ...detail, name: null } as PersonDetail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    const user = userEvent.setup();
    await user.click(within(ohneAngabe()).getByRole('button', { name: 'Name eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mül');
    await user.click(screen.getByRole('link', { name: 'Betroffene' }));
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await user.click(screen.getByRole('button', { name: 'Bleiben' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mül');
    expect(screen.queryByText('LISTE')).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Betroffene' }));
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('ohne Änderung keine Rückfrage beim Verlassen', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await userEvent.click(screen.getByRole('link', { name: 'Betroffene' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('ohne Netz alles gesperrt, mit einem Grund am Abschnitt', async () => {
    render(einsatzAktiv, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    setzeOnline(false);
    try {
      const daten = document.querySelector<HTMLElement>('[data-lfh="personendaten"]')!;
      const grund = await within(daten).findByText('Ohne Verbindung nicht änderbar');
      expect(within(daten).getAllByText('Ohne Verbindung nicht änderbar')).toHaveLength(1);
      expect(grund).toBeVisible();
      const name = screen.getByRole('button', { name: 'Name bearbeiten' });
      expect(name).toBeDisabled();
      expect(name).toHaveAccessibleDescription('Mustermann Ohne Verbindung nicht änderbar');
      const plus = within(ohneAngabe()).getByRole('button', { name: 'Geburtsdatum eintragen' });
      expect(plus).toBeDisabled();
      expect(plus).toHaveAccessibleDescription('Ohne Verbindung nicht änderbar');
    } finally {
      setzeOnline(true);
    }
  });
});

/**
 * LFH-757: „Fotos und Dateien“ ist ein aufklappbarer Abschnitt. Die Liste lädt erst mit ihm, und
 * der Download-Verweis zeigt auf die Personenroute (jeder Abruf steht dort im Zugriffsprotokoll).
 */
describe('PersonenDetailPage — Fotos und Dateien (LFH-757)', () => {
  const ANHAENGE = '/api/einsaetze/1/personen/10/anhaenge';
  const anhang = {
    id: 5,
    person_id: 10,
    dateiname: 'verletzung.jpg',
    mime: 'image/jpeg',
    groesse: 2048,
    abgelegt_von_id: 1,
    abgelegt_von_name: 'Leitung',
    abgelegt_at: '2026-10-02 10:30:00',
  };

  function zaehleListe(): { abrufe: () => number; loesen: () => void } {
    let n = 0;
    const horcher = ({ request }: { request: Request }) => {
      if (new URL(request.url).pathname === ANHAENGE) n += 1;
    };
    server.events.on('request:start', horcher);
    return {
      abrufe: () => n,
      loesen: () => server.events.removeListener('request:start', horcher),
    };
  }

  async function klappeAnhaengeAuf() {
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(screen.getByRole('button', { name: /Fotos und Dateien/ }));
    return screen.findByRole('region', { name: 'Fotos und Dateien' });
  }

  it('lädt die Anhangliste erst beim Aufklappen, genau einmal', async () => {
    const { abrufe, loesen } = zaehleListe();
    try {
      render(einsatzAktiv, detail, [http.get(ANHAENGE, () => HttpResponse.json([anhang]))]);
      await screen.findByRole('heading', { name: /Person R-001/ });
      expect(abrufe()).toBe(0);
      const bereich = await klappeAnhaengeAuf();
      const link = await within(bereich).findByRole('link', {
        name: /^verletzung\.jpg, .*Datei von Person R-001 herunterladen$/,
      });
      expect(link).toHaveAttribute('href', `${ANHAENGE}/5/datei`);
      expect(abrufe()).toBe(1);
      expect(within(bereich).getByRole('button', { name: 'Datei ablegen' })).toBeInTheDocument();
      expect(
        within(bereich).getByRole('button', {
          name: 'Datei verletzung.jpg von Person R-001 entfernen',
        }),
      ).toBeInTheDocument();
      expect(document.querySelector('form form')).toBeNull();
    } finally {
      loesen();
    }
  });

  it('Beobachter sieht die Liste ohne Aktionen', async () => {
    render(einsatzBeobachter, detail, [http.get(ANHAENGE, () => HttpResponse.json([anhang]))]);
    const bereich = await klappeAnhaengeAuf();
    await within(bereich).findByRole('link', { name: /^verletzung\.jpg/ });
    expect(within(bereich).queryByRole('button')).toBeNull();
  });

  it('an einer stornierten Person bleibt die Liste nur lesbar', async () => {
    render(einsatzAktiv, { ...detail, storniert_at: '2026-10-02 11:00:00' }, [
      http.get(ANHAENGE, () => HttpResponse.json([anhang])),
    ]);
    const bereich = await klappeAnhaengeAuf();
    await within(bereich).findByRole('link', { name: /^verletzung\.jpg/ });
    expect(within(bereich).queryByRole('button', { name: /Datei ablegen|entfernen/ })).toBeNull();
  });

  it('das Zugriffs-Audit nennt den Datei-Download im Klartext', async () => {
    render(einsatzFixture({ meine_rolle: 'einsatzleitung' }), detail, [
      http.get('/api/einsaetze/1/personen/10/audit', () =>
        HttpResponse.json([
          {
            id: 1,
            person_id: 10,
            benutzer_id: 1,
            benutzer_name: 'Leitung',
            art: 'anhang',
            zugriff_at: '2026-10-02 10:31:00',
          },
        ]),
      ),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(screen.getByRole('button', { name: /Zugriffs-Audit/ }));
    expect(await screen.findByText('Datei geladen')).toBeInTheDocument();
    expect(screen.queryByText('anhang')).toBeNull();
  });

  // LFH-916 (design.md D3): Export und Druck der Liste stehen im Audit der Person, wenn sie in der
  // Liste stand. Ein Erklärsatz darüber entfällt (LFH-1078): die Art „Liste exportiert“ spricht
  // für sich.
  it('das Zugriffs-Audit zeigt Listenzugriffe ohne Erklärsatz', async () => {
    render(einsatzFixture({ meine_rolle: 'einsatzleitung' }), detail, [
      http.get('/api/einsaetze/1/personen/10/audit', () =>
        HttpResponse.json([
          {
            id: 2,
            person_id: null,
            benutzer_id: 1,
            benutzer_name: 'Leitung',
            art: 'export',
            zugriff_at: '2026-10-02 10:35:00',
          },
        ]),
      ),
    ]);
    await screen.findByRole('heading', { name: /Person R-001/ });
    await userEvent.click(screen.getByRole('button', { name: /Zugriffs-Audit/ }));
    expect(await screen.findByText('Liste exportiert')).toBeInTheDocument();
    expect(screen.queryByText(/Export und Druck der Personenliste/)).toBeNull();
  });
});

// Erfassungs-Norm (frontend/AGENTS.md, LFH-796): die zwei Dialoge der Seite und die zwei Paneele
// des Patientenkopfs liegen auf der Erfassungshülle. Die Dialoge sind Select-Masken — Enter
// schluckt der `Select`, belegt wird die Struktur.
describe('PersonenDetailPage — Dialoge und Paneele auf der Erfassungshülle (LFH-796)', () => {
  const leereListen: Parameters<typeof server.use> = [
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
  ];

  it.each([
    {
      dialog: 'In UHS aufnehmen',
      ausloeser: 'In UHS aufnehmen',
      knopf: 'Aufnehmen',
      bezuege: false,
    },
    {
      dialog: 'Bezug hinzufügen',
      ausloeser: 'Bezug hinzufügen',
      knopf: 'Hinzufügen',
      bezuege: true,
    },
  ])(
    '$dialog: Knopf im Formular, keine Fußzeile',
    async ({ dialog, ausloeser, knopf, bezuege }) => {
      render(einsatzAktiv, detail, leereListen);
      if (bezuege) await klappeBezuegeAuf();
      await userEvent.click(await screen.findByRole('button', { name: ausloeser }));
      const fenster = await screen.findByRole('dialog');
      expect(within(fenster).getByText(dialog)).toBeInTheDocument();
      const absenden = within(fenster).getByRole('button', { name: knopf });
      expect(absenden.closest('form')).not.toBeNull();
      expect(document.querySelector('.ant-modal-footer')).toBeNull();
    },
  );

  it.each([
    { paneel: 'Sichtung erfassen', ausloeser: 'Sichten, bisher ungesichtet', knopf: 'Übernehmen' },
    { paneel: 'Verbleib erfassen', ausloeser: 'Verbleib erfassen', knopf: 'Verbleib erfassen' },
  ])(
    '$paneel: Paneel im Kopf, Knopf im Formular, kein Dialog',
    async ({ paneel, ausloeser, knopf }) => {
      render(einsatzAktiv, detail, leereListen);
      await screen.findByRole('heading', { name: /Person R-001/ });
      await userEvent.click(within(kopf()).getByRole('button', { name: ausloeser }));
      const bereich = within(kopf()).getByRole('region', { name: paneel });
      const absenden = within(bereich).getByRole('button', { name: knopf });
      expect(absenden.closest('form')).not.toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );
});
