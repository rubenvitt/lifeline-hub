import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Material } from '../api/types';
import MaterialFormModal from './MaterialFormModal';

/**
 * LFH-346/A6 — die Materialmaske auf `ErfassungsModal`. Geprüft wird nur, was an
 * DIESER Maske verdrahtet ist; die Mechanik der Hülle beweist
 * `components/Erfassung.test.tsx`, die Übernahmefelder einmalig
 * `FahrzeugFormModal.test.tsx`.
 */

const material: Material = {
  id: 3,
  bezeichnung: 'Wolldecke',
  kategorie: 'Betreuung',
  bestandsnummer: 'INV-7',
  traegerorganisation: 'DRK Musterstadt',
  standort: 'Lagerhalle 2',
  bemerkung: null,
  dienststatus: 'in_dienst',
  angelegt_at: '2026-05-26 10:00:00',
};

function handler() {
  server.use(
    http.post('/api/material', () => HttpResponse.json({ ...material, id: 9 })),
    http.patch('/api/material/3', () => HttpResponse.json(material)),
  );
}

function Harness({ bestand, onClose }: { bestand?: Material | null; onClose?: () => void }) {
  const [offen, setOffen] = useState(true);
  const [aktuell, setAktuell] = useState<Material | null>(bestand ?? null);
  return (
    <>
      <button type="button" onClick={() => { setAktuell(null); setOffen(true); }}>
        Wieder öffnen
      </button>
      <MaterialFormModal
        offen={offen}
        material={aktuell}
        kategorien={['Betreuung']}
        onClose={() => { setOffen(false); onClose?.(); }}
      />
    </>
  );
}

