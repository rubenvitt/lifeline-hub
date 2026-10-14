import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from 'antd';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { freigabenFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import { gewaehlteOptionen, oeffne, optionenVon, waehle } from '../test/auswahlListe';
import type { Einheit, EinsatzFahrzeug, EinsatzPersonal, Personal } from '../api/types';
import PersonalDisponierenModal from './PersonalDisponierenModal';

const person = (id: number, name: string, felder: Partial<Personal> = {}): Personal =>
  ({
    id,
    name,
    personalnummer: `P-${id}`,
    ist_demo: false,
    qualifikationen: [],
    dienststatus: 'im_dienst',
    angelegt_at: '2026-10-01T08:00:00Z',
    ...felder,
  }) as Personal;

const POOL: Personal[] = [
  person(1, 'Anna Berg', {
    qualifikationen: [{ id: 3, label: 'Notfallsanitäter' }] as Personal['qualifikationen'],
  }),
  person(2, 'Bernd Clausen'),
  person(3, 'Carla Dorn'),
  person(4, 'Dora Engel'),
  person(5, 'Emil Fuchs'),
];

const EINHEITEN = [
  { id: 10, name: 'Rettungsstaffel', aufgeloest_at: null },
  { id: 20, name: 'Sanitätszug', aufgeloest_at: null },
  { id: 30, name: 'Alter Zug', aufgeloest_at: '2026-10-13T10:00:00Z' },
] as Einheit[];

const FAHRZEUGE = [
  { id: 5, funkrufname: '83-1', fahrzeugtyp: 'RTW', einheit_id: 10 },
  { id: 6, funkrufname: '83-2', fahrzeugtyp: 'KTW', einheit_id: 20 },
] as EinsatzFahrzeug[];

/** Carla ist aktiv disponiert, Dora entlassen: beide gehören nicht in die Auswahl. */
const AKTIV = [{ id: 90, personal_id: 3, name: 'Carla Dorn' }] as EinsatzPersonal[];
const ENTLASSEN = [{ id: 91, personal_id: 4, name: 'Dora Engel' }] as EinsatzPersonal[];

let bodies: unknown[];

function standardHandler(freigaben = freigabenFixture()) {
  server.use(
    http.get('/api/einsaetze/1/modul-freigaben', () => HttpResponse.json(freigaben)),
    http.get('/api/personal', () => HttpResponse.json(POOL)),
    http.get('/api/einsaetze/1/personal', ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.has('entlassene') ? ENTLASSEN : AKTIV),
    ),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(EINHEITEN)),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json(FAHRZEUGE)),
    http.post('/api/einsaetze/1/personal/sammel', async ({ request }) => {
      const body = (await request.json()) as { personal_ids: number[] };
      bodies.push(body);
      return HttpResponse.json(
        body.personal_ids.map((id) => ({ id: 100 + id, personal_id: id })),
        { status: 201 },
      );
    }),
  );
}

beforeEach(() => {
  bodies = [];
});

function Harness({ serie = false }: { serie?: boolean }) {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <Button onClick={() => setOffen(true)}>Wieder öffnen</Button>
      <PersonalDisponierenModal
        offen={offen}
        einsatzId={1}
        serie={serie}
        onSchliessen={() => setOffen(false)}
      />
    </>
  );
}

