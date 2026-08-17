import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MitgliederAbschnitt from './MitgliederAbschnitt';

function mitglied(over: Partial<Record<string, unknown>> = {}) {
  return {
    benutzer_id: 2,
    anzeigename: 'Eva Einsatz',
    benutzername: 'eva',
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-05-23 10:00:00',
    ...over,
  };
}

describe('MitgliederAbschnitt', () => {
  it('zeigt vorhandene Mitglieder', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(<MitgliederAbschnitt einsatzId={7} darfVerwalten />);
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
  });

  it('entfernt ein Mitglied', async () => {
    let entfernt = false;
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json(entfernt ? [] : [mitglied()]),
      ),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.delete('/api/einsaetze/7/mitglieder/2', () => {
        entfernt = true;
        return HttpResponse.json([]);
      }),
    );
    renderMitProviders(<MitgliederAbschnitt einsatzId={7} darfVerwalten />);
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const popup = await screen.findByRole('tooltip');
    await userEvent.click(within(popup).getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(screen.queryByText('Eva Einsatz')).not.toBeInTheDocument());
  });

  it('beschriftet die Aktionsspalte und trägt einen echten Knopf statt eines Textlinks', async () => {
    /**
     * Befund N7 (LFH-339 · C4). Die Aktionsspalte hiess `title: ''` — eine namenlose
     * Spalte ist für einen Screenreader eine Zelle ohne Zugehörigkeit, und ein
     * `Button type="link"` sieht aus wie Fliesstext, obwohl er die einzige destruktive
     * Handlung der Zeile auslöst.
     */
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(<MitgliederAbschnitt einsatzId={7} darfVerwalten />);
    // Erst auf die DATENZEILE warten: die Kopfzeile steht auch ohne Mitglieder im Baum,
    // ein `findByRole('columnheader')` allein wäre also grün, bevor es etwas zu bedienen
    // gibt — und der Knopf darunter dann noch nicht da.
    await screen.findByText('Eva Einsatz');
    expect(screen.getByRole('columnheader', { name: 'Aktion' })).toBeInTheDocument();
    const knopf = screen.getByRole('button', { name: 'Entfernen' });
    expect(knopf.className).not.toMatch(/ant-btn-link\b/);
    // `danger` bleibt: Löschen IST Gefahr. Rot bedient nichts — aber es warnt.
    expect(knopf.className).toMatch(/ant-btn-color-dangerous|ant-btn-dangerous/);
  });

  it('blendet Edit-Aktionen aus, wenn nicht verwaltet werden darf', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(<MitgliederAbschnitt einsatzId={7} darfVerwalten={false} />);
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
  });
});
