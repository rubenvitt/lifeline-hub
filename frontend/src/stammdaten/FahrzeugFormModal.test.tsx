import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Fahrzeug } from '../api/types';
import FahrzeugFormModal from './FahrzeugFormModal';

/**
 * LFH-346/A6 — die Fahrzeugmaske auf `ErfassungsModal`.
 *
 * Geprüft wird nur, was an DIESER Maske verdrahtet ist. Was die Hülle selbst
 * zusichert (Reset auf allen vier Auswegen, Enter-Übermittlung, Serienmechanik),
 * beweist `components/Erfassung.test.tsx` und wird hier nicht nachgespielt.
 *
 * **Zur Bauform des Reset-Belegs:** der Dialog wird über einen ECHTEN Ausweg
 * geschlossen (Speichern bzw. Abbrechen), nicht durch ein blosses `offen={false}`.
 * Ein nackter Prop-Wechsel löst keinen der vier Auswege aus — er ist damit auch
 * keine gültige Probe: `destroyOnHidden` hängt nur die Kinder ab, der Speicher von
 * rc-field-form überlebt und gewinnt beim nächsten Öffnen gegen `initialValues`.
 */

const fahrzeug: Fahrzeug = {
  id: 1,
  funkrufname: 'Florian 1',
  fahrzeugtyp: 'LF 20',
  traegerorganisation: 'FF Musterstadt',
  kennzeichen: 'XX-AB 1',
  opta: null,
  standort: 'Wache Mitte',
  fms_issi: null,
  sondersignal: false,
  tragenkapazitaet: null,
  staerke: null,
  bemerkung: null,
  dienststatus: 'in_dienst',
  angelegt_at: '2026-05-26 10:00:00',
};

const vorschlaege = { fahrzeugtyp: ['LF 20'], traegerorganisation: ['FF Musterstadt'], standort: ['Wache Mitte'] };

function handler(onSend: (body: unknown) => void = () => {}, status = 200) {
  server.use(
    http.post('/api/fahrzeuge', async ({ request }) => {
      onSend(await request.json());
      if (status !== 200) return HttpResponse.json({ error: 'Funkrufname bereits vergeben' }, { status });
      return HttpResponse.json({ ...fahrzeug, id: 9 });
    }),
    http.patch('/api/fahrzeuge/1', async ({ request }) => {
      onSend(await request.json());
      return HttpResponse.json(fahrzeug);
    }),
  );
}

/**
 * Eltern mit Offen-Zustand. „Wieder öffnen" öffnet bewusst IMMER im Anlegen-Fall —
 * das ist der Weg, den `FahrzeugeTab` nimmt, wenn nach einem Bearbeiten „Fahrzeug
 * anlegen" gedrückt wird, und der Weg, den der entfernte `resetFields()`-Zweig
 * früher abdeckte.
 */
function Harness({ bestand, onClose }: { bestand?: Fahrzeug | null; onClose?: () => void }) {
  const [offen, setOffen] = useState(true);
  const [aktuell, setAktuell] = useState<Fahrzeug | null>(bestand ?? null);
  return (
    <>
      <button type="button" onClick={() => { setAktuell(null); setOffen(true); }}>
        Wieder öffnen
      </button>
      <FahrzeugFormModal
        offen={offen}
        fahrzeug={aktuell}
        vorschlaege={vorschlaege}
        onClose={() => { setOffen(false); onClose?.(); }}
      />
    </>
  );
}

