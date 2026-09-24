import { describe, expect, it, onTestFinished } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { server } from '../../test/server';
import { App as AntApp, ConfigProvider } from 'antd';
import Grundriss, {
  PLATZ_KARTE_BREITE,
  PLATZ_KARTE_HOEHE,
  platzBedienform,
  platzMenueEintraege,
} from './Grundriss';
import { antdToken, farbenDunkel, type Dichte } from '../../theme/tokens';
import type { Person, PersonDetail, UhsBelegung, UhsDetail, UhsPlatz } from '../../api/types';
import { einsatzKeys } from '../../api/queryKeys';

function person(over: Partial<Person>): Person {
  return {
    id: 1,
    einsatz_id: 1,
    registrier_nr: 42,
    status: 'betroffen',
    name: null,
    vorname: null,
    geschlecht: null,
    geburtsdatum: null,
    alter_geschaetzt: null,
    herkunft_adresse: null,
    antreff_ort: null,
    melder_kontakt: null,
    notiz: null,
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    aktuelle_sichtung: null,
    aktuelle_sichtung_at: null,
    aktueller_verbleib: null,
    aktuelle_uhs_id: null,
    aktueller_platz_id: null,
    ...over,
  };
}

function platz(over: Partial<UhsPlatz>): UhsPlatz {
  return {
    id: 10,
    uhs_id: 1,
    typ: 'bett',
    bezeichnung: 'Bett 1',
    pos_x: 10,
    pos_y: 10,
    verfuegbarkeit: 'frei',
    reserviert_fuer_person_id: null,
    storniert_at: null,
    ...over,
  };
}

function uhsDetail(over: Partial<UhsDetail>): UhsDetail {
  return {
    id: 1,
    einsatz_id: 1,
    abschnitt_id: null,
    typ: 'behandlungsplatz',
    bezeichnung: 'BHP 50',
    standort: null,
    notiz: null,
    lat: null,
    lon: null,
    status: 'aktiv',
    erfasst_at: 'x',
    erfasst_von: 1,
    geaendert_at: 'x',
    geaendert_von: 1,
    storniert_at: null,
    plaetze: [],
    belegungen: [],
    material: [],
    ...over,
  };
}

/**
 * Rendert mit dem App-Theme der gewählten Dichtestufe (LFH-359). Die Platzkarte liest ihre
 * Bedienform aus den aufgelösten Tokens (`platzBedienform`); antds Vorgaben ohne Theme
 * (`marginSM` 12) ergäben die Kartenform — einen Zustand, den die App in `kompakt` nie hat.
 * Vorgabe ist deshalb `kompakt`, die Tests der Kartenform reichen `komfortabel` herein.
 */
function renderGrundriss(
  uhs: UhsDetail,
  personen: Person[],
  schreibgeschuetzt = false,
  dichte: Dichte = 'kompakt',
) {
  server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ergebnis = render(
    // MemoryRouter: der Detail-Drawer (PersonDetailDrawer) nutzt useNavigate; in der App
    // läuft Grundriss immer unter einer Route.
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ConfigProvider theme={{ token: antdToken(farbenDunkel, dichte) }}>
          <AntApp>
            <Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...ergebnis, client: qc };
}

describe('Grundriss – Belegt-Anzeige (LFH-18)', () => {
  it('zeigt einen Platz als belegt, sobald eine Person darauf zugewiesen ist', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p]);
    // Person-Tag bestätigt, dass die Belegung geladen ist …
    expect(await screen.findByText(/R-007/)).toBeInTheDocument();
    // … und der Platz muss als belegt gekennzeichnet sein.
    expect(screen.getByText('belegt')).toBeInTheDocument();
    // Ein belegter „freier" Platz ist nicht mehr frei: der „frei"-Tag entfällt,
    // „belegt" ist der einzige Status (Bug-Fix: zuvor „frei / belegt" parallel).
    expect(screen.queryByText('frei')).not.toBeInTheDocument();
  });

  it('zeigt bei belegtem, NICHT-freiem Platz beide Status (z. B. defekt + belegt)', async () => {
    // Nur „frei" widerspricht „belegt". defekt/gesperrt/… sind eigenständige
    // Zustände, die auch bei Belegung informativ bleiben.
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({
      plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'defekt' })],
    });
    renderGrundriss(uhs, [p]);
    expect(await screen.findByText('belegt')).toBeInTheDocument();
    expect(screen.getByText('defekt')).toBeInTheDocument();
  });

  it('zeigt einen unbelegten Platz NICHT als belegt', async () => {
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);
    expect(await screen.findByText('Bett 1')).toBeInTheDocument();
    expect(screen.queryByText('belegt')).not.toBeInTheDocument();
    // Unbelegt → Verfügbarkeit „frei" bleibt sichtbar.
    expect(screen.getByText('frei')).toBeInTheDocument();
  });
});

