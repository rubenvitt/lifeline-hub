import { delay, http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { einsatzKeys } from '../api/queryKeys';
import { renderMitProviders } from '../test/utils';
import SchaedenDetailPage from './SchaedenDetailPage';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): geprüft wird die Einsatz-Rolle; dass die Systemrolle
// fürs Schreiben nicht zählt, deckt schreibrecht.test.ts ab.
const nutzer = benutzerFixture({ org_rolle: 'fuehrungskraft' });
const einsatzAktiv = {
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  org_id: 5,
  org_name: 'DRK Musterstadt',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

// Quellen der Geschädigt-Combobox (laden beim Öffnen des Edit-Formulars).
const einePerson = {
  id: 42,
  einsatz_id: 1,
  registrier_nr: 7,
  status: 'betroffen',
  name: 'Meier',
  vorname: 'Anna',
};

function basisSchaden(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    einsatz_id: 1,
    registrier_nr: 1,
    status: 'offen',
    typ: 'sachschaden',
    ausmass: 'gering',
    ort: 'Hauptstr. 17',
    beschreibung: 'Umgestürzter Baum',
    lat: null,
    lon: null,
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
    geschaedigt_personal_name: null,
    geschaedigt_organisation_name: null,
    ...overrides,
  };
}

function render(
  einsatzObj: object,
  schaden: Record<string, unknown>,
  extra: Parameters<typeof server.use> = [],
  route = '/einsaetze/1/schaeden/10',
) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(schaden)),
    http.get('/api/einsaetze/1/personen/auswahl', () => HttpResponse.json([einePerson])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden/10/anhaenge', () => HttpResponse.json([])),
  );
  if (extra.length > 0) server.use(...extra);
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/schaeden" element={<div>LISTE</div>} />
      <Route path="/einsaetze/:id/schaeden/:schadenId" element={<SchaedenDetailPage />} />
      <Route path="/einsaetze/:id/personen/:personId" element={<div>PERSON-DETAIL</div>} />
    </Routes>,
    // Data Router: der Verlassen-Schutz hält Pfadwechsel über `useBlocker` an, und der wirft ohne
    // ihn (`frontend/AGENTS.md`, „Formularseiten“).
    { route, datenRouter: true },
  );
}

