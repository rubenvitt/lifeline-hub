import { delay, http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { einsatzKeys } from '../api/queryKeys';
import { renderMitProviders } from '../test/utils';
import TiereDetailPage from './TiereDetailPage';
import type { Tier } from '../api/types';
import { benutzerFixture, einsatzFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): geprüft wird die Einsatz-Rolle; dass die Systemrolle
// fürs Schreiben nicht zählt, deckt schreibrecht.test.ts ab.
const nutzer = benutzerFixture();
const einsatzAktiv = einsatzFixture();
const einsatzBeobachter = einsatzFixture({ meine_rolle: 'beobachter' });

// Quelle der Halter-Combobox (lädt beim Öffnen des Edit-Formulars). Der HalterPicker liest nur
// id/registrier_nr/name/vorname.
const einePerson = {
  id: 5,
  einsatz_id: 1,
  registrier_nr: 7,
  status: 'betroffen',
  name: 'Meier',
  vorname: 'Anna',
};

const tierBasis: Tier = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'aktiv',
  spezies: 'hund',
  rasse_beschreibung: 'Schäferhund',
  rufname: 'Rex',
  geschlecht: 'maennlich',
  alter_geschaetzt: 3,
  farbe_beschreibung: null,
  kennzeichnung: null,
  groesse_gewicht: null,
  halter_person_id: null,
  halter_kontakt: null,
  antreff_ort: 'Weide',
  notiz: null,
  abschluss_grund: null,
  abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-29 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  halter_registrier_nr: null,
  halter_storniert_at: null,
};

function render(
  einsatzObj: typeof einsatzAktiv,
  tier: Tier,
  extra: Parameters<typeof server.use> = [],
  route = '/einsaetze/1/tiere/10',
) {
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/tiere/10', () => HttpResponse.json(tier)),
    http.get('/api/einsaetze/1/personen/auswahl', () => HttpResponse.json([einePerson])),
    http.get('/api/einsaetze/1/tiere/10/anhaenge', () => HttpResponse.json([])),
  );
  // extra-Handler separat voranstellen, damit sie Vorrang vor den Defaults haben.
  if (extra.length > 0) server.use(...extra);
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/tiere" element={<div>LISTE</div>} />
      <Route path="/einsaetze/:id/tiere/:tierId" element={<TiereDetailPage />} />
      <Route path="/einsaetze/:id/personen/:personId" element={<div>PERSON-DETAIL</div>} />
    </Routes>,
    // Data Router: der Verlassen-Schutz hält Pfadwechsel über `useBlocker` an, und der wirft ohne
    // ihn (`frontend/AGENTS.md`, „Formularseiten“).
    { route, datenRouter: true },
  );
}

/**
 * Das Kopfmenü öffnen und eine Aktion daraus wählen. `.ant-dropdown:not(.ant-dropdown-hidden)` ist
 * Pflicht: antd lässt die Portale geschlossener Dropdowns im Baum stehen.
 */
async function oeffneKopfmenue(): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Weitere Aktionen zu Tier T-001' }),
  );
  return waitFor(() => {
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(menue).not.toBeNull();
    return menue!;
  });
}

async function ausMenue(name: string) {
  await userEvent.click(within(await oeffneKopfmenue()).getByRole('menuitem', { name }));
}

/** Der Storno-Dialog (LLH-1105): ein `<Modal>` außerhalb des Menüs, kein `Popconfirm`. */
const stornoDialog = () => screen.findByRole('dialog', { name: 'Tier T-001 stornieren?' });

/** Die Primärknöpfe im Seitenkopf, über die Marke des Primitivs eingegrenzt. */
function kopfPrimaeraktionen(): string[] {
  const kopf = document.querySelector('[data-lfh="seitenkopf-aktionen"]');
  if (!kopf) return [];
  return [...kopf.querySelectorAll('button')]
    .filter((b) => [...b.classList].some((k) => k.endsWith('-btn-primary')))
    .map((b) => b.textContent ?? '');
}