describe('Grundriss – Zurückweisen (LFH-17)', () => {
  it('weist eine belegte Person über das Aktionsmenü als Austritt zurück', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    let body: { art?: string } | null = null;
    server.use(
      http.post('/api/einsaetze/1/personen/7/uhs-belegung', async ({ request }) => {
        body = (await request.json()) as { art?: string };
        return HttpResponse.json({
          id: 1,
          einsatz_id: 1,
          person_id: 7,
          uhs_id: 1,
          platz_id: null,
          art: 'austritt',
          notiz: null,
          zeitpunkt_at: 'x',
          erfasst_von: 1,
        });
      }),
    );
    renderGrundriss(uhs, [p]);
    await userEvent.click(await screen.findByRole('button', { name: 'zurückweisen' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.art).toBe('austritt');
  });

  it('zeigt keine Patientenaktionen für unbelegte Plätze', async () => {
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);
    await screen.findByText('Bett 1');
    expect(screen.queryByRole('button', { name: 'zurückweisen' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Verbleib / Entlassung erfassen' }),
    ).not.toBeInTheDocument();
  });
});

describe('Grundriss – Verbleib / Entlassung erfassen (LFH-17)', () => {
  it('erfasst Transport (Default-Art) über den Platz-Button + Modal', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    let body: {
      art?: string;
      ziel?: string | null;
      transportmittel?: string | null;
      status?: string | null;
    } | null = null;
    server.use(
      http.post('/api/einsaetze/1/personen/7/verbleib', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          id: 1,
          einsatz_id: 1,
          person_id: 7,
          art: 'transport',
          transportmittel: 'RTW',
          ziel: 'KH Mitte',
          status: 'abtransportiert',
          notiz: null,
          zeitpunkt_at: 'x',
          erfasst_von: 1,
        });
      }),
    );
    renderGrundriss(uhs, [p]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }),
    );
    // Abschluss-Screen: Art ist mit Transport vorbelegt → nur Ziel + Transportmittel erfassen.
    await userEvent.type(screen.getByRole('textbox', { name: /Transportmittel/ }), 'RTW');
    // Ziel ist das erste Arbeitsfeld; Enter dort muss die native Formularübermittlung auslösen.
    await userEvent.type(await screen.findByRole('textbox', { name: /Ziel/ }), 'KH Mitte{Enter}');
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.art).toBe('transport');
    expect(body!.status).toBe('abtransportiert');
    expect(body!.ziel).toBe('KH Mitte');
    expect(body!.transportmittel).toBe('RTW');
  });

  it('erfasst eine Entlassung vor Ort (Art umgestellt) ohne abtransportiert-Status', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    let body: { art?: string; status?: string | null } | null = null;
    server.use(
      http.post('/api/einsaetze/1/personen/7/verbleib', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          id: 1,
          einsatz_id: 1,
          person_id: 7,
          art: 'entlassung',
          transportmittel: null,
          ziel: null,
          status: null,
          notiz: null,
          zeitpunkt_at: 'x',
          erfasst_von: 1,
        });
      }),
    );
    renderGrundriss(uhs, [p]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }),
    );
    // Art von Transport auf „Entlassung vor Ort" umstellen.
    await userEvent.click(await screen.findByRole('combobox', { name: 'Art' }));
    await userEvent.click(await screen.findByText('Entlassung vor Ort'));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.art).toBe('entlassung');
    // status=abtransportiert NUR bei Transport → sonst null (Spiegel der Patienten-Ansicht).
    expect(body!.status).toBeNull();
  });

  it('setzt den Fokus beim Öffnen auf „Ziel", nicht auf das vorbelegte „Art"', async () => {
    // LFH-332/B4: die Erfassungshülle fokussiert das ERSTE bedienbare Feld. Deshalb steht
    // „Ziel" im Formular vor „Art" — „Art" ist mit Transport vorbelegt und nichts, was der
    // Erfassende zuerst tippt. Der Test pinnt die Feldreihenfolge über ihre Wirkung.
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }),
    );
    const ziel = await screen.findByRole('textbox', { name: /Ziel/ });
    await waitFor(() => expect(ziel).toHaveFocus());
    // „Art" bleibt trotz der Umsortierung sichtbar und bedienbar.
    expect(screen.getByRole('combobox', { name: 'Art' })).toBeEnabled();
  });

  it('lässt Dialog und Eingaben stehen, wenn das Speichern scheitert', async () => {
    // LFH-332/B4: die Hülle leert erst NACH erfolgreichem Speichern. Das setzt voraus,
    // dass `onErfassen` bei einem Fehler ablehnt (mutateAsync, nicht mutate) — sonst
    // wäre der Wortlaut weg, obwohl der Verbleib nie ankam.
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    server.use(
      http.post('/api/einsaetze/1/personen/7/verbleib', () =>
        HttpResponse.json({ error: 'Verbleib abgelehnt' }, { status: 500 }),
      ),
    );
    renderGrundriss(uhs, [p]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }),
    );
    await userEvent.type(await screen.findByRole('textbox', { name: /Ziel/ }), 'KH Mitte');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Verbleib abgelehnt')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Ziel/ })).toHaveValue('KH Mitte');
  });

  // LFH-332/B4, Zusicherung 3: zurückgesetzt wird auf BEIDEN Wegen. Vor dem Umbau tat das
  // der Aufrufer selbst (onSuccess UND onCancel), jetzt die Hülle.
  //
  // GEMESSENE LÜCKE (29.07., gehört NICHT dieser Datei): der Abbrechen-Weg hat zwei
  // Auslöser, und nur einer läuft durch den Reset der Hülle. `ErfassungsModal` reicht
  // `onAbbrechen` roh an `Modal.onCancel` weiter, während `form.resetFields()` allein im
  // `abbrechen()` von `ErfassungsFormular` steht — also hinter dem Abbrechen-KNOPF. Escape,
  // das Kreuz und der Maskenklick gehen daran vorbei; `destroyOnHidden` rettet nichts, weil
  // der Formularspeicher beim Aufrufer liegt (`Form.useForm()`), nicht im zerstörten DOM.
  // Gemessen: nach Escape steht beim Wiederöffnen „KH Mitte" im Ziel-Feld. Der Fix ist eine
  // Zeile in `components/Erfassung.tsx` (Modal-`onCancel` durch denselben Griff wie den
  // Knopf leiten) und trifft alle Aufrufer der Hülle — deshalb hier nur der Knopf-Weg
  // gepinnt und die Lücke gemeldet, statt sie lokal mit einem verbotenen Aufrufer-Reset
  // zuzukleistern (Regel 3 des Umbaus).
  it('leert den Dialog nach dem Abbrechen per Knopf (auch die Vorbelegung ist wieder da)', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p]);
    const oeffnen = await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' });
    await userEvent.click(oeffnen);
    await userEvent.type(await screen.findByRole('textbox', { name: /Ziel/ }), 'KH Mitte');
    await userEvent.click(await screen.findByRole('combobox', { name: 'Art' }));
    await userEvent.click(await screen.findByText('Entlassung vor Ort'));

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await userEvent.click(oeffnen);
    expect(await screen.findByRole('textbox', { name: /Ziel/ })).toHaveValue('');
    // Art steht wieder auf der Vorbelegung. antd v6 trägt den gewählten Eintrag als
    // `title` am Select-Inhalt — das Eingabefeld der Combobox ist immer leer.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTitle('Transport')).toBeInTheDocument();
    expect(within(dialog).queryByTitle('Entlassung vor Ort')).not.toBeInTheDocument();
  });
});

describe('Grundriss – Plätze nach Typ anlegen (LFH-16)', () => {
  it('legt über Typ + Menge mehrere Plätze an (Bulk, ohne Namensvergabe)', async () => {
    const uhs = uhsDetail({ plaetze: [], status: 'geplant' });
    let body: { typ?: string; menge?: number } | null = null;
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/bulk', async ({ request }) => {
        body = (await request.json()) as { typ?: string; menge?: number };
        return HttpResponse.json([]);
      }),
    );
    renderGrundriss(uhs, []);
    await userEvent.click(screen.getByRole('button', { name: 'Plätze anlegen' }));
    const menge = await screen.findByRole('spinbutton', { name: 'Menge' });
    await userEvent.clear(menge);
    await userEvent.type(menge, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ typ: 'bett', menge: 3 });
  });

  it('überträgt den im Select gewählten Typ', async () => {
    const uhs = uhsDetail({ plaetze: [], status: 'geplant' });
    let body: { typ?: string; menge?: number } | null = null;
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/bulk', async ({ request }) => {
        body = (await request.json()) as { typ?: string; menge?: number };
        return HttpResponse.json([]);
      }),
    );
    renderGrundriss(uhs, []);
    await userEvent.click(screen.getByRole('button', { name: 'Plätze anlegen' }));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Platz-Typ' }));
    await userEvent.click(await screen.findByText('Intensivplatz'));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.typ).toBe('intensivplatz');
  });
});

describe('Grundriss – Spalten-Fluss (LFH-58)', () => {
  it('zeigt aus DIESER UHS abtransportierte Personen in der rechten Spalte', async () => {
    const p = person({
      id: 9,
      registrier_nr: 9,
      aktuelle_uhs_id: null,
      aktueller_verbleib: 'Transport → KH Mitte',
    });
    const austritt: UhsBelegung = {
      id: 1,
      einsatz_id: 1,
      person_id: 9,
      uhs_id: 1,
      platz_id: null,
      art: 'austritt',
      notiz: null,
      zeitpunkt_at: 'x',
      erfasst_von: 1,
    };
    const uhs = uhsDetail({ belegungen: [austritt] });
    renderGrundriss(uhs, [p]);
    expect(await screen.findByText('Auf Transport gebracht')).toBeInTheDocument();
    expect(await screen.findByText('Transport → KH Mitte')).toBeInTheDocument();
    // Auto-Austritt leert aktuelle_uhs_id → die Person darf NICHT zusätzlich links
    // unter „Noch nicht aufgenommen" auftauchen (sonst Doppelanzeige).
    expect(screen.getAllByText(/R-009/)).toHaveLength(1);
  });

  it('zeigt noch nicht aufgenommene Personen in der linken Spalte', async () => {
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    renderGrundriss(uhsDetail({}), [p]);
    expect(await screen.findByText('Noch nicht aufgenommen')).toBeInTheDocument();
    expect(await screen.findByText(/R-005/)).toBeInTheDocument();
  });
});

describe('Grundriss – Platz-Aktion kontextabhängig (LFH-58)', () => {
  it('versteckt „Plätze anlegen" bei aktiver UHS hinter „Plätze bearbeiten"', async () => {
    renderGrundriss(uhsDetail({ status: 'aktiv' }), []);
    // Aktiv: Anlegen ist NICHT sofort sichtbar, nur der sekundäre Bearbeiten-Umschalter.
    const toggle = await screen.findByRole('button', { name: 'Plätze bearbeiten' });
    expect(screen.queryByRole('button', { name: 'Plätze anlegen' })).not.toBeInTheDocument();
    // Nach Klick erscheint die Anlegen-Aktion.
    await userEvent.click(toggle);
    expect(await screen.findByRole('button', { name: 'Plätze anlegen' })).toBeInTheDocument();
  });
});