describe('MaterialFormModal — Hülle (LFH-346/A6)', () => {
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Speichern' });

    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins Bezeichnungsfeld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung')));
  });

  it('Anlegen: der Serienweg steht — Material wird am Stück erfasst', async () => {
    handler();
    renderMitProviders(<Harness />);
    await screen.findByLabelText('Bezeichnung');
    expect(screen.getByRole('button', { name: 'Speichern und nächste' })).toBeInTheDocument();
  });

  it('Bearbeiten: KEIN Serienweg — „Speichern und nächste" wäre ein toter Knopf', async () => {
    handler();
    renderMitProviders(<Harness bestand={material} />);
    await screen.findByLabelText('Bezeichnung');
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });

  it('bleibt beim Serien-Speichern offen und leert die Bezeichnung', async () => {
    // Ein im `onSuccess` der Mutation stehengebliebenes `onClose()` schlösse den Dialog
    // auch im Serienlauf; jsdom hält den schliessenden Dialog samt Feldern im Baum, der
    // Beleg ist deshalb der NICHT gerufene Schliess-Callback.
    handler();
    const geschlossen = vi.fn();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness onClose={geschlossen} />);

    await nutzer.type(await screen.findByLabelText('Bezeichnung'), 'Wolldecke');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(geschlossen).not.toHaveBeenCalled();
  });

  it('nach erfolgreichem Bearbeiten startet das nächste Anlegen leer', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={material} />);
    expect(await screen.findByLabelText('Bezeichnung')).toHaveValue('Wolldecke');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
    expect(screen.getByLabelText('Bestandsnummer')).toHaveValue('');
  });

  /**
   * LFH-346 · A8, Befund N20. Die tragende Prüfung des Collapse-Umbaus — nicht die
   * Zählung darunter: beide Hälften der Zählung stünden grün, während jedes Speichern
   * drei Felder still leert.
   *
   * `MaterialEingabe` ist Vollersatz. Ohne `forceRender` sind Träger, Standort und
   * Bemerkung nicht montiert, und `onFinish` liefert nur montierte Felder — ein
   * `onErfassen`, das seine Werte von dort nimmt, schickte drei `null` an ein
   * Material, an dem niemand etwas davon angefasst hat.
   */
  it('behält Träger, Standort und Bemerkung, wenn niemand aufklappt', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/material/3', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(material);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={{ ...material, bemerkung: 'Zweite Reihe' }} />);
    const feld = await screen.findByLabelText('Bezeichnung');
    await nutzer.clear(feld);
    await nutzer.type(feld, 'Wolldecke groß');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toEqual({
      bezeichnung: 'Wolldecke groß',
      kategorie: 'Betreuung',
      bestandsnummer: 'INV-7',
      traegerorganisation: 'DRK Musterstadt',
      standort: 'Lagerhalle 2',
      bemerkung: 'Zweite Reihe',
    });
  });

  /**
   * Die Gegenprobe: ein aufgeklappt geleerter Standort kommt auch geleert an. Ein
   * Rückfall auf `material?.standort` bestünde die Prüfung darüber und fiele hier.
   */
  it('ein aufgeklappt geleerter Standort kommt geleert an', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/material/3', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(material);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={material} />);
    await screen.findByLabelText('Bezeichnung');
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await nutzer.clear(await screen.findByLabelText('Standort'));
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toMatchObject({ standort: null, traegerorganisation: 'DRK Musterstadt' });
  });

  /**
   * Träger und Standort sind zugleich die Wiederholfelder des Serienlaufs
   * (`uebernahme`) und liegen seit A8 hinter dem Collapse. Die Hülle liest sie aus
   * den `onFinish`-Werten, also nur, solange sie montiert sind — was sie sind,
   * sobald jemand aufgeklappt hat, um sie überhaupt einzutragen. Und der Bereich
   * bleibt über ein `resetFields` hinweg offen. Beides zusammen ist die Aussage;
   * ohne diese Prüfung wäre „Wiederholfeld hinter dem Collapse" eine Vermutung.
   */
  it('Wiederholfelder überleben den Serienlauf auch hinter dem Collapse', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);

    await nutzer.type(await screen.findByLabelText('Bezeichnung'), 'Wolldecke');
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await nutzer.type(await screen.findByLabelText('Trägerorganisation'), 'DRK Musterstadt');
    await nutzer.type(screen.getByLabelText('Standort'), 'Lagerhalle 2');
    await nutzer.click(screen.getByRole('checkbox', { name: /Werte behalten/ }));
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(screen.getByLabelText('Trägerorganisation')).toHaveValue('DRK Musterstadt');
    expect(screen.getByLabelText('Standort')).toHaveValue('Lagerhalle 2');
  });

  /**
   * Der Collapse liegt IM `<form>` — also in Reichweite der eingebauten
   * Formularübermittlung. Der Dateikopf von `components/Erfassung.tsx` benennt die
   * Falle: Enter löst den ERSTEN Übermittlungsknopf im Baum aus, und der Klapp-Kopf
   * steht vor dem Speichern-Knopf. Wäre er ein `<button>` ohne `type="button"`,
   * klappte Enter im ersten Feld den Bereich auf, statt zu speichern.
   *
   * GEMESSEN ist er ein `<div role="button">` (antd 6) — die Zusicherung hält also.
   * Diese Prüfung ist die Stelle, an der ein antd-Sprung das auffliegen liesse; die
   * Struktur-Abfragen daneben (keine Fusszeile, Knopf im `<form>`) blieben dabei
   * beide grün. Hier ist Enter ausnahmsweise per Tastendruck belegbar: das erste
   * sichtbare Feld ist ein einfaches `Input`, `@rc-component/select` kommt nicht
   * dazwischen.
   */
  it('Enter im ersten Feld speichert — der Klapp-Kopf fängt es nicht ab', async () => {
    let rumpf: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/material', async ({ request }) => {
        rumpf = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...material, id: 9 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);

    await nutzer.type(await screen.findByLabelText('Bezeichnung'), 'Wolldecke{Enter}');

    await waitFor(() => expect(rumpf).not.toBeNull());
    expect(rumpf).toMatchObject({ bezeichnung: 'Wolldecke' });
    // Die Gegenaussage: der Bereich ist NICHT aufgeklappt — Enter hat gespeichert,
    // nicht den Klapp-Kopf ausgelöst.
    expect(screen.queryByLabelText('Standort')).toBeNull();
  });

  /**
   * Das Feldbudget (LFH-346 · A8): drei sichtbare Felder statt sechs.
   *
   * Gezählt werden `.ant-form-item`-Knoten, nicht `role="textbox"` — die Kategorie ist
   * ein `AutoComplete` und zählte in der Rollenzählung als `combobox`. Die zweite
   * Hälfte ist Pflicht: „höchstens drei" allein erfüllte auch ein Dialog ohne Felder.
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
