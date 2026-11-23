import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import OfflineVorhandeneModal from './OfflineVorhandeneModal';

const DATEIEN = [
  { dateiname: 'osm.bremen.2026-07-02.mbtiles', groesse: 11_600_000 },
  { dateiname: 'osm.hamburg.2026-07-02.mbtiles', groesse: 22_400_000 },
];

function Harness() {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Wieder öffnen
      </button>
      <OfflineVorhandeneModal offen={offen} onClose={() => setOffen(false)} />
    </>
  );
}

/** Die Bremer Datei lehnt der Server ab, die Hamburger nimmt er an. */
function mock(gesendet: { pfad: string; name: string }[] = []) {
  server.use(
    http.get('/api/map/offline-maps/existing', () => HttpResponse.json(DATEIEN)),
    http.post('/api/map/offline-maps', async ({ request }) => {
      const body = (await request.json()) as { pfad: string; name: string };
      gesendet.push(body);
      if (body.pfad.includes('bremen')) {
        return HttpResponse.json({ error: 'Name schon vergeben' }, { status: 409 });
      }
      return HttpResponse.json({ id: 9, name: body.name }, { status: 201 });
    }),
  );
  return gesendet;
}

function zeile(dateiname: string): HTMLElement {
  return screen.getByText(dateiname, { exact: false }).closest('li') as HTMLElement;
}

describe('OfflineVorhandeneModal', () => {
  it('übernimmt eine Datei mit dem abgeleiteten Namen', async () => {
    const gesendet = mock();
    renderMitProviders(<Harness />);
    await screen.findByDisplayValue('hamburg');
    await userEvent.click(
      within(zeile('osm.hamburg.2026-07-02.mbtiles')).getByRole('button', { name: 'Übernehmen' }),
    );
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ name: 'hamburg', pfad: 'osm.hamburg.2026-07-02.mbtiles' });
  });

  /**
   * Zeilenfehler im Dialog (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): eine abgelehnte
   * Übernahme nennt ihren Grund an der Datei, an der sie ausgelöst wurde; der getippte Name bleibt,
   * kein Toast.
   */
  it('zeigt eine Ablehnung an ihrer Datei, behält den Namen und zeigt keinen Toast', async () => {
    mock();
    renderMitProviders(<Harness />);
    const name = await screen.findByLabelText('Name für osm.bremen.2026-07-02.mbtiles');
    await userEvent.clear(name);
    await userEvent.type(name, 'Bremen Stadt');
    await userEvent.click(
      within(zeile('osm.bremen.2026-07-02.mbtiles')).getByRole('button', { name: 'Übernehmen' }),
    );

    expect(
      await within(zeile('osm.bremen.2026-07-02.mbtiles')).findByText('Name schon vergeben'),
    ).toHaveAttribute('data-fehler');
    expect(zeile('osm.hamburg.2026-07-02.mbtiles').querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
    expect(screen.getByLabelText('Name für osm.bremen.2026-07-02.mbtiles')).toHaveValue(
      'Bremen Stadt',
    );
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('zeigt nach Schließen und erneutem Öffnen keinen alten Grund', async () => {
    mock();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    await screen.findByDisplayValue('bremen');
    await nutzer.click(
      within(zeile('osm.bremen.2026-07-02.mbtiles')).getByRole('button', { name: 'Übernehmen' }),
    );
    await within(zeile('osm.bremen.2026-07-02.mbtiles')).findByText('Name schon vergeben');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs ein.
    await nutzer.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /close|schlie/i }),
    );
    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = await screen.findByRole('dialog');
    await within(wieder).findByDisplayValue('bremen');
    expect(wieder.querySelector('[data-fehler]')).toBeNull();
  });

  /**
   * Eine Übernahme nach der anderen: solange eine läuft, sind die anderen Dateien gesperrt, keine
   * zweite Zeile kann den Grund der ersten verdrängen.
   */
  it('sperrt die anderen Dateien, solange eine Übernahme läuft', async () => {
    let gibFrei: () => void = () => {};
    const freigabe = new Promise<void>((r) => (gibFrei = r));
    server.use(
      http.get('/api/map/offline-maps/existing', () => HttpResponse.json(DATEIEN)),
      http.post('/api/map/offline-maps', async () => {
        await freigabe;
        return HttpResponse.json({ error: 'Name schon vergeben' }, { status: 409 });
      }),
    );
    renderMitProviders(<Harness />);
    await screen.findByDisplayValue('bremen');
    await userEvent.click(
      within(zeile('osm.bremen.2026-07-02.mbtiles')).getByRole('button', { name: 'Übernehmen' }),
    );
    await waitFor(() =>
      expect(
        within(zeile('osm.hamburg.2026-07-02.mbtiles')).getByRole('button', { name: 'Übernehmen' }),
      ).toBeDisabled(),
    );
    gibFrei();
    expect(
      await within(zeile('osm.bremen.2026-07-02.mbtiles')).findByText('Name schon vergeben'),
    ).toHaveAttribute('data-fehler');
  });
});

/**
 * LLH-2010: ein geänderter Name geht nicht still verloren (`frontend/AGENTS.md`,
 * „Erfassungs-Norm“). Die Maske schließt nie; das Kreuz fragt nur nach einer Namensänderung.
 */
describe('OfflineVorhandeneModal — Rückfrage vor dem Verwerfen (LLH-2010)', () => {
  const kreuz = () => screen.getByRole('button', { name: /Close|Schließen/i });

  it('die Maske schließt nicht', async () => {
    mock();
    renderMitProviders(<Harness />);
    await screen.findByDisplayValue('hamburg');
    await userEvent.click(document.querySelector<HTMLElement>('.ant-modal-wrap')!);
    expect(screen.getByRole('dialog', { name: 'Gebaute Region übernehmen' })).not.toHaveClass(
      'ant-zoom-leave',
    );
  });

  it('unverändert schließt das Kreuz still', async () => {
    mock();
    renderMitProviders(<Harness />);
    await screen.findByDisplayValue('hamburg');
    await userEvent.click(kreuz());
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Gebaute Region übernehmen' })).toHaveClass(
        'ant-zoom-leave',
      ),
    );
    expect(screen.queryByRole('dialog', { name: 'Eingaben verwerfen?' })).toBeNull();
  });

  it('ein geänderter Name: das Kreuz fragt nach', async () => {
    mock();
    renderMitProviders(<Harness />);
    await userEvent.type(await screen.findByDisplayValue('hamburg'), '-nord');
    await userEvent.click(kreuz());
    expect(
      await screen.findByText('Die Eingaben in „Gebaute Region übernehmen“ gehen verloren.'),
    ).toBeInTheDocument();
  });
});
