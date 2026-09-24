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
   * LFH-376 — die Zusicherung, wegen der die Maske auf der Hülle steht (Befund H69
   * aus LFH-332/B4): Enter in einem einzeiligen Feld sendet ab. Die Strukturprobe
   * oben (Knopf im `<form>`) ist nur die Ursache; dieser Test belegt die Wirkung.
   * Die Attribution ist Pflicht und muss vor dem Enter stehen; sie wird ZUERST
   * getippt, weil der Absende-Weg nicht über sie laufen kann — sie ist eine
   * Textarea, Enter bricht dort um. Der Typ bleibt auf seiner Vorgabe, ein `Select`
   * schluckt Enter selbst (CLAUDE.md, Erfassungs-Norm). Abgesendet wird aus der URL.
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
   * Die Gegenprobe: in der Textarea bricht Enter um und sendet NICHT ab. Belegt wird
   * das über den Knopf danach — genau EIN Request, und er trägt den Umbruch. Ein
   * „nicht aufgerufen" direkt nach dem Tippen wäre zu früh gefragt: die Prüfung der
   * Hülle läuft asynchron, ein Absenden durch Enter käme erst danach an.
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
    // Die Sortierung liegt seit LFH-346 · A8 unter „Weitere Angaben"; die Vorbelegung
    // muss sie trotzdem erreichen, obwohl das Feld beim Öffnen noch nicht montiert ist.
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
   * LFH-346 · A8, Befund N20. Die tragende Prüfung des Collapse-Umbaus — nicht die
   * Zählung darunter: beide Hälften der Zählung stünden grün, während jedes Speichern
   * drei Felder still zurücksetzt.
   *
   * `OnlineQuelleBody` ist Vollersatz. Ohne `forceRender` sind Sortierung, Aktiv und
   * Proxy nicht montiert, und `onFinish` liefert nur montierte Felder — ein
   * `onErfassen`, das seine Werte von dort nimmt, schickte `sortier: 0` und den
   * Vorgabe-Proxy an eine Quelle, an der niemand etwas davon angefasst hat.
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
   * Die Gegenprobe: ein aufgeklappt UMGELEGTER Schalter kommt auch umgelegt an. Ein
   * Rückfall auf `quelle?.proxy` bestünde die Prüfung darüber und fiele hier — er
   * kann „nie montiert" nicht von „aufgeklappt und bewusst geändert" unterscheiden.
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
   * Das Feldbudget (LFH-346 · A8): VIER sichtbare Felder statt sieben.
   *
   * Vier, nicht die drei der Plan-Tabelle: `attribution` ist `required` und
   * serverseitig erzwungen, hat also keinen brauchbaren Vorgabewert und darf nach
   * LFH-343 · H49 nicht hinter den Collapse. Begründung im Dateikopf der Komponente.
   *
   * Gezählt werden `.ant-form-item`-Knoten, nicht `role="textbox"` — der Typ ist ein
   * `Select` und fehlte in der Rollenzählung. Die zweite Hälfte ist Pflicht:
   * „höchstens vier" allein erfüllte auch ein Dialog ganz ohne Felder.
   */
  it('zeigt vier Felder und deckt drei weitere erst beim Aufklappen auf', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    // Gegriffen wird der Dialog, NICHT `container`: antds Modal hängt in einem Portal
    // an `document.body`, `container.querySelectorAll` zählte dort gemessen null.
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(4);

    await nutzer.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(7));
  });

  /**
   * Der Erklär-Alert zum Proxy ist weg — er erklärte ein FELD, nicht einen Zustand der
   * Seite, und steht seit LFH-346 · A8 als Tooltip an dessen `Form.Item`. Geprüft wird
   * die Abwesenheit des Alerts UND die Anwesenheit der Erklärung am Feld: ohne die
   * zweite Hälfte wäre „Alert weg" auch dann grün, wenn die Erklärung ersatzlos fiele.
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
