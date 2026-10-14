import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { waehle } from '../test/auswahlListe';
import type { EinheitTyp, Einsatzabschnitt, EinsatzFahrzeug, EinsatzPersonal } from '../api/types';
import EigeneEinheitDialog from './EigeneEinheitDialog';

const RTW = {
  id: 3,
  funkrufname: 'Florian Nachbarstadt 44/1',
  einheit_id: null,
  soll_besatzung: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 },
} as EinsatzFahrzeug;

const TYPEN: EinheitTyp[] = [
  { id: 1, label: 'Trupp', soll: { fuehrer: 0, unterfuehrer: 1, mannschaft: 2 }, sortier: 1 },
  {
    id: 2,
    label: 'Rettungstrupp',
    soll: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 },
    sortier: 2,
  },
];

const PERSONAL = [
  { id: 7, name: 'Anna', fahrzeug_id: 3, einheit_id: null },
  { id: 8, name: 'Berta', fahrzeug_id: 3, einheit_id: null },
  { id: 9, name: 'Carl', fahrzeug_id: 3, einheit_id: 50 },
] as EinsatzPersonal[];

const ABSCHNITTE = [{ id: 4, name: 'Abschnitt Nord' }] as Einsatzabschnitt[];

let bodies: unknown[];

function handler(typen = TYPEN) {
  server.use(
    http.get('/api/einheit-typen', () => HttpResponse.json(typen)),
    http.post('/api/einsaetze/1/einheiten', async ({ request }) => {
      const body = (await request.json()) as { name: string };
      bodies.push(body);
      return HttpResponse.json({ id: 60, name: body.name }, { status: 201 });
    }),
  );
}

beforeEach(() => {
  bodies = [];
});

function Harness({ abschnitte = ABSCHNITTE }: { abschnitte?: Einsatzabschnitt[] | null }) {
  const [fahrzeug, setFahrzeug] = useState<EinsatzFahrzeug | null>(RTW);
  return (
    <>
      <span>{fahrzeug ? 'offen' : 'zu'}</span>
      <EigeneEinheitDialog
        einsatzId={1}
        fahrzeug={fahrzeug}
        personal={PERSONAL}
        abschnitte={abschnitte}
        onSchliessen={() => setFahrzeug(null)}
      />
    </>
  );
}

/**
 * Der angezeigte Wert einer Einfachauswahl: antd 6 rendert ihn als `.ant-select-content`, ohne
 * Wert steht dort der Platzhalter.
 */
function auswahlWert(feld: string): string | null {
  const eingabe = screen.getByRole('combobox', { name: feld });
  const inhalt = eingabe.closest('.ant-select')?.querySelector('.ant-select-content');
  const text = inhalt?.textContent ?? '';
  return text === '' || inhalt?.querySelector('.ant-select-placeholder') ? null : text;
}

describe('EigeneEinheitDialog — Als eigene Einheit führen (LLH-1073, design.md D9)', () => {
  it('trägt die Erfassungs-Norm: keine Modal-Fusszeile, Knopf im <form>', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Einheit bilden' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  /**
   * Feldbudget (LFH-19): drei Felder. Es gibt keinen eingeklappten Teil; die Gegenprobe läuft über
   * die Freigabe der Einsatzabschnitte: ohne sie entfällt das Feld, die Zahl sinkt auf zwei.
   */
  it('zeigt höchstens drei Felder, den Abschnitt nur mit Freigabe', async () => {
    handler();
    const { unmount } = renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(3);
    expect(within(dialog).getByRole('combobox', { name: 'Abschnitt' })).toBeInTheDocument();
    unmount();

    renderMitProviders(<Harness abschnitte={null} />);
    const ohne = await screen.findByRole('dialog');
    expect(ohne.querySelectorAll('.ant-form-item')).toHaveLength(2);
    expect(within(ohne).queryByRole('combobox', { name: 'Abschnitt' })).toBeNull();
  });

  it('belegt Name und den einen passenden Typ vor und nennt die mitkommende Besatzung', async () => {
    handler();
    renderMitProviders(<Harness />);
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue(
      'Florian Nachbarstadt 44/1',
    );
    await waitFor(() => expect(auswahlWert('Typ')).toBe('Rettungstrupp'));
    // Carl gehört einer anderen Einheit an und bleibt dort (D10).
    expect(screen.getByText('Besatzung: Anna, Berta')).toBeInTheDocument();
  });

  it('rät keinen Typ, wenn zwei Typen dasselbe Soll haben', async () => {
    handler([...TYPEN, { ...TYPEN[1], id: 3, label: 'Rettungstrupp B' }]);
    renderMitProviders(<Harness />);
    await screen.findByRole('textbox', { name: 'Name' });
    await new Promise((r) => setTimeout(r, 50));
    expect(auswahlWert('Typ')).toBeNull();
    const feld = screen.getByRole('combobox', { name: 'Typ' }).closest('.ant-select');
    expect(feld).not.toHaveTextContent('Rettungstrupp');
    expect(feld).toHaveTextContent('ohne Typ');
  });

  it('bildet die Einheit mit dem Soll und dem Fahrzeug, meldet sie und schließt', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(auswahlWert('Typ')).toBe('Rettungstrupp'));
    await waehle('Abschnitt', 'Abschnitt Nord');
    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));
    expect(
      await screen.findByText('Einheit «Florian Nachbarstadt 44/1» gebildet'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        name: 'Florian Nachbarstadt 44/1',
        typ_id: 2,
        abschnitt_id: 4,
        soll_fuehrer: 0,
        soll_unterfuehrer: 1,
        soll_mannschaft: 1,
        fahrzeug_ids: [3],
      },
    ]);
    expect(await screen.findByText('zu')).toBeInTheDocument();
  });

  it('nennt den Grund am Fahrzeug, wenn es inzwischen einer Einheit angehört', async () => {
    handler();
    server.use(
      http.post('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json(
          {
            error: 'Nicht alle Fahrzeuge lassen sich zuordnen',
            zeilen: [{ art: 'fahrzeug', id: 3, grund: 'gehört zu «Zug 2»' }],
          },
          { status: 422 },
        ),
      ),
    );
    renderMitProviders(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    expect(
      await screen.findByText('Florian Nachbarstadt 44/1 – gehört zu «Zug 2»'),
    ).toBeInTheDocument();
    expect(screen.getByText('offen')).toBeInTheDocument();
  });
});
