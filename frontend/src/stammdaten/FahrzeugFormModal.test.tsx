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
 * Die Fahrzeugmaske auf `ErfassungsModal` (LFH-346).
 *
 * Geprüft wird nur, was an DIESER Maske verdrahtet ist; was die Hülle selbst zusichert,
 * beweist `components/Erfassung.test.tsx`.
 *
 * **Zum Reset-Beleg:** der Dialog wird über einen ECHTEN Ausweg geschlossen (Speichern bzw.
 * Abbrechen), nicht durch ein bloßes `offen={false}`. Ein Prop-Wechsel löst keinen Ausweg
 * aus: `destroyOnHidden` hängt nur die Kinder ab, der Speicher von rc-field-form überlebt und
 * gewinnt beim nächsten Öffnen gegen `initialValues`.
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
  demo: false,
};

const vorschlaege = {
  fahrzeugtyp: ['LF 20'],
  traegerorganisation: ['FF Musterstadt'],
  standort: ['Wache Mitte'],
};

function handler(onSend: (body: unknown) => void = () => {}, status = 200) {
  server.use(
    http.post('/api/fahrzeuge', async ({ request }) => {
      onSend(await request.json());
      if (status !== 200)
        return HttpResponse.json({ error: 'Funkrufname bereits vergeben' }, { status });
      return HttpResponse.json({ ...fahrzeug, id: 9 });
    }),
    http.patch('/api/fahrzeuge/1', async ({ request }) => {
      onSend(await request.json());
      return HttpResponse.json(fahrzeug);
    }),
  );
}

/**
 * Eltern mit Offen-Zustand. „Wieder öffnen" öffnet bewusst IMMER im Anlegen-Fall — der Weg,
 * den `FahrzeugeTab` nimmt, wenn nach einem Bearbeiten „Fahrzeug anlegen" gedrückt wird.
 */
function Harness({ bestand, onClose }: { bestand?: Fahrzeug | null; onClose?: () => void }) {
  const [offen, setOffen] = useState(true);
  const [aktuell, setAktuell] = useState<Fahrzeug | null>(bestand ?? null);
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
      <FahrzeugFormModal
        offen={offen}
        fahrzeug={aktuell}
        vorschlaege={vorschlaege}
        onClose={() => {
          setOffen(false);
          onClose?.();
        }}
      />
    </>
  );
}