describe('Grundriss – Platz-Verfügbarkeit ohne Edit-Modus (LFH-17)', () => {
  it('bietet die Platz-Aktionen auch im Nicht-Edit-Modus (aktive UHS)', async () => {
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);
    await screen.findByText('Bett 1');
    // Kein „Plätze bearbeiten" aktiviert → trotzdem Platzaktionen erreichbar.
    expect(screen.getByRole('button', { name: /Platzaktionen zu Bett 1/ })).toBeInTheDocument();
  });

  it('zeigt „als frei markieren" als direkte Primäraktion für einen Platz in Aufbereitung', async () => {
    const uhs = uhsDetail({
      status: 'aktiv',
      plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'aufbereitung' })],
    });
    let body: { verfuegbarkeit?: string } | null = null;
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/10/verfuegbarkeit', async ({ request }) => {
        body = (await request.json()) as { verfuegbarkeit?: string };
        return HttpResponse.json({});
      }),
    );
    renderGrundriss(uhs, []);
    await userEvent.click(await screen.findByRole('button', { name: 'als frei markieren' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.verfuegbarkeit).toBe('frei');
  });

  it('zeigt KEINE „als frei markieren"-Primäraktion für einen bereits freien Platz', async () => {
    const uhs = uhsDetail({
      status: 'aktiv',
      plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'frei' })],
    });
    renderGrundriss(uhs, []);
    await screen.findByText('Bett 1');
    expect(screen.queryByRole('button', { name: 'als frei markieren' })).not.toBeInTheDocument();
    // Das vollständige Menü bleibt aber erreichbar.
    expect(screen.getByRole('button', { name: /Platzaktionen zu Bett 1/ })).toBeInTheDocument();
  });
});

describe('Grundriss – Read-only (schreibgeschuetzt)', () => {
  it('blendet Schreibaktionen aus, wenn schreibgeschuetzt', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p], true);
    // belegter Platz ist sichtbar …
    expect(await screen.findByText('belegt')).toBeInTheDocument();
    // … aber keine Schreibaktionen.
    expect(screen.queryByRole('button', { name: 'zurückweisen' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Verbleib / Entlassung erfassen' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Platzaktionen zu Bett 1/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plätze anlegen' })).not.toBeInTheDocument();
  });
});

describe('Grundriss – Platzzuweisung ohne Drag (LFH-367/B5g)', () => {
  /** Öffnet das geladene Dropdown-Menü der Platzkarte. antd lässt die Portale
   *  geschlossener Dropdowns im Baum stehen — deshalb über das SICHTBARE greifen. */
  function offenesMenue(): HTMLElement {
    const offen = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    if (!offen) throw new Error('kein offenes Dropdown-Menü im Baum');
    return offen as HTMLElement;
  }

  /** Wählt im geöffneten Patienten-Auswahlfeld den Eintrag mit dieser Kennung.
   *  Über das SICHTBARE Dropdown greifen: dieselbe Person steht zugleich in der linken
   *  Spalte, ein blosser Textgriff wäre mehrdeutig. */
  async function waehlePatient(kennung: RegExp) {
    await userEvent.click(await screen.findByRole('combobox', { name: 'Patient' }));
    const liste = await waitFor(() => {
      const el = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      if (!el) throw new Error('kein offenes Auswahlfeld');
      return el as HTMLElement;
    });
    await userEvent.click(within(liste).getByText(kennung));
  }

  function belegungRoute(personId: number, senke: { body: unknown }) {
    return http.post(`/api/einsaetze/1/personen/${personId}/uhs-belegung`, async ({ request }) => {
      senke.body = await request.json();
      return HttpResponse.json({
        id: 1,
        einsatz_id: 1,
        person_id: personId,
        uhs_id: 1,
        platz_id: 10,
        art: 'eintritt',
        notiz: null,
        zeitpunkt_at: 'x',
        erfasst_von: 1,
      });
    });
  }

  it('weist eine noch nicht aufgenommene Person per Klick auf den Platz zu (art=eintritt)', async () => {
    // AK1: der Weg läuft OHNE jedes Drag-Ereignis. Gepinnt wird der abgeschickte Body,
    // nicht ein Mock auf useMutation — ein Mock wäre auch dann grün, wenn der Klickweg
    // bloss den bestehenden DragEnd-Handler synthetisch auslöste.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    const senke: { body: unknown } = { body: null };
    server.use(belegungRoute(5, senke));
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByTestId('platz-karte'));
    await waehlePatient(/R-005/);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(senke.body).not.toBeNull());
    expect(senke.body).toEqual({ art: 'eintritt', uhs_id: 1, platz_id: 10 });
  });

  it('zeigt die Platzbelegung optimistisch und rollt eine Serverablehnung zurück', async () => {
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const anderePerson = person({ id: 6, registrier_nr: 6, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    server.use(
      http.post('/api/einsaetze/1/personen/5/uhs-belegung', async () => {
        await gate;
        return HttpResponse.json({ error: 'Platz inzwischen belegt' }, { status: 409 });
      }),
    );
    const { client } = renderGrundriss(uhs, [p, anderePerson]);

    await userEvent.click(await screen.findByTestId('platz-karte'));
    await waehlePatient(/R-005/);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => {
      const optimistisch = client.getQueryData<Person[]>(einsatzKeys.personen(1));
      expect(optimistisch?.[0]).toMatchObject({ aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    });
    expect(screen.getByText('belegt')).toBeInTheDocument();

    // Ein unabhängiger Live-/Refetch-Stand, der während unseres Requests eintrifft, darf
    // beim Fehler nicht durch einen Snapshot der gesamten Personenliste verloren gehen.
    let refetchFreigeben: (() => void) | undefined;
    const refetchGate = new Promise<void>((resolve) => {
      refetchFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/1/personen', async () => {
        await refetchGate;
        return HttpResponse.json([{ ...p, name: 'Extern geändert' }, anderePerson]);
      }),
    );
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), (aktuell) =>
        aktuell?.map((eintrag) =>
          eintrag.id === 5 ? { ...eintrag, name: 'Extern geändert' } : eintrag,
        ),
      );
    });

    await act(async () => {
      freigeben?.();
    });
    await waitFor(() => {
      const zurueckgerollt = client.getQueryData<Person[]>(einsatzKeys.personen(1));
      expect(zurueckgerollt?.find((eintrag) => eintrag.id === 5)).toMatchObject({
        aktuelle_uhs_id: null,
        aktueller_platz_id: null,
      });
      expect(zurueckgerollt?.find((eintrag) => eintrag.id === 5)?.name).toBe('Extern geändert');
    });
    await act(async () => {
      refetchFreigeben?.();
    });
    expect(screen.queryByText('belegt')).not.toBeInTheDocument();
  });

  it('verlegt eine Person aus dem Wartebereich auf den Platz (art=wechsel)', async () => {
    // Zweiter Fall derselben Ableitung: wer bereits in DIESER UHS ist, wechselt.
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    const senke: { body: unknown } = { body: null };
    server.use(belegungRoute(7, senke));
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByTestId('platz-karte'));
    await waehlePatient(/R-007/);
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(senke.body).not.toBeNull());
    expect(senke.body).toEqual({ art: 'wechsel', uhs_id: 1, platz_id: 10 });
  });

  it('bietet den Zuweisungsweg auch über das Platzaktionen-Menü an', async () => {
    // Der Wurzelklick ist die grosse Berührungsfläche; im Fükw (Tastatur+Maus) ist das
    // Menü der Weg dorthin, weil ein `div onClick` keinen Tastaturzugang hat. Ein eigener
    // Knopf auf der Karte scheidet aus — die Zeile trägt mit vier Knöpfen ihre volle Breite
    // (`platzBedienform`, Dateikopf). In den Berührungsstufen steht er ohnehin im Kartenmenü.
    //
    // DER NAME SAGT BEWUSST NICHT „Tastaturweg": gefahren wird hier mit der Maus. Der Weg
    // ist für die Tastatur gedacht, aber ein antd-Dropdown mit `trigger={['click']}` ist
    // in jsdom nicht per Tastatur zu öffnen (gemessen: Enter auf dem Auslöser, danach
    // Pfeil und Enter im Menü — der Dialog bleibt zu). Belegt ist damit, DASS der Eintrag
    // existiert und den Dialog öffnet; NICHT, dass eine Tastatur ihn erreicht. Ein
    // Testname, der das behauptet, wäre die Sorte Zusicherung, die diese Datei an drei
    // anderen Stellen ausgeräumt hat.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    await userEvent.click(within(offenesMenue()).getByText('Patient zuweisen'));

    expect(await screen.findByRole('combobox', { name: 'Patient' })).toBeInTheDocument();
  });

  it('löst beim Klick auf einen Menüeintrag NICHT zusätzlich die Platzzuweisung aus', async () => {
    // AK2 / gemessener Portal-Fall (LFH-365/MetaChip): das Dropdown rendert im Portal,
    // sein Synthetic Event steigt aber im KOMPONENTEN-Baum auf und erreicht den
    // Wurzel-onClick der Karte. Ein stopPropagation am Auslöser allein genügt dort nicht.
    // MIT zuweisbarer Person rendern: ohne sie zeigte der Dialog „Niemand zuweisbar" statt
    // eines Auswahlfelds, und eine Prüfung auf die Auswahl wäre blind — gemessen, der Test
    // blieb dann auch mit entferntem Riegel grün. Geprüft wird deshalb der DIALOG.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({
      status: 'aktiv',
      plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'defekt' })],
    });
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/10/verfuegbarkeit', () => HttpResponse.json({})),
    );
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    await userEvent.click(within(offenesMenue()).getByText('als frei markieren'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('löst beim Klick auf einen Aktions-Button NICHT zusätzlich die Platzzuweisung aus', async () => {
    // Zweite Hälfte von AK2: die direkten Icon-Buttons stoppten bisher nur `pointerdown`,
    // nicht `click` — ein Wurzel-onClick feuerte damit bei jedem Aktionsklick mit.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({
      status: 'aktiv',
      plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'aufbereitung' })],
    });
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/10/verfuegbarkeit', () => HttpResponse.json({})),
    );
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByRole('button', { name: 'als frei markieren' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reagiert nicht auf den Klick, wenn der Platz bereits belegt ist', async () => {
    // Festlegung LFH-367: nur unbelegte Plätze nehmen per Klick auf. Ein belegter Platz
    // trägt bereits eigene Klickziele (Personenkarte, Transport, Zurückweisen).
    //
    // Die ZWEITE Person ist der Grund, dass dieser Test etwas belegt: mit dem Belegenden
    // allein wäre die Kandidatenmenge leer (er steht weder im Wartebereich noch unter
    // „noch nicht aufgenommen"), der Dialog zeigte „Niemand zuweisbar" statt einer Auswahl
    // — und eine Prüfung darauf bliebe auch ohne die `belegtVon`-Bedingung grün. Gemessen.
    const belegend = person({
      id: 7,
      registrier_nr: 7,
      aktuelle_uhs_id: 1,
      aktueller_platz_id: 10,
    });
    const wartend = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [belegend, wartend]);

    await userEvent.click(await screen.findByTestId('platz-karte'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Auch der Menü-Weg schweigt: der Eintrag steht nur an zuweisbaren Plätzen.
    await userEvent.click(screen.getByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    expect(within(offenesMenue()).queryByText('Patient zuweisen')).not.toBeInTheDocument();
  });

  it('nimmt auch einen defekten oder gesperrten Platz per Klick auf', async () => {
    // Festlegung LFH-367: „frei" ist UNBELEGT, nicht `verfuegbarkeit === 'frei'`. Der
    // Drag-Weg prüft die Verfügbarkeit ebenfalls nicht — der Klickweg darf nicht strenger
    // sein als die Geste, die er ersetzt.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({
      status: 'aktiv',
      plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'gesperrt' })],
    });
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByTestId('platz-karte'));

    expect(await screen.findByRole('combobox', { name: 'Patient' })).toBeInTheDocument();
  });

  it('bietet keinen Zuweisungsweg im schreibgeschützten Modus', async () => {
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p], true);

    await userEvent.click(await screen.findByTestId('platz-karte'));

    expect(screen.queryByRole('combobox', { name: 'Patient' })).not.toBeInTheDocument();
  });

  it('bietet keinen Zuweisungsweg im Bearbeiten-Modus (dort verschiebt der Klick Layout)', async () => {
    // Im Bearbeiten-Modus ist die Karte Drag-Source fürs Layout. Ein Zuweisungsdialog
    // daneben stellte den Klick gegen die Geste, die dort gemeint ist.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByRole('button', { name: 'Plätze bearbeiten' }));
    await userEvent.click(await screen.findByTestId('platz-karte'));

    expect(screen.queryByRole('combobox', { name: 'Patient' })).not.toBeInTheDocument();
  });

  it('meldet statt eines Dialogs, wenn niemand zuweisbar ist', async () => {
    // Kein Dialog mit totem Primär-Knopf: der hätte nichts zu erfassen und schlösse nur.
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);

    await userEvent.click(await screen.findByTestId('platz-karte'));

    expect(await screen.findByText(/Niemand zuweisbar/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Grundriss – Berührungsbedienung: kein Scroll-Riegel (LFH-367/B5g, AK3)', () => {
  // Das AK des Elterntickets forderte `touchAction: 'none'` auf beiden Draggables. In der
  // Fassung wäre es eine REGRESSION: alle drei Träger liegen in overflow:auto-Containern,
  // und die Angabe schaltet natives Scrollen auf dem Element ab — das Tablet könnte die
  // Platzliste nicht mehr scrollen. Der PointerSensor deckt Berührung über Pointer Events
  // bereits ab (dnd-kit empfiehlt PointerSensor ODER MouseSensor+TouchSensor, nicht beides).
  // Geprüft wird der Inline-Style, nicht ein Pixel: jsdom rechnet kein Layout.
  it('setzt auf der Platzkarte keine Angabe, die das Scrollen der Fläche abschaltet', async () => {
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, []);
    const karte = await screen.findByTestId('platz-karte');
    expect(karte.style.touchAction).toBe('');
  });

  it('setzt auch auf der ziehbaren Personenkarte keine solche Angabe', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [] });
    renderGrundriss(uhs, [p]);
    const tag = await screen.findByText(/R-007/);
    const traeger = tag.closest('div');
    expect(traeger).not.toBeNull();
    expect(traeger!.style.touchAction).toBe('');
  });
});

