import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/server';
import { renderMitProviders } from '../../../test/utils';
import * as dateiSpeichern from '../../../components/dateiSpeichern';
import { MODUL_PERSONAL_GESPERRT } from '../../../components/nurAnsicht';
import { schichtplanDruckPfad } from '../../../routing/deeplinks';
import EinsatzSeite from '../../../components/EinsatzSeite';
import { setzeViewportBreite, setzeViewportZurueck } from '../../../test/viewport';
import { useSchichtplanAusgabe } from './useSchichtplanAusgabe';

const EXPORT = '/api/incidents/4/reliefs/shift-plan/export';

/** Wie die Ablösung: Ausgabewege im Seitenkopf, der Fehler an der Ansicht (LLH-1836). */
function Seite({ personalFrei }: { personalFrei: boolean | undefined }) {
  const ausgabe = useSchichtplanAusgabe({
    einsatzId: 4,
    einsatzBezeichnung: () => 'Sanitätsdienst Stadtfest',
    personalFrei,
  });
  return (
    <EinsatzSeite
      titel="Ablösung"
      weitere={{ name: 'Weitere Aktionen zur Ablösung', eintraege: ausgabe.nebenwege }}
    >
      <div data-testid="ansicht">{ausgabe.fehler}</div>
    </EinsatzSeite>
  );
}

function zeige(personalFrei: boolean | undefined) {
  setzeViewportBreite(1180);
  return renderMitProviders(<Seite personalFrei={personalFrei} />);
}

afterEach(() => {
  vi.restoreAllMocks();
  setzeViewportZurueck();
});

describe('useSchichtplanAusgabe (LLH-1557, LLH-1836)', () => {
  it('„Druckansicht“ und „Excel“ stehen im Seitenkopf', () => {
    zeige(true);
    const kopf = document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    expect(within(kopf).getByRole('link', { name: 'Druckansicht' })).toHaveAttribute(
      'href',
      schichtplanDruckPfad(4),
    );
    expect(within(kopf).getByRole('button', { name: 'Excel' })).toBeEnabled();
  });

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
    const ansicht = screen.getByTestId('ansicht');
    expect(
      await within(ansicht).findByText('Kein Zugriff auf das Modul Personal'),
    ).toBeInTheDocument();
    expect(within(ansicht).getByText('Excel fehlgeschlagen')).toBeInTheDocument();
    expect(speichern).not.toHaveBeenCalled();

    server.use(http.get(EXPORT, () => new HttpResponse('PK')));
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Excel fehlgeschlagen')).not.toBeInTheDocument();
  });

  it('ohne Modul Personal ist „Excel“ gesperrt und nennt den Grund im Text', () => {
    zeige(false);
    const knopf = screen.getByRole('button', { name: `Excel (${MODUL_PERSONAL_GESPERRT})` });
    expect(knopf).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Druckansicht' })).toHaveAttribute(
      'href',
      schichtplanDruckPfad(4),
    );
  });

  it('solange die Freigaben laden, ist „Excel“ gesperrt, aber ohne Grund', () => {
    zeige(undefined);
    const knopf = screen.getByRole('button', { name: 'Excel' });
    expect(knopf).toBeDisabled();
    expect(screen.queryByText(new RegExp(MODUL_PERSONAL_GESPERRT))).not.toBeInTheDocument();
  });
});
