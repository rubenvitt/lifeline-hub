import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import { offeneRueckfrage } from '../test/rueckfrage';
import type { EinsatzVorlage } from '../api/types';
import { modulRegistry } from '../einsatz/modulRegistry';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import EinsatzVorlagenTab from './EinsatzVorlagenTab';
import { ausgeblendetAus, moduleText, sichtbarAus } from './einsatzVorlageModule';

/** Sektion „Einsatz-Vorlagen“ (LLH-1375, design.md D3a). */

const admin = adminFixture();
const nichtAdmin = benutzerFixture({
  id: 2,
  anzeigename: 'Führungskraft',
  org_rolle: 'fuehrungskraft',
});

const VORLAGEN: EinsatzVorlage[] = [
  {
    id: 1,
    bezeichnung: 'Kleinlage',
    einsatzart: 'realeinsatz',
    ausgeblendet: ['stab', 'tiere'],
    sortier: 10,
  },
  { id: 2, bezeichnung: 'Großbrand', ausgeblendet: [], sortier: 20 },
];

function setup(benutzer: typeof admin, vorlagen = VORLAGEN) {
  server.use(
    meHandler(benutzer),
    http.get('/api/einsatz-vorlagen', () => HttpResponse.json(vorlagen)),
  );
  return renderMitProviders(<EinsatzVorlagenTab />);
}

const zeile = (text: string) => screen.getByText(text).closest('tr')!;

describe('EinsatzVorlagenTab (LLH-1375)', () => {
  it('listet Bezeichnung, Einsatzart und „n von N Modulen“ aus der Registry', async () => {
    setup(admin);
    await screen.findByText('Kleinlage');
    const n = modulRegistry.length;
    expect(within(zeile('Kleinlage')).getByText('Realeinsatz')).toBeInTheDocument();
    expect(within(zeile('Kleinlage')).getByText(`${n - 2} von ${n} Modulen`)).toBeInTheDocument();
    // Weder Einsatzart noch Schichtmodell: zweimal „—“.
    expect(within(zeile('Großbrand')).getAllByText('—')).toHaveLength(2);
    expect(within(zeile('Großbrand')).getByText(`${n} von ${n} Modulen`)).toBeInTheDocument();
  });

  it('Spalte „Schichtmodell“ nennt das Modell der Vorlage (LLH-1313)', async () => {
    server.use(
      http.get('/api/schichtmodelle', () =>
        HttpResponse.json([
          {
            id: 9,
            bezeichnung: '12-h-Schicht',
            typ: 'rhythmus',
            rhythmus_minuten: 720,
            vorwarnung_minuten: 30,
            planungsvorlauf_minuten: 120,
            ist_vorgabe: false,
            ist_demo: false,
          },
        ]),
      ),
    );
    setup(admin, [{ ...VORLAGEN[0], schichtmodell_id: 9 }, VORLAGEN[1]]);
    await screen.findByText('Kleinlage');
    expect(screen.getByRole('columnheader', { name: /Schichtmodell/ })).toBeInTheDocument();
    expect(await within(zeile('Kleinlage')).findByText('12-h-Schicht')).toBeInTheDocument();
    expect(within(zeile('Kleinlage')).queryByText('—')).toBeNull();
  });

  it('Admin: Anlegen öffnet das Formular, Bearbeiten belegt es vor', async () => {
    setup(admin);
    await screen.findByText('Kleinlage');
    await userEvent.click(screen.getByRole('button', { name: 'Einsatz-Vorlage anlegen' }));
    expect(
      await screen.findByRole('dialog', { name: 'Einsatz-Vorlage anlegen' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await userEvent.click(screen.getByRole('button', { name: 'Kleinlage bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Einsatz-Vorlage bearbeiten' });
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('Kleinlage'),
    );
    expect(screen.getByRole('checkbox', { name: 'Stab' })).not.toBeChecked();
  });

  it('Löschen fragt zurück und löscht erst nach der Bestätigung', async () => {
    let geloescht: number | null = null;
    setup(admin);
    server.use(
      http.delete('/api/einsatz-vorlagen/:id', ({ params }) => {
        geloescht = Number(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await screen.findByText('Kleinlage');
    await userEvent.click(screen.getByRole('button', { name: 'Kleinlage löschen' }));
    expect(geloescht).toBeNull();
    const rueckfrage = await offeneRueckfrage();
    expect(within(rueckfrage).getByText('Kleinlage löschen?')).toBeInTheDocument();
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Vorlage löschen' }));
    await waitFor(() => expect(geloescht).toBe(1));
  });

  it('ein abgelehntes Löschen nennt den Grund über der Seite', async () => {
    setup(admin);
    server.use(
      http.delete('/api/einsatz-vorlagen/:id', () =>
        HttpResponse.json({ error: 'Vorlage nicht gefunden' }, { status: 404 }),
      ),
    );
    await screen.findByText('Kleinlage');
    await userEvent.click(screen.getByRole('button', { name: 'Kleinlage löschen' }));
    const rueckfrage = await offeneRueckfrage();
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Vorlage löschen' }));
    expect(await screen.findByText('Vorlage nicht gefunden')).toBeInTheDocument();
  });

  it('Nicht-Admin liest nur: Anlegen gesperrt mit Grund, keine Zeilenaktionen', async () => {
    setup(nichtAdmin);
    await screen.findByText('Kleinlage');
    expect(await screen.findByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Einsatz-Vorlage anlegen' })).toBeDisabled(),
    );
    expect(screen.queryByRole('button', { name: 'Kleinlage bearbeiten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kleinlage löschen' })).toBeNull();
  });

  it('ein gescheiterter Abruf zeigt den Fehler, nicht den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsatz-vorlagen', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(<EinsatzVorlagenTab />);
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Einsatz-Vorlagen')).toBeNull();
  });
});

describe('einsatzVorlageModule', () => {
  it('Häkchen und Ausblendungen sind Komplemente in Registry-Reihenfolge', () => {
    const sichtbar = sichtbarAus(['tiere', 'stab']);
    expect(sichtbar).toHaveLength(modulRegistry.length - 2);
    expect(sichtbar).not.toContain('stab');
    const aus = ausgeblendetAus(sichtbar);
    expect(aus).toEqual(
      modulRegistry.map((m) => m.key).filter((k) => k === 'stab' || k === 'tiere'),
    );
  });

  it('nicht ausblendbare Module gehen nie hinaus und bleiben immer sichtbar', () => {
    expect(ausgeblendetAus([])).not.toContain('einsatzdaten');
    expect(ausgeblendetAus([])).not.toContain('einsatz-einstellungen');
    expect(ausgeblendetAus([])).toHaveLength(modulRegistry.length - 2);
    expect(sichtbarAus(['einsatzdaten'])).toContain('einsatzdaten');
  });

  it('unbekannte Schlüssel zählen nicht', () => {
    const n = modulRegistry.length;
    expect(moduleText(['gibt-es-nicht'])).toBe(`${n} von ${n} Modulen`);
    expect(moduleText(['stab'])).toBe(`${n - 1} von ${n} Modulen`);
  });
});