describe('SchaedenDetailPage — Stammdaten', () => {
  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, basisSchaden());
    expect(await screen.findByRole('heading', { name: /Schaden S-001/ })).toBeInTheDocument();
    expect(screen.getByText('Hauptstr. 17')).toBeInTheDocument();
    expect(screen.getByText('Umgestürzter Baum')).toBeInTheDocument();
    expect(screen.getByText('Sachschaden')).toBeInTheDocument();
  });

  /**
   * Verortung. Beide Zweige: „der Link steht da" wäre auch bei verorteten Schäden wahr, wenn der
   * Zweig fehlte.
   */
  it('schickt einen unverorteten Schaden mit einem Auftrag auf die Karte', async () => {
    render(einsatzAktiv, basisSchaden({ lat: null, lon: null }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(screen.getByText('nicht verortet')).toBeInTheDocument();
    // `%3A` statt `:`: `mitQuery` kodiert seine Werte. Der Aufrufer liest über `searchParams.get()`
    // und bekommt den Doppelpunkt zurück — der Round-Trip ist in `routing/deeplinks.test.ts`
    // gepinnt.
    expect(screen.getByRole('link', { name: 'Auf Karte verorten' })).toHaveAttribute(
      'href',
      // Mit Herkunft: die Karte bietet danach „Zurück zu S-001“ an (LLH-1125).
      '/einsaetze/1/lagekarte?platzieren=schaden%3A10&zurueck=1',
    );
  });

  it('gesperrte Lagekarte: „Auf Karte verorten" steht gesperrt mit Grund (LFH-888)', async () => {
    render(einsatzAktiv, basisSchaden({ lat: null, lon: null }), [
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ lagekarte: { zugriff: false } })),
      ),
    ]);
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    const knopf = await screen.findByRole('button', { name: 'Auf Karte verorten' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
    expect(screen.queryByRole('link', { name: 'Auf Karte verorten' })).toBeNull();
  });

  it('zeigt bei vorhandener Koordinate die Koordinate statt des Auftrags', async () => {
    render(einsatzAktiv, basisSchaden({ lat: 52.1, lon: 8.5 }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(screen.queryByRole('link', { name: 'Auf Karte verorten' })).not.toBeInTheDocument();
    expect(screen.queryByText('nicht verortet')).not.toBeInTheDocument();
  });

  it('bietet Beobachtern keinen Verortungs-Auftrag an', async () => {
    // Der Auftrag endet in einem PATCH — ohne Schreibrecht führte der Link nach dem Kartenklick in
    // einen 403.
    render(einsatzBeobachter, basisSchaden({ lat: null, lon: null }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(screen.getByText('nicht verortet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Auf Karte verorten' })).not.toBeInTheDocument();
  });

  it('Einsatzleitung kann bearbeiten und speichern (ohne Geschädigt → alle vier null)', async () => {
    let body: Record<string, unknown> | null = null;
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.ort).toBe('Hauptstr. 17');
    expect(body!.geschaedigt_person_id).toBeNull();
    expect(body!.geschaedigt_personal_id).toBeNull();
    expect(body!.geschaedigt_organisation_id).toBeNull();
    expect(body!.geschaedigt_kontakt).toBeNull();
  });

  it('sendet beim Speichern den beim Laden gelesenen Stand als Baseline (LFH-300/F10)', async () => {
    let body: Record<string, unknown> | null = null;
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.basis_geaendert_at).toBe('2026-05-29 10:00:00');
  });

  it('hält die Baseline fest, wenn die Detail-Query bei offener Maske refetcht (LFH-303)', async () => {
    // Auslöser im Betrieb: Fensterwechsel bei `staleTime` 10 s und `refetchOnWindowFocus: true`.
    // Der Hintergrund-Refetch legt den fremden, neueren Stand in den Cache; ginge der als Baseline
    // raus, verglich der Server ihn mit sich selbst und die fremde Änderung wäre still
    // überschrieben.
    let stand: Record<string, unknown> = basisSchaden();
    let body: Record<string, unknown> | null = null;
    const { client } = render(einsatzAktiv, basisSchaden(), [
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    stand = basisSchaden({ geaendert_at: '2026-05-29 12:30:00', ort: 'Fremde Straße' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: einsatzKeys.schaden(1, 10) });
    });
    await waitFor(() =>
      expect(
        client.getQueryData<{ geaendert_at: string }>(einsatzKeys.schaden(1, 10))?.geaendert_at,
      ).toBe('2026-05-29 12:30:00'),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.basis_geaendert_at).toBe('2026-05-29 10:00:00');
  });

  it('zeigt bei 409 den Konfliktdialog; „Überschreiben" sendet ohne Baseline (LFH-300/F10)', async () => {
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        // Erster Save (mit Baseline) → 409; der Overwrite (ohne Baseline) → Erfolg.
        if (koerper.length === 1) {
          return HttpResponse.json({ error: 'Zwischenzeitlich geändert' }, { status: 409 });
        }
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    // Konfliktdialog erscheint statt eines stillen Overwrites.
    await userEvent.click(await screen.findByRole('button', { name: 'Überschreiben' }));
    await waitFor(() => expect(koerper).toHaveLength(2));
    expect(koerper[0].basis_geaendert_at).toBe('2026-05-29 10:00:00');
    expect(koerper[1].basis_geaendert_at).toBeUndefined();
  });

  it('ein zweiter 409 auf den Overwrite zeigt die Servermeldung statt erneut den Dialog', async () => {
    // Die Schaden-Route kennt einen zweiten 409 (Storno-Guard vor der CAS), den der Overwrite nicht
    // umgehen kann. Ohne den `!v.overwrite`-Zweig wäre „Überschreiben" ein toter Knopf.
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(
          { error: 'Stornierter Schaden kann nicht geändert werden' },
          { status: 409 },
        );
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Überschreiben' }));
    await waitFor(() => expect(koerper).toHaveLength(2));
    // Die Servermeldung erscheint (am Formular, LFH-1077), nicht erneut der
    // Konfliktdialog.
    expect(
      await screen.findByText('Stornierter Schaden kann nicht geändert werden'),
    ).toBeInTheDocument();
  });

  it('Beobachter sieht keinen Bearbeiten-Button', async () => {
    render(einsatzBeobachter, basisSchaden());
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('Edit: Geschädigt-Combobox auf betroffene Person → geschaedigt_person_id', async () => {
    let body: Record<string, unknown> = {};
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Geschädigt' }));
    const option = (await screen.findAllByText('R-007 · Anna Meier')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    expect(option).toBeTruthy();
    await userEvent.click(option!);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body.geschaedigt_person_id).toBe(42));
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Edit: Geschädigt leeren sendet alle vier Felder als null', async () => {
    const mitGeschaedigt = basisSchaden({
      geschaedigt_person_id: 42,
      geschaedigt_registrier_nr: 7,
    });
    let body: Record<string, unknown> = {};
    const { container } = render(einsatzAktiv, mitGeschaedigt, [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(mitGeschaedigt);
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    // Geschädigt ist der letzte allowClear-Select im Formular → letztes Clear-Icon.
    const clears = container.querySelectorAll('.ant-select-clear');
    const clear = clears[clears.length - 1];
    expect(clear, 'Geschädigt-Combobox muss allowClear haben').toBeTruthy();
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body.geschaedigt_person_id).toBeNull());
    expect(body.geschaedigt_personal_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Geschädigt-Link deeplinkt bei bekannter Person auf die Personen-Detailseite', async () => {
    render(einsatzAktiv, basisSchaden({ geschaedigt_person_id: 42, geschaedigt_registrier_nr: 7 }));
    const link = await screen.findByRole('link', { name: /R-007/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen/42');
  });

  it('Stornieren fragt über einen Dialog zurück, ruft DELETE und navigiert zur Liste', async () => {
    let geloescht = false;
    render(einsatzAktiv, basisSchaden(), [
      http.delete('/api/einsaetze/1/schaeden/10', () => {
        geloescht = true;
        return new HttpResponse(null, { status: 204 });
      }),
    ]);
    await ausKopfmenue('Stornieren');
    const dialog = await screen.findByRole('dialog', { name: 'Schaden S-001 stornieren?' });
    // Die tragende Hälfte: bis zur Bestätigung ist nichts passiert.
    expect(geloescht).toBe(false);
    expect(document.querySelector('.ant-popconfirm')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden stornieren' }));
    await waitFor(() => expect(geloescht).toBe(true));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });
});

/**
 * Das Menü der Kopfleiste öffnen und den Eintragsknoten des geöffneten Portals liefern.
 * `.ant-dropdown:not(.ant-dropdown-hidden)` ist Pflicht: antd lässt die Portale geschlossener
 * Dropdowns im Baum stehen.
 */
async function oeffneKopfmenue(): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Weitere Aktionen zu Schaden S-001' }),
  );
  const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  expect(menue).not.toBeNull();
  return menue as HTMLElement;
}

async function ausKopfmenue(name: string) {
  const menue = await oeffneKopfmenue();
  await userEvent.click(within(menue).getByRole('menuitem', { name }));
}

/** Die Knöpfe im Seitenkopf, über die Marke des Primitivs eingegrenzt. */
function kopfKnoepfe(): HTMLElement[] {
  const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]');
  return kopf ? [...kopf.querySelectorAll<HTMLElement>('button')] : [];
}

function kopfPrimaeraktionen(): HTMLElement[] {
  const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]');
  return kopf ? [...kopf.querySelectorAll<HTMLElement>('.ant-btn-primary')] : [];
}