describe('TiereDetailPage — Stammdaten', () => {
  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, tierBasis);
    expect(await screen.findByRole('heading', { name: /Tier T-001/ })).toBeInTheDocument();
    expect(screen.getByText('Schäferhund')).toBeInTheDocument();
    expect(screen.getByText('Weide')).toBeInTheDocument();
  });

  it('Einsatzleitung kann bearbeiten und speichern (ohne Halter → beide null)', async () => {
    // Edit-Modus öffnen, das vorbefüllte Formular direkt speichern und den PATCH prüfen.
    let body: { halter_person_id?: number | null; halter_kontakt?: string | null } | null = null;
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        body = (await request.json()) as NonNullable<typeof body>;
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.halter_person_id).toBeNull();
    expect(body!.halter_kontakt).toBeNull();
  });

  it('sendet beim Speichern den beim Laden gelesenen Stand als Baseline (LFH-299/F10)', async () => {
    let body: Record<string, unknown> | null = null;
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.basis_geaendert_at).toBe('2026-05-29 09:00:00');
  });

  it('hält die Baseline fest, wenn die Detail-Query bei offener Maske refetcht (LFH-303)', async () => {
    // Auslöser im Betrieb: Fensterwechsel bei `staleTime` 10 s und `refetchOnWindowFocus: true`.
    // Der Hintergrund-Refetch legt den fremden, neueren Stand in den Cache; ginge der als Baseline
    // raus, verglich der Server ihn mit sich selbst und die fremde Änderung wäre still
    // überschrieben.
    let stand: Tier = tierBasis;
    let body: Record<string, unknown> | null = null;
    const { client } = render(einsatzAktiv, tierBasis, [
      http.get('/api/einsaetze/1/tiere/10', () => HttpResponse.json(stand)),
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    stand = { ...tierBasis, geaendert_at: '2026-05-29 11:30:00', rufname: 'Fremd' };
    await act(async () => {
      await client.invalidateQueries({ queryKey: einsatzKeys.tier(1, 10) });
    });
    await waitFor(() =>
      expect(client.getQueryData<Tier>(einsatzKeys.tier(1, 10))?.geaendert_at).toBe(
        '2026-05-29 11:30:00',
      ),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.basis_geaendert_at).toBe('2026-05-29 09:00:00');
  });

  it('zeigt bei 409 den Konfliktdialog; „Überschreiben" sendet ohne Baseline (LFH-299/F10)', async () => {
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        // Erster Save (mit Baseline) → 409; der Overwrite (ohne Baseline) → Erfolg.
        if (koerper.length === 1) {
          return HttpResponse.json({ error: 'Zwischenzeitlich geändert' }, { status: 409 });
        }
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    // Konfliktdialog erscheint statt eines stillen Overwrites.
    await userEvent.click(await screen.findByRole('button', { name: 'Überschreiben' }));
    await waitFor(() => expect(koerper).toHaveLength(2));
    expect(koerper[0].basis_geaendert_at).toBe('2026-05-29 09:00:00');
    expect(koerper[1].basis_geaendert_at).toBeUndefined();
  });

  it('ein zweiter 409 auf den Overwrite zeigt die Servermeldung statt erneut den Dialog', async () => {
    // Die Tier-Route kennt einen zweiten 409 (Storno-Guard vor der CAS), den der Overwrite nicht
    // umgeht. Ohne den `!v.overwrite`-Zweig ginge derselbe Dialog endlos wieder auf.
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(
          { error: 'Storniertes Tier kann nicht geändert werden' },
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
      await screen.findByText('Storniertes Tier kann nicht geändert werden'),
    ).toBeInTheDocument();
  });

  it('Beobachter sieht keinen Bearbeiten-Button', async () => {
    render(einsatzBeobachter, tierBasis);
    await screen.findByRole('heading', { name: /Tier T-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('Halter-Link deeplinkt bei bekanntem Halter auf die Personen-Detailseite', async () => {
    const mitHalter: Tier = { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7 };
    render(einsatzAktiv, mitHalter);
    await userEvent.click(await screen.findByText('R-007'));
    expect(await screen.findByText('PERSON-DETAIL')).toBeInTheDocument();
  });

  it('Edit: Halter-Combobox auf betroffene Person setzen → halter_person_id', async () => {
    let body: { halter_person_id?: number | null; halter_kontakt?: string | null } = {};
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    // Comboboxen im Edit-Formular: [0] Geschlecht, [1] Halter.
    await userEvent.click(screen.getAllByRole('combobox')[1]);
    const option = (await screen.findAllByText('R-007 · Anna Meier')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    expect(option).toBeTruthy();
    await userEvent.click(option!);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body.halter_person_id).toBe(5));
    expect(body.halter_kontakt).toBeNull();
  });

  it('Edit: Freitext in der Halter-Combobox → externer Kontakt (halter_kontakt)', async () => {
    let body: { halter_person_id?: number | null; halter_kontakt?: string | null } = {};
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const halterCb = screen.getAllByRole('combobox')[1];
    await userEvent.click(halterCb);
    await userEvent.type(halterCb, 'Familie Krause');
    const extern = (await screen.findAllByText(/Als externen Kontakt/)).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    expect(extern).toBeTruthy();
    await userEvent.click(extern!);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body.halter_kontakt).toBe('Familie Krause'));
    expect(body.halter_person_id).toBeNull();
  });

  it('Edit: Halter leeren sendet halter_person_id und halter_kontakt als null', async () => {
    // Start mit FK-Halter, Combobox leeren → beide Felder explizit null.
    const mitHalter: Tier = {
      ...tierBasis,
      geschlecht: null,
      halter_person_id: 5,
      halter_registrier_nr: 7,
    };
    let body: { halter_person_id?: number | null; halter_kontakt?: string | null } = {};
    const { container } = render(einsatzAktiv, mitHalter, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...mitHalter });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    // Halter ist der letzte allowClear-Select im Formular → letztes Clear-Icon.
    const clears = container.querySelectorAll('.ant-select-clear');
    const clear = clears[clears.length - 1];
    expect(clear, 'Halter-Combobox muss allowClear haben').toBeTruthy();
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(body.halter_person_id).toBeNull());
    expect(body.halter_kontakt).toBeNull();
  });

  it('Stornieren über das Menü fragt im Dialog nach, ruft DELETE und navigiert zur Liste', async () => {
    let geloescht = false;
    render(einsatzAktiv, tierBasis, [
      http.delete('/api/einsaetze/1/tiere/10', () => {
        geloescht = true;
        return new HttpResponse(null, { status: 204 });
      }),
    ]);
    await ausMenue('Stornieren');
    await userEvent.click(
      within(await stornoDialog()).getByRole('button', { name: 'Tier stornieren' }),
    );
    await waitFor(() => expect(geloescht).toBe(true));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });
});

