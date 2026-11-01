import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { waehle } from '../test/auswahlListe';
import type { EinsatzVorlage } from '../api/types';
import { modulRegistry } from '../einsatz/modulRegistry';
import EinsatzVorlageFormModal from './EinsatzVorlageFormModal';

/**
 * Formular einer Einsatz-Vorlage (LLH-1375, design.md D2/D3a): Häkchen = sichtbar, gespeichert
 * wird das Komplement als `ausgeblendet`; nicht ausblendbare Module stehen angehakt und gesperrt.
 */

const MANV: EinsatzVorlage = {
  id: 3,
  bezeichnung: 'MANV',
  einsatzart: 'realeinsatz',
  ausgeblendet: ['stab', 'tiere'],
  sortier: 30,
};

/** Registry-Reihenfolge einer Schlüsselmenge, wie der Server sie in `MODUL_KEYS` führt. */
function inRegistryFolge(keys: string[]): string[] {
  return modulRegistry.map((m) => m.key).filter((k) => keys.includes(k));
}

function aufzeichnen(status = 200) {
  const anfragen: { methode: string; pfad: string; rumpf: unknown }[] = [];
  const antwort = async ({ request }: { request: Request }) => {
    anfragen.push({
      methode: request.method,
      pfad: new URL(request.url).pathname,
      rumpf: await request.json(),
    });
    if (status !== 200) {
      return HttpResponse.json({ error: 'Bezeichnung bereits vergeben' }, { status });
    }
    return HttpResponse.json({ ...MANV, id: 9 }, { status: request.method === 'POST' ? 201 : 200 });
  };
  server.use(
    http.post('/api/einsatz-vorlagen', antwort),
    http.put('/api/einsatz-vorlagen/:id', antwort),
  );
  return anfragen;
}

function Harness({ vorlage = null }: { vorlage?: EinsatzVorlage | null }) {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <span data-testid="offen">{offen ? 'offen' : 'zu'}</span>
      <EinsatzVorlageFormModal offen={offen} vorlage={vorlage} onClose={() => setOffen(false)} />
    </>
  );
}

const kaestchen = (name: string) => screen.getByRole('checkbox', { name });

