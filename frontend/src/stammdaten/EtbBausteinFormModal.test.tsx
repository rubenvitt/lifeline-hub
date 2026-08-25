import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { EtbBaustein } from '../api/types';
import EtbBausteinFormModal from './EtbBausteinFormModal';

/**
 * LFH-346/A6 — die Baustein-Maske auf `ErfassungsModal`. Kein Serienmodus: Bausteine
 * sind Vorlagen, die einmal gepflegt und danach eingesetzt werden.
 */

const baustein: EtbBaustein = {
  id: 2,
  label: 'Lage unverändert',
  typ: 'lage',
  inhalt: 'Lage unverändert bei {einheit}',
  meldeweg: null,
  veranlassung: null,
  sortier: 7,
};

function handler() {
  server.use(
    http.post('/api/etb-bausteine', () => HttpResponse.json({ ...baustein, id: 9 })),
    http.patch('/api/etb-bausteine/2', () => HttpResponse.json(baustein)),
  );
}

function Harness({ bestand }: { bestand?: EtbBaustein | null }) {
  const [offen, setOffen] = useState(true);
  const [aktuell, setAktuell] = useState<EtbBaustein | null>(bestand ?? null);
  return (
    <>
      <button type="button" onClick={() => { setAktuell(null); setOffen(true); }}>
        Wieder öffnen
      </button>
      <EtbBausteinFormModal offen={offen} baustein={aktuell} onClose={() => setOffen(false)} />
    </>
  );
}

describe('EtbBausteinFormModal — Hülle (LFH-346/A6)', () => {
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Speichern' });

    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins Label-Feld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Label')));
  });

  /**
   * Die Vorgabewerte des früheren Anlegen-Zweigs (`typ: 'meldung'`, `sortier: 0`) stehen
   * jetzt als `initialValues` an der Hülle — von dort holt sie jedes `resetFields`
   * wieder. Der Beleg ist der Weg über einen bearbeiteten Datensatz: ohne
   * `initialValues` stünde hier die Sortierung 7 des Bausteins.
   */
  it('nach dem Bearbeiten startet das nächste Anlegen mit den Vorgabewerten', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={baustein} />);
    expect(await screen.findByLabelText('Label')).toHaveValue('Lage unverändert');
    expect(screen.getByLabelText('Sortierung')).toHaveValue('7');
    expect(screen.getByLabelText('Typ').closest('.ant-select')).toHaveTextContent('Lage');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Label')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Label')).toHaveValue('');
    expect(screen.getByLabelText('Sortierung')).toHaveValue('0');
    // antd 6 rendert die gewählte Option als `.ant-select-content` (nicht mehr
    // `-selection-item`); gegriffen wird sie über das Feld, damit der zweite Select
    // (Meldeweg) nicht mitzählt.
    expect(screen.getByLabelText('Typ').closest('.ant-select')).toHaveTextContent('Meldung');
  });
});
