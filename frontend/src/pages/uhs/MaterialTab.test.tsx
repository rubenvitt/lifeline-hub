import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { EinsatzMaterial, UhsDetail } from '../../api/types';
import MaterialTab from './MaterialTab';

/**
 * Belege zu LFH-378 · B5l — der Materialreiter der UHS.
 *
 * Die Datei hatte bis hierher KEINE Testdatei; der Umbau der Erfassungsmaske auf
 * `ErfassungsModal` (LFH-332/B4) wäre ohne sie unbelegt. Geprüft werden genau die
 * zwei Zusicherungen, die der handgebaute `<Modal onOk>` davor NICHT trug:
 *
 *   1. **Der Absende-Knopf liegt im `<form>`.** Vorher hing er als `onOk` am Modal, also
 *      als DOM-Geschwister ausserhalb des Formulars.
 *
 *      **Was hier NICHT geprüft wird und warum — gemessen am 31.07.2026.** Das Ticket
 *      verlangte „Enter im Auswahlfeld sendet ab". Mit einem antd-`Select` als Feld ist
 *      das unerreichbar, und zwar nicht wegen der Hülle: `@rc-component/select`
 *      (`BaseSelect/index.js:246`) ruft bei JEDEM Enter `event.preventDefault()`, solange
 *      der Modus nicht `combobox` ist — kommentiert mit „Do not submit form when type in
 *      the input" — und öffnet stattdessen die Liste. Die eingebaute Formularübermittlung
 *      des Browsers erreicht die Taste damit nie. Ein `Select` ist für Enter also
 *      ausgenommen wie eine `Input.TextArea`; die Zusicherung der Hülle greift für
 *      `Input`/`InputNumber`/`DatePicker`. Belegt wird deshalb die STRUKTUR, aus der die
 *      Zusicherung folgt — dieselbe Abfrage, die `Erfassung.test.tsx` an der Hülle führt.
 *   2. **Escape setzt zurück.** Dieser Beleg war schon VOR dem Umbau grün, und das
 *      gehört hierher statt in eine Erfolgsmeldung: das Ticket schrieb, der Bestand
 *      decke „nur zwei der vier Auswege", aber antds `Modal` ruft `onCancel` für ALLE
 *      vier (Knopf, Schliesskreuz, Escape, Maskenklick) — und der Bestand leerte dort
 *      seinen `useState`. Der gemessene Reset-Fehler aus LFH-332 traf Masken mit einem
 *      `Form`-Speicher, der das Abhängen der Kinder überlebt; einen solchen bekommt
 *      diese Maske durch den Umbau ERST. Der Test ist deshalb kein Fix-Beleg, sondern
 *      der Riegel dagegen, dass der Umbau eine Lücke einbaut, die vorher nicht da war.
 */

const uhs = { id: 3, einsatz_id: 1, plaetze: [], belegungen: [] } as unknown as UhsDetail;

const basis = {
  einsatz_id: 1, material_id: 5, einheit_id: null, ist_adhoc: false,
  kategorie: 'Betreuung', bestandsnummer: null, traegerorganisation: null,
  status: 'einsatzbereit', bemerkung: null,
  disponiert_at: '2026-07-30 09:00:00', disponiert_von: 1,
};

/** Frei verortbar (uhs_id === null) → steht im Auswahlfeld der Erfassungsmaske. */
const frei = { ...basis, id: 10, bezeichnung: 'Wolldecke', menge: 50, uhs_id: null } as unknown as EinsatzMaterial;
const freiZwei = { ...basis, id: 11, bezeichnung: 'Zeltbahn', menge: 4, uhs_id: null } as unknown as EinsatzMaterial;
/** Dieser UHS zugeordnet → steht in der Tabelle. */
const verortet = { ...basis, id: 12, bezeichnung: 'Trage', menge: 2, uhs_id: 3 } as unknown as EinsatzMaterial;

interface Patch { emId: number; body: unknown }

/**
 * Rendert den Reiter und gibt die aufgezeichneten PATCHes zurück. Kein `vi.fn()` als
 * Mutation: geprüft wird der Weg bis zum Request, nicht der Aufruf eines Doubles.
 */
function render(material: EinsatzMaterial[], schreibgeschuetzt = false) {
  const patches: Patch[] = [];
  server.use(
    http.get('/api/einsaetze/1/material', () => HttpResponse.json(material)),
    http.patch('/api/einsaetze/1/material/:emId', async ({ params, request }) => {
      patches.push({ emId: Number(params.emId), body: await request.json() });
      return HttpResponse.json({ ...frei, id: Number(params.emId) });
    }),
  );
  return {
    patches,
    ...renderMitProviders(
      <MaterialTab einsatzId={1} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />,
      { route: '/einsaetze/1/unfallhilfsstellen/3' },
    ),
  };
}

