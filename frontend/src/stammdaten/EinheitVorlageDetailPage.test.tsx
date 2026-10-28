import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { EINHEIT_TYPEN, RETTUNGSSTAFFEL, SANITAETSZUG, VORLAGEN } from '../test/einheitVorlagen';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import EinheitVorlageDetailPage from './EinheitVorlageDetailPage';
import { einheitVorlageDetailPath } from './stammdatenDetail';

/** LLH-1042: Detailseite einer Einheiten-Vorlage (Spec `einheit-vorlagen`). */

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

function fahrzeug(id: number, funkrufname: string, dienststatus = 'in_dienst') {
  return {
    id,
    funkrufname,
    fahrzeugtyp: 'RTW',
    sondersignal: true,
    dienststatus,
    angelegt_at: '2026-05-26 10:00:00',
    ist_demo: false,
  };
}

function person(id: number, name: string, staerke_position: string, dienststatus = 'in_dienst') {
  return {
    id,
    name,
    staerke_position,
    dienststatus,
    qualifikationen: [],
    angelegt_at: '2026-05-26 09:00:00',
    ist_demo: false,
  };
}

const FAHRZEUGE = [
  fahrzeug(31, 'Rotkreuz Musterstadt 11-1'),
  // In Dienst gestellt: ausgeschlossen ist es dann nur, weil es schon in der Staffel steht.
  fahrzeug(32, 'Rotkreuz Musterstadt 83-1'),
  fahrzeug(33, 'Rotkreuz Musterstadt 83-2'),
  fahrzeug(34, 'Rotkreuz Musterstadt 83-3', 'ausser_dienst'),
];

function material(
  id: number,
  bezeichnung: string,
  art: 'geraet' | 'verbrauchsgut',
  bestandsnummer: string | null = null,
  dienststatus = 'in_dienst',
) {
  return {
    id,
    bezeichnung,
    art,
    bestandsnummer,
    dienststatus,
    angelegt_at: '2026-05-26 09:00:00',
    ist_demo: false,
  };
}

/** LLH-1261: 61 und 62 stehen in der Staffel; 63 ist ein Stück im selben Baum, 65 außer Dienst. */
const MATERIAL = [
  material(61, 'Wolldecke', 'verbrauchsgut'),
  material(62, 'Sanitätsrucksack', 'geraet'),
  material(63, 'Stromerzeuger', 'geraet', 'SE-1'),
  material(64, 'Trage', 'geraet', 'TR-2'),
  material(65, 'Absaugpumpe', 'geraet', null, 'ausser_dienst'),
];

const PERSONAL = [
  person(41, 'Anna Zugführer', 'fuehrer'),
  person(42, 'Ben Sani', 'mannschaft'),
  person(43, 'Cora Urlaub', 'mannschaft', 'ausser_dienst'),
];

interface Calls {
  list: number;
  patch: unknown[];
  fahrzeuge: unknown[];
  personal: unknown[];
  material: unknown[];
}

function handler(benutzer = admin) {
  const calls: Calls = { list: 0, patch: [], fahrzeuge: [], personal: [], material: [] };
  server.use(
    meHandler(benutzer),
    http.get('/api/einheit-vorlagen', () => {
      calls.list += 1;
      return HttpResponse.json(VORLAGEN);
    }),
    http.get('/api/einheit-typen', () => HttpResponse.json(EINHEIT_TYPEN)),
    http.get('/api/fahrzeuge', () => HttpResponse.json(FAHRZEUGE)),
    http.get('/api/personal', () => HttpResponse.json(PERSONAL)),
    http.get('/api/material', () => HttpResponse.json(MATERIAL)),
    http.patch('/api/einheit-vorlagen/:id', async ({ request }) => {
      calls.patch.push(await request.json());
      return HttpResponse.json(SANITAETSZUG);
    }),
    http.put('/api/einheit-vorlagen/:id/fahrzeuge', async ({ request }) => {
      calls.fahrzeuge.push(await request.json());
      return HttpResponse.json(SANITAETSZUG);
    }),
    http.put('/api/einheit-vorlagen/:id/personal', async ({ request }) => {
      calls.personal.push(await request.json());
      return HttpResponse.json(SANITAETSZUG);
    }),
    http.put('/api/einheit-vorlagen/:id/material', async ({ request }) => {
      calls.material.push(await request.json());
      return HttpResponse.json(RETTUNGSSTAFFEL);
    }),
  );
  return calls;
}

