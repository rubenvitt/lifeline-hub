import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
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
      <button
        type="button"
        onClick={() => {
          setAktuell(null);
          setOffen(true);
        }}
      >
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
    expect(screen.getByLabelText('Typ').closest('.ant-select')).toHaveTextContent('Lage');
    // Die Sortierung liegt seit LFH-346 · A8 unter „Weitere Angaben"; die Vorbelegung
    // muss sie trotzdem erreichen, obwohl das Feld beim Öffnen noch nicht montiert ist.
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    expect(await screen.findByLabelText('Sortierung')).toHaveValue('7');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Label')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Label')).toHaveValue('');
    // Nach dem Wiederöffnen ist der Bereich zu (`destroyOnHidden`) — erneut aufklappen.
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    expect(await screen.findByLabelText('Sortierung')).toHaveValue('0');
    // antd 6 rendert die gewählte Option als `.ant-select-content` (nicht mehr
    // `-selection-item`); gegriffen wird sie über das Feld, damit der zweite Select
    // (Meldeweg) nicht mitzählt.
    expect(screen.getByLabelText('Typ').closest('.ant-select')).toHaveTextContent('Meldung');
  });

  /**
   * LFH-346 · A8, Befund N20. Die tragende Prüfung des Collapse-Umbaus — nicht die
   * Zählung darunter: beide Hälften der Zählung stünden grün, während jedes Speichern
   * drei Felder still leert.
   *
   * `BausteinEingabe` ist Vollersatz. Ohne `forceRender` sind Meldeweg, Veranlassung
   * und Sortierung nicht montiert, und `onFinish` liefert nur montierte Felder — ein
   * `onErfassen`, das seine Werte von dort nimmt, schickte `meldeweg: null` und
   * `sortier: 0` an einen Baustein, an dem niemand etwas davon angefasst hat.
   */
  it('behält Meldeweg, Veranlassung und Sortierung, wenn niemand aufklappt', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/etb-bausteine/2', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(baustein);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(
      <Harness bestand={{ ...baustein, meldeweg: 'funk', veranlassung: 'Lagemeldung' }} />,
    );
    const label = await screen.findByLabelText('Label');
    await nutzer.clear(label);
    await nutzer.type(label, 'Lage unverändert (kurz)');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toEqual({
      label: 'Lage unverändert (kurz)',
      typ: 'lage',
      inhalt: 'Lage unverändert bei {einheit}',
      meldeweg: 'funk',
      veranlassung: 'Lagemeldung',
      sortier: 7,
    });
  });

  /**
   * Die Gegenprobe: eine aufgeklappt geleerte Veranlassung kommt auch geleert an. Ein
   * Rückfall auf `baustein?.veranlassung` bestünde die Prüfung darüber und fiele hier.
   */
  it('eine aufgeklappt geleerte Veranlassung kommt geleert an', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/etb-bausteine/2', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(baustein);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(
      <Harness bestand={{ ...baustein, meldeweg: 'funk', veranlassung: 'Lagemeldung' }} />,
    );
    await screen.findByLabelText('Label');
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await nutzer.clear(await screen.findByLabelText('Veranlassung (optional)'));
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toMatchObject({ veranlassung: null, meldeweg: 'funk', sortier: 7 });
  });

  /**
   * Das Feldbudget (LFH-346 · A8): drei sichtbare Felder statt sechs.
   *
   * Gezählt werden `.ant-form-item`-Knoten, nicht `role="textbox"` — der Typ ist ein
   * `Select` und fehlte in der Rollenzählung. Die zweite Hälfte ist Pflicht:
   * „höchstens drei" allein erfüllte auch ein Dialog ganz ohne Felder.
   */
  it('zeigt drei Felder und deckt drei weitere erst beim Aufklappen auf', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    // Der Dialog, NICHT `container`: antds Modal hängt in einem Portal an `body`.
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(3);

    await nutzer.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(6));
  });
});