describe('FahrzeugFormModal — Hülle (LFH-346/A6)', () => {
  /**
   * Die einzige strukturell prüfbare Hälfte der Enter-Zusicherung: `@rc-component/select`
   * ruft bei jedem Enter `preventDefault()`, ein Tastendruck belegt hier also nichts.
   * Beide Abfragen zusammen sind die Aussage — KEINE antd-Fusszeile (dort wäre der Knopf
   * ein DOM-Geschwister ausserhalb des `<form>`) UND der Knopf hat ein `form` als Vorfahr.
   * Mutationsprobe: zurück auf `<Modal onOk>` färbt beide rot.
   */
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Speichern' });

    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins Funkrufname-Feld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Funkrufname')));
  });

  /**
   * Das Paar zu `serie={fahrzeug == null}`. Eine der beiden Hälften allein bliebe
   * auch bei einem festen `serie`-Wert grün.
   */
  it('Anlegen: der Serienweg steht — Fahrzeuge werden am Stück erfasst', async () => {
    handler();
    renderMitProviders(<Harness />);
    await screen.findByLabelText('Funkrufname');
    expect(screen.getByRole('button', { name: 'Speichern und nächste' })).toBeInTheDocument();
  });

  it('Bearbeiten: KEIN Serienweg — „Speichern und nächste" wäre ein toter Knopf', async () => {
    handler();
    renderMitProviders(<Harness bestand={fahrzeug} />);
    await screen.findByLabelText('Funkrufname');
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });

  /**
   * `uebernahme` einmal vollständig durchgemessen — die übrigen Masken erben dieselbe
   * Mechanik aus der Hülle. Träger und Standort sind bei einer Einheit dieselben,
   * der Funkrufname ist es nie.
   */
  it('hält beim Serien-Speichern Träger und Standort und leert den Rest', async () => {
    handler();
    const geschlossen = vi.fn();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness onClose={geschlossen} />);

    await nutzer.type(await screen.findByLabelText('Funkrufname'), 'Florian 1');
    await nutzer.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await nutzer.type(screen.getByLabelText('Trägerorganisation'), 'FF Musterstadt');
    // Die AutoComplete-Liste legt sich sonst über die Knopfreihe und frisst den Klick.
    await nutzer.keyboard('{Escape}');
    await nutzer.type(screen.getByLabelText('Standort'), 'Wache Mitte');
    await nutzer.keyboard('{Escape}');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Funkrufname')).toHaveValue(''));
    expect(screen.getByLabelText('Trägerorganisation')).toHaveValue('FF Musterstadt');
    expect(screen.getByLabelText('Standort')).toHaveValue('Wache Mitte');
    expect(screen.getByLabelText('Funkrufname')).toHaveFocus();
    // Die schärfere Hälfte: der Dialog bleibt OFFEN. Ein im `onSuccess` der Mutation
    // stehengebliebenes `onClose()` schlösse ihn auch im Serienlauf und machte den
    // Serienweg still wirkungslos — sichtbar wird das nur hier, denn jsdom hält den
    // schliessenden antd-Dialog samt Feldern im Baum fest.
    expect(geschlossen).not.toHaveBeenCalled();
  });

  /**
   * Die Zusage muss BRECHEN, wenn der Server ablehnt — deshalb `mutateAsync` und nicht
   * `mutate`. Mit `mutate` liefe die Hülle in ihren Erfolgszweig, leerte die Felder und
   * schlösse den Dialog, obwohl nie etwas ankam: der Wortlaut wäre weg. Dieser Test ist
   * der einzige, der das sieht.
   */
  it('behält bei einer Ablehnung (422) den Wortlaut und lässt den Dialog offen', async () => {
    handler(() => {}, 422);
    const geschlossen = vi.fn();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness onClose={geschlossen} />);

    await nutzer.type(await screen.findByLabelText('Funkrufname'), 'Florian 1');
    await nutzer.type(screen.getByLabelText('Kennzeichen'), 'XX-AB 1');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await screen.findByText('Funkrufname bereits vergeben');
    expect(screen.getByLabelText('Funkrufname')).toHaveValue('Florian 1');
    expect(screen.getByLabelText('Kennzeichen')).toHaveValue('XX-AB 1');
    expect(geschlossen).not.toHaveBeenCalled();
  });

  it('Bearbeiten: die Vorbelegung steht — sie ist kein Reset und bleibt erhalten', async () => {
    handler();
    renderMitProviders(<Harness bestand={fahrzeug} />);
    expect(await screen.findByLabelText('Funkrufname')).toHaveValue('Florian 1');
    expect(screen.getByLabelText('Kennzeichen')).toHaveValue('XX-AB 1');
  });

  it('nach erfolgreichem Bearbeiten startet das nächste Anlegen leer', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={fahrzeug} />);

    await nutzer.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Funkrufname')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Funkrufname')).toHaveValue('');
    expect(screen.getByLabelText('Kennzeichen')).toHaveValue('');
  });

  it('Abbrechen leert die Felder — der zweite Aufruf startet leer', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);

    await nutzer.type(await screen.findByLabelText('Funkrufname'), 'Florian 9');
    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));

    await waitFor(() => expect(screen.getByLabelText('Funkrufname')).toHaveValue(''));
  });
});