describe('Grundriss – Personenkarte im Neuentwurf (LFH-621)', () => {
  // Kein antd-`Tag` mehr: die Karte ist eine Personenmarke in Paneel-Optik, die
  // Registriernummer läuft Mono. Die e2e-Specs greifen sie über `data-lfh`, nicht über
  // eine antd-Klasse — die Abwesenheit von `.ant-tag` ist deshalb Teil der Aussage.
  it('rendert die Karte als Personenmarke mit Mono-Nummer, nicht als antd-Tag', async () => {
    const p = person({ id: 7, registrier_nr: 7, name: 'Müller', aktuelle_uhs_id: null });
    renderGrundriss(uhsDetail({}), [p]);
    const nr = await screen.findByText('R-007');
    const karte = nr.closest('[data-lfh="personenkarte"]') as HTMLElement | null;
    expect(karte).not.toBeNull();
    expect(karte).toHaveTextContent('R-007 · Müller');
    expect(karte!.closest('.ant-tag')).toBeNull();
    expect(karte!.querySelector('.ant-tag')).toBeNull();
    expect(nr.style.fontFamily).toContain('JetBrains Mono');
    expect(nr.style.fontVariantNumeric).toBe('tabular-nums');
  });
});

describe('Grundriss – Patient-Detail-Drawer (Klick)', () => {
  function detail(p: Person): PersonDetail {
    return { ...p, sichtungen: [], notizen: [], verbleib: [], abgleiche: [] };
  }

  it('öffnet beim Klick auf eine Wartebereichs-Karte den Detail-Drawer', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: null });
    server.use(http.get('/api/einsaetze/1/personen/7', () => HttpResponse.json(detail(p))));
    renderGrundriss(uhsDetail({}), [p]);
    await userEvent.click(await screen.findByText(/R-007/));
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vollständig öffnen' })).toBeInTheDocument();
  });

  it('öffnet den Detail-Drawer auch für eine belegte Platz-Person', async () => {
    const p = person({ id: 8, registrier_nr: 8, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    server.use(http.get('/api/einsaetze/1/personen/8', () => HttpResponse.json(detail(p))));
    renderGrundriss(uhs, [p]);
    await userEvent.click(await screen.findByText(/R-008/));
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
  });

  it('öffnet den Detail-Drawer auch im schreibgeschützten Modus (nur ansehen)', async () => {
    const p = person({ id: 9, registrier_nr: 9, aktuelle_uhs_id: null });
    server.use(http.get('/api/einsaetze/1/personen/9', () => HttpResponse.json(detail(p))));
    renderGrundriss(uhsDetail({}), [p], true);
    await userEvent.click(await screen.findByText(/R-009/));
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
  });

  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert (kein leerer Drawer)', async () => {
    const p = person({ id: 11, registrier_nr: 11, aktuelle_uhs_id: null });
    server.use(
      http.get('/api/einsaetze/1/personen/11', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderGrundriss(uhsDetail({}), [p]);
    await userEvent.click(await screen.findByText(/R-011/));
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });
});