/**
 * Kopfaktionen nach Leitlinie (LLH-1105, `frontend/AGENTS.md`, „Aktionen“): je Zustand genau eine
 * Primäraktion, „Bearbeiten“ sekundär sichtbar, der Rest im Menü mit Stornieren rot hinter dem
 * Trenner. Die Statuskanten spiegeln `darf_uebergehen` (`src/schaden/mod.rs`).
 */
/** Gefahr und Schadensgrad (LLH-1115): in Worten lesen, an Ort und Stelle ändern und leeren. */
describe('SchaedenDetailPage — Gefahr und Schadensgrad (LLH-1115)', () => {
  const zelle = (label: string) =>
    screen
      .getByText(label, { selector: '[data-lfh="datenfeld"] *' })
      .closest('[data-lfh="datenfeld"]')!;

  it('zeigt Gefahr und Schadensgrad in Worten', async () => {
    render(einsatzAktiv, basisSchaden({ gefahrenart: 'elektrizitaet', schadensgrad: 'zerstoert' }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(within(zelle('Gefahr') as HTMLElement).getByText('Elektrizität')).toBeInTheDocument();
    expect(
      within(zelle('Schadensgrad') as HTMLElement).getByText('total zerstört'),
    ).toBeInTheDocument();
  });

  it('ohne Angabe steht ein Strich', async () => {
    render(einsatzAktiv, basisSchaden());
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(within(zelle('Gefahr') as HTMLElement).getByText('—')).toBeInTheDocument();
    expect(within(zelle('Schadensgrad') as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('Bearbeiten hält Gefahr und Schadensgrad und sendet sie mit', async () => {
    let body: Record<string, unknown> | null = null;
    const s = basisSchaden({ gefahrenart: 'brand', schadensgrad: 'angeschlagen' });
    render(einsatzAktiv, s, [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(s);
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByRole('combobox', { name: 'Gefahr' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Schadensgrad' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.gefahrenart).toBe('brand');
    expect(body!.schadensgrad).toBe('angeschlagen');
  });

  it('eine geleerte Gefahr geht als null an den Server', async () => {
    let body: Record<string, unknown> | null = null;
    const s = basisSchaden({ gefahrenart: 'brand' });
    render(einsatzAktiv, s, [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(s);
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = (await screen.findByRole('combobox', { name: 'Gefahr' })).closest('.ant-select')!;
    const clear = feld.querySelector('.ant-select-clear');
    expect(clear, 'Gefahr muss sich leeren lassen').toBeTruthy();
    fireEvent.mouseDown(clear!);
    fireEvent.click(clear!);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.gefahrenart).toBeNull();
    expect(body!.schadensgrad).toBeNull();
  });
});

describe('SchaedenDetailPage — Kopfaktionen (LLH-1105)', () => {
  it.each([
    { status: 'offen', primaer: 'Schaden übergeben' },
    { status: 'uebergeben', primaer: 'Schaden abschließen' },
  ])('$status: genau eine Primäraktion „$primaer“', async ({ status, primaer }) => {
    render(einsatzAktiv, basisSchaden({ status }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    const primaer_ = kopfPrimaeraktionen();
    expect(primaer_).toHaveLength(1);
    expect(primaer_[0]).toHaveAccessibleName(primaer);
  });

  it('abgeschlossen: keine Primäraktion', async () => {
    render(einsatzAktiv, basisSchaden({ status: 'abgeschlossen' }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(kopfPrimaeraktionen()).toHaveLength(0);
  });

  it.each(['offen', 'uebergeben', 'abgeschlossen'])(
    '%s: „Bearbeiten“ steht sekundär im Kopf, kein Knopf gesperrt, kein „Zurück zur Liste“',
    async (status) => {
      render(einsatzAktiv, basisSchaden({ status }));
      await screen.findByRole('heading', { name: /Schaden S-001/ });
      const bearbeiten = screen.getByRole('button', { name: 'Bearbeiten' });
      expect(kopfKnoepfe()).toContain(bearbeiten);
      expect(bearbeiten).not.toHaveClass('ant-btn-primary');
      // Eine gesperrte Handlung steht nicht stumm da: sie entfällt oder nennt im Menü ihren Grund.
      expect(kopfKnoepfe().filter((k) => k.hasAttribute('disabled'))).toEqual([]);
      // Die Brotkrume trägt den Rückweg.
      expect(screen.queryByRole('button', { name: 'Zurück zur Liste' })).not.toBeInTheDocument();
    },
  );

  it.each([
    { status: 'offen', eintraege: ['Ohne Übergabe abschließen', 'Stornieren'] },
    { status: 'uebergeben', eintraege: ['Stornieren'] },
    { status: 'abgeschlossen', eintraege: ['Stornieren'] },
  ])('$status: das Menü trägt $eintraege', async ({ status, eintraege }) => {
    render(einsatzAktiv, basisSchaden({ status }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    const menue = await oeffneKopfmenue();
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(eintraege);
  });

  it('kein Knopf und kein Menüeintrag gleicht einem Statuswort (LFH-959)', async () => {
    render(einsatzAktiv, basisSchaden());
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    const menue = await oeffneKopfmenue();
    const texte = [...kopfKnoepfe(), ...within(menue).getAllByRole('menuitem')].map((e) =>
      (e.textContent ?? '').trim().toLocaleLowerCase('de'),
    );
    for (const wort of ['offen', 'übergeben', 'abgeschlossen']) expect(texte).not.toContain(wort);
  });

  it('„Stornieren“ steht rot hinter dem einen Trenner', async () => {
    render(einsatzAktiv, basisSchaden());
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    const menue = await oeffneKopfmenue();
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);
    const eintraege = [
      ...menue.querySelectorAll('[role="menuitem"], .ant-dropdown-menu-item-divider'),
    ];
    const trenner = eintraege.findIndex((e) =>
      e.classList.contains('ant-dropdown-menu-item-divider'),
    );
    const storno = within(menue).getByRole('menuitem', { name: 'Stornieren' });
    expect(eintraege.indexOf(storno)).toBeGreaterThan(trenner);
    expect(storno).toHaveClass('ant-dropdown-menu-item-danger');
  });

  it('offen: „Ohne Übergabe abschließen“ öffnet den Abschluss-Dialog', async () => {
    render(einsatzAktiv, basisSchaden());
    await ausKopfmenue('Ohne Übergabe abschließen');
    const dialog = (await screen.findAllByRole('dialog'))[0];
    expect(within(dialog).getByLabelText('Abschlussgrund')).toBeInTheDocument();
  });

  it('stornierter Schaden: keine Kopfaktionen, „storniert“ als neutrale Zustandsmarke', async () => {
    render(einsatzAktiv, basisSchaden({ storniert_at: '2026-05-29 11:00:00' }));
    const titel = await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(kopfKnoepfe()).toEqual([]);
    expect(
      screen.queryByRole('button', { name: 'Weitere Aktionen zu Schaden S-001' }),
    ).not.toBeInTheDocument();
    const marke = within(titel).getByText('storniert').closest('[data-lfh="status-chip"]');
    expect(marke).toHaveAttribute('data-ton', 'neutral');
    // Kein farbloser antd-`Tag` mehr daneben: die Zustandsmarke ist das neutrale Muster.
    expect([...titel.querySelectorAll('.ant-tag')].map((t) => t.textContent)).not.toContain(
      'storniert',
    );
  });

  it('ohne Schreibrecht steht weder Primäraktion noch Menü', async () => {
    render(einsatzBeobachter, basisSchaden());
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(kopfKnoepfe()).toEqual([]);
  });
});

describe('SchaedenDetailPage — Status-Aktionen', () => {
  it('Übergeben-Modal erzwingt einen Adressaten und schickt ihn', async () => {
    let body: { uebergeben_an?: string } = {};
    render(einsatzAktiv, basisSchaden(), [
      http.post('/api/einsaetze/1/schaeden/10/uebergeben', async ({ request }) => {
        body = (await request.json()) as { uebergeben_an?: string };
        return HttpResponse.json(
          basisSchaden({ status: 'uebergeben', uebergeben_an: body.uebergeben_an }),
        );
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden übergeben' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden übergeben' }));
    expect(await screen.findByText('Adressat ist Pflicht')).toBeInTheDocument();
    expect(body.uebergeben_an).toBeUndefined();
    await userEvent.type(within(dialog).getByLabelText('Übergeben an'), 'Stadtwerke');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden übergeben' }));
    await waitFor(() => expect(body.uebergeben_an).toBe('Stadtwerke'));
  });

  it('Abschließen-Modal erzwingt einen Grund und schickt ihn', async () => {
    let body: { abschluss_grund?: string } = {};
    render(einsatzAktiv, basisSchaden({ status: 'uebergeben' }), [
      http.post('/api/einsaetze/1/schaeden/10/abschliessen', async ({ request }) => {
        body = (await request.json()) as { abschluss_grund?: string };
        return HttpResponse.json(
          basisSchaden({ status: 'abgeschlossen', abschluss_grund: body.abschluss_grund }),
        );
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden abschließen' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden abschließen' }));
    expect(await screen.findByText('Grund ist Pflicht')).toBeInTheDocument();
    expect(body.abschluss_grund).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('combobox'));
    const option = (await screen.findAllByText('behoben')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await userEvent.click(option!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden abschließen' }));
    await waitFor(() => expect(body.abschluss_grund).toBe('behoben'));
  });

  it('zeigt den Übergeben-an-Wert bei übergebenem Schaden', async () => {
    render(einsatzAktiv, basisSchaden({ status: 'uebergeben', uebergeben_an: 'Stadtwerke' }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(screen.getByText('Stadtwerke')).toBeInTheDocument();
  });
});

describe('SchaedenDetailPage — Fotos und Dateien (LFH-21)', () => {
  it('trägt das Paneel unter den Stammdaten, auch im Bearbeiten-Modus, ohne <form> im <form>', async () => {
    render(einsatzAktiv, basisSchaden());
    expect(await screen.findByRole('region', { name: 'Fotos und Dateien' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const paneel = await screen.findByRole('region', { name: 'Fotos und Dateien' });
    expect(paneel.closest('form'), 'außerhalb des Bearbeiten-Formulars').toBeNull();
    for (const form of document.querySelectorAll('form')) {
      expect(form.parentElement?.closest('form'), 'kein verschachteltes Formular').toBeNull();
    }
  });
});

describe('SchaedenDetailPage — Robustheit', () => {
  it('leitet bei ungültiger Schaden-ID auf die Liste um', async () => {
    render(einsatzAktiv, basisSchaden(), [], '/einsaetze/1/schaeden/abc');
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.get('/api/einsaetze/1/schaeden/10', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    expect(await screen.findByText('Schaden konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });
});

// Erfassungs-Norm (frontend/AGENTS.md, LFH-796): beide Status-Dialoge liegen auf der
// Erfassungshülle.
describe('SchaedenDetailPage — Dialoge auf der Erfassungshülle (LFH-796)', () => {
  // Je Zustand die Primäraktion; der Bestätigungsknopf nennt dieselbe Handlung wie der Titel.
  it.each([
    { status: 'offen', titel: 'Schaden übergeben' },
    { status: 'uebergeben', titel: 'Schaden abschließen' },
  ])('$titel: Knopf im Formular, keine Fußzeile', async ({ status, titel }) => {
    render(einsatzAktiv, basisSchaden({ status }));
    await userEvent.click(await screen.findByRole('button', { name: titel }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    expect(dialog.querySelector('.ant-modal-title')).toHaveTextContent(titel);
    const knopf = within(dialog).getByRole('button', { name: titel });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
  });

  it('Übergeben: Fokus im Feld, Enter sendet ab', async () => {
    let body: { uebergeben_an?: string } = {};
    render(einsatzAktiv, basisSchaden(), [
      http.post('/api/einsaetze/1/schaeden/10/uebergeben', async ({ request }) => {
        body = (await request.json()) as { uebergeben_an?: string };
        return HttpResponse.json(
          basisSchaden({ status: 'uebergeben', uebergeben_an: body.uebergeben_an }),
        );
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden übergeben' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    const feld = within(dialog).getByLabelText('Übergeben an');
    await waitFor(() => expect(feld).toHaveFocus());
    await userEvent.type(feld, 'Bauhof{Enter}');
    await waitFor(() => expect(body.uebergeben_an).toBe('Bauhof'));
  });

  it('Abschließen: Notiz ohne Erklärung im Etikett (LFH-1078)', async () => {
    render(einsatzAktiv, basisSchaden({ status: 'uebergeben' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden abschließen' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    expect(within(dialog).getByLabelText('Notiz (optional)')).toBeInTheDocument();
  });
});

describe('SchaedenDetailPage — Eingabegrenzen (LFH-937)', () => {
  it('zeigt eine ältere, zu lange Beschreibung als Überlänge und speichert sie nicht', async () => {
    let gepatcht = false;
    render(einsatzAktiv, basisSchaden({ beschreibung: 'b'.repeat(8_001) }), [
      http.patch('/api/einsaetze/1/schaeden/10', () => {
        gepatcht = true;
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByText('8.001 / 8.000 · zu lang')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('z. B. Hauptstr. 17 oder L 235 km 12,5')).toHaveAttribute(
      'maxlength',
      '500',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(gepatcht).toBe(false);
  });

  it('eine ältere, zu lange Beschreibung bleibt beim Löschen eines Zeichens vollständig', async () => {
    const start = `${'b'.repeat(8_000)}ENDE`;
    render(einsatzAktiv, basisSchaden({ beschreibung: start }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const feld = await screen.findByDisplayValue(start);
    fireEvent.change(feld, { target: { value: start.slice(1) } });
    expect(feld).toHaveValue(start.slice(1));
  });

  it('Geschädigt: ein Suchbegriff über 500 Zeichen wird nicht als externer Kontakt angeboten', async () => {
    render(einsatzAktiv, basisSchaden());
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const geschaedigt = screen.getByRole('combobox', { name: 'Geschädigt' });
    await userEvent.click(geschaedigt);
    fireEvent.change(geschaedigt, { target: { value: 'k'.repeat(500) } });
    expect(await screen.findByText(/Als externen Kontakt/)).toBeInTheDocument();
    fireEvent.change(geschaedigt, { target: { value: 'k'.repeat(501) } });
    expect(
      await screen.findByText('Kontakt zu lang: höchstens 500 Zeichen (jetzt 501)'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Als externen Kontakt/)).toBeNull();
  });
});

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): Bearbeiten am
 * Formular, Übergeben, Abschließen und Storno im Dialog. Kein Fehler-Toast.
 */
describe('SchaedenDetailPage — Speicherfehler am Ort (LFH-1077)', () => {
  const abgelehnt =
    (text: string, status = 422) =>
    () =>
      HttpResponse.json({ error: text }, { status });

  /** Einmal ablehnen, danach ohne Antwort: geprüft wird der Zustand, solange sie aussteht. */
  function erstAblehnenDannWarten(text: string) {
    let erster = true;
    return async () => {
      if (erster) {
        erster = false;
        return HttpResponse.json({ error: text }, { status: 422 });
      }
      await delay('infinite');
      return HttpResponse.json({});
    };
  }

  const formular = () => screen.getByRole('button', { name: 'Speichern' }).closest('form')!;
  const keinToast = () => expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

  /** Über das Kopfmenü stornieren und bestätigen; liefert die Rückfrage. */
  async function storniere(): Promise<HTMLElement> {
    await ausKopfmenue('Stornieren');
    const dialog = await screen.findByRole('dialog', { name: 'Schaden S-001 stornieren?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden stornieren' }));
    return dialog;
  }

  it('Bearbeiten: der Grund steht am Formular, das nächste Speichern räumt ihn', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', erstAblehnenDannWarten('Ort zu lang')),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    // Vorher greifen: solange gespeichert wird, heißt der Knopf anders (Ladesymbol).
    const form = formular();
    expect(await within(form).findByRole('alert')).toHaveTextContent('Ort zu lang');
    keinToast();

    await userEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(form).queryByRole('alert')).toBeNull());
    // Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort.
    expect(within(form).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Bearbeiten: Abbrechen und erneutes Bearbeiten zeigen keinen alten Grund', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', abgelehnt('Ort zu lang')),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await within(formular()).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await screen.findByRole('button', { name: 'Speichern' });
    expect(within(formular()).queryByRole('alert')).toBeNull();
  });

  it('Bearbeiten: der Sperrkonflikt bleibt beim Konfliktdialog, ein 409 danach am Formular', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.patch(
        '/api/einsaetze/1/schaeden/10',
        abgelehnt('Stornierter Schaden kann nicht geändert werden', 409),
      ),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    const ueberschreiben = await screen.findByRole('button', { name: 'Überschreiben' });
    expect(within(formular()).queryByRole('alert')).toBeNull();

    await userEvent.click(ueberschreiben);
    expect(await within(formular()).findByRole('alert')).toHaveTextContent(
      'Stornierter Schaden kann nicht geändert werden',
    );
    keinToast();
  });

  it('Übergeben: der Grund steht im Dialog, das nächste Absenden räumt ihn', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.post(
        '/api/einsaetze/1/schaeden/10/uebergeben',
        erstAblehnenDannWarten('Schaden ist bereits übergeben'),
      ),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden übergeben' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    await userEvent.type(within(dialog).getByLabelText('Übergeben an'), 'Stadtwerke');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden übergeben' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Schaden ist bereits übergeben',
    );
    expect(within(dialog).getByLabelText('Übergeben an')).toHaveValue('Stadtwerke');
    keinToast();

    // Solange das nächste Absenden läuft, ist Abbrechen gesperrt.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden übergeben' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Übergeben: nach Abbrechen und erneutem Öffnen kein alter Grund', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.post(
        '/api/einsaetze/1/schaeden/10/uebergeben',
        abgelehnt('Schaden ist bereits übergeben'),
      ),
    ]);
    const oeffnen = await screen.findByRole('button', { name: 'Schaden übergeben' });
    await userEvent.click(oeffnen);
    const dialog = (await screen.findAllByRole('dialog'))[0];
    await userEvent.type(within(dialog).getByLabelText('Übergeben an'), 'Stadtwerke');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden übergeben' }));
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert einen schließenden Dialog ein.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(oeffnen);
    const wieder = (await screen.findAllByRole('dialog'))[0];
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });

  it('Abschließen: der Grund steht im Dialog, kein Toast', async () => {
    render(einsatzAktiv, basisSchaden({ status: 'uebergeben' }), [
      http.post(
        '/api/einsaetze/1/schaeden/10/abschliessen',
        abgelehnt('Schaden ist storniert', 409),
      ),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden abschließen' }));
    const dialog = (await screen.findAllByRole('dialog'))[0];
    await userEvent.click(within(dialog).getByRole('combobox'));
    const option = (await screen.findAllByText('behoben')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await userEvent.click(option!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden abschließen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Schaden ist storniert');
    expect(within(dialog).getByText('Nicht abgeschlossen')).toBeInTheDocument();
    keinToast();
  });

  it('Stornieren: der Grund steht in der Rückfrage, das nächste Bestätigen räumt ihn', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.delete('/api/einsaetze/1/schaeden/10', erstAblehnenDannWarten('Schaden ist verknüpft')),
    ]);
    const dialog = await storniere();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Schaden ist verknüpft');
    expect(within(dialog).getByText('Nicht storniert')).toBeInTheDocument();
    expect(screen.queryByText('LISTE')).toBeNull();
    keinToast();

    // Solange das nächste Bestätigen läuft, ist Abbrechen gesperrt.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schaden stornieren' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Stornieren: nach Abbrechen und erneutem Öffnen kein alter Grund', async () => {
    render(einsatzAktiv, basisSchaden(), [
      http.delete('/api/einsaetze/1/schaeden/10', abgelehnt('Schaden ist verknüpft')),
    ]);
    const dialog = await storniere();
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert einen schließenden Dialog ein.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await ausKopfmenue('Stornieren');
    const wieder = await screen.findByRole('dialog', { name: 'Schaden S-001 stornieren?' });
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });

  it('der Wechsel zu einem anderen Schaden räumt die Gründe', async () => {
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/1/schaeden/11')}>
          Zum zweiten Schaden
        </button>
      );
    }
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(basisSchaden())),
      http.get('/api/einsaetze/1/schaeden/11', () =>
        HttpResponse.json(basisSchaden({ id: 11, registrier_nr: 2 })),
      ),
      http.get('/api/einsaetze/1/schaeden/:sid/anhaenge', () => HttpResponse.json([])),
      http.delete('/api/einsaetze/1/schaeden/10', abgelehnt('Schaden ist verknüpft')),
    );
    renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/schaeden/:schadenId" element={<SchaedenDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/schaeden/10', datenRouter: true },
    );
    const dialog = await storniere();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Schaden ist verknüpft');

    await userEvent.click(screen.getByRole('button', { name: 'Zum zweiten Schaden' }));
    await screen.findByRole('heading', { name: /Schaden S-002/ });
    expect(screen.queryByText('Schaden ist verknüpft')).toBeNull();
    // Die Rückfrage gehört dem vorigen Schaden: offen gelassen, stornierte sie den neuen. jsdom
    // beendet das Ausblenden nie, „offen“ heißt hier: ohne `ant-zoom-leave`.
    expect(document.querySelectorAll('.ant-modal:not(.ant-zoom-leave)')).toHaveLength(0);
  });

  it('der Wechsel zu einem anderen Schaden schließt „Schaden übergeben“ und öffnet ihn nicht wieder', async () => {
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => void navigate('/einsaetze/1/schaeden/11')}>
            Zum zweiten Schaden
          </button>
          <button type="button" onClick={() => void navigate('/einsaetze/1/schaeden/10')}>
            Zurück zum ersten Schaden
          </button>
        </>
      );
    }
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(basisSchaden())),
      http.get('/api/einsaetze/1/schaeden/11', () =>
        HttpResponse.json(basisSchaden({ id: 11, registrier_nr: 2 })),
      ),
      http.get('/api/einsaetze/1/schaeden/:sid/anhaenge', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/schaeden/:schadenId" element={<SchaedenDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/schaeden/10', datenRouter: true },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Schaden übergeben' }));
    await screen.findByRole('dialog', { name: 'Schaden übergeben' });

    await userEvent.click(screen.getByRole('button', { name: 'Zum zweiten Schaden' }));
    await screen.findByRole('heading', { name: /Schaden S-002/ });
    expect(document.querySelectorAll('.ant-modal:not(.ant-zoom-leave)')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Zurück zum ersten Schaden' }));
    await screen.findByRole('heading', { name: /Schaden S-001/ });
    expect(document.querySelectorAll('.ant-modal:not(.ant-zoom-leave)')).toHaveLength(0);
  });
});

/**
 * Prüfung am Feld (LLH-1101): die Zellen des Bearbeiten-Modus stehen auf `DatenfeldEingabe`, ein
 * Prüffehler steht sichtbar unter seiner Eingabe. Vorher lag `Form.Item noStyle` in der Zelle:
 * „Ort ist Pflicht“ verhinderte das Speichern, ohne dass irgendwo stand, warum.
 */
describe('SchaedenDetailPage — Prüfung am Feld (LLH-1101)', () => {
  function mitPatch() {
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, basisSchaden(), [
      http.patch('/api/einsaetze/1/schaeden/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(basisSchaden());
      }),
    ]);
    return koerper;
  }

  it('leerer Ort: „Ort ist Pflicht“ steht am Feld, der Fokus darin, kein PATCH', async () => {
    const koerper = mitPatch();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const ort = await screen.findByLabelText('Ort');
    await userEvent.clear(ort);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    // Mutationsprobe: `noStyle` zurück an das `Form.Item` der Zelle — keine Meldung, rot.
    const meldung = await screen.findByText('Ort ist Pflicht');
    expect(meldung.closest('[data-lfh="datenfeld"]')).toBe(ort.closest('[data-lfh="datenfeld"]'));
    expect(ort).toHaveAccessibleDescription('Ort ist Pflicht');
    // Mutationsprobe: ohne `scrollToFirstError` am Formular bleibt der Fokus am Knopf, rot.
    await waitFor(() => expect(ort).toHaveFocus());
    await new Promise((r) => setTimeout(r, 50));
    expect(koerper).toHaveLength(0);
  });

  it('Gegenprobe: mit Ort speichert die Seite', async () => {
    const koerper = mitPatch();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const ort = await screen.findByLabelText('Ort');
    await userEvent.clear(ort);
    await userEvent.type(ort, 'Bahnhofstr. 3');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0].ort).toBe('Bahnhofstr. 3');
    expect(screen.queryByText('Ort ist Pflicht')).toBeNull();
  });

  it('eine zu lange Beschreibung nennt die Grenze am Feld', async () => {
    render(einsatzAktiv, basisSchaden({ beschreibung: 'b'.repeat(8_001) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    const meldung = await screen.findByText('Beschreibung darf höchstens 8.000 Zeichen lang sein');
    expect(meldung.closest('[data-lfh="datenfeld"]')).toBe(
      screen.getByLabelText('Beschreibung').closest('[data-lfh="datenfeld"]'),
    );
  });

  it('jede Eingabe ist über ihr Etikett erreichbar', async () => {
    render(einsatzAktiv, basisSchaden());
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByRole('combobox', { name: 'Typ' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Ausmaß' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ort' })).toHaveValue('Hauptstr. 17');
    expect(screen.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue('Umgestürzter Baum');
    // Mutationsprobe: ohne `id`-Weitergabe im `GeschaedigtPicker` hat die Auswahl keinen Namen.
    expect(screen.getByRole('combobox', { name: 'Geschädigt' })).toBeInTheDocument();
  });
});

/**
 * Verlassen-Schutz (LLH-1101, Spec `formularseiten`, „Rückfrage vor dem Verlassen“): mit offener
 * Änderung hält ein Pfadwechsel an, ohne fragt niemand.
 */
describe('SchaedenDetailPage — Verlassen-Schutz (LLH-1101)', () => {
  const rueckfrage = () => screen.queryByRole('dialog', { name: 'Ungespeicherte Änderungen' });

  it('offene Änderung: „Bleiben“ hält die Eingabe, „Verwerfen“ führt zur Liste', async () => {
    render(einsatzAktiv, basisSchaden());
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const ort = await screen.findByLabelText('Ort');
    await userEvent.type(ort, ' Hinterhof');

    await userEvent.click(screen.getByRole('link', { name: 'Schäden' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bleiben' }));
    expect(screen.getByLabelText('Ort')).toHaveValue('Hauptstr. 17 Hinterhof');
    expect(screen.queryByText('LISTE')).toBeNull();

    await userEvent.click(screen.getByRole('link', { name: 'Schäden' }));
    const wieder = await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await userEvent.click(within(wieder).getByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('ohne Änderung: der Wechsel geht ohne Rückfrage', async () => {
    render(einsatzAktiv, basisSchaden());
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await screen.findByLabelText('Ort');
    await userEvent.click(screen.getByRole('link', { name: 'Schäden' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(rueckfrage()).toBeNull();
  });

  it('eine abgebrochene Änderung zählt beim nächsten Bearbeiten nicht', async () => {
    render(einsatzAktiv, basisSchaden());
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(await screen.findByLabelText('Ort'), ' alt');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await screen.findByLabelText('Ort');

    // Mutationsprobe: `schluessel` fest auf die Schaden-ID statt auf die offene Sitzung — der
    // Merker trüge die verworfene Eingabe weiter, die Rückfrage käme, rot.
    await userEvent.click(screen.getByRole('link', { name: 'Schäden' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(rueckfrage()).toBeNull();
  });
});

describe('SchaedenDetailPage — stehende Leiste (LLH-1101)', () => {
  it('Speichern und Abbrechen stehen in der Speicherleiste im Formular', async () => {
    render(einsatzAktiv, basisSchaden());
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const speichern = await screen.findByRole('button', { name: 'Speichern' });
    // Mutationsprobe: die Knöpfe zurück in ein `<Space>` ohne Leiste — `closest` findet nichts.
    const leiste = speichern.closest('[data-lfh="speicherleiste"]');
    expect(leiste).not.toBeNull();
    expect(leiste!.closest('form')).not.toBeNull();
    expect(within(leiste as HTMLElement).getByRole('button', { name: 'Abbrechen' })).toBeEnabled();
  });
});
