import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { listeVon, waehle } from '../test/auswahlListe';
import type { EinsatzVorlage, StichwortVorschlag } from '../api/types';
import EinsaetzePage from './EinsaetzePage';
import { MODUL_ANZAHL, moduleText } from '../stammdaten/einsatzVorlageModule';
import { adminFixture } from '../test/fixtures';
import {
  OHNE_VORLAGE,
  einsatzartDerVorlage,
  gekoppelteVorlage,
  wahlNachStichwort,
} from './einsatzVorlageWahlKern';

/**
 * Einsatz-Vorlage im Anlegedialog (LLH-1375, Spec `einsatz-vorlagen`, „Der Anlegedialog bietet die
 * Vorlage an“): seit LLH-1816 das oberste von sechs Feldern mit der Modulzahl darunter; das
 * Stichwort koppelt, die Handwahl hat Vorrang, die Vorlage belegt die Einsatzart vor.
 */

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests.
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: () => <div data-testid="kartenausschnitt" />,
}));

const admin = adminFixture();

const VORLAGEN: EinsatzVorlage[] = [
  {
    id: 1,
    bezeichnung: 'Kleinlage',
    einsatzart: 'realeinsatz',
    ausgeblendet: ['lagebesprechung'],
    sortier: 10,
  },
  {
    id: 2,
    bezeichnung: 'Sanitätsdienst',
    einsatzart: 'sanitaetsdienst',
    ausgeblendet: ['lagebesprechung', 'tiere'],
    sortier: 20,
  },
  {
    id: 3,
    bezeichnung: 'MANV',
    einsatzart: 'realeinsatz',
    ausgeblendet: ['lagebesprechung'],
    sortier: 30,
  },
  { id: 4, bezeichnung: 'Ohne Art', ausgeblendet: [], sortier: 40 },
];

const VORSCHLAEGE: StichwortVorschlag[] = [
  { id: 11, text: 'MANV15', vorlage_id: 3 },
  { id: 12, text: 'SAN', vorlage_id: 2 },
  { id: 13, text: 'H1' },
];

/** Rendert die Seite samt Ziel und zeichnet den Anlege-Rumpf auf. */
function setup(vorlagen: EinsatzVorlage[] = VORLAGEN) {
  const rumpf: { wert: Record<string, unknown> | null } = { wert: null };
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze', () => HttpResponse.json([])),
    http.get('/api/einsatz-vorlagen', () => HttpResponse.json(vorlagen)),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(VORSCHLAEGE)),
    http.post('/api/einsaetze', async ({ request }) => {
      rumpf.wert = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          id: 7,
          bezeichnung: 'Unfall A2',
          status: 'aktiv',
          begonnen_at: '2026-05-23 09:00:00',
          meine_rolle: 'einsatzleitung',
        },
        { status: 201 },
      );
    }),
  );
  renderMitProviders(
    <Routes>
      <Route path="/" element={<EinsaetzePage />} />
      <Route path="/einsaetze/:id" element={<div>Workspace-7</div>} />
    </Routes>,
  );
  return rumpf;
}

async function oeffneDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
  const dialog = await screen.findByRole('dialog', { name: 'Neuen Einsatz anlegen' });
  // Die Zeile erscheint mit der Antwort auf die Vorlagen.
  await within(dialog).findByRole('combobox', { name: 'Vorlage' });
  return dialog;
}

/** Der angezeigte Wert einer Auswahl (antd zeigt ihn neben dem Eingabefeld). */
function gewaehlt(feld: string): string {
  return screen.getByRole('combobox', { name: feld }).closest('.ant-select')?.textContent ?? '';
}

async function anlegen(rumpf: { wert: Record<string, unknown> | null }) {
  await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Unfall A2');
  await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
  await waitFor(() => expect(rumpf.wert).not.toBeNull());
  return rumpf.wert!;
}