/**
 * Kartenform der Platzkarte in den Berührungsstufen (LFH-359 + LFH-379). Gerendert mit dem
 * App-Theme der Stufe `komfortabel`: dort wählt `platzBedienform` die Karte als EINZIGES Ziel,
 * ein Tipp öffnet das Aktionsmenü. Die Trefffläche selbst misst Playwright
 * (`uhs-grundriss-touch.spec.ts`) — jsdom rechnet kein Layout.
 */
describe('Grundriss – Kartenform in den Berührungsstufen (LFH-359)', () => {
  function offenesMenue(): HTMLElement {
    const offen = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    if (!offen) throw new Error('kein offenes Dropdown-Menü im Baum');
    return offen as HTMLElement;
  }
  const keinOffenesMenue = () =>
    document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]') === null;
  /**
   * „Das Menü ist zu" wird am AUSLÖSER gelesen (`aria-expanded`), nicht am Portal: antd hängt
   * `ant-dropdown-hidden` erst am Ende der Ausblend-Animation an, und jsdom feuert kein
   * `transitionend` — das Portal sähe dort offen aus (gemessen).
   */
  const menueZu = (name = 'Aktionen zu Bett 1') =>
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
  /** Die Menüeinträge in Reihenfolge, per Teilstring greifbar (Icons bringen ihr
   *  englisches aria-label mit, s. `platzMenueEintraege`). */
  const eintraege = () =>
    within(offenesMenue())
      .getAllByRole('menuitem')
      .map((e) => e.textContent ?? '');

  const unbelegt = () =>
    uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
  const belegtePerson = () =>
    person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
  const wartend = () => person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });

  it('trägt keine Knöpfe in der Karte, die Karte selbst ist der Auslöser', async () => {
    renderGrundriss(unbelegt(), [wartend()], false, 'komfortabel');
    const karte = await screen.findByRole('button', { name: 'Aktionen zu Bett 1' });
    expect(karte).toBe(screen.getByTestId('platz-karte'));
    expect(karte).toHaveAttribute('aria-haspopup', 'menu');
    expect(within(karte).queryAllByRole('button')).toHaveLength(0);
    // Gegenprobe: die Knöpfe der Zeilenform gibt es nirgends.
    expect(screen.queryByRole('button', { name: /Platzaktionen zu/ })).not.toBeInTheDocument();
  });

  it('öffnet beim Tipp auf einen unbelegten Platz das Menü, nicht den Zuweisungsdialog', async () => {
    renderGrundriss(unbelegt(), [wartend()], false, 'komfortabel');
    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen zu Bett 1' }));

    expect(eintraege()[0]).toContain('Patient zuweisen');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktionen zu Bett 1' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // Zweiter Tipp: „Patient zuweisen" öffnet den Dialog, das Menü geht zu.
    await userEvent.click(within(offenesMenue()).getByText('Patient zuweisen'));
    expect(await screen.findByRole('combobox', { name: 'Patient' })).toBeInTheDocument();
    menueZu();
  });

  it('führt beim belegten Platz Verbleib oben, Person und Rückweg, zurückweisen zuletzt', async () => {
    renderGrundriss(unbelegt(), [belegtePerson()], false, 'komfortabel');
    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen zu Bett 1' }));

    const namen = eintraege();
    expect(namen[0]).toContain('Verbleib / Entlassung erfassen');
    expect(namen[1]).toContain('Person öffnen');
    expect(namen[2]).toContain('Zurück in den Wartebereich');
    expect(namen[namen.length - 1]).toContain('zurückweisen');
    expect(
      within(offenesMenue()).getByRole('menuitem', { name: /zurückweisen/ }).className,
    ).toContain('danger');
  });

  it('öffnet über „Person öffnen" den Detail-Drawer', async () => {
    const p = belegtePerson();
    server.use(
      http.get('/api/einsaetze/1/personen/7', () =>
        HttpResponse.json({ ...p, sichtungen: [], notizen: [], verbleib: [], abgleiche: [] }),
      ),
    );
    renderGrundriss(unbelegt(), [p], false, 'komfortabel');
    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen zu Bett 1' }));
    await userEvent.click(within(offenesMenue()).getByText('Person öffnen'));
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
  });

  it('öffnet über „Verbleib / Entlassung erfassen" den Verbleib-Dialog', async () => {
    renderGrundriss(unbelegt(), [belegtePerson()], false, 'komfortabel');
    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen zu Bett 1' }));
    await userEvent.click(within(offenesMenue()).getByText('Verbleib / Entlassung erfassen'));
    expect(await screen.findByRole('textbox', { name: /Ziel/ })).toBeInTheDocument();
  });

  /**
   * Ein Tipp auf die Personenmarke der Karte ist in dieser Form KEIN eigener Weg: er steigt
   * zur Karte auf und öffnet das Menü (verschachtelte 24-px-Ziele verbieten die Stufen).
   */
  it('öffnet beim Tipp auf die Personenmarke das Menü, nicht direkt den Drawer', async () => {
    renderGrundriss(unbelegt(), [belegtePerson()], false, 'komfortabel');
    await userEvent.click(await screen.findByText(/R-007/));
    expect(eintraege()[0]).toContain('Verbleib / Entlassung erfassen');
    // Der Drawer ist ein `dialog` und stünde sofort im Baum (sein Inhalt lädt erst danach —
    // eine Textprüfung auf den Inhalt wäre blind, gemessen per Mutationsprobe).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('löst mit einer Menüwahl weder die Zuweisung aus noch öffnet es das Menü erneut', async () => {
    const uhs = uhsDetail({
      status: 'aktiv',
      plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'frei' })],
    });
    let gesendet: unknown = null;
    server.use(
      http.post('/api/einsaetze/1/uhs/1/plaetze/10/verfuegbarkeit', async ({ request }) => {
        gesendet = await request.json();
        return HttpResponse.json({});
      }),
    );
    // MIT zuweisbarer Person: sonst zeigte ein fälschlich ausgelöster Zuweisungsweg nur
    // eine Meldung statt eines Dialogs, und die Prüfung darauf wäre blind.
    renderGrundriss(uhs, [wartend()], false, 'komfortabel');
    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen zu Bett 1' }));
    await userEvent.click(within(offenesMenue()).getByText('als defekt markieren'));

    await waitFor(() => expect(gesendet).not.toBeNull());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    menueZu();
  });

  it('öffnet das Menü mit Enter und mit der Leertaste', async () => {
    renderGrundriss(unbelegt(), [wartend()], false, 'komfortabel');
    const karte = await screen.findByRole('button', { name: 'Aktionen zu Bett 1' });
    karte.focus();
    await userEvent.keyboard('{Enter}');
    expect(eintraege()[0]).toContain('Patient zuweisen');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => menueZu());
    karte.focus();
    await userEvent.keyboard(' ');
    // Am AUSLÖSER gelesen, nicht am Portal: das alte Portal stünde in jsdom nach Esc noch
    // sichtbar im Baum (kein `transitionend`), eine Prüfung der Einträge wäre hier blind.
    expect(karte).toHaveAttribute('aria-expanded', 'true');
  });

  /**
   * Im Bearbeiten-Modus gehört die Leertaste dem Tastatur-Zug des Layouts (dnd-kits
   * KeyboardSensor). Und das Enter, das einen laufenden Zug ABLEGT, darf nicht zusätzlich das
   * Menü öffnen — dnd-kit beendet den Zug an `document`, Reacts Handler an der Karte läuft
   * vorher und sähe sonst ein gewöhnliches Enter.
   */
  it('lässt im Bearbeiten-Modus die Leertaste dem Zug und öffnet beim Ablegen kein Menü', async () => {
    // dnd-kits KeyboardSensor ruft beim Start `scrollIntoView`, das jsdom nicht kennt.
    const vorher = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    onTestFinished(() => {
      Element.prototype.scrollIntoView = vorher;
    });
    renderGrundriss(unbelegt(), [wartend()], false, 'komfortabel');
    await userEvent.click(await screen.findByRole('button', { name: 'Plätze bearbeiten' }));
    const karte = await screen.findByRole('button', { name: 'Aktionen zu Bett 1' });
    karte.focus();
    await userEvent.keyboard(' ');
    expect(karte).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Enter}');
    expect(karte).toHaveAttribute('aria-expanded', 'false');
    // Gegenprobe: ohne laufenden Zug öffnet Enter auch im Bearbeiten-Modus das Menü.
    karte.focus();
    await userEvent.keyboard('{Enter}');
    expect(karte).toHaveAttribute('aria-expanded', 'true');
  });

  /**
   * Spec „kein weiteres Klickziel verschachtelt" — an einer BELEGTEN Karte, denn nur dort
   * steckt die ziehbare Personenmarke darin. dnd-kits `useDraggable` setzt `role="button"`
   * und `tabIndex` auch bei `disabled`; eine unbelegte Karte sähe diesen Fall nie.
   */
  it('trägt auch bei belegtem Platz kein fokussierbares Ziel in der Karte', async () => {
    renderGrundriss(unbelegt(), [belegtePerson()], false, 'komfortabel');
    const karte = await screen.findByRole('button', { name: 'Aktionen zu Bett 1' });
    await within(karte).findByText(/R-007/);
    expect(within(karte).queryAllByRole('button')).toHaveLength(0);
    expect(karte.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0);
    // Die Kinder eines benannten Knopfs sind präsentational — Belegung und Person hängen
    // deshalb als Beschreibung am Kartenknopf.
    expect(karte).toHaveAccessibleDescription(/belegt.*R-007/);
  });

  it('trägt auch ohne Schreibrecht kein fokussierbares Ziel in der belegten Karte', async () => {
    renderGrundriss(unbelegt(), [belegtePerson()], true, 'komfortabel');
    const karte = await screen.findByRole('button', { name: 'Bett 1: Person öffnen' });
    await within(karte).findByText(/R-007/);
    expect(within(karte).queryAllByRole('button')).toHaveLength(0);
    expect(karte.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0);
  });

  /**
   * Ein Live-Update, das die Belegung ändert, baut die Einträge um: aus „Patient zuweisen"
   * würde „Verbleib / Entlassung erfassen", und hinten erschiene das `danger` „zurückweisen"
   * — unter dem Finger, dieselbe Lage, gegen die LFH-457 gebaut ist. Das offene Menü gehört
   * zu dem Zustand, in dem es geöffnet wurde, und schließt, wenn der sich ändert.
   */
  it('schließt ein offenes Menü, wenn sich die Belegung des Platzes live ändert', async () => {
    const { client } = renderGrundriss(unbelegt(), [wartend()], false, 'komfortabel');
    const karte = await screen.findByRole('button', { name: 'Aktionen zu Bett 1' });
    await userEvent.click(karte);
    expect(karte).toHaveAttribute('aria-expanded', 'true');

    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), [
        { ...wartend(), aktuelle_uhs_id: 1, aktueller_platz_id: 10 },
      ]);
    });
    await within(karte).findByText(/R-005/);
    expect(karte).toHaveAttribute('aria-expanded', 'false');

    // Und es bleibt zu, wenn die Belegung zurückspringt (zweites Live-Update, Rollback
    // nach 409): der gemerkte Zustand „frei" darf das Menü nicht von selbst wieder öffnen.
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), [wartend()]);
    });
    await waitFor(() => expect(within(karte).queryByText(/R-005/)).not.toBeInTheDocument());
    expect(karte).toHaveAttribute('aria-expanded', 'false');
  });

  it('bietet im Bearbeiten-Modus Verfügbarkeiten und Löschen, aber kein Zuweisen', async () => {
    renderGrundriss(unbelegt(), [wartend()], false, 'komfortabel');
    await userEvent.click(await screen.findByRole('button', { name: 'Plätze bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aktionen zu Bett 1' }));

    const namen = eintraege();
    expect(namen.some((n) => n.includes('Patient zuweisen'))).toBe(false);
    expect(namen.some((n) => n.includes('als defekt markieren'))).toBe(true);
    expect(namen[namen.length - 1]).toContain('Platz löschen');
  });

  it('öffnet ohne Schreibrecht beim belegten Platz direkt die Person, ohne Menü', async () => {
    const p = belegtePerson();
    server.use(
      http.get('/api/einsaetze/1/personen/7', () =>
        HttpResponse.json({ ...p, sichtungen: [], notizen: [], verbleib: [], abgleiche: [] }),
      ),
    );
    renderGrundriss(unbelegt(), [p], true, 'komfortabel');
    const karte = await screen.findByRole('button', { name: 'Bett 1: Person öffnen' });
    expect(karte).not.toHaveAttribute('aria-haspopup');
    await userEvent.click(karte);
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
    expect(keinOffenesMenue()).toBe(true);
  });

  it('macht ohne Schreibrecht einen unbelegten Platz zu keinem Ziel', async () => {
    renderGrundriss(unbelegt(), [], true, 'komfortabel');
    const karte = await screen.findByTestId('platz-karte');
    expect(karte).not.toHaveAttribute('role');
    expect(karte).not.toHaveAttribute('tabindex');
    await userEvent.click(karte);
    expect(keinOffenesMenue()).toBe(true);
  });
});

