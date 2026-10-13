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
}

function handler(benutzer = admin) {
  const calls: Calls = { list: 0, patch: [], fahrzeuge: [], personal: [] };
  server.use(
    meHandler(benutzer),
    http.get('/api/einheit-vorlagen', () => {
      calls.list += 1;
      return HttpResponse.json(VORLAGEN);
    }),
    http.get('/api/einheit-typen', () => HttpResponse.json(EINHEIT_TYPEN)),
    http.get('/api/fahrzeuge', () => HttpResponse.json(FAHRZEUGE)),
    http.get('/api/personal', () => HttpResponse.json(PERSONAL)),
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
    await user.click(within(fahrzeuge).getByRole('button', { name: 'Fahrzeug hinzufügen' }));
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
    await user.click(within(besetzung).getByRole('button', { name: 'Person hinzufügen' }));
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

  it('ohne Admin-Recht nur Ansicht: Grund genannt, Speichern gesperrt, keine Zeilenaktionen', async () => {
    handler(nichtAdmin);
    renderDetail(SANITAETSZUG.id);
    expect(await screen.findByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Untereinheit anlegen' })).toBeDisabled();
    expect(within(panel('Fahrzeuge')).queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Person wählen')).toBeNull();
  });
});