describe('FahrzeugFormModal — Hülle (LFH-346/A6)', () => {
  /**
   * Die strukturell prüfbare Hälfte der Enter-Zusicherung: `@rc-component/select` ruft bei jedem
   * Enter `preventDefault()`, ein Tastendruck belegt nichts. Beide Abfragen zusammen sind die
   * Aussage — KEINE antd-Fußzeile UND ein `form` als Vorfahr des Knopfes.
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
   * `uebernahme` einmal vollständig durchgemessen — die übrigen Masken erben die Mechanik aus
   * der Hülle. Der Träger ist bei einer Einheit derselbe, Funkrufname und Kennzeichen nie.
   *
   * `uebernahme` darf nur SICHTBARE Felder nennen; der Standort steht auf der Detailseite, die
   * Gegenaussage „kein Standort" steht deshalb hier.
   */
  it('hält beim Serien-Speichern den Träger und leert den Rest', async () => {
    handler();
    const geschlossen = vi.fn();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness onClose={geschlossen} />);

    await nutzer.type(await screen.findByLabelText('Funkrufname'), 'Florian 1');
    await nutzer.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await nutzer.type(screen.getByLabelText('Trägerorganisation'), 'FF Musterstadt');
    // Die AutoComplete-Liste legt sich sonst über die Knopfreihe und frisst den Klick.
    await nutzer.keyboard('{Escape}');
    await nutzer.type(screen.getByLabelText('Kennzeichen'), 'XX-AB 1');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Funkrufname')).toHaveValue(''));
    expect(screen.getByLabelText('Trägerorganisation')).toHaveValue('FF Musterstadt');
    expect(screen.getByLabelText('Kennzeichen')).toHaveValue('');
    expect(screen.queryByLabelText('Standort')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Funkrufname')).toHaveFocus();
    // Die schärfere Hälfte: der Dialog bleibt OFFEN. Ein `onClose()` im `onSuccess` der Mutation
    // schlösse ihn auch im Serienlauf — sichtbar nur hier, denn jsdom hält den schließenden
    // antd-Dialog samt Feldern im Baum.
    expect(geschlossen).not.toHaveBeenCalled();
  });

  /**
   * Die Zusage muss BRECHEN, wenn der Server ablehnt — deshalb `mutateAsync`. Mit `mutate`
   * liefe die Hülle in ihren Erfolgszweig, leerte die Felder und schlösse den Dialog.
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

describe('FahrzeugFormModal — Schnellerfassung (LFH-346/A7)', () => {
  /**
   * Das Feldbudget (LFH-19: Schnellerfassung ≤ ~4). Gezählt über die LABEL: zwei der vier
   * Felder sind AutoComplete mit Rolle `combobox`, eine `textbox`-Zählung ergäbe 2.
   *
   * Die ABWESENHEITS-Hälfte ist die tragende: „vier sind da" bliebe grün, wenn die übrigen
   * daneben stünden. KEIN `<Collapse>` — die Felder stehen auf der Detailseite.
   */
  it('zeigt genau die vier Felder, ohne die ein Fahrzeug nicht auffindbar ist', async () => {
    handler();
    renderMitProviders(<Harness />);
    await screen.findByLabelText('Funkrufname');

    for (const label of ['Funkrufname', 'Fahrzeugtyp', 'Trägerorganisation', 'Kennzeichen']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const label of [
      'OPTA',
      'Standort',
      'FMS-ISSI',
      'Sonder-/Wegerecht',
      'Tragenkapazität',
      'Soll-Stärke (alle drei oder keiner)',
      'Bemerkung',
    ]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
  });

  /**
   * `PATCH /api/fahrzeuge/{id}` ist ein echter Teil-Patch (LFH-306): fehlender Key =
   * unverändert, `null` = LEEREN, und `leerZuNull(undefined)` ist `null`. Ein Vollersatz-Mapper
   * löschte bei jedem Bearbeiten OPTA, Standort, FMS-ISSI, Tragenkapazität, Soll-Stärke und
   * Bemerkung — still.
   *
   * Geprüft werden die KEYS des Bodys: `body.opta === undefined` ist für einen fehlenden Key
   * trivial wahr (wie `contains_key` auf der Backend-Seite).
   */
  it('schickt beim Bearbeiten NUR seine vier Felder — der Teil-Patch lässt den Rest stehen', async () => {
    const gesendet = vi.fn();
    handler(gesendet);
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={fahrzeug} />);

    await nutzer.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(gesendet).toHaveBeenCalledTimes(1));
    expect(Object.keys(gesendet.mock.calls[0][0] as object).sort()).toEqual([
      'fahrzeugtyp',
      'funkrufname',
      'kennzeichen',
      'traegerorganisation',
    ]);
  });

  /**
   * Der Weg zu den übrigen Feldern. Beim ANLEGEN gibt es noch keine id und keine Route — ein
   * Link stünde dort ins Leere.
   */
  it('führt beim Bearbeiten auf die Detailseite', async () => {
    handler();
    renderMitProviders(<Harness bestand={fahrzeug} />);
    const link = await screen.findByRole('link', { name: /Mehr Details/ });
    expect(link).toHaveAttribute('href', '/admin/stammdaten/fahrzeuge/1');
  });

  it('zeigt beim Anlegen KEINEN Detail-Link — es gibt noch keine id', async () => {
    handler();
    renderMitProviders(<Harness />);
    await screen.findByLabelText('Funkrufname');
    expect(screen.queryByRole('link', { name: /Mehr Details/ })).not.toBeInTheDocument();
  });
});