/**
 * Bedienform der Platzkarte je Dichtestufe (LFH-359 + LFH-379; Vorgänger LFH-378 · B5l).
 *
 * Die Karte ist fest 140 × 116 px (Innenraum 124 × 100), weil `raster_position` im Backend
 * die Felder vergibt. Eine Aktionszeile aus vier Knöpfen trägt sie nur, solange die Knöpfe in
 * die 24 px hohe Zeile UND samt dem vollen `marginSM` neben „zurückweisen" (LFH-363) in die
 * 124 px Breite passen. Das gilt nur in `kompakt`: 4 × 24 + 3 × 7 = 117. Ab `komfortabel`
 * reißt schon die Höhe (48 > 24) — und die Breite (4 × 48 = 192), das war LFH-379. Dort wird
 * die ganze Karte das eine Bedienziel und öffnet ein Menü.
 *
 * Der Deckel aus LFH-378 (`aktionsabstand`, Ergebnis 7 / 0 / 0) ist entfallen: er schützte
 * eine Zeile, die zu breit war, und die gibt es nicht mehr. In der Zeilenform ist der Abstand
 * schlicht `marginSM`, und die Zeilenform gibt es nur, wenn der hineinpasst.
 *
 * ── WARUM EINE REINE FUNKTION UND NICHT DAS DOM ─────────────────────────────────
 *
 * `test/utils.tsx` montiert ein nacktes `ConfigProvider` OHNE unser Theme, und jsdom rechnet
 * kein Layout. Geprüft wird deshalb die Entscheidung je Stufe, mit den Tokens aus
 * `antdToken(…, stufe)` (ein Staffelwechsel in `tokens.ts` zieht den Test mit) gegen
 * LITERALE Böden (sonst prüfte der Token sich selbst).
 */