function renderDetail(id: number) {
  return renderMitProviders(
    <Routes>
      <Route path="/admin/stammdaten/einheiten/:vorlageId" element={<EinheitVorlageDetailPage />} />
      <Route path="/admin/stammdaten/einheiten" element={<p>Liste</p>} />
    </Routes>,
    { route: einheitVorlageDetailPath(id), datenRouter: true },
  );
}

const panel = (name: string) => screen.getByRole('region', { name });

describe('EinheitVorlageDetailPage', () => {
  it('zeigt den Kopf aus der Listen-Query, das Soll des Typs als Vorgabe, kein Einzel-GET', async () => {
    const calls = handler();
    renderDetail(SANITAETSZUG.id);
    expect(
      await screen.findByRole('heading', { level: 1, name: /Sanitätszug Musterstadt/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Sanitätszug Musterstadt');
    expect(screen.getByLabelText('Funkrufname')).toHaveValue('Rotkreuz Musterstadt 1');
    expect(screen.getByRole('switch', { name: 'Aktiv' })).toBeChecked();
    // Kein eigenes Soll: die Felder bleiben leer, das des Typs steht als Vorgabe darunter.
    expect(screen.getByLabelText('Führer')).toHaveValue('');
    expect(screen.getByText('Vorgabe des Einheitstyps: 1/2/19//22')).toBeInTheDocument();
    expect(calls.list).toBe(1);
  });

  it('nennt eine fremde oder unbekannte Vorlage nicht gefunden', async () => {
    handler();
    renderDetail(99);
    expect(await screen.findByText('Einheiten-Vorlage nicht gefunden')).toBeInTheDocument();
  });

  it('zeigt Untereinheiten als Link auf ihre Detailseite', async () => {
    handler();
    renderDetail(SANITAETSZUG.id);
    const untereinheiten = await screen.findByRole('region', { name: 'Untereinheiten' });
    expect(within(untereinheiten).getByRole('link', { name: 'Rettungsstaffel' })).toHaveAttribute(
      'href',
      einheitVorlageDetailPath(RETTUNGSSTAFFEL.id),
    );
  });

  it('stellt in jeder Zeile Bedienung mit Abstand neben die Kennung, umbrechend (Treffläche)', async () => {
    handler();
    renderDetail(RETTUNGSSTAFFEL.id);
    const fahrzeuge = await screen.findByRole('region', { name: 'Fahrzeuge' });
    const knopf = within(fahrzeuge).getByRole('button', { name: 'Fahrzeug hinzufügen' });
    const auswahl = within(fahrzeuge).getByRole('combobox', { name: 'Fahrzeug wählen' });
    // Die Zeile ist die nächste Hülle um Auswahl und Knopf. Ohne `display: flex` stünden beide
    // als Inline-Blöcke bündig nebeneinander (gemessen 0 px im Handschuh-Modus).
    let zeile: HTMLElement | null = knopf;
    while (zeile && !zeile.contains(auswahl)) zeile = zeile.parentElement;
    expect(zeile).not.toBeNull();
    expect(zeile!.style.display).toBe('flex');
    expect(parseFloat(zeile!.style.columnGap)).toBeGreaterThan(0);
    expect(parseFloat(zeile!.style.rowGap)).toBeGreaterThan(0);
  });

  it('nennt Warnungen am Fahrzeug als Wort: außer Dienst, auch in …', async () => {
    handler();
    renderDetail(RETTUNGSSTAFFEL.id);
    const fahrzeuge = await screen.findByRole('region', { name: 'Fahrzeuge' });
    expect(within(fahrzeuge).getByText('außer Dienst')).toBeInTheDocument();
    expect(within(fahrzeuge).getByText('auch in Löschzug Nord')).toBeInTheDocument();
  });

  it('speichert nur die geänderten Felder und nennt sie in der Meldung', async () => {
    const calls = handler();
    const user = userEvent.setup();
    renderDetail(SANITAETSZUG.id);
    const funk = await screen.findByLabelText('Funkrufname');
    await user.clear(funk);
    await user.type(funk, 'Rotkreuz Musterstadt 2');
    await user.type(screen.getByLabelText('Mannschaft'), '6');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(calls.patch).toHaveLength(1));
    // Das Soll geht als Trio, leere Felder zählen als 0 (Server: alle drei oder keiner).
    expect(calls.patch[0]).toEqual({
      funkrufname: 'Rotkreuz Musterstadt 2',
      soll_fuehrer: 0,
      soll_unterfuehrer: 0,
      soll_mannschaft: 6,
    });
    expect(await screen.findByText('Gespeichert: Funkrufname, Soll-Stärke')).toBeInTheDocument();
  });

  it('ohne Änderung geht kein PATCH hinaus', async () => {
    const calls = handler();
    const user = userEvent.setup();
    renderDetail(SANITAETSZUG.id);
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    // Ein Takt für eine etwaige Anfrage; die Liste ist inzwischen sicher geladen.
    await waitFor(() => expect(calls.list).toBe(1));
    expect(calls.patch).toHaveLength(0);
  });

  it('bietet als Unterstellung weder die Vorlage selbst noch ihre Nachfahren noch inaktive an', async () => {
    handler();
    const user = userEvent.setup();
    renderDetail(SANITAETSZUG.id);
    await user.click(await screen.findByLabelText('Unter'));
    const option = await screen.findByTitle('Löschzug Nord');
    const dropdown = option.closest('.ant-select-dropdown') as HTMLElement;
    expect(within(dropdown).queryByTitle('Rettungsstaffel')).toBeNull();
    expect(within(dropdown).queryByTitle('Sanitätszug Musterstadt')).toBeNull();
    expect(within(dropdown).queryByTitle('SEG Behandlung')).toBeNull();
  });

  it('entfernt ein Fahrzeug und fügt nur freie Fahrzeuge in Dienst hinzu, je als ganze Liste', async () => {
    const calls = handler();
    const user = userEvent.setup();
    renderDetail(SANITAETSZUG.id);
    const fahrzeuge = await screen.findByRole('region', { name: 'Fahrzeuge' });
    await user.click(
      within(fahrzeuge).getByRole('button', {
        name: 'Rotkreuz Musterstadt 11-1 aus der Vorlage entfernen',
      }),
    );
    await waitFor(() => expect(calls.fahrzeuge).toEqual([{ fahrzeug_ids: [] }]));

    await user.click(within(fahrzeuge).getByLabelText('Fahrzeug wählen'));
    // 83-1 steht schon in der Staffel (selber Baum), 83-3 ist außer Dienst.
    expect(await screen.findByTitle('Rotkreuz Musterstadt 83-2 (RTW)')).toBeInTheDocument();
    expect(screen.queryByTitle('Rotkreuz Musterstadt 83-1 (RTW)')).toBeNull();
    expect(screen.queryByTitle('Rotkreuz Musterstadt 83-3 (RTW)')).toBeNull();
    await user.click(screen.getByTitle('Rotkreuz Musterstadt 83-2 (RTW)'));
    // Der Knopf lud während der vorigen Änderung; das Ladesymbol („loading“) bleibt in jsdom
    // mitten in seiner Ausblendung stehen und hängt sich vor den Namen.
    await user.click(within(fahrzeuge).getByRole('button', { name: /Fahrzeug hinzufügen$/ }));
    await waitFor(() => expect(calls.fahrzeuge[1]).toEqual({ fahrzeug_ids: [31, 33] }));
  });

  it('ändert Position und Fahrzeug der Stammbesetzung und schickt die ganze Liste', async () => {
    const calls = handler();
    const user = userEvent.setup();
    renderDetail(SANITAETSZUG.id);
    const besetzung = await screen.findByRole('region', { name: 'Stammbesetzung' });
    await user.click(within(besetzung).getByLabelText('Position Anna Zugführer'));
    await user.click(await screen.findByTitle('Unterführer'));
    await waitFor(() =>
      expect(calls.personal).toEqual([
        {
          personal: [{ personal_id: 41, fahrzeug_id: 31, staerke_position: 'unterfuehrer' }],
        },
      ]),
    );

    await user.click(within(besetzung).getByLabelText('Person wählen'));
    // Nur in Dienst und noch nicht im Baum.
    expect(await screen.findByTitle('Ben Sani')).toBeInTheDocument();
    expect(screen.queryByTitle('Cora Urlaub')).toBeNull();
    await user.click(screen.getByTitle('Ben Sani'));
    // Der Knopf lud während der vorigen Änderung; das Ladesymbol („loading“) bleibt in jsdom
    // mitten in seiner Ausblendung stehen und hängt sich vor den Namen.
    await user.click(within(besetzung).getByRole('button', { name: /Person hinzufügen$/ }));
    await waitFor(() =>
      expect(calls.personal[1]).toEqual({
        personal: [
          { personal_id: 41, fahrzeug_id: 31, staerke_position: 'fuehrer' },
          { personal_id: 42 },
        ],
      }),
    );
  });

  it('eine abgelehnte Zuordnung nennt ihren Grund im Paneel', async () => {
    handler();
    server.use(
      http.put('/api/einheit-vorlagen/:id/fahrzeuge', () =>
        HttpResponse.json(
          { error: 'Fahrzeug steht schon in diesem Vorlagen-Baum' },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderDetail(SANITAETSZUG.id);
    const fahrzeuge = await screen.findByRole('region', { name: 'Fahrzeuge' });
    await user.click(
      within(fahrzeuge).getByRole('button', {
        name: 'Rotkreuz Musterstadt 11-1 aus der Vorlage entfernen',
      }),
    );
    expect(
      await within(fahrzeuge).findByText('Fahrzeug steht schon in diesem Vorlagen-Baum'),
    ).toBeInTheDocument();
  });

  it('zeigt Material mit Art, Menge und Ort und ändert Menge und Ort als ganze Liste (LLH-1261)', async () => {
    const calls = handler();
    const user = userEvent.setup();
    renderDetail(RETTUNGSSTAFFEL.id);
    const paneel = await screen.findByRole('region', { name: 'Material' });
    expect(within(paneel).getByText('Wolldecke')).toBeInTheDocument();
    expect(within(paneel).getByText('Verbrauchsgut')).toBeInTheDocument();
    expect(within(paneel).getByText('Gerät')).toBeInTheDocument();
    expect(within(paneel).getByLabelText('Menge Wolldecke')).toHaveValue('50');
    // Ohne Fahrzeug steht „an der Einheit“, der Rucksack liegt auf 83-1.
    expect(within(paneel).getByText('an der Einheit')).toBeInTheDocument();
    expect(within(paneel).getByTitle('Rotkreuz Musterstadt 83-1')).toBeInTheDocument();

    const menge = within(paneel).getByLabelText('Menge Wolldecke');
    await user.clear(menge);
    await user.type(menge, '40{Enter}');
    await waitFor(() =>
      expect(calls.material).toEqual([
        {
          material: [
            { material_id: 61, menge: 40, fahrzeug_id: null },
            { material_id: 62, menge: 1, fahrzeug_id: 32 },
          ],
        },
      ]),
    );

    await user.click(within(paneel).getByLabelText('Ort Wolldecke'));
    // Der Titel steht auch am gewählten Wert des Rucksacks; geklickt wird die Option der Liste.
    const optionen = await screen.findAllByTitle('Rotkreuz Musterstadt 83-1');
    const option = optionen.find((e) => e.classList.contains('ant-select-item-option'));
    if (!option) throw new Error('Option 83-1 fehlt');
    await user.click(option);
    await waitFor(() =>
      expect(calls.material[1]).toEqual({
        material: [
          { material_id: 61, menge: 50, fahrzeug_id: 32 },
          { material_id: 62, menge: 1, fahrzeug_id: 32 },
        ],
      }),
    );
  });

  it('eine gleiche oder leere Menge schickt nichts', async () => {
    const calls = handler();
    const user = userEvent.setup();
    renderDetail(RETTUNGSSTAFFEL.id);
    const paneel = await screen.findByRole('region', { name: 'Material' });
    const menge = within(paneel).getByLabelText('Menge Wolldecke');
    await user.click(menge);
    await user.tab();
    await user.clear(menge);
    await user.tab();
    expect(menge).toHaveValue('50');
    expect(calls.material).toEqual([]);
  });

  it('fügt Material in Dienst hinzu, ein Stück nur, wenn es nicht schon im Baum steht', async () => {
    const calls = handler();
    const user = userEvent.setup();
    server.use(
      http.get('/api/einheit-vorlagen', () =>
        HttpResponse.json(
          VORLAGEN.map((v) =>
            v.id === SANITAETSZUG.id
              ? {
                  ...v,
                  material: [
                    {
                      id: 80,
                      material_id: 63,
                      bezeichnung: 'Stromerzeuger',
                      art: 'geraet',
                      bestandsnummer: 'SE-1',
                      menge: 1,
                      dienststatus: 'in_dienst',
                      ist_demo: false,
                    },
                  ],
                }
              : v,
          ),
        ),
      ),
    );
    renderDetail(RETTUNGSSTAFFEL.id);
    const paneel = await screen.findByRole('region', { name: 'Material' });
    await user.click(within(paneel).getByLabelText('Material wählen'));
    // Verbrauchsgut und Gerät ohne Nummer dürfen mehrfach stehen; SE-1 steht am Zug (selber Baum),
    // die Absaugpumpe ist außer Dienst.
    expect(await screen.findByTitle('Trage (TR-2)')).toBeInTheDocument();
    expect(screen.getByTitle('Wolldecke')).toBeInTheDocument();
    expect(screen.queryByTitle('Stromerzeuger (SE-1)')).toBeNull();
    expect(screen.queryByTitle('Absaugpumpe')).toBeNull();
    await user.click(screen.getByTitle('Trage (TR-2)'));
    await user.click(within(paneel).getByRole('button', { name: 'Material hinzufügen' }));
    await waitFor(() =>
      expect(calls.material).toEqual([
        {
          material: [
            { material_id: 61, menge: 50, fahrzeug_id: null },
            { material_id: 62, menge: 1, fahrzeug_id: 32 },
            { material_id: 64, menge: 1 },
          ],
        },
      ]),
    );

    await user.click(
      within(paneel).getByRole('button', { name: 'Wolldecke aus der Vorlage entfernen' }),
    );
    await waitFor(() =>
      expect(calls.material[1]).toEqual({
        material: [{ material_id: 62, menge: 1, fahrzeug_id: 32 }],
      }),
    );
  });

  it('ein Stück mit alter Menge über 1 geht mit Menge 1, damit die Liste speicherbar bleibt', async () => {
    const calls = handler();
    server.use(
      http.get('/api/einheit-vorlagen', () =>
        HttpResponse.json(
          VORLAGEN.map((v) =>
            v.id === RETTUNGSSTAFFEL.id
              ? {
                  ...v,
                  material: [
                    ...RETTUNGSSTAFFEL.material,
                    {
                      id: 82,
                      material_id: 64,
                      bezeichnung: 'Trage',
                      art: 'geraet',
                      bestandsnummer: 'TR-2',
                      menge: 3,
                      dienststatus: 'in_dienst',
                      ist_demo: false,
                    },
                  ],
                }
              : v,
          ),
        ),
      ),
    );
    const user = userEvent.setup();
    renderDetail(RETTUNGSSTAFFEL.id);
    const paneel = await screen.findByRole('region', { name: 'Material' });
    await user.click(
      within(paneel).getByRole('button', { name: 'Wolldecke aus der Vorlage entfernen' }),
    );
    await waitFor(() =>
      expect(calls.material).toEqual([
        {
          material: [
            { material_id: 62, menge: 1, fahrzeug_id: 32 },
            { material_id: 64, menge: 1, fahrzeug_id: null },
          ],
        },
      ]),
    );
  });

  it('ein Stück hat Menge 1 fest; eine Ablehnung steht im Paneel', async () => {
    handler();
    server.use(
      http.get('/api/einheit-vorlagen', () =>
        HttpResponse.json(
          VORLAGEN.map((v) =>
            v.id === RETTUNGSSTAFFEL.id
              ? {
                  ...v,
                  material: [
                    {
                      id: 81,
                      material_id: 63,
                      bezeichnung: 'Stromerzeuger',
                      art: 'geraet',
                      bestandsnummer: 'SE-1',
                      menge: 1,
                      dienststatus: 'ausser_dienst',
                      ist_demo: false,
                    },
                  ],
                }
              : v,
          ),
        ),
      ),
      http.put('/api/einheit-vorlagen/:id/material', () =>
        HttpResponse.json(
          { error: 'Gerät «Stromerzeuger» steht schon in «Zug» im selben Vorlagen-Baum' },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderDetail(RETTUNGSSTAFFEL.id);
    const paneel = await screen.findByRole('region', { name: 'Material' });
    expect(within(paneel).getByLabelText('Menge Stromerzeuger')).toBeDisabled();
    expect(within(paneel).getByText('SE-1')).toBeInTheDocument();
    expect(within(paneel).getByText('außer Dienst')).toBeInTheDocument();
    await user.click(
      within(paneel).getByRole('button', { name: 'Stromerzeuger aus der Vorlage entfernen' }),
    );
    expect(
      await within(paneel).findByText(
        'Gerät «Stromerzeuger» steht schon in «Zug» im selben Vorlagen-Baum',
      ),
    ).toBeInTheDocument();
  });

  it('ohne Admin-Recht nur Ansicht: Grund genannt, Speichern gesperrt, keine Zeilenaktionen', async () => {
    handler(nichtAdmin);
    renderDetail(SANITAETSZUG.id);
    expect(await screen.findByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Untereinheit anlegen' })).toBeDisabled();
    expect(within(panel('Fahrzeuge')).queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Person wählen')).toBeNull();
    expect(within(panel('Material')).queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Material wählen')).toBeNull();
  });
});
