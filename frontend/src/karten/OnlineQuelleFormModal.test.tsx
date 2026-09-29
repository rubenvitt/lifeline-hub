import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { OnlineQuelle } from '../api/onlineQuellen';
import OnlineQuelleFormModal from './OnlineQuelleFormModal';

/**
 * Die Online-Quellen-Maske auf `ErfassungsModal`. Kein Serienmodus: eine Instanz führt eine
 * Handvoll Quellen.
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
      <button
        type="button"
        onClick={() => {
          setAktuell(null);
          setOffen(true);
        }}
      >
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
   * Enter in einem einzeiligen Feld sendet ab — die Wirkung, nicht nur die Struktur. Die
   * Attribution (Pflicht, Textarea) wird ZUERST getippt, der Typ bleibt auf der Vorgabe (ein
   * `Select` schluckt Enter); abgesendet wird aus der URL.
   */
  it('Enter im URL-Feld legt die Quelle an', async () => {
    let rumpf: Record<string, unknown> | null = null;
    let aufrufe = 0;
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        aufrufe += 1;
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...quelle, id: 9 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);

    const name = await screen.findByLabelText('Name');
    await waitFor(() => expect(document.activeElement).toBe(name));
    await nutzer.type(screen.getByLabelText('Attribution'), '© OpenStreetMap-Mitwirkende');
    await nutzer.type(name, 'OpenStreetMap');
    await nutzer.type(screen.getByLabelText('URL'), 'https://example.test/style.json{Enter}');

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(aufrufe).toBe(1);
    expect(rumpf).toMatchObject({
      name: 'OpenStreetMap',
      url: 'https://example.test/style.json',
      typ: 'vektor',
      attribution: '© OpenStreetMap-Mitwirkende',
      sortier: 7,
    });
  });

  /**
   * Gegenprobe: in der Textarea bricht Enter um. Belegt über den Knopf danach — genau EIN Request
   * mit dem Umbruch; die Prüfung der Hülle läuft asynchron.
   */
  it('Enter in der Attribution bricht um und sendet nicht ab', async () => {
    const rumpfe: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        rumpfe.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...quelle, id: 9 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);

    const name = await screen.findByLabelText('Name');
    await waitFor(() => expect(document.activeElement).toBe(name));
    await nutzer.type(name, 'OpenStreetMap');
    await nutzer.type(screen.getByLabelText('URL'), 'https://example.test/style.json');
    await nutzer.type(screen.getByLabelText('Attribution'), '© OSM{Enter}ODbL');
    expect(screen.getByLabelText('Attribution')).toHaveValue('© OSM\nODbL');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpfe).not.toHaveLength(0));
    expect(rumpfe).toHaveLength(1);
    expect(rumpfe[0]).toMatchObject({ attribution: '© OSM\nODbL' });
  });

  /**
   * Die Vorgaben stehen als `initialValues` an der Hülle, inklusive `naechsteSortier`. Beleg über
   * eine bearbeitete Quelle: ohne `initialValues` stünde deren Sortierung 2 statt der nächsten 7.
   */
  it('nach dem Bearbeiten startet das nächste Anlegen mit den Vorgabewerten', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={quelle} />);
    expect(await screen.findByLabelText('Name')).toHaveValue('OpenStreetMap');
    // Die Sortierung liegt unter „Weitere Angaben"; die Vorbelegung muss sie trotzdem erreichen.
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    expect(await screen.findByLabelText('Sortierung')).toHaveValue('2');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('URL')).toHaveValue('');
    // Der Bereich ist nach dem Wiederöffnen zu (`destroyOnHidden`) — erneut aufklappen.
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    expect(await screen.findByLabelText('Sortierung')).toHaveValue('7');
  });

  /**
   * Die tragende Prüfung des Collapse: `OnlineQuelleBody` ist Vollersatz, und ohne
   * `forceRender` liefert `onFinish` nur montierte Felder — ein Speichern setzte Sortierung,
   * Aktiv und Proxy still zurück, obwohl niemand sie angefasst hat.
   */
  it('behält Sortierung, Aktiv und Proxy, wenn niemand aufklappt', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/karte/online-quellen/3', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(quelle);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={{ ...quelle, sortier: 2, aktiv: false, proxy: false }} />);
    const name = await screen.findByLabelText('Name');
    await nutzer.clear(name);
    await nutzer.type(name, 'OSM Standard');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toEqual({
      name: 'OSM Standard',
      url: 'https://example.test/style.json',
      typ: 'vektor',
      attribution: '© OpenStreetMap-Mitwirkende',
      sortier: 2,
      aktiv: false,
      proxy: false,
    });
  });

  /**
   * Gegenprobe: ein aufgeklappt UMGELEGTER Schalter kommt umgelegt an. Ein Rückfall auf
   * `quelle?.proxy` bestünde die Prüfung darüber und fiele hier.
   */
  it('ein aufgeklappt umgelegter Schalter kommt umgelegt an', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/karte/online-quellen/3', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(quelle);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={quelle} />);
    await screen.findByLabelText('Name');
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await nutzer.click(await screen.findByLabelText('Über Server proxen'));
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toMatchObject({ proxy: false, aktiv: true, sortier: 2 });
  });

  /**
   * Feldbudget: VIER sichtbare Felder statt sieben. Vier, weil `attribution` Pflicht ohne
   * brauchbare Vorgabe ist und nicht hinter den Collapse darf.
   * Gezählt werden `.ant-form-item`-Knoten (der Typ ist ein `Select`, keine textbox). „Höchstens
   * vier" allein erfüllte auch ein leerer Dialog.
   */
  it('zeigt vier Felder und deckt drei weitere erst beim Aufklappen auf', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    // Gegriffen wird der Dialog, NICHT `container`: antds Modal hängt im Portal an `document.body`.
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(4);

    await nutzer.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(7));
  });

  /**
   * Der Proxy wird als Tooltip am Feld erklärt, nicht als Alert über dem Formular. Geprüft wird
   * beides: Alert weg UND Erklärung am Feld.
   */
  it('erklärt den Proxy am Feld statt in einem Alert über dem Formular', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelector('.ant-alert')).toBeNull();

    await nutzer.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    const zeile = (await screen.findByLabelText('Über Server proxen')).closest('.ant-form-item');
    expect(zeile?.querySelector('.ant-form-item-tooltip')).not.toBeNull();
  });
});
