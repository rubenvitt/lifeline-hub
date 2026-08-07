import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { server } from '../../test/server';
import { App as AntApp } from 'antd';
import Grundriss, { aktionsabstand } from './Grundriss';
import { dichten } from '../../theme/tokens';
import type { Person, PersonDetail, UhsBelegung, UhsDetail, UhsPlatz } from '../../api/types';
import { einsatzKeys } from '../../api/queryKeys';

function person(over: Partial<Person>): Person {
  return {
    id: 1, einsatz_id: 1, registrier_nr: 42, status: 'betroffen', name: null, vorname: null,
    geschlecht: null, geburtsdatum: null, alter_geschaetzt: null, herkunft_adresse: null,
    antreff_ort: null, melder_kontakt: null, notiz: null, erfasst_at: 'x', erfasst_von: 1,
    geaendert_at: 'x', geaendert_von: 1, storniert_at: null, aktuelle_sichtung: null,
    aktuelle_sichtung_at: null, aktueller_verbleib: null, aktuelle_uhs_id: null,
    aktueller_platz_id: null, ...over,
  };
}

function platz(over: Partial<UhsPlatz>): UhsPlatz {
  return {
    id: 10, uhs_id: 1, typ: 'bett', bezeichnung: 'Bett 1', pos_x: 10, pos_y: 10,
    verfuegbarkeit: 'frei', reserviert_fuer_person_id: null, storniert_at: null, ...over,
  };
}

function uhsDetail(over: Partial<UhsDetail>): UhsDetail {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz', bezeichnung: 'BHP 50',
    standort: null, notiz: null, lat: null, lon: null, status: 'aktiv',
    erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
    plaetze: [], belegungen: [], material: [], ...over,
  };
}

function renderGrundriss(uhs: UhsDetail, personen: Person[], schreibgeschuetzt = false) {
  server.use(http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ergebnis = render(
    // MemoryRouter: der Detail-Drawer (PersonDetailDrawer) nutzt useNavigate; in der App
    // läuft Grundriss immer unter einer Route.
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <AntApp>
          <Grundriss einsatzId={1} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
        </AntApp>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { ...ergebnis, client: qc };
}

describe('Grundriss – Belegt-Anzeige (LFH-18)', () => {
  it('zeigt einen Platz als belegt, sobald eine Person darauf zugewiesen ist', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [p]);
    // Person-Tag bestätigt, dass die Belegung geladen ist …
    expect(await screen.findByText(/R-007|R-7|· unbekannt/)).toBeInTheDocument();
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
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'defekt' })] });
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
          id: 1, einsatz_id: 1, person_id: 7, uhs_id: 1, platz_id: null,
          art: 'austritt', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
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
    expect(screen.queryByRole('button', { name: 'Verbleib / Entlassung erfassen' })).not.toBeInTheDocument();
  });
});