describe('Anlegedialog · Einsatz-Vorlage (LLH-1375, LLH-1816)', () => {
  it('steht als oberstes Feld „Vorlage“ mit Vorgabe „Alle Module“ und Modulzahl; sechs Felder', async () => {
    setup();
    const dialog = await oeffneDialog();
    expect(gewaehlt('Vorlage')).toBe('Alle Module');
    const felder = dialog.querySelectorAll<HTMLElement>('.ant-form-item');
    // Feldbudget-Ausnahme (frontend/AGENTS.md, LLH-1816): sechs Felder, die Vorlage zuerst.
    expect(felder.length).toBe(6);
    expect(within(felder[0]).getByRole('combobox', { name: 'Vorlage' })).toBeInTheDocument();
    expect(
      within(felder[0]).getByText(`${MODUL_ANZAHL} von ${MODUL_ANZAHL} Modulen`),
    ).toBeInTheDocument();
    // Die alte Zeile „Module:“ unter den Feldern ist weg.
    expect(within(dialog).queryByText('Module:')).toBeNull();
    // Kein Erklärsatz zur Vorlage (LFH-1078).
    expect(within(dialog).queryByText(/blendet/)).toBeNull();
  });

  it('„Bezeichnung“ ist das Fokusziel beim Öffnen, nicht die Vorlage darüber', async () => {
    setup();
    await oeffneDialog();
    // Die Erfassungs-Hülle fokussiert sonst das erste Feld, seit LLH-1816 die Vorlage; das
    // ausdrückliche Ziel bevorzugt sie (`Erfassung.test.tsx`).
    expect(screen.getByLabelText('Bezeichnung')).toHaveAttribute('data-erfassung-fokus');
    expect(screen.getByRole('combobox', { name: 'Vorlage' })).not.toHaveAttribute(
      'data-erfassung-fokus',
    );
  });

  it('zeigt die Modulzahl der gewählten Vorlage', async () => {
    setup();
    const dialog = await oeffneDialog();
    await waehle('Vorlage', 'Sanitätsdienst');
    expect(
      await within(dialog).findByText(moduleText(['lagebesprechung', 'tiere'])),
    ).toBeInTheDocument();
  });

  it('das leere Stichwortfeld klappt keine Vorschläge auf, Tippen schon', async () => {
    setup();
    await oeffneDialog();
    const feld = screen.getByRole('combobox', { name: 'Stichwort' });
    await userEvent.click(feld);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    const optionen = () =>
      [...(listeVon('Stichwort')?.querySelectorAll('.ant-select-item-option') ?? [])].map(
        (k) => k.textContent,
      );
    expect(optionen()).toEqual([]);
    await userEvent.type(feld, 'man');
    await waitFor(() => expect(optionen()).toEqual(['MANV15']));
  });

  it('ohne Vorlagen der Organisation keine Auswahl', async () => {
    let beantwortet = false;
    setup([]);
    server.use(
      http.get('/api/einsatz-vorlagen', () => {
        beantwortet = true;
        return HttpResponse.json([]);
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Einsatz' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neuen Einsatz anlegen' });
    // Erst nach der Antwort ist die Abwesenheit eine Aussage.
    await waitFor(() => expect(beantwortet).toBe(true));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(within(dialog).queryByRole('combobox', { name: 'Vorlage' })).toBeNull();
    expect(dialog.querySelectorAll('.ant-form-item').length).toBe(5);
  });

  it('ohne Wahl geht kein `vorlage_id` hinaus', async () => {
    const rumpf = setup();
    await oeffneDialog();
    const gesendet = await anlegen(rumpf);
    expect(gesendet).not.toHaveProperty('vorlage_id');
  });

  it('ein gekoppeltes Stichwort stellt die Vorlage ein und schickt sie mit', async () => {
    const rumpf = setup();
    await oeffneDialog();
    await userEvent.type(screen.getByRole('combobox', { name: 'Stichwort' }), 'MANV15');
    await waitFor(() => expect(gewaehlt('Vorlage')).toBe('MANV'));
    const gesendet = await anlegen(rumpf);
    expect(gesendet.vorlage_id).toBe(3);
    expect(gesendet.stichwort).toBe('MANV15');
  });

  it('ein Stichwort ohne Kopplung stellt eine gekoppelte Vorlage zurück', async () => {
    setup();
    await oeffneDialog();
    const feld = screen.getByRole('combobox', { name: 'Stichwort' });
    await userEvent.type(feld, 'MANV15');
    await waitFor(() => expect(gewaehlt('Vorlage')).toBe('MANV'));
    await userEvent.clear(feld);
    await userEvent.type(feld, 'H1');
    await waitFor(() => expect(gewaehlt('Vorlage')).toBe('Alle Module'));
  });

  it('Handwahl hat Vorrang: erst „Kleinlage“, dann „MANV15“, die Vorlage bleibt', async () => {
    const rumpf = setup();
    await oeffneDialog();
    await waehle('Vorlage', 'Kleinlage');
    await userEvent.type(screen.getByRole('combobox', { name: 'Stichwort' }), 'MANV15');
    expect(gewaehlt('Vorlage')).toBe('Kleinlage');
    const gesendet = await anlegen(rumpf);
    expect(gesendet.vorlage_id).toBe(1);
  });

  it('auch die Handwahl „Alle Module“ hat Vorrang vor dem Stichwort', async () => {
    const rumpf = setup();
    await oeffneDialog();
    await waehle('Vorlage', 'Kleinlage');
    await waehle('Vorlage', 'Alle Module');
    await userEvent.type(screen.getByRole('combobox', { name: 'Stichwort' }), 'MANV15');
    expect(gewaehlt('Vorlage')).toBe('Alle Module');
    const gesendet = await anlegen(rumpf);
    expect(gesendet).not.toHaveProperty('vorlage_id');
  });

  it('die Vorlage belegt die Einsatzart vor und schickt sie mit', async () => {
    const rumpf = setup();
    await oeffneDialog();
    expect(gewaehlt('Einsatzart')).toBe('Realeinsatz');
    await waehle('Vorlage', 'Sanitätsdienst');
    await waitFor(() => expect(gewaehlt('Einsatzart')).toBe('Sanitätsdienst'));
    // Zurück auf eine Vorlage ohne Einsatzart: die Startwahl des Dialogs gilt wieder.
    await waehle('Vorlage', 'Ohne Art');
    await waitFor(() => expect(gewaehlt('Einsatzart')).toBe('Realeinsatz'));
    await waehle('Vorlage', 'Sanitätsdienst');
    const gesendet = await anlegen(rumpf);
    expect(gesendet.einsatzart).toBe('sanitaetsdienst');
    expect(gesendet.vorlage_id).toBe(2);
  });

  it('ein gekoppeltes Stichwort belegt über seine Vorlage die Einsatzart vor', async () => {
    setup();
    await oeffneDialog();
    await userEvent.type(screen.getByRole('combobox', { name: 'Stichwort' }), 'SAN');
    await waitFor(() => expect(gewaehlt('Einsatzart')).toBe('Sanitätsdienst'));
  });

  it('eine von Hand geänderte Einsatzart bleibt', async () => {
    const rumpf = setup();
    await oeffneDialog();
    await waehle('Einsatzart', 'Übung');
    await waehle('Vorlage', 'Sanitätsdienst');
    expect(gewaehlt('Einsatzart')).toBe('Übung');
    const gesendet = await anlegen(rumpf);
    expect(gesendet.einsatzart).toBe('uebung');
    expect(gesendet.vorlage_id).toBe(2);
  });

  it('Abbrechen setzt Vorlage und Handwahl zurück', async () => {
    setup();
    await oeffneDialog();
    await waehle('Einsatzart', 'Übung');
    await waehle('Vorlage', 'Kleinlage');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await oeffneDialog();
    expect(gewaehlt('Vorlage')).toBe('Alle Module');
    expect(gewaehlt('Einsatzart')).toBe('Realeinsatz');
    // Die Handwahl ist vergessen: das Stichwort koppelt wieder, die Einsatzart folgt.
    await userEvent.type(screen.getByRole('combobox', { name: 'Stichwort' }), 'SAN');
    await waitFor(() => expect(gewaehlt('Vorlage')).toBe('Sanitätsdienst'));
    expect(gewaehlt('Einsatzart')).toBe('Sanitätsdienst');
  });
});

describe('Anlegedialog · Schichtmodell der Vorlage (LLH-1313)', () => {
  const modell = (id: number, bezeichnung: string, ist_vorgabe: boolean) => ({
    id,
    bezeichnung,
    typ: 'rhythmus',
    rhythmus_minuten: 360,
    vorwarnung_minuten: 30,
    planungsvorlauf_minuten: 120,
    ist_vorgabe,
    ist_demo: false,
  });

  it('nennt das Modell der Vorlage, sonst die Vorgabe der Organisation', async () => {
    const mitModell = VORLAGEN.map((v) => (v.id === 2 ? { ...v, schichtmodell_id: 9 } : v));
    const rumpf = setup(mitModell);
    server.use(
      http.get('/api/schichtmodelle', () =>
        HttpResponse.json([
          modell(1, '12-h-Schicht', true),
          modell(9, 'Sanitätsdienst 6 h', false),
        ]),
      ),
    );
    const dialog = await oeffneDialog();
    expect(
      await within(dialog).findByText('Schichtmodell: 12-h-Schicht (Vorgabe)'),
    ).toBeInTheDocument();

    await waehle('Vorlage', 'Sanitätsdienst');
    expect(
      await within(dialog).findByText('Schichtmodell: Sanitätsdienst 6 h (Vorgabe Vorlage)'),
    ).toBeInTheDocument();
    // Das Schichtmodell ist kein eigenes Feld: sechs Felder samt Vorlage (Feldbudget, LLH-1816).
    expect(dialog.querySelectorAll('.ant-form-item').length).toBe(6);

    await waehle('Vorlage', 'Kleinlage');
    expect(
      await within(dialog).findByText('Schichtmodell: 12-h-Schicht (Vorgabe)'),
    ).toBeInTheDocument();

    // Die Wahl geht nur als `vorlage_id` hinaus; das Modell rechnet der Server.
    await waehle('Vorlage', 'Sanitätsdienst');
    const body = await anlegen(rumpf);
    expect(body.vorlage_id).toBe(2);
    expect(body).not.toHaveProperty('schichtmodell_id');
  });

  it('Vorlage mit Modell ohne Org-Vorgabe zeigt die Zeile erst mit der Vorlage', async () => {
    const mitModell = VORLAGEN.map((v) => (v.id === 3 ? { ...v, schichtmodell_id: 9 } : v));
    setup(mitModell);
    server.use(
      http.get('/api/schichtmodelle', () =>
        HttpResponse.json([modell(9, '12-h-Schicht 0600/1800', false)]),
      ),
    );
    const dialog = await oeffneDialog();
    expect(within(dialog).queryByText(/^Schichtmodell:/)).toBeNull();
    await waehle('Vorlage', 'MANV');
    expect(
      await within(dialog).findByText('Schichtmodell: 12-h-Schicht 0600/1800 (Vorgabe Vorlage)'),
    ).toBeInTheDocument();
  });
});

describe('Anlegedialog · Modell der Vorlage fehlt im Cache (LLH-1313)', () => {
  it('zeigt dann keine Zeile statt der Org-Vorgabe', async () => {
    const mitModell = VORLAGEN.map((v) => (v.id === 2 ? { ...v, schichtmodell_id: 77 } : v));
    setup(mitModell);
    server.use(
      http.get('/api/schichtmodelle', () =>
        HttpResponse.json([
          {
            id: 1,
            bezeichnung: '12-h-Schicht',
            typ: 'rhythmus',
            rhythmus_minuten: 720,
            vorwarnung_minuten: 30,
            planungsvorlauf_minuten: 120,
            ist_vorgabe: true,
            ist_demo: false,
          },
        ]),
      ),
    );
    const dialog = await oeffneDialog();
    expect(
      await within(dialog).findByText('Schichtmodell: 12-h-Schicht (Vorgabe)'),
    ).toBeInTheDocument();
    await waehle('Vorlage', 'Sanitätsdienst');
    await waitFor(() => expect(within(dialog).queryByText(/^Schichtmodell:/)).toBeNull());
  });
});

describe('einsatzVorlageWahlKern', () => {
  it('koppelt nur exakt, nur an eine bekannte Vorlage', () => {
    expect(gekoppelteVorlage('MANV15', VORSCHLAEGE, VORLAGEN)).toBe(3);
    expect(gekoppelteVorlage(' MANV15 ', VORSCHLAEGE, VORLAGEN)).toBe(3);
    expect(gekoppelteVorlage('MANV1', VORSCHLAEGE, VORLAGEN)).toBeNull();
    expect(gekoppelteVorlage('H1', VORSCHLAEGE, VORLAGEN)).toBeNull();
    expect(gekoppelteVorlage(undefined, VORSCHLAEGE, VORLAGEN)).toBeNull();
    // Eine gelöschte Vorlage, deren Kopplung der Cache noch kennt, stellt nichts ein.
    expect(gekoppelteVorlage('MANV15', VORSCHLAEGE, VORLAGEN.slice(0, 2))).toBeNull();
  });

  it('die Handwahl bleibt; ohne Änderung bleibt dieselbe Wahl', () => {
    const hand = { vorlageId: 1, vonHand: true };
    expect(wahlNachStichwort(hand, 'MANV15', VORSCHLAEGE, VORLAGEN)).toBe(hand);
    expect(wahlNachStichwort(OHNE_VORLAGE, 'H1', VORSCHLAEGE, VORLAGEN)).toBe(OHNE_VORLAGE);
    expect(wahlNachStichwort(OHNE_VORLAGE, 'MANV15', VORSCHLAEGE, VORLAGEN)).toEqual({
      vorlageId: 3,
      vonHand: false,
    });
  });

  it('Einsatzart der Vorlage, sonst die Startwahl', () => {
    expect(einsatzartDerVorlage(2, VORLAGEN, 'realeinsatz')).toBe('sanitaetsdienst');
    expect(einsatzartDerVorlage(4, VORLAGEN, 'realeinsatz')).toBe('realeinsatz');
    expect(einsatzartDerVorlage(null, VORLAGEN, 'uebung')).toBe('uebung');
  });
});
