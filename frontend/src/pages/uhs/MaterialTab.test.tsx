import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { EinsatzMaterial, MaterialStatus, UhsDetail } from '../../api/types';
import { CommandPaletteProvider } from '../../command-palette/CommandPaletteProvider';
import MaterialTab from './MaterialTab';

/**
 * Der Materialreiter der UHS auf der Erfassungshülle. Geprüft werden:
 *
 * 1. Der Absende-Knopf liegt im `<form>`. „Enter im Auswahlfeld sendet ab" ist mit einem
 *    antd-`Select` unerreichbar: rc-select ruft bei jedem Enter `preventDefault()` (außer im Modus
 *    `combobox`) und öffnet die Liste. Belegt wird deshalb die Struktur, aus der die Zusicherung
 *    folgt — dieselbe Abfrage wie `Erfassung.test.tsx`.
 * 2. Escape setzt zurück. Das war schon vor der Hülle so (antds `Modal` ruft `onCancel` für alle
 *    vier Auswege); der Test ist der Riegel dagegen, dass der `Form`-Speicher der Hülle eine Lücke
 *    einbaut, die vorher nicht da war.
 */

const uhs = { id: 3, einsatz_id: 1, plaetze: [], belegungen: [] } as unknown as UhsDetail;

const basis = {
  einsatz_id: 1,
  material_id: 5,
  einheit_id: null,
  ist_adhoc: false,
  kategorie: 'Betreuung',
  bestandsnummer: null,
  traegerorganisation: null,
  status: 'einsatzbereit',
  bemerkung: null,
  disponiert_at: '2026-07-30 09:00:00',
  disponiert_von: 1,
};

/** Frei verortbar (uhs_id === null) → steht im Auswahlfeld der Erfassungsmaske. */
const frei = {
  ...basis,
  id: 10,
  bezeichnung: 'Wolldecke',
  menge: 50,
  uhs_id: null,
} as unknown as EinsatzMaterial;
const freiZwei = {
  ...basis,
  id: 11,
  bezeichnung: 'Zeltbahn',
  menge: 4,
  uhs_id: null,
} as unknown as EinsatzMaterial;
/** Dieser UHS zugeordnet → steht in der Tabelle. */
const verortet = {
  ...basis,
  id: 12,
  bezeichnung: 'Trage',
  menge: 2,
  uhs_id: 3,
} as unknown as EinsatzMaterial;

interface Patch {
  emId: number;
  body: unknown;
}

/**
 * Rendert den Reiter und gibt die aufgezeichneten PATCHes zurück — geprüft wird der Weg bis zum
 * Request, nicht der Aufruf eines Doubles.
 */
