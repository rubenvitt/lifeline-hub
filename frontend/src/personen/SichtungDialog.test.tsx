import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useAuthOptional } from '../auth/AuthContext';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import SichtungDialog from './SichtungDialog';

/**
 * Die Nachsichtung ohne Dropdown (LLH-1083, Spec `sichtungswahl`, „Nachsichtung ohne Dropdown“):
 * eine Fläche, dann „Übernehmen“ — zwei Tipps nach dem Öffnen.
 */
let gesendet: Record<string, unknown>[];

beforeEach(() => {
  gesendet = [];
  server.use(
    http.post('/api/einsaetze/1/personen/2/sichtung', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        { id: 9, person_id: 2, kategorie: 'sk1', gesichtet_at: '', gesichtet_von: 1 },
        { status: 201 },
      );
    }),
  );
});

function zeige() {
  const onErfasst = vi.fn();
  const onSchliessen = vi.fn();
  renderMitProviders(
    <SichtungDialog
      einsatzId={1}
      person={{ id: 2, registrier_nr: 7 }}
      offen
      onErfasst={onErfasst}
      onSchliessen={onSchliessen}
    />,
  );
  return { onErfasst, onSchliessen };
}

describe('SichtungDialog (LLH-1083)', () => {
  it('wählt über Flächen, nicht über ein Dropdown', () => {
    zeige();
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('radiogroup', { name: 'Sichtungskategorie' }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(6);
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('speichert mit zwei Tipps: Fläche, Übernehmen', async () => {
    const { onErfasst } = zeige();
    await userEvent.click(screen.getByRole('radio', { name: /^SK I,/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onErfasst).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([{ kategorie: 'sk1', notiz: null, client_id: expect.any(String) }]);
  });

  it('verlangt eine Kategorie, bevor es speichert', async () => {
    const { onErfasst } = zeige();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Bitte eine Sichtungskategorie wählen')).toBeInTheDocument();
    expect(onErfasst).not.toHaveBeenCalled();
    expect(gesendet).toHaveLength(0);
  });
});

/** Zeigt, dass die Sitzung geladen ist (Besitzer der Offline-Warteschlange). */
function AuthSonde() {
  return useAuthOptional()?.benutzer ? <span data-testid="angemeldet" /> : null;
}

describe('SichtungDialog ohne Netz (LLH-1138, design.md D8)', () => {
  it('merkt vor statt zu scheitern: kein POST, „vorgemerkt“ statt „erfasst“', async () => {
    await queueLeerenFuerTests();
    server.use(meHandler(benutzerFixture()));
    const onErfasst = vi.fn();
    const onVorgemerkt = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <>
        <AuthSonde />
        <SichtungDialog
          einsatzId={1}
          person={{ id: 2, registrier_nr: 7 }}
          offen
          onErfasst={onErfasst}
          onVorgemerkt={onVorgemerkt}
          onSchliessen={onSchliessen}
        />
      </>,
    );
    await screen.findByTestId('angemeldet');
    setzeOnline(false);
    onTestFinished(() => setzeOnline(true));
    await userEvent.click(screen.getByRole('radio', { name: /^SK I,/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => expect(onVorgemerkt).toHaveBeenCalledTimes(1));
    expect(onErfasst).not.toHaveBeenCalled();
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(gesendet).toEqual([]);
    expect((await schreibaktionenLaden(benutzerFixture().id, 1)).map((z) => z.aktion)).toEqual([
      expect.objectContaining({ art: 'sichtung', person_id: 2, bezeichnung: 'R-007' }),
    ]);
  });
});