describe('EinsatzVorlageFormModal (LLH-1375)', () => {
  it('ohne Schichtmodelle der Organisation keine Auswahl „Schichtmodell“', async () => {
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Bezeichnung')).toBeInTheDocument());
    expect(within(dialog).queryByRole('combobox', { name: 'Schichtmodell' })).toBeNull();
  });

  it('drei Felder; neu sind alle Module angehakt, Module nach den Kategorien der Navigation', async () => {
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog', { name: 'Einsatz-Vorlage anlegen' });
    expect(dialog.querySelectorAll('.ant-form-item').length).toBe(3);
    const alle = within(dialog).getAllByRole('checkbox');
    expect(alle).toHaveLength(modulRegistry.length);
    for (const k of alle) expect(k).toBeChecked();
    // Je Kategorie eine benannte Gruppe.
    for (const kategorie of ['Führung', 'Kräfte & Mittel', 'Erfassung', 'Lage', 'Kommunikation']) {
      expect(within(dialog).getByRole('group', { name: kategorie })).toBeInTheDocument();
    }
    expect(
      within(within(dialog).getByRole('group', { name: 'Erfassung' })).getByRole('checkbox', {
        name: 'Unfallhilfsstellen',
      }),
    ).toBeInTheDocument();
  });

  it('nicht ausblendbare Module stehen angehakt, gesperrt und mit Grund', async () => {
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    for (const name of [/^Einsatzdaten/, /^Einstellungen/]) {
      const k = screen.getByRole('checkbox', { name });
      expect(k).toBeChecked();
      expect(k).toBeDisabled();
      expect(k.closest('label')?.textContent).toContain('immer sichtbar');
    }
    expect(kaestchen('Stab')).toBeEnabled();
  });

  it('Anlegen schickt das Komplement der Häkchen als `ausgeblendet`, ohne Einsatzart `null`', async () => {
    const anfragen = aufzeichnen();
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), '  Großbrand ');
    await userEvent.click(kaestchen('Tiere'));
    await userEvent.click(kaestchen('Stab'));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0]).toEqual({
      methode: 'POST',
      pfad: '/api/einsatz-vorlagen',
      rumpf: {
        bezeichnung: 'Großbrand',
        einsatzart: null,
        schichtmodell_id: null,
        ausgeblendet: inRegistryFolge(['stab', 'tiere']),
      },
    });
    await waitFor(() => expect(screen.getByTestId('offen')).toHaveTextContent('zu'));
  });

  it('Bearbeiten belegt vor und speichert als Vollersatz', async () => {
    const anfragen = aufzeichnen();
    renderMitProviders(<Harness vorlage={MANV} />);
    await screen.findByRole('dialog', { name: 'Einsatz-Vorlage bearbeiten' });
    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue('MANV'));
    expect(kaestchen('Stab')).not.toBeChecked();
    expect(kaestchen('Tiere')).not.toBeChecked();
    expect(kaestchen('Unfallhilfsstellen')).toBeChecked();

    await userEvent.click(kaestchen('Stab'));
    await userEvent.click(kaestchen('Betreuung'));
    await waehle('Einsatzart', 'Sanitätsdienst');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(anfragen).toHaveLength(1));
    expect(anfragen[0]).toEqual({
      methode: 'PUT',
      pfad: '/api/einsatz-vorlagen/3',
      rumpf: {
        bezeichnung: 'MANV',
        einsatzart: 'sanitaetsdienst',
        schichtmodell_id: null,
        ausgeblendet: inRegistryFolge(['tiere', 'betreuung']),
      },
    });
  });

  it('leere Bezeichnung wird nicht gesendet', async () => {
    const anfragen = aufzeichnen();
    renderMitProviders(<Harness />);
    await screen.findByRole('dialog');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Bezeichnung darf nicht leer sein')).toBeInTheDocument();
    expect(anfragen).toHaveLength(0);
  });

  it('eine Ablehnung steht im Dialog, der Dialog bleibt offen', async () => {
    aufzeichnen(409);
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'MANV');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Bezeichnung bereits vergeben')).toBeInTheDocument();
    expect(screen.getByTestId('offen')).toHaveTextContent('offen');
  });

  describe('Schichtmodell (LLH-1313)', () => {
    const modelle = [
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
      {
        id: 9,
        bezeichnung: 'Sanitätsdienst 6 h',
        typ: 'rhythmus',
        rhythmus_minuten: 360,
        vorwarnung_minuten: 30,
        planungsvorlauf_minuten: 120,
        ist_vorgabe: false,
        ist_demo: false,
      },
    ];

    it('steht in der Zeile der Einsatzart, leer mit der Vorgabe der Organisation', async () => {
      server.use(http.get('/api/schichtmodelle', () => HttpResponse.json(modelle)));
      const anfragen = aufzeichnen();
      renderMitProviders(<Harness />);
      const dialog = await screen.findByRole('dialog');
      const feld = await within(dialog).findByRole('combobox', { name: 'Schichtmodell' });
      // Eine Zeile mit der Einsatzart: das Feldbudget des Modals bleibt bei drei Zeilen.
      const zeile = dialog.querySelector('[data-lfh="vorlage-vorbelegung"]')!;
      expect(zeile).toContainElement(feld);
      expect(zeile).toContainElement(within(dialog).getByRole('combobox', { name: 'Einsatzart' }));
      expect(feld.closest('.ant-select')?.textContent).toContain('12-h-Schicht (Vorgabe)');

      await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Konzert');
      await waehle('Schichtmodell', 'Sanitätsdienst 6 h');
      await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      await waitFor(() => expect(anfragen).toHaveLength(1));
      expect(anfragen[0].rumpf).toMatchObject({ bezeichnung: 'Konzert', schichtmodell_id: 9 });
    });

    it('Bearbeiten belegt das Modell vor; Leeren schickt `null`', async () => {
      server.use(http.get('/api/schichtmodelle', () => HttpResponse.json(modelle)));
      const anfragen = aufzeichnen();
      renderMitProviders(<Harness vorlage={{ ...MANV, schichtmodell_id: 9 }} />);
      const dialog = await screen.findByRole('dialog', { name: 'Einsatz-Vorlage bearbeiten' });
      const feld = await within(dialog).findByRole('combobox', { name: 'Schichtmodell' });
      await waitFor(() =>
        expect(feld.closest('.ant-select')?.textContent).toContain('Sanitätsdienst 6 h'),
      );
      const auswahl = feld.closest<HTMLElement>('.ant-select')!;
      await userEvent.hover(auswahl);
      await userEvent.click(auswahl.querySelector<HTMLElement>('.ant-select-clear')!);
      await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
      await waitFor(() => expect(anfragen).toHaveLength(1));
      expect(anfragen[0].rumpf).toMatchObject({ schichtmodell_id: null });
    });
  });
});