describe('Grundriss – Bedienform der Platzkarte je Dichtestufe (LFH-359/LFH-379)', () => {
  const tokenFuer = (stufe: Dichte) => {
    const t = antdToken(farbenDunkel, stufe)!;
    return {
      controlHeight: t.controlHeight!,
      controlHeightSM: t.controlHeightSM!,
      marginSM: t.marginSM!,
    };
  };
  /** Innenbreite der Karte: 140 − 2 × 2 Rand − 2 × 6 Polsterung. */
  const INNENBREITE = 124;

  it('trägt in kompakt die Knopfzeile mit vollem marginSM, und sie passt in die Karte', () => {
    const form = platzBedienform(tokenFuer('kompakt'));
    expect(form).toEqual({ form: 'zeile', abstand: 7 });
    // AK 1 LFH-379: Knopfbreiten + Lücken ≤ Innenbreite. Die Knöpfe sind icon-only und
    // damit `controlHeightSM` breit (antd `genSizeSmallButtonStyle`), der Boden in kompakt
    // ist 24 (A1 Gate 3).
    const t = tokenFuer('kompakt');
    expect(t.controlHeightSM).toBeGreaterThanOrEqual(24);
    expect(
      4 * t.controlHeightSM + 3 * (form.form === 'zeile' ? form.abstand : 0),
    ).toBeLessThanOrEqual(INNENBREITE);
  });

  it('macht in komfortabel und Handschuh die ganze Karte zum Bedienziel', () => {
    expect(platzBedienform(tokenFuer('komfortabel'))).toEqual({ form: 'karte' });
    expect(platzBedienform(tokenFuer('handschuh'))).toEqual({ form: 'karte' });
  });

  /** AK 2 LFH-379: ein dichteblinder Festwert flöge erst an der Ungleichheit auf. */
  it('ist über zwei Dichtestufen ungleich, statt auf einem Festwert zu kleben', () => {
    expect(platzBedienform(tokenFuer('kompakt'))).not.toEqual(
      platzBedienform(tokenFuer('komfortabel')),
    );
  });

  /**
   * Die Lücke geht UNGEDECKELT ein: passt der volle `marginSM` neben „zurückweisen" nicht,
   * gibt es keine Zeile (AK 4 LFH-379, Trennlinie LFH-363). Mit Deckel (der Weg aus LFH-378)
   * käme hier `zeile` mit einer kleineren Lücke heraus.
   */
  it('baut keine Zeile, in der die Lücke neben dem Gefahrknopf gekürzt werden müsste', () => {
    // 4 × 24 + 3 × 10 = 126 > 124.
    expect(platzBedienform({ controlHeightSM: 24, marginSM: 10 })).toEqual({
      form: 'karte',
    });
  });

  it('baut keine Zeile, deren Knöpfe höher sind als die 24-px-Aktionszeile', () => {
    // Schmal genug (4 × 26 + 3 × 2 = 110), aber 26 > 24.
    expect(platzBedienform({ controlHeightSM: 26, marginSM: 2 })).toEqual({
      form: 'karte',
    });
  });

  it('trägt als Kartenziel in jeder Stufe mindestens die volle Steuerhöhe in beiden Achsen', () => {
    // Literale Böden der Staffel (A1 Festlegung 4): 30 / 48 / 72. Die Kartenmaße kommen aus
    // der Komponente — wer die Karte verkleinert, soll hier auffliegen, nicht an einer Kopie.
    for (const [stufe, boden] of [
      ['kompakt', 30],
      ['komfortabel', 48],
      ['handschuh', 72],
    ] as const) {
      expect(tokenFuer(stufe).controlHeight, stufe).toBe(boden);
      expect(PLATZ_KARTE_BREITE, stufe).toBeGreaterThanOrEqual(boden);
      expect(PLATZ_KARTE_HOEHE, stufe).toBeGreaterThanOrEqual(boden);
    }
  });
});

/**
 * Inhalt des Platzmenüs (LFH-359). EINE reine Ableitung für beide Formen: die Zeilenform
 * behält ihr „…"-Menü unverändert, die Kartenform nimmt die Knöpfe der Zeile als Einträge
 * mit auf — Primäraktion oben, Gefahr hinter dem Trenner (LFH-365). Geprüft wird die
 * Schlüsselfolge (Trenner als „—") und die Sperren; die Beschriftung prüfen die
 * Render-Tests der Kartenform.
 */
describe('Grundriss – Inhalt des Platzmenüs (LFH-359)', () => {
  const grund = {
    belegt: false,
    zuweisbar: false,
    wartebereich: false,
    bearbeitbar: false,
    belegungLaeuft: false,
  };
  type Eintrag = { key?: unknown; type?: string; disabled?: boolean; danger?: boolean } | null;
  const folge = (items: Eintrag[]) => items.map((i) => (i?.type === 'divider' ? '—' : i?.key));
  const gesperrt = (items: Eintrag[]) =>
    items.filter((i) => i?.disabled).map((i) => i?.key as string);
  const gefahr = (items: Eintrag[]) => items.filter((i) => i?.danger).map((i) => i?.key as string);
  const VERF = ['frei', 'defekt', 'aufbereitung', 'gesperrt'];

  describe('Zeilenform (kompakt) — der Bestand, gepinnt', () => {
    it('unbelegt im Betrieb: Zuweisen, Trenner, Verfügbarkeiten', () => {
      const items = platzMenueEintraege({ ...grund, form: 'zeile', zuweisbar: true });
      expect(folge(items)).toEqual(['zuweisen', '—', ...VERF]);
    });
    it('belegt: Wartebereich vor den Verfügbarkeiten, keine Patientenaktionen (die sind Knöpfe)', () => {
      const items = platzMenueEintraege({
        ...grund,
        form: 'zeile',
        belegt: true,
        wartebereich: true,
      });
      expect(folge(items)).toEqual(['wartebereich', ...VERF]);
    });
    it('Bearbeiten-Modus: Löschen hinter dem Trenner, als Gefahr', () => {
      const items = platzMenueEintraege({ ...grund, form: 'zeile', bearbeitbar: true });
      expect(folge(items)).toEqual([...VERF, '—', 'storno']);
      expect(gefahr(items)).toEqual(['storno']);
    });
  });

  describe('Kartenform (komfortabel/Handschuh)', () => {
    it('unbelegt: „Patient zuweisen" steht oben', () => {
      const items = platzMenueEintraege({ ...grund, form: 'karte', zuweisbar: true });
      expect(folge(items)).toEqual(['zuweisen', '—', ...VERF]);
    });

    it('belegt: Verbleib oben, dann Person und Wartebereich, zurückweisen hinter dem Trenner', () => {
      const items = platzMenueEintraege({
        ...grund,
        form: 'karte',
        belegt: true,
        wartebereich: true,
      });
      expect(folge(items)).toEqual([
        'verbleib',
        'person',
        'wartebereich',
        '—',
        ...VERF,
        '—',
        'zurueckweisen',
      ]);
      expect(gefahr(items)).toEqual(['zurueckweisen']);
    });

    it('Bearbeiten-Modus, unbelegt: Verfügbarkeiten und Löschen, kein Zuweisen', () => {
      const items = platzMenueEintraege({ ...grund, form: 'karte', bearbeitbar: true });
      expect(folge(items)).toEqual([...VERF, '—', 'storno']);
    });

    it('Bearbeiten-Modus, belegt: beide Gefahraktionen im selben Block', () => {
      const items = platzMenueEintraege({
        ...grund,
        form: 'karte',
        belegt: true,
        wartebereich: true,
        bearbeitbar: true,
      });
      expect(folge(items).slice(-3)).toEqual(['—', 'zurueckweisen', 'storno']);
      expect(gefahr(items)).toEqual(['zurueckweisen', 'storno']);
    });

    /**
     * LFH-457: sperren statt entfernen. Gesperrt ist, was eine zweite Bewegung derselben
     * Person anstößt; „Person öffnen" und die Verfügbarkeiten bleiben frei.
     */
    it('sperrt bei laufender Belegung die Bewegungen der Person, entfernt aber nichts', () => {
      const lage = { ...grund, form: 'karte' as const, belegt: true, wartebereich: true };
      const frei = platzMenueEintraege(lage);
      const laufend = platzMenueEintraege({ ...lage, belegungLaeuft: true });
      expect(folge(laufend)).toEqual(folge(frei));
      expect(gesperrt(laufend)).toEqual(['verbleib', 'wartebereich', 'zurueckweisen']);
      expect(gesperrt(frei)).toEqual([]);
    });

    it('sperrt bei laufender Belegung auch das Zuweisen eines freien Platzes', () => {
      const items = platzMenueEintraege({
        ...grund,
        form: 'karte',
        zuweisbar: true,
        belegungLaeuft: true,
      });
      expect(gesperrt(items)).toEqual(['zuweisen']);
    });
  });
});