/** Öffnet „Material zuordnen" und wählt den ersten Eintrag im Auswahlfeld. */
async function oeffnenUndWaehlen(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('button', { name: 'Material zuordnen' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('combobox'));
  await user.click(await screen.findByTitle(label));
  return dialog;
}

describe('MaterialTab · Erfassungsmaske „Material zuordnen" (LFH-378)', () => {
  /**
   * DIE Zusicherung des Umbaus, und die einzige, die strukturell prüfbar ist (Begründung
   * im Dateikopf). Beide Hälften zusammen sind die Aussage: KEINE antd-Fusszeile — läge
   * der Knopf in `footer`, stünde er als DOM-Geschwister ausserhalb des `<form>` — UND
   * der Knopf hat tatsächlich ein `form` als Vorfahr. Die Mutationsprobe: dreht man auf
   * `<Modal onOk okText="Zuordnen">` zurück, fallen beide Abfragen.
   */
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    const user = userEvent.setup();
    render([frei, verortet]);
    await user.click(await screen.findByRole('button', { name: 'Material zuordnen' }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Zuordnen' }).closest('form')).not.toBeNull();
  });

  /**
   * Der Weg, den der Betrieb nimmt: auswählen, „Zuordnen". Belegt, dass der Umbau die
   * Mutation noch erreicht — der Knopf ist jetzt ein `htmlType="submit"` im Formular und
   * läuft über `onFinish`, nicht mehr über `onOk`.
   */
  it('ordnet das gewählte Material dieser UHS zu', async () => {
    const user = userEvent.setup();
    const { patches } = render([frei, verortet]);
    const dialog = await oeffnenUndWaehlen(user, 'Wolldecke (Betreuung) — 50×');

    await user.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ emId: 10, body: { uhs_id: 3 } });
  });

  /**
   * Der alte Dialog verhinderte das Absenden ohne Auswahl über einen DEAKTIVIERTEN Knopf
   * — ein Knopf, der nicht sagt, warum er nicht geht. Jetzt trägt das Feld die Pflicht:
   * der Knopf ist bedienbar, die Prüfung meldet sich, und es geht KEIN Request raus.
   */
  it('sendet ohne Auswahl nicht ab, sondern meldet die Pflicht', async () => {
    const user = userEvent.setup();
    const { patches } = render([frei]);
    await user.click(await screen.findByRole('button', { name: 'Material zuordnen' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));

    expect(await screen.findByText('Bitte Material auswählen')).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  /**
   * Der Reset-Beleg läuft über ESCAPE, nicht über den Abbrechen-Knopf — der Knopf-Weg
   * geht durch `ErfassungsFormular.abbrechen()`, Escape durch den `schliessen`-Umschlag
   * in `ErfassungsModal`. Nur der zweite ist die Stelle, an der ein Formularspeicher
   * überleben könnte: `destroyOnHidden` hängt die Kinder ab, der Store von rc-field-form
   * bleibt (`preserve` ist per Vorgabe an) und gewinnt beim nächsten Öffnen gegen
   * `initialValues`. Zum Status „grün auch vor dem Umbau" siehe Dateikopf.
   */
  it('nach Escape ist beim Wiederöffnen nichts stehengeblieben', async () => {
    const user = userEvent.setup();
    render([frei, freiZwei]);
    const dialog = await oeffnenUndWaehlen(user, 'Wolldecke (Betreuung) — 50×');
    expect(within(dialog).getByTitle('Wolldecke (Betreuung) — 50×')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // NICHT auf „Dialog verschwunden" warten: antds Zoom-Animation läuft in jsdom nie zu
    // Ende, der Knoten bleibt mit `ant-zoom-leave` stehen. Geprüft wird stattdessen der
    // INHALT beim Wiederöffnen — das ist ohnehin die Aussage (Muster: Grundriss.test.tsx).
    await user.click(screen.getByRole('button', { name: 'Material zuordnen' }));
    const wieder = await screen.findByRole('dialog');
    await within(wieder).findByRole('combobox');
    // antd v6 trägt den gewählten Eintrag als `title` am Select-Inhalt; das Eingabefeld der
    // Combobox ist immer leer, eine Wert-Abfrage darauf wäre trivial grün. Die Optionsliste
    // hängt im Portal AUSSERHALB des Dialogs — `within` trennt beides sauber.
    expect(within(wieder).queryByTitle('Wolldecke (Betreuung) — 50×')).not.toBeInTheDocument();
  });
});

describe('MaterialTab · „Lösen" ist umkehrbar (LFH-378, Trennlinie aus LFH-363)', () => {
  /**
   * „Eine gelöste Zuordnung" steht in CLAUDE.md wörtlich als Beispiel für UMKEHRBAR:
   * Abstand und `danger`, aber keine zusätzliche Reibung. Die Aktion setzt `uhs_id:
   * null` und ist über „Material zuordnen" direkt darüber wiederherstellbar. Der Klick
   * muss deshalb SOFORT patchen — steht eine Rückfrage davor, bleibt `patches` leer.
   */
  it('löst ohne Rückfrage — ein Klick, ein PATCH', async () => {
    const user = userEvent.setup();
    const { patches } = render([verortet]);
    await screen.findByText('Trage');

    await user.click(screen.getByRole('button', { name: 'Lösen' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ emId: 12, body: { uhs_id: null } });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('ohne Schreibrecht gibt es weder Lösen noch Zuordnen', async () => {
    render([verortet, frei], true);
    await screen.findByText('Trage');
    expect(screen.queryByRole('button', { name: 'Lösen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Material zuordnen' })).not.toBeInTheDocument();
  });
});
