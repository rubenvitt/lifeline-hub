import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/server';
import { renderMitProviders } from '../../../test/utils';
import * as dateiSpeichern from '../../../components/dateiSpeichern';
import { MODUL_PERSONAL_GESPERRT } from '../../../components/nurAnsicht';
import { schichtplanDruckPfad } from '../../../routing/deeplinks';
import SchichtplanAusgabeKnoepfe from './SchichtplanAusgabeKnoepfe';

const EXPORT = '/api/einsaetze/4/abloesungen/schichtplan/export';

function zeige(personalFrei: boolean | undefined) {
  return renderMitProviders(
    <SchichtplanAusgabeKnoepfe
      einsatzId={4}
      einsatzBezeichnung="Sanitätsdienst Stadtfest"
      personalFrei={personalFrei}
    />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('SchichtplanAusgabeKnoepfe (LLH-1557)', () => {
  it('„Excel“ lädt die Mappe und speichert sie unter dem Namen des Einsatzes', async () => {
    const speichern = vi.spyOn(dateiSpeichern, 'speichereDatei').mockImplementation(() => {});
    server.use(http.get(EXPORT, () => new HttpResponse('PK-mappe')));
    zeige(true);
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    const [datei, name] = speichern.mock.calls[0];
    expect(await (datei as Blob).text()).toBe('PK-mappe');
    expect(name).toMatch(/^schichtplan-sanitaetsdienst-stadtfest-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('ein Fehler steht an der Seite und verschwindet beim nächsten Versuch', async () => {
    const speichern = vi.spyOn(dateiSpeichern, 'speichereDatei').mockImplementation(() => {});
    server.use(
      http.get(EXPORT, () =>
        HttpResponse.json({ error: 'Kein Zugriff auf das Modul Personal' }, { status: 403 }),
      ),
    );
    zeige(true);
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(await screen.findByText('Kein Zugriff auf das Modul Personal')).toBeInTheDocument();
    expect(screen.getByText('Excel fehlgeschlagen')).toBeInTheDocument();
    expect(speichern).not.toHaveBeenCalled();

    server.use(http.get(EXPORT, () => new HttpResponse('PK')));
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Excel fehlgeschlagen')).not.toBeInTheDocument();
  });

  it('ohne Modul Personal ist „Excel“ gesperrt und nennt den Grund', () => {
    zeige(false);
    const knopf = screen.getByRole('button', { name: 'Excel' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription(MODUL_PERSONAL_GESPERRT);
    expect(screen.getByRole('link', { name: 'Drucken' })).toHaveAttribute(
      'href',
      schichtplanDruckPfad(4),
    );
  });

  it('solange die Freigaben laden, ist „Excel“ gesperrt, aber ohne Grund', () => {
    zeige(undefined);
    const knopf = screen.getByRole('button', { name: 'Excel' });
    expect(knopf).toBeDisabled();
    expect(knopf).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(MODUL_PERSONAL_GESPERRT)).not.toBeInTheDocument();
  });
});
