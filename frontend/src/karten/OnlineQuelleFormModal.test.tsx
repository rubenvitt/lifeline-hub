import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { OnlineQuelle } from '../api/onlineQuellen';
import OnlineQuelleFormModal from './OnlineQuelleFormModal';

/**
 * LFH-346/A6 — die Online-Quellen-Maske auf `ErfassungsModal`. Kein Serienmodus:
 * eine Instanz führt eine Handvoll Basemap-Quellen, keinen Erfassungsstrom.
 */

const quelle: OnlineQuelle = {
  id: 3,
  name: 'OpenStreetMap',
  url: 'https://example.test/style.json',
  typ: 'vektor',
  attribution: '© OpenStreetMap-Mitwirkende',
  sortier: 2,
  aktiv: true,
  proxy: true,
};

function handler() {
  server.use(
    http.post('/api/karte/online-quellen', () => HttpResponse.json({ ...quelle, id: 9 })),
    http.patch('/api/karte/online-quellen/3', () => HttpResponse.json(quelle)),
  );
}

function Harness({ bestand }: { bestand?: OnlineQuelle | null }) {
  const [offen, setOffen] = useState(true);
  const [aktuell, setAktuell] = useState<OnlineQuelle | null>(bestand ?? null);
  return (
    <>
      <button type="button" onClick={() => { setAktuell(null); setOffen(true); }}>
        Wieder öffnen
      </button>
      <OnlineQuelleFormModal
        offen={offen}
        quelle={aktuell}
        naechsteSortier={7}
        onClose={() => setOffen(false)}
      />
    </>
  );
}

describe('OnlineQuelleFormModal — Hülle (LFH-346/A6)', () => {
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Speichern' });

    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins Namensfeld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
  });

  /**
   * Die Vorgaben des früheren Anlegen-Zweigs stehen jetzt als `initialValues` an der
   * Hülle — inklusive der von aussen gereichten `naechsteSortier`. Der Beleg ist der
   * Weg über eine bearbeitete Quelle: ohne `initialValues` stünde hier deren
   * Sortierung 2 statt der nächsten freien 7.
   */
  it('nach dem Bearbeiten startet das nächste Anlegen mit den Vorgabewerten', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={quelle} />);
    expect(await screen.findByLabelText('Name')).toHaveValue('OpenStreetMap');
    expect(screen.getByLabelText('Sortierung')).toHaveValue('2');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('URL')).toHaveValue('');
    expect(screen.getByLabelText('Sortierung')).toHaveValue('7');
  });
});