describe('Grundriss – Verbleib / Entlassung erfassen (LFH-17)', () => {
  it('erfasst Transport (Default-Art) über den Platz-Button + Modal', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    let body: { art?: string; ziel?: string | null; transportmittel?: string | null; status?: string | null } | null = null;
    server.use(
      http.post('/api/einsaetze/1/personen/7/verbleib', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          id: 1, einsatz_id: 1, person_id: 7, art: 'transport', transportmittel: 'RTW',
          ziel: 'KH Mitte', status: 'abtransportiert', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
        });
      }),
    );
    renderGrundriss(uhs, [p]);
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }));
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
          id: 1, einsatz_id: 1, person_id: 7, art: 'entlassung', transportmittel: null,
          ziel: null, status: null, notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
        });
      }),
    );
    renderGrundriss(uhs, [p]);
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }));
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
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }));
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
    server.use(http.post('/api/einsaetze/1/personen/7/verbleib', () =>
      HttpResponse.json({ error: 'Verbleib abgelehnt' }, { status: 500 })));
    renderGrundriss(uhs, [p]);
    await userEvent.click(await screen.findByRole('button', { name: 'Verbleib / Entlassung erfassen' }));
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
    const p = person({ id: 9, registrier_nr: 9, aktuelle_uhs_id: null, aktueller_verbleib: 'Transport → KH Mitte' });
    const austritt: UhsBelegung = {
      id: 1, einsatz_id: 1, person_id: 9, uhs_id: 1, platz_id: null,
      art: 'austritt', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
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
    expect(await screen.findByText(/R-005|· unbekannt/)).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Platzaktionen' })).toBeInTheDocument();
  });

  it('zeigt „als frei markieren" als direkte Primäraktion für einen Platz in Aufbereitung', async () => {
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'aufbereitung' })] });
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
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'frei' })] });
    renderGrundriss(uhs, []);
    await screen.findByText('Bett 1');
    expect(screen.queryByRole('button', { name: 'als frei markieren' })).not.toBeInTheDocument();
    // Das vollständige Menü bleibt aber erreichbar.
    expect(screen.getByRole('button', { name: 'Platzaktionen' })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Verbleib / Entlassung erfassen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Platzaktionen' })).not.toBeInTheDocument();
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
        id: 1, einsatz_id: 1, person_id: personId, uhs_id: 1, platz_id: 10,
        art: 'eintritt', notiz: null, zeitpunkt_at: 'x', erfasst_von: 1,
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
    const gate = new Promise<void>((resolve) => { freigeben = resolve; });
    server.use(http.post('/api/einsaetze/1/personen/5/uhs-belegung', async () => {
      await gate;
      return HttpResponse.json({ error: 'Platz inzwischen belegt' }, { status: 409 });
    }));
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
    const refetchGate = new Promise<void>((resolve) => { refetchFreigeben = resolve; });
    server.use(http.get('/api/einsaetze/1/personen', async () => {
      await refetchGate;
      return HttpResponse.json([{ ...p, name: 'Extern geändert' }, anderePerson]);
    }));
    act(() => {
      client.setQueryData<Person[]>(einsatzKeys.personen(1), (aktuell) =>
        aktuell?.map((eintrag) => eintrag.id === 5 ? { ...eintrag, name: 'Extern geändert' } : eintrag));
    });

    await act(async () => { freigeben?.(); });
    await waitFor(() => {
      const zurueckgerollt = client.getQueryData<Person[]>(einsatzKeys.personen(1));
      expect(zurueckgerollt?.find((eintrag) => eintrag.id === 5))
        .toMatchObject({ aktuelle_uhs_id: null, aktueller_platz_id: null });
      expect(zurueckgerollt?.find((eintrag) => eintrag.id === 5)?.name).toBe('Extern geändert');
    });
    await act(async () => { refetchFreigeben?.(); });
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
    // Knopf auf der Karte scheidet aus — sie ist an SCHRITT_Y gedeckelt (s. Dateikopf).
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

    await userEvent.click(await screen.findByRole('button', { name: 'Platzaktionen' }));
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
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'defekt' })] });
    server.use(http.post('/api/einsaetze/1/uhs/1/plaetze/10/verfuegbarkeit', () => HttpResponse.json({})));
    renderGrundriss(uhs, [p]);

    await userEvent.click(await screen.findByRole('button', { name: 'Platzaktionen' }));
    await userEvent.click(within(offenesMenue()).getByText('als frei markieren'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('löst beim Klick auf einen Aktions-Button NICHT zusätzlich die Platzzuweisung aus', async () => {
    // Zweite Hälfte von AK2: die direkten Icon-Buttons stoppten bisher nur `pointerdown`,
    // nicht `click` — ein Wurzel-onClick feuerte damit bei jedem Aktionsklick mit.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'aufbereitung' })] });
    server.use(http.post('/api/einsaetze/1/uhs/1/plaetze/10/verfuegbarkeit', () => HttpResponse.json({})));
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
    const belegend = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const wartend = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    renderGrundriss(uhs, [belegend, wartend]);

    await userEvent.click(await screen.findByTestId('platz-karte'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Auch der Menü-Weg schweigt: der Eintrag steht nur an zuweisbaren Plätzen.
    await userEvent.click(screen.getByRole('button', { name: 'Platzaktionen' }));
    expect(within(offenesMenue()).queryByText('Patient zuweisen')).not.toBeInTheDocument();
  });

  it('nimmt auch einen defekten oder gesperrten Platz per Klick auf', async () => {
    // Festlegung LFH-367: „frei" ist UNBELEGT, nicht `verfuegbarkeit === 'frei'`. Der
    // Drag-Weg prüft die Verfügbarkeit ebenfalls nicht — der Klickweg darf nicht strenger
    // sein als die Geste, die er ersetzt.
    const p = person({ id: 5, registrier_nr: 5, aktuelle_uhs_id: null });
    const uhs = uhsDetail({ status: 'aktiv', plaetze: [platz({ id: 10, bezeichnung: 'Bett 1', verfuegbarkeit: 'gesperrt' })] });
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

describe('Grundriss – Patient-Detail-Drawer (Klick)', () => {
  function detail(p: Person): PersonDetail {
    return { ...p, sichtungen: [], notizen: [], verbleib: [], abgleiche: [] };
  }

  it('öffnet beim Klick auf eine Wartebereichs-Karte den Detail-Drawer', async () => {
    const p = person({ id: 7, registrier_nr: 7, aktuelle_uhs_id: null });
    server.use(http.get('/api/einsaetze/1/personen/7', () => HttpResponse.json(detail(p))));
    renderGrundriss(uhsDetail({}), [p]);
    await userEvent.click(await screen.findByText(/R-007|· unbekannt/));
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vollständig öffnen' })).toBeInTheDocument();
  });

  it('öffnet den Detail-Drawer auch für eine belegte Platz-Person', async () => {
    const p = person({ id: 8, registrier_nr: 8, aktuelle_uhs_id: 1, aktueller_platz_id: 10 });
    const uhs = uhsDetail({ plaetze: [platz({ id: 10, bezeichnung: 'Bett 1' })] });
    server.use(http.get('/api/einsaetze/1/personen/8', () => HttpResponse.json(detail(p))));
    renderGrundriss(uhs, [p]);
    await userEvent.click(await screen.findByText(/R-008|· unbekannt/));
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
  });

  it('öffnet den Detail-Drawer auch im schreibgeschützten Modus (nur ansehen)', async () => {
    const p = person({ id: 9, registrier_nr: 9, aktuelle_uhs_id: null });
    server.use(http.get('/api/einsaetze/1/personen/9', () => HttpResponse.json(detail(p))));
    renderGrundriss(uhsDetail({}), [p], true);
    await userEvent.click(await screen.findByText(/R-009|· unbekannt/));
    expect(await screen.findByText('Medizinischer Verlauf (neueste zuerst)')).toBeInTheDocument();
  });

  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert (kein leerer Drawer)', async () => {
    const p = person({ id: 11, registrier_nr: 11, aktuelle_uhs_id: null });
    server.use(http.get('/api/einsaetze/1/personen/11', () =>
      HttpResponse.json({ error: 'kaputt' }, { status: 500 })));
    renderGrundriss(uhsDetail({}), [p]);
    await userEvent.click(await screen.findByText(/R-011|· unbekannt/));
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });
});

/**
 * Aktionszeile der Platzkarte — der Abstand zwischen dem `danger`-Knopf „zurückweisen"
 * und seinen neutralen Nachbarn (LFH-378 · B5l, Befund 3 aus dem Review zu LFH-367).
 *
 * ── WARUM GEDECKELT UND NICHT SCHLICHT `token.marginSM` ─────────────────────────
 *
 * Der Befund wollte `gap: 4` gegen `token.marginSM` (7 / 11 / 16) tauschen. Die Rechnung
 * im Ticket rechnete mit „vier Knöpfen à 24 px" — das gilt aber nur in der KOMPAKTEN
 * Stufe. Nachgemessen am 31.07.2026: antd gibt einem icon-only-Knopf `width:
 * controlHeightSM` (`button/style/index.js`, `genSizeSmallButtonStyle`), also 24 / 48 / 72.
 * Die Knöpfe sind Flex-Items ohne `flex-shrink: 0` und schrumpfen deshalb auf den
 * Innenraum der Karte. Ab `komfortabel` brauchen allein vier Knöpfe 4 × 48 = 192 px in
 * einer 124 px breiten Zeile — die Zeile ist schon OHNE Lücke überfüllt, und jede Lücke
 * nimmt den Knöpfen zusätzlich Trefffläche weg. Ein ungedeckeltes `marginSM` wäre
 * nominell regelkonform und in der Bedienung schlechter.
 *
 * Deshalb: so viel Abstand wie hineinpasst, höchstens `marginSM`. Der Boden aus LFH-363
 * wird damit im Fükw (kompakt, der PRIMÄRE Einsatzkontext) erfüllt; darüber ist die Zeile
 * breitenseitig an `SCHRITT_X = 160` gebunden, wie ihre Höhe an `SCHRITT_Y = 120`.
 *
 * ── WARUM EINE REINE FUNKTION UND NICHT DAS DOM ─────────────────────────────────
 *
 * `test/utils.tsx` montiert ein nacktes `ConfigProvider` OHNE unser Theme, und jsdom
 * rechnet ohnehin kein Layout — ein gemessener Pixel belegte hier nichts. Geprüft wird der
 * PROP-WERT je Dichtestufe, gegen LITERALE: aus dem Token zurückgelesen prüfte die
 * Behauptung den Token gegen sich selbst.
 */
describe('Grundriss – Aktionszeilen-Abstand der Platzkarte (LFH-378)', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    marginSM: dichten[stufe].abstand.sm,
    controlHeightSM: dichten[stufe].kleineZeilenhoehe,
  });

  it('trägt in der kompakten Stufe den Boden aus marginSM', () => {
    // 4 × 24 = 96 px Knöpfe in 124 px Zeile → 9 px je Lücke übrig, marginSM = 7 passt.
    expect(aktionsabstand(tokenFuer('kompakt'))).toBe(7);
  });

  it('fällt auf 0, wo die Knöpfe die Zeile schon allein füllen', () => {
    // 4 × 48 = 192 bzw. 4 × 72 = 288 px in 124 px — jede Lücke ginge von der Trefffläche ab.
    expect(aktionsabstand(tokenFuer('komfortabel'))).toBe(0);
    expect(aktionsabstand(tokenFuer('handschuh'))).toBe(0);
  });

  /**
   * Die eigentliche Aussage: der Wert hängt an der Dichte. Ein dichteblinder Festwert
   * (`gap: 4`, oder auch ein hart gesetztes `7`) bestünde die Literal-Prüfungen oben
   * teilweise — erst die UNGLEICHHEIT über zwei Stufen lässt ihn auffliegen.
   */
  it('ist über zwei Dichtestufen ungleich, statt auf einem Festwert zu kleben', () => {
    expect(aktionsabstand(tokenFuer('kompakt')))
      .not.toBe(aktionsabstand(tokenFuer('komfortabel')));
  });

  /**
   * Und der Deckel greift wirklich am Token, nicht an einer Kopie der Zahl: ein künstlich
   * kleiner `marginSM` bei kompakter Knopfhöhe muss durchschlagen. Ohne `Math.min` gäbe
   * die Funktion hier den Platz zurück (9), nicht die Vorgabe (3).
   */
  it('nimmt marginSM als Obergrenze, nicht als Sollwert', () => {
    expect(aktionsabstand({ marginSM: 3, controlHeightSM: 24 })).toBe(3);
  });
});