describe('Grundriss – Platzmenü während laufender Belegung (LFH-457)', () => {
  /** Zwei Plätze: „Bett 1" belegt (Ausgangspunkt der Belegungs-Mutation), „Bett 2" frei
   *  (der Platz, an dem danach das Menü geöffnet wird — genau der gemeldete Bedienweg). */
  function zweiPlaetze() {
    return uhsDetail({
      status: 'aktiv',
      plaetze: [
        platz({ id: 10, bezeichnung: 'Bett 1' }),
        platz({ id: 11, bezeichnung: 'Bett 2', pos_x: 200 }),
      ],
    });
  }

  /** Belegungs-Route, deren Antwort erst auf Zuruf kommt — die Mutation bleibt so lange
   *  `pending`, und genau dieses Fenster ist der Gegenstand des Befunds. */
  function haengendeBelegung(personId: number) {
    let freigeben: (() => void) | undefined;
    const tor = new Promise<void>((aufloesen) => {
      freigeben = aufloesen;
    });
    server.use(
      http.post(`/api/einsaetze/1/personen/${personId}/uhs-belegung`, async () => {
        await tor;
        return HttpResponse.json({
          id: 1,
          einsatz_id: 1,
          person_id: personId,
          uhs_id: 1,
          platz_id: null,
          art: 'wechsel',
          notiz: null,
          zeitpunkt_at: 'x',
          erfasst_von: 1,
        });
      }),
    );
    return () => freigeben?.();
  }

  /** Das ZULETZT geöffnete Menü. antd lässt die Portale geschlossener Dropdowns im Baum
   *  stehen und markiert sie in jsdom nicht immer als `hidden` — ein `querySelector` traf
   *  deshalb das Menü des zuerst geöffneten Platzes (gemessen: „Zurück in den
   *  Wartebereich" statt der Verfügbarkeiten). */
  function menue(): HTMLElement | null {
    const offen = document.querySelectorAll(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    return (offen[offen.length - 1] as HTMLElement) ?? null;
  }

  /** Startet die Belegung über „Zurück in den Wartebereich" an Bett 1 und lässt sie laufen. */
  async function starteBelegung() {
    await userEvent.click(await screen.findByRole('button', { name: /Platzaktionen zu Bett 1/ }));
    await userEvent.click(within(menue()!).getByText('Zurück in den Wartebereich'));
  }

  it('lässt das Platzmenü eines anderen Platzes erreichbar, während eine Belegung läuft', async () => {
    // DER BEFUND, gemessen (LFH-457): `belegMut.isPending` fuhr als `schreibgeschuetzt` in
    // die Platzkarte, und die rendert ihren Menü-Auslöser unter `{!schreibgeschuetzt && …}`.
    // Damit verschwanden während JEDER Belegung ALLE Auslöser aus dem Baum — im Browser
    // gemessen 26 bis 397 ms lang. Ein Portal-Overlay stirbt mit seinem Auslöser; wer in
    // diesem Fenster klickt, greift ins Leere.
    const belegend = person({
      id: 7,
      registrier_nr: 7,
      aktuelle_uhs_id: 1,
      aktueller_platz_id: 10,
    });
    const freigeben = haengendeBelegung(7);
    renderGrundriss(zweiPlaetze(), [belegend]);

    await starteBelegung();

    // Die Mutation läuft noch (die Route ist nicht freigegeben) — trotzdem ist das Menü
    // des NACHBARPLATZES erreichbar und bleibt offen.
    const ausloeser = screen.getByRole('button', { name: /Platzaktionen zu Bett 2/ });
    await userEvent.click(ausloeser);
    expect(within(menue()!).getByText('als in Aufbereitung markieren')).toBeInTheDocument();

    freigeben();
  });

  it('startet während einer laufenden Belegung KEINE zweite über den Klickweg', async () => {
    // Die Gegenaussage: `belegMut.isPending` hatte einen Zweck — es verhinderte, dass
    // parallel eine zweite Belegung angestoßen wird. Der Schutz muss die Trennung
    // überleben, sonst tauscht der Fix einen Bedienbefund gegen einen Datenbefund.
    const belegend = person({
      id: 7,
      registrier_nr: 7,
      aktuelle_uhs_id: 1,
      aktueller_platz_id: 10,
    });
    const wartend = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const freigeben = haengendeBelegung(7);
    renderGrundriss(zweiPlaetze(), [belegend, wartend]);

    await starteBelegung();

    // Wurzelklick auf den freien Nachbarplatz — kein Zuweisungsdialog.
    await userEvent.click(screen.getAllByTestId('platz-karte')[1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // … und der Menüweg dorthin steht GESPERRT da, statt zu verschwinden: ein Eintrag,
    // der aus dem offenen Menü fällt und später wiederkommt, verschöbe die Liste unter
    // dem Cursor. Geprüft wird beides — dass er sichtbar ist UND nicht auslöst.
    await userEvent.click(screen.getByRole('button', { name: /Platzaktionen zu Bett 2/ }));
    const eintrag = within(menue()!).getByRole('menuitem', { name: /Patient zuweisen/ });
    expect(eintrag).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(eintrag);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    freigeben();
  });

  it('sperrt „Zurück in den Wartebereich" an einer FREMDEN Karte, statt ihn zu entfernen', async () => {
    // Derselbe Vertrag wie beim Eintrag darüber, und der unauffälligere Fall: der Rückweg
    // hing an `belegMut.isPending` und fiel damit während JEDER Belegung aus dem Menü
    // JEDER belegten Karte — auch an Karten, die mit der laufenden Bewegung nichts zu tun
    // haben. Das ist genau der Mechanismus, den dieses Ticket abgestellt hat; bei
    // `autoFocus: true` verliert eine Tastaturbedienung dabei ihren Platz.
    const bewegt = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const fremd = person({ id: 9, registrier_nr: 9, aktuelle_uhs_id: 1, aktueller_platz_id: 11 });
    const freigeben = haengendeBelegung(5);
    renderGrundriss(zweiPlaetze(), [bewegt, fremd]);

    // Belegung an Bett 1 anstoßen (über den Rückweg dieser Karte) …
    await starteBelegung();

    // … und an der FREMDEN, weiterhin belegten Karte steht der Eintrag gesperrt da.
    await userEvent.click(screen.getByRole('button', { name: /Platzaktionen zu Bett 2/ }));
    const eintrag = within(menue()!).getByRole('menuitem', { name: /Zurück in den Wartebereich/ });
    expect(eintrag).toHaveAttribute('aria-disabled', 'true');

    freigeben();
  });

  it('sperrt die Patientenaktionen der Zielkarte, solange die Belegung läuft', async () => {
    // Die zweite Hälfte desselben Schutzes, und die unauffälligere: das OPTIMISTISCHE
    // Update setzt die Person sofort auf den Zielplatz, also erscheinen dort auch sofort
    // „Verbleib / Entlassung erfassen" und „zurückweisen" — beide auf DIESELBE Person und
    // denselben Endpunkt wie die noch laufende Belegung. Solange `belegMut.isPending` als
    // `schreibgeschuetzt` durchfuhr, war das strukturell unmöglich; seit der Trennung muss
    // es ausdrücklich gesperrt werden, sonst tauscht der Fix einen Bedienbefund gegen
    // einen Datenbefund. Gesperrt, nicht entfernt — ein Verschwinden wäre genau der
    // Mechanismus, gegen den dieses Ticket geschrieben ist.
    const wartend = person({
      id: 5,
      registrier_nr: 5,
      aktuelle_uhs_id: 1,
      aktueller_platz_id: null,
    });
    const freigeben = haengendeBelegung(5);
    renderGrundriss(zweiPlaetze(), [wartend]);

    // Zuweisen über den Klickweg an Bett 1 — die Person sitzt danach optimistisch dort.
    await userEvent.click((await screen.findAllByTestId('platz-karte'))[0]);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Patient' }));
    const liste = await waitFor(() => {
      const el = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      if (!el) throw new Error('kein offenes Auswahlfeld');
      return el as HTMLElement;
    });
    await userEvent.click(within(liste).getByText(/R-005/));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByRole('button', { name: 'zurückweisen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verbleib / Entlassung erfassen' })).toBeDisabled();

    freigeben();
  });
});