describe('PersonalDisponierenModal', () => {
  /**
   * Das erste Feld ist ein Select — „Enter sendet" ist nicht belegbar (rc-select verschluckt
   * Enter). Geprüft wird die Struktur, aus der die Zusicherung folgt (`frontend/AGENTS.md`,
   * Erfassungs-Norm).
   */
  it('trägt die Erfassungs-Norm: keine Modal-Fusszeile, Knopf im <form>', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Disponieren' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Personal disponieren' })).toBeInTheDocument();
  });

  /**
   * Feldbudget (LFH-19): höchstens drei sichtbare Felder. Es gibt keinen eingeklappten Teil;
   * die Gegenprobe läuft über die Freigaben: ohne Einheiten und Fahrzeuge bleibt nur die Auswahl,
   * mit ihnen steigt die Zahl auf drei (Spec `kraefte-disposition`, „Rechte der Zielmodule“).
   */
  it('zeigt höchstens drei Felder, die Ziele nur bei Freigabe ihres Moduls', async () => {
    standardHandler();
    const { unmount } = renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('combobox', { name: 'Auf Fahrzeug' });
    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(3);
    // Ohne Ablehnung steht unter der Auswahl keine leere Zeile für die Gründe.
    expect(dialog.querySelector('.ant-form-item-extra')).toBeNull();
    expect(within(dialog).getByRole('combobox', { name: 'Personen' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'In Einheit' })).toBeInTheDocument();
    unmount();

    standardHandler(
      freigabenFixture({ einheiten: { zugriff: false }, fahrzeuge: { zugriff: false } }),
    );
    renderMitProviders(<Harness serie />);
    const gesperrt = await screen.findByRole('dialog');
    await within(gesperrt).findByRole('combobox', { name: 'Personen' });
    // Die Freigaben sind da, wenn das Feld steht: der Dialog wartet nicht auf sie, also ein
    // kurzer Takt, damit ein verspätetes Zielfeld hier auffiele.
    await new Promise((r) => setTimeout(r, 50));
    expect(gesperrt.querySelectorAll('.ant-form-item')).toHaveLength(1);
    expect(within(gesperrt).queryByRole('combobox', { name: 'In Einheit' })).toBeNull();
    expect(within(gesperrt).queryByRole('combobox', { name: 'Auf Fahrzeug' })).toBeNull();
    // Ohne Einheit gibt es nichts zu behalten.
    expect(within(gesperrt).queryByRole('checkbox', { name: 'Werte behalten' })).toBeNull();
  });

  it('bietet weder aktiv disponierte noch entlassene Personen an', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await oeffne('Personen');
    await waitFor(() => expect(optionenVon('Personen')).toContain('Anna Berg (P-1)'));
    expect(optionenVon('Personen')).toEqual([
      'Anna Berg (P-1)',
      'Bernd Clausen (P-2)',
      'Emil Fuchs (P-5)',
    ]);
  });

  it('findet eine Person über ihre Qualifikation', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await oeffne('Personen');
    await waitFor(() => expect(optionenVon('Personen')).toHaveLength(3));
    await userEvent.keyboard('Notfallsan');
    await waitFor(() => expect(optionenVon('Personen')).toEqual(['Anna Berg (P-1)']));
  });

  it('disponiert eine Gruppe in Einheit und Fahrzeug in einem Absenden', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await waehle('Personen', 'Anna Berg (P-1)', 'Bernd Clausen (P-2)');
    await waehle('In Einheit', 'Rettungsstaffel');
    await waehle('Auf Fahrzeug', '83-1 (RTW)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ personal_ids: [1, 2], einheit_id: 10, fahrzeug_id: 5 });
    expect(await screen.findByText('2 Kräfte disponiert')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Wieder öffnen' })).toBeInTheDocument(),
    );
  });

  it('bietet nur Fahrzeuge der gewählten Einheit an und leert ein unpassendes', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await waehle('Auf Fahrzeug', '83-2 (KTW)');
    await waehle('In Einheit', 'Rettungsstaffel');
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).queryByText('83-2 (KTW)')).toBeNull());

    await oeffne('Auf Fahrzeug');
    await waitFor(() => expect(optionenVon('Auf Fahrzeug')).toEqual(['83-1 (RTW)']));
  });

  it('bietet keine aufgelöste Einheit an', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await oeffne('In Einheit');
    await waitFor(() =>
      expect(optionenVon('In Einheit')).toEqual(['Rettungsstaffel', 'Sanitätszug']),
    );
  });

  it('behält im Serienmodus mit „Werte behalten“ die Einheit und leert die Auswahl', async () => {
    standardHandler();
    renderMitProviders(<Harness serie />);
    const dialog = await screen.findByRole('dialog');
    await waehle('Personen', 'Anna Berg (P-1)');
    await waehle('In Einheit', 'Rettungsstaffel');
    await waehle('Auf Fahrzeug', '83-1 (RTW)');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(await within(dialog).findByText('Erfasst: 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Rettungsstaffel')).toBeInTheDocument();
    expect(within(dialog).queryByText('83-1 (RTW)')).toBeNull();
    expect(await gewaehlteOptionen('Personen')).toEqual([]);
  });

  it('verlangt mindestens eine Person, ohne etwas zu senden', async () => {
    standardHandler();
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('combobox', { name: 'Personen' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
    expect(await within(dialog).findByText('Mindestens eine Person wählen')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  describe('Ablehnung mit Grund je Person', () => {
    const ablehnen = () =>
      http.post('/api/einsaetze/1/personal/sammel', () =>
        HttpResponse.json(
          {
            error: 'Nicht alle Kräfte lassen sich disponieren',
            zeilen: [{ art: 'personal', id: 2, grund: 'außer Dienst' }],
          },
          { status: 422 },
        ),
      );

    it('nennt den Grund an der Person im Dialog, behält die Auswahl, kein Toast', async () => {
      standardHandler();
      server.use(ablehnen());
      const onSchliessen = vi.fn();
      renderMitProviders(
        <PersonalDisponierenModal offen einsatzId={1} onSchliessen={onSchliessen} />,
      );
      const dialog = await screen.findByRole('dialog');
      await waehle('Personen', 'Anna Berg (P-1)', 'Bernd Clausen (P-2)');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));

      const liste = await within(dialog).findByRole('list', { name: 'Nicht disponiert' });
      expect(
        within(liste)
          .getAllByRole('listitem')
          .map((l) => l.textContent),
      ).toEqual(['Bernd Clausen (P-2) – außer Dienst']);
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Nicht alle Kräfte lassen sich disponieren',
      );
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
      expect(onSchliessen).not.toHaveBeenCalled();
      // Die Auswahl bleibt stehen.
      expect(await gewaehlteOptionen('Personen')).toEqual([
        'Anna Berg (P-1)',
        'Bernd Clausen (P-2)',
      ]);
    });

    it('nimmt die Abgelehnten auf Knopfdruck aus der Auswahl', async () => {
      standardHandler();
      server.use(ablehnen());
      renderMitProviders(<Harness />);
      const dialog = await screen.findByRole('dialog');
      await waehle('Personen', 'Anna Berg (P-1)', 'Bernd Clausen (P-2)');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
      await within(dialog).findByRole('list', { name: 'Nicht disponiert' });

      await userEvent.click(within(dialog).getByRole('button', { name: 'Abgelehnte abwählen' }));
      await waitFor(() =>
        expect(within(dialog).queryByRole('list', { name: 'Nicht disponiert' })).toBeNull(),
      );
      expect(await gewaehlteOptionen('Personen')).toEqual(['Anna Berg (P-1)']);
    });

    it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
      standardHandler();
      server.use(ablehnen());
      renderMitProviders(<Harness />);
      const dialog = await screen.findByRole('dialog');
      await waehle('Personen', 'Bernd Clausen (P-2)');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Disponieren' }));
      await within(dialog).findByRole('list', { name: 'Nicht disponiert' });

      await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      await userEvent.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
      const wieder = await screen.findByRole('dialog');
      await waitFor(() => {
        expect(within(wieder).queryByRole('alert')).toBeNull();
        expect(within(wieder).queryByRole('list', { name: 'Nicht disponiert' })).toBeNull();
      });
    });
  });
});