function render(
  material: EinsatzMaterial[],
  schreibgeschuetzt = false,
  // Hält den PATCH offen, bis der Test ihn freigibt — sonst antwortet MSW vor einem zweiten Klick,
  // und der Riegel gegen Doppel-Absenden wäre nicht prüfbar.
  anhalten?: { freigeben: () => void; versprechen: Promise<void> },
) {
  const patches: Patch[] = [];
  server.use(
    http.get('/api/einsaetze/1/material', () => HttpResponse.json(material)),
    http.patch('/api/einsaetze/1/material/:emId', async ({ params, request }) => {
      patches.push({ emId: Number(params.emId), body: await request.json() });
      if (anhalten) await anhalten.versprechen;
      return HttpResponse.json({ ...frei, id: Number(params.emId) });
    }),
  );
  return {
    patches,
    ...renderMitProviders(
      <CommandPaletteProvider>
        <MaterialTab einsatzId={1} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
      </CommandPaletteProvider>,
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
   * Die strukturell prüfbare Zusicherung (siehe Dateikopf): keine antd-Fußzeile und der Knopf hat
   * ein `form` als Vorfahr.
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
   * Der Knopf ist ein `htmlType="submit"` im Formular und erreicht die Mutation über `onFinish`.
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
   * Ohne Auswahl: der Knopf ist bedienbar, die Pflichtprüfung meldet sich, und es geht kein Request
   * raus.
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
   * Der Reset-Beleg läuft über Escape (den `schliessen`-Umschlag in `ErfassungsModal`), nicht über
   * den Knopf: nur dort könnte der Store von rc-field-form das Abhängen der Kinder überleben
   * (`preserve` ist an) und beim nächsten Öffnen gegen `initialValues` gewinnen.
   */
  it('nach Escape ist beim Wiederöffnen nichts stehengeblieben', async () => {
    const user = userEvent.setup();
    render([frei, freiZwei]);
    const dialog = await oeffnenUndWaehlen(user, 'Wolldecke (Betreuung) — 50×');
    expect(within(dialog).getByTitle('Wolldecke (Betreuung) — 50×')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // Nicht auf „Dialog verschwunden" warten: antds Zoom-Animation läuft in jsdom nie zu Ende.
    // Geprüft wird der Inhalt beim Wiederöffnen.
    await user.click(screen.getByRole('button', { name: 'Material zuordnen' }));
    const wieder = await screen.findByRole('dialog');
    await within(wieder).findByRole('combobox');
    // antd v6 trägt den gewählten Eintrag als `title` am Select-Inhalt; das Eingabefeld ist immer
    // leer. Die Optionsliste hängt im Portal außerhalb des Dialogs — `within` trennt beides.
    expect(within(wieder).queryByTitle('Wolldecke (Betreuung) — 50×')).not.toBeInTheDocument();
  });
});

describe('MaterialTab · „Lösen" ist umkehrbar (LFH-378, Trennlinie aus LFH-363)', () => {
  /**
   * Eine gelöste Zuordnung ist umkehrbar (über „Material zuordnen" darüber): der Klick patcht
   * sofort, ohne Rückfrage.
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

  /**
   * Ohne Rückfrage fängt ein `loading` je Zeile den zweiten Klick ab — sonst kostete jeder Klick
   * einen PATCH samt Invalidierung, Live-Ereignis und Erfolgsmeldung. Je Zeile, weil `loesenMut`
   * alle Zeilen bedient.
   */
  it('nimmt keinen zweiten Klick an, solange der PATCH läuft', async () => {
    const user = userEvent.setup();
    let freigeben!: () => void;
    const versprechen = new Promise<void>((r) => {
      freigeben = r;
    });
    const { patches } = render([verortet, { ...verortet, id: 13, bezeichnung: 'Decke' }], false, {
      freigeben,
      versprechen,
    });
    await screen.findByText('Trage');
    const [ersteZeile, zweiteZeile] = screen.getAllByRole('button', { name: 'Lösen' });

    await user.click(ersteZeile);
    await waitFor(() => expect(patches).toHaveLength(1));
    await user.click(ersteZeile);

    expect(patches).toHaveLength(1);
    // Der Riegel liegt an dieser Zeile, nicht an der Spalte.
    expect(zweiteZeile).toBeEnabled();

    freigeben();
    await waitFor(() => expect(ersteZeile).toBeEnabled());
  });

  it('ohne Schreibrecht gibt es weder Lösen noch Zuordnen', async () => {
    render([verortet, frei], true);
    await screen.findByText('Trage');
    expect(screen.queryByRole('button', { name: 'Lösen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Material zuordnen' })).not.toBeInTheDocument();
  });
});

/**
 * Statusspalte: Farbe und Beschriftung kommen aus `theme/statusFarben.ts` (`materialStatus`), wie
 * in `MaterialPage`.
 */
describe('MaterialTab · Statusspalte (LFH-341 · C6)', () => {
  // Die Menge läuft Mono mit `tabular-nums`, die Bezeichnung bleibt Satzschrift.
  it('setzt die Menge in die Zahlenschrift, die Bezeichnung nicht', async () => {
    render([verortet]);
    const menge = await screen.findByText('2');
    expect(menge.style.fontFamily).toContain('JetBrains Mono');
    expect(menge.style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('Trage').style.fontFamily).toBe('');
  });

  it('zeigt den Materialstatus als Etikett, nie den rohen Wire-Wert', async () => {
    render([{ ...verortet, status: 'desinfektion_noetig' as MaterialStatus }]);

    expect(await screen.findByText('Desinfektion nötig')).toBeInTheDocument();
    expect(screen.queryByText('desinfektion_noetig')).not.toBeInTheDocument();
  });

  it('lässt in keiner Statuszelle einen Unterstrich stehen', async () => {
    const alleStatus: MaterialStatus[] = [
      'einsatzbereit',
      'im_einsatz',
      'defekt',
      'verbraucht',
      'desinfektion_noetig',
    ];
    render(
      alleStatus.map((status, i) => ({
        ...verortet,
        id: 20 + i,
        bezeichnung: `Material ${i}`,
        status,
      })),
    );

    // Gegen die Zellen, nicht den ganzen Baum: ein Unterstrich in einer Bezeichnung wäre kein
    // Befund.
    const zellen = await screen.findAllByTestId('material-status-zelle');
    expect(zellen.length).toBeGreaterThan(0);
    for (const zelle of zellen) expect(zelle.textContent).not.toMatch(/_/);
  });
});