describe('TiereDetailPage — Status/Verbleib', () => {
  it('zeigt das Paneel „Verbleib“ bei abgeschlossen (LLH-1092)', async () => {
    const abgeschlossen: Tier = {
      ...tierBasis,
      status: 'abgeschlossen',
      abschluss_grund: 'uebergabe_tierarzt',
      abschluss_ziel: 'Tierarzt Müller',
    };
    render(einsatzAktiv, abgeschlossen);
    expect(await screen.findByRole('heading', { name: 'Verbleib' })).toBeInTheDocument();
    expect(screen.getByText('an Tierarzt übergeben')).toBeInTheDocument();
    expect(screen.getByText('Tierarzt Müller')).toBeInTheDocument();
  });

  it('„Als vermisst melden“ aus dem Menü ruft die Status-Mutation', async () => {
    let body: { status?: string } = {};
    render(einsatzAktiv, tierBasis, [
      http.post('/api/einsaetze/1/tiere/10/status', async ({ request }) => {
        body = (await request.json()) as { status?: string };
        return HttpResponse.json({ ...tierBasis, status: 'vermisst' });
      }),
    ]);
    await ausMenue('Als vermisst melden');
    await waitFor(() => expect(body.status).toBe('vermisst'));
  });

  it('„Verbleib erfassen“ erzwingt einen Verbleib und schickt ihn', async () => {
    let body: { status?: string; abschluss_grund?: string } = {};
    render(einsatzAktiv, tierBasis, [
      http.post('/api/einsaetze/1/tiere/10/status', async ({ request }) => {
        body = (await request.json()) as { status?: string; abschluss_grund?: string };
        return HttpResponse.json({
          ...tierBasis,
          status: 'abgeschlossen',
          abschluss_grund: 'freilauf',
        });
      }),
    ]);
    // Die Primäraktion des offenen Tiers öffnet den Dialog.
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib erfassen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    // Ohne Verbleib: Submit blockiert (Pflichtfeld) → kein Request.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verbleib speichern' }));
    expect(await screen.findByText('Verbleib ist Pflicht')).toBeInTheDocument();
    expect(body.status).toBeUndefined();
    // Mit Verbleib in Handlungsform; der Drahtwert bleibt `freilauf`:
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('freigelassen')); // Option rendert im Portal
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verbleib speichern' }));
    await waitFor(() => expect(body.abschluss_grund).toBe('freilauf'));
    expect(body.status).toBe('abgeschlossen');
  });

  it('belegt „Übergeben an / Ort“ bei „an Halter übergeben“ mit dem bekannten Halter vor', async () => {
    render(einsatzAktiv, { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7 });
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib erfassen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('an Halter übergeben'));
    expect(within(dialog).getByLabelText('Übergeben an / Ort')).toHaveValue('R-007');
  });

  it('nimmt die Vorbelegung zurück, wenn ein anderer Verbleib gewählt wird', async () => {
    render(einsatzAktiv, { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7 });
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib erfassen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('an Halter übergeben'));
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('an Tierarzt übergeben'));
    expect(within(dialog).getByLabelText('Übergeben an / Ort')).toHaveValue('');
  });

  it('überschreibt kein schon eingetragenes Ziel mit dem Halter', async () => {
    render(einsatzAktiv, { ...tierBasis, halter_kontakt: 'Fam. Becker' });
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib erfassen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    await userEvent.type(within(dialog).getByLabelText('Übergeben an / Ort'), 'Onkel Paul');
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('an Halter übergeben'));
    expect(within(dialog).getByLabelText('Übergeben an / Ort')).toHaveValue('Onkel Paul');
  });
});

/**
 * Kopfaktionen nach Leitlinie (LLH-1105, `frontend/AGENTS.md`, Aktionen): genau eine Primäraktion
 * je Zustand, „Bearbeiten“ sichtbar daneben, der Rest im Menü, Stornieren rot hinter dem Trenner.
 */
describe('TiereDetailPage — Kopfaktionen', () => {
  it.each([
    { status: 'aktiv', primaer: 'Verbleib erfassen', menue: ['Als vermisst melden', 'Stornieren'] },
    { status: 'vermisst', primaer: 'Aufgefunden', menue: ['Verbleib erfassen', 'Stornieren'] },
    {
      status: 'abgeschlossen',
      primaer: 'Wieder aufnehmen',
      menue: ['Als vermisst melden', 'Stornieren'],
    },
  ] as const)('$status: Primär „$primaer“, im Menü $menue', async ({ status, primaer, menue }) => {
    render(einsatzAktiv, { ...tierBasis, status, abschluss_grund: 'verstorben' });
    await screen.findByRole('heading', { name: /Tier T-001/ });
    expect(kopfPrimaeraktionen()).toEqual([primaer]);
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    const eintraege = within(await oeffneKopfmenue()).getAllByRole('menuitem');
    expect(eintraege.map((e) => e.textContent)).toEqual(menue);
    // Gefahr rot (antd `danger`) und als Letztes, hinter dem einen Trenner.
    const letzter = eintraege[eintraege.length - 1];
    expect(letzter.className).toMatch(/item-danger/);
    expect(letzter.previousElementSibling?.className).toMatch(/divider/);
  });

  it('trägt weder „Zurück zur Liste“ noch einen Pfeil-Knopf', async () => {
    render(einsatzAktiv, { ...tierBasis, status: 'abgeschlossen', abschluss_grund: 'verstorben' });
    await screen.findByRole('heading', { name: /Tier T-001/ });
    expect(screen.queryByRole('button', { name: 'Zurück zur Liste' })).toBeNull();
    expect(screen.queryByRole('button', { name: /→/ })).toBeNull();
  });

  it('„Wieder aufnehmen“ setzt ein abgeschlossenes Tier zurück auf aktiv', async () => {
    let body: { status?: string } = {};
    render(einsatzAktiv, { ...tierBasis, status: 'abgeschlossen', abschluss_grund: 'verstorben' }, [
      http.post('/api/einsaetze/1/tiere/10/status', async ({ request }) => {
        body = (await request.json()) as { status?: string };
        return HttpResponse.json(tierBasis);
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Wieder aufnehmen' }));
    await waitFor(() => expect(body.status).toBe('aktiv'));
  });

  it('am stornierten Tier: Marke „storniert“, keine Kopfaktion', async () => {
    render(einsatzAktiv, { ...tierBasis, storniert_at: '2026-05-29 12:00:00' });
    await screen.findByRole('heading', { name: /Tier T-001/ });
    expect(screen.getByText('storniert')).toBeInTheDocument();
    expect(kopfPrimaeraktionen()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
  });

  it('Beobachter: keine Kopfaktion', async () => {
    render(einsatzBeobachter, tierBasis);
    await screen.findByRole('heading', { name: /Tier T-001/ });
    expect(kopfPrimaeraktionen()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).toBeNull();
  });
});

// LFH-758: Fotos und Dateien am Tier.
describe('TiereDetailPage — Fotos und Dateien', () => {
  const anhang = {
    id: 4,
    tier_id: 10,
    dateiname: 'hund.jpg',
    mime: 'image/jpeg',
    groesse: 1024,
    abgelegt_von_id: 1,
    abgelegt_von_name: 'Leitung',
    abgelegt_at: '2026-05-29 10:00:00',
  };

  it('zeigt das Paneel mit Anker auf die Tier-Route, außerhalb jedes Formulars', async () => {
    render(einsatzAktiv, tierBasis, [
      http.get('/api/einsaetze/1/tiere/10/anhaenge', () => HttpResponse.json([anhang])),
    ]);
    const anker = await screen.findByRole('link', {
      name: /hund\.jpg, .*Datei von Tier T-001 herunterladen/,
    });
    expect(anker).toHaveAttribute('href', '/api/einsaetze/1/tiere/10/anhaenge/4/datei');
    expect(anker.closest('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Datei ablegen' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Datei hund.jpg von Tier T-001 entfernen' }),
    ).toBeInTheDocument();
  });

  it('bleibt im Bearbeiten-Modus sichtbar und steckt in keinem Formular', async () => {
    render(einsatzAktiv, tierBasis);
    await userEvent.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
    const knopf = await screen.findByRole('button', { name: 'Datei ablegen' });
    expect(knopf.closest('form')).toBeNull();
  });

  it('am stornierten Tier: lesbar, aber ohne Ablegen und Entfernen', async () => {
    render(einsatzAktiv, { ...tierBasis, storniert_at: '2026-05-29 11:00:00' }, [
      http.get('/api/einsaetze/1/tiere/10/anhaenge', () => HttpResponse.json([anhang])),
    ]);
    expect(
      await screen.findByRole('link', { name: /hund\.jpg, .*herunterladen/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Datei ablegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /entfernen/ })).toBeNull();
  });

  it('Beobachter: lesbar, ohne Aktionen', async () => {
    render(einsatzBeobachter, tierBasis, [
      http.get('/api/einsaetze/1/tiere/10/anhaenge', () => HttpResponse.json([anhang])),
    ]);
    expect(
      await screen.findByRole('link', { name: /hund\.jpg, .*herunterladen/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Datei ablegen' })).toBeNull();
  });
});

describe('TiereDetailPage — Robustheit', () => {
  it('leitet bei ungültiger Tier-ID auf die Liste um', async () => {
    render(einsatzAktiv, tierBasis, [], '/einsaetze/1/tiere/abc');
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, tierBasis, [
      http.get('/api/einsaetze/1/tiere/10', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    ]);
    expect(await screen.findByText('Tier konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });
});

// Erfassungs-Norm (frontend/AGENTS.md, LFH-796): Grund ist ein `Select`, Enter schluckt er —
// belegt wird die Struktur.
describe('TiereDetailPage — Verbleib auf der Erfassungshülle (LFH-796)', () => {
  it('Knopf im Formular, keine Fußzeile', async () => {
    render(einsatzAktiv, tierBasis);
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib erfassen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    const knopf = within(dialog).getByRole('button', { name: 'Verbleib speichern' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
  });
});

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): Bearbeiten am
 * Formular, Status im Seitenhinweis, Verbleib und Storno im Dialog. Kein Fehler-Toast.
 */
describe('TiereDetailPage — Speicherfehler am Ort (LFH-1077)', () => {
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

  const seitenHinweis = () =>
    document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
  const formular = () => screen.getByRole('button', { name: 'Speichern' }).closest('form')!;
  const keinToast = () => expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

  it('Bearbeiten: der Grund steht am Formular, kein Toast', async () => {
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', abgelehnt('Rufname zu lang')),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    expect(await within(formular()).findByRole('alert')).toHaveTextContent('Rufname zu lang');
    keinToast();
  });

  it('Bearbeiten: das nächste Speichern räumt den Grund', async () => {
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', erstAblehnenDannWarten('Rufname zu lang')),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    // Vorher greifen: solange gespeichert wird, heißt der Knopf anders (Ladesymbol).
    const form = formular();
    await within(form).findByRole('alert');

    await userEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(form).queryByRole('alert')).toBeNull());
    // Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort.
    expect(within(form).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Bearbeiten: Abbrechen und erneutes Bearbeiten zeigen keinen alten Grund', async () => {
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', abgelehnt('Rufname zu lang')),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await within(formular()).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await screen.findByRole('button', { name: 'Speichern' });
    expect(within(formular()).queryByRole('alert')).toBeNull();
  });

  it('Bearbeiten: der Sperrkonflikt bleibt beim Konfliktdialog, nicht am Formular', async () => {
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', abgelehnt('Zwischenzeitlich geändert', 409)),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('button', { name: 'Überschreiben' })).toBeInTheDocument();
    expect(within(formular()).queryByRole('alert')).toBeNull();
    keinToast();
  });

  it('Bearbeiten: ein 409 auf das Überschreiben steht am Formular', async () => {
    render(einsatzAktiv, tierBasis, [
      http.patch(
        '/api/einsaetze/1/tiere/10',
        abgelehnt('Storniertes Tier kann nicht geändert werden', 409),
      ),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Überschreiben' }));

    expect(await within(formular()).findByRole('alert')).toHaveTextContent(
      'Storniertes Tier kann nicht geändert werden',
    );
    keinToast();
  });

  it('Status: der Grund steht im Seitenhinweis, der nächste Wechsel räumt ihn', async () => {
    render(einsatzAktiv, tierBasis, [
      http.post(
        '/api/einsaetze/1/tiere/10/status',
        erstAblehnenDannWarten('Übergang nicht erlaubt'),
      ),
    ]);
    await ausMenue('Als vermisst melden');

    const hinweis = await waitFor(() => {
      const h = seitenHinweis();
      expect(h).not.toBeNull();
      return h!;
    });
    expect(await within(hinweis).findByRole('alert')).toHaveTextContent('Übergang nicht erlaubt');
    expect(hinweis).toHaveTextContent('Status nicht geändert');
    keinToast();

    await ausMenue('Als vermisst melden');
    await waitFor(() =>
      expect(seitenHinweis()?.querySelector('[role="alert"]') ?? null).toBeNull(),
    );
  });

  it('Stornieren: der Grund steht im Dialog, der Dialog bleibt offen, der Grund des Status geht', async () => {
    let stornoAntwort: () => void = () => {};
    const stornoGehalten = new Promise<void>((r) => (stornoAntwort = r));
    render(einsatzAktiv, tierBasis, [
      http.post('/api/einsaetze/1/tiere/10/status', abgelehnt('Übergang nicht erlaubt')),
      http.delete('/api/einsaetze/1/tiere/10', async () => {
        await stornoGehalten;
        return HttpResponse.json({ error: 'Tier ist einer UHS zugeordnet' }, { status: 409 });
      }),
    ]);
    await ausMenue('Als vermisst melden');
    await waitFor(() => expect(seitenHinweis()).toHaveTextContent('Übergang nicht erlaubt'));

    await ausMenue('Stornieren');
    const dialog = await stornoDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tier stornieren' }));
    // Solange das Storno läuft, steht der alte Grund des Status nicht mehr da.
    await waitFor(() => expect(screen.queryByText('Übergang nicht erlaubt')).toBeNull());

    await act(async () => stornoAntwort());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Tier ist einer UHS zugeordnet',
    );
    expect(dialog).toHaveTextContent('Nicht storniert');
    expect(screen.queryByText('LISTE')).toBeNull();
    keinToast();
  });

  it('Stornieren: Abbrechen räumt den Grund, das erneute Öffnen zeigt keinen alten', async () => {
    render(einsatzAktiv, tierBasis, [
      http.delete('/api/einsaetze/1/tiere/10', abgelehnt('Tier ist einer UHS zugeordnet', 409)),
    ]);
    await ausMenue('Stornieren');
    const dialog = await stornoDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tier stornieren' }));
    await within(dialog).findByRole('alert');
    expect(seitenHinweis()?.querySelector('[role="alert"]') ?? null).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await ausMenue('Stornieren');
    const wieder = await stornoDialog();
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });

  it('Verbleib: der Grund steht im Dialog, der Dialog bleibt offen, kein Toast', async () => {
    render(einsatzAktiv, tierBasis, [
      http.post('/api/einsaetze/1/tiere/10/status', erstAblehnenDannWarten('Tier ist vermisst')),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib erfassen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('freigelassen'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verbleib speichern' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tier ist vermisst');
    expect(seitenHinweis()?.querySelector('[role="alert"]') ?? null).toBeNull();
    keinToast();

    // Das nächste Absenden räumt den Grund; solange es läuft, ist Abbrechen gesperrt.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verbleib speichern' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  it('Verbleib: nach Abbrechen und erneutem Öffnen kein alter Grund', async () => {
    render(einsatzAktiv, tierBasis, [
      http.post('/api/einsaetze/1/tiere/10/status', abgelehnt('Tier ist vermisst')),
    ]);
    const oeffnen = await screen.findByRole('button', { name: 'Verbleib erfassen' });
    await userEvent.click(oeffnen);
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('freigelassen'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verbleib speichern' }));
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert einen schließenden Dialog ein.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(oeffnen);
    const wieder = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });

  it('der Wechsel zu einem anderen Tier schließt den Verbleib-Dialog und leert ihn', async () => {
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/1/tiere/11')}>
          Zum zweiten Tier
        </button>
      );
    }
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/tiere/10', () =>
        HttpResponse.json({ ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7 }),
      ),
      http.get('/api/einsaetze/1/tiere/11', () =>
        HttpResponse.json({ ...tierBasis, id: 11, registrier_nr: 2 }),
      ),
      http.get('/api/einsaetze/1/tiere/:tid/anhaenge', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/tiere/:tierId" element={<TiereDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/tiere/10', datenRouter: true },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib erfassen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Verbleib von T-001' });
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('an Halter übergeben'));

    await userEvent.click(screen.getByRole('button', { name: 'Zum zweiten Tier' }));
    await screen.findByRole('heading', { name: /Tier T-002/ });
    // Offen gelassen, schriebe „Verbleib speichern“ den Verbleib von T-001 an T-002. jsdom beendet
    // das Ausblenden nie, „offen“ heißt hier: ohne `ant-zoom-leave`.
    expect(document.querySelectorAll('.ant-modal:not(.ant-zoom-leave)')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Verbleib erfassen' }));
    const neu = await screen.findByRole('dialog', { name: 'Verbleib von T-002' });
    expect(within(neu).getByLabelText('Übergeben an / Ort')).toHaveValue('');
  });

  it('der Wechsel zu einem anderen Tier räumt die Gründe', async () => {
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/1/tiere/11')}>
          Zum zweiten Tier
        </button>
      );
    }
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/tiere/10', () => HttpResponse.json(tierBasis)),
      http.get('/api/einsaetze/1/tiere/11', () =>
        HttpResponse.json({ ...tierBasis, id: 11, registrier_nr: 2 }),
      ),
      http.get('/api/einsaetze/1/tiere/:tid/anhaenge', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/tiere/10/status', abgelehnt('Übergang nicht erlaubt')),
    );
    renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/tiere/:tierId" element={<TiereDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/tiere/10', datenRouter: true },
    );
    await ausMenue('Als vermisst melden');
    await waitFor(() => expect(seitenHinweis()).toHaveTextContent('Übergang nicht erlaubt'));

    await userEvent.click(screen.getByRole('button', { name: 'Zum zweiten Tier' }));
    await screen.findByRole('heading', { name: /Tier T-002/ });
    expect(screen.queryByText('Übergang nicht erlaubt')).toBeNull();
  });
});

/**
 * Prüfung am Feld (LLH-1101): die Zellen stehen auf `DatenfeldEingabe`. Das Alter klemmte vorher
 * still auf 120 (`max` am `InputNumber`) bzw. auf 0 (`min`); jetzt nennen Regeln beide Grenzen am
 * Feld.
 */
describe('TiereDetailPage — Prüfung am Feld (LLH-1101)', () => {
  function mitPatch() {
    const koerper: Array<Record<string, unknown>> = [];
    render(einsatzAktiv, tierBasis, [
      http.patch('/api/einsaetze/1/tiere/10', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...tierBasis });
      }),
    ]);
    return koerper;
  }

  it('Alter 121: „Höchstens 120 Jahre“ steht am Feld, der Wert bleibt, kein PATCH', async () => {
    const koerper = mitPatch();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const alter = await screen.findByLabelText('Alter in Jahren (geschätzt)');
    await userEvent.clear(alter);
    await userEvent.type(alter, '121');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    // Mutationsprobe: `max={120}` zurück an das Feld — es klemmt still, keine Meldung, rot.
    const meldung = await screen.findByText('Höchstens 120 Jahre');
    expect(meldung.closest('[data-lfh="datenfeld"]')).toBe(alter.closest('[data-lfh="datenfeld"]'));
    expect(alter).toHaveValue('121');
    await waitFor(() => expect(alter).toHaveFocus());
    await new Promise((r) => setTimeout(r, 50));
    expect(koerper).toHaveLength(0);
  });

  it('Alter -5: „Mindestens 0 Jahre“ steht am Feld, der Wert bleibt, kein PATCH', async () => {
    const koerper = mitPatch();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const alter = await screen.findByLabelText('Alter in Jahren (geschätzt)');
    await userEvent.clear(alter);
    await userEvent.type(alter, '-5');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    // Mutationsprobe: `min={0}` zurück an das Feld — es klemmt still auf 0 und speichert, rot.
    const meldung = await screen.findByText('Mindestens 0 Jahre');
    expect(meldung.closest('[data-lfh="datenfeld"]')).toBe(alter.closest('[data-lfh="datenfeld"]'));
    expect(alter).toHaveValue('-5');
    await waitFor(() => expect(alter).toHaveFocus());
    await new Promise((r) => setTimeout(r, 50));
    expect(koerper).toHaveLength(0);
  });

  it('Gegenprobe: Alter 120 speichert', async () => {
    const koerper = mitPatch();
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const alter = await screen.findByLabelText('Alter in Jahren (geschätzt)');
    await userEvent.clear(alter);
    await userEvent.type(alter, '120');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0].alter_geschaetzt).toBe(120);
  });

  it('jede Eingabe ist über ihr Etikett erreichbar', async () => {
    render(einsatzAktiv, tierBasis);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByRole('textbox', { name: 'Rufname' })).toHaveValue('Rex');
    expect(screen.getByRole('textbox', { name: 'Rasse / Beschreibung' })).toHaveValue(
      'Schäferhund',
    );
    expect(screen.getByRole('combobox', { name: 'Geschlecht' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Alter in Jahren (geschätzt)' })).toHaveValue(
      '3',
    );
    for (const name of ['Farbe / Erscheinung', 'Kennzeichnung', 'Größe / Gewicht', 'Notiz']) {
      expect(screen.getByRole('textbox', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Fundort' })).toHaveValue('Weide');
    // Mutationsprobe: ohne `id`-Weitergabe im `HalterPicker` hat die Auswahl keinen Namen.
    expect(screen.getByRole('combobox', { name: 'Halter' })).toBeInTheDocument();
  });
});

/**
 * Verlassen-Schutz (LLH-1101, Spec `formularseiten`, „Rückfrage vor dem Verlassen“): mit offener
 * Änderung hält ein Pfadwechsel an, ohne fragt niemand.
 */
describe('TiereDetailPage — Verlassen-Schutz (LLH-1101)', () => {
  const rueckfrage = () => screen.queryByRole('dialog', { name: 'Ungespeicherte Änderungen' });

  it('offene Änderung: „Bleiben“ hält die Eingabe, „Verwerfen“ führt zur Liste', async () => {
    render(einsatzAktiv, tierBasis);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(await screen.findByLabelText('Rufname'), 'i');

    await userEvent.click(screen.getByRole('link', { name: 'Tiere' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bleiben' }));
    expect(screen.getByLabelText('Rufname')).toHaveValue('Rexi');
    expect(screen.queryByText('LISTE')).toBeNull();

    await userEvent.click(screen.getByRole('link', { name: 'Tiere' }));
    const wieder = await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await userEvent.click(within(wieder).getByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
  });

  it('ohne Änderung: der Wechsel geht ohne Rückfrage', async () => {
    render(einsatzAktiv, tierBasis);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await screen.findByLabelText('Rufname');
    await userEvent.click(screen.getByRole('link', { name: 'Tiere' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(rueckfrage()).toBeNull();
  });

  it('eine abgebrochene Änderung zählt beim nächsten Bearbeiten nicht', async () => {
    render(einsatzAktiv, tierBasis);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.type(await screen.findByLabelText('Rufname'), 'i');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await screen.findByLabelText('Rufname');

    // Mutationsprobe: `schluessel` fest auf die Tier-ID statt auf die offene Sitzung, rot.
    await userEvent.click(screen.getByRole('link', { name: 'Tiere' }));
    expect(await screen.findByText('LISTE')).toBeInTheDocument();
    expect(rueckfrage()).toBeNull();
  });
});

describe('TiereDetailPage — stehende Leiste (LLH-1101)', () => {
  it('Speichern und Abbrechen stehen in der Speicherleiste im Formular', async () => {
    render(einsatzAktiv, tierBasis);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const speichern = await screen.findByRole('button', { name: 'Speichern' });
    // Mutationsprobe: die Knöpfe zurück in ein `<Space>` ohne Leiste — `closest` findet nichts.
    const leiste = speichern.closest('[data-lfh="speicherleiste"]');
    expect(leiste).not.toBeNull();
    expect(leiste!.closest('form')).not.toBeNull();
    expect(within(leiste as HTMLElement).getByRole('button', { name: 'Abbrechen' })).toBeEnabled();
  });
});
