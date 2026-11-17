import { http, HttpResponse } from 'msw';
import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../test/server';
import { renderMitProviders, setzeOnline } from '../../test/utils';
import { freigabenFixture } from '../../test/fixtures';
import type { AbschlussPruefung } from '../../api/types';
import EinsatzAbschlussDialog, {
  KRAEFTE_SATZ,
  matchesEinsatzkennung,
} from './EinsatzAbschlussDialog';

/**
 * Abschlussdialog (LLH-1814, Spec `einsatz-abschluss`, design.md D2/D6): offene Punkte warnen nur,
 * der rote Knopf wird erst mit eingetippter Einsatznummer oder Bezeichnung aktiv, die Prüfung
 * läuft nur im Client.
 */

const leer = { anzahl: 0, eintraege: [] };
const nichtsOffen: AbschlussPruefung = {
  kraefte: { anzahl: 0, eintraege: [], personal: 0 },
  auftraege: leer,
  meldungen: leer,
  nachforderungen: leer,
  betroffene: leer,
};
const offen: AbschlussPruefung = {
  kraefte: {
    anzahl: 4,
    personal: 3,
    eintraege: [{ art: 'einheit', id: 11, bezeichnung: 'Zug 1', status: '3 – Auf Anfahrt' }],
  },
  auftraege: {
    anzahl: 2,
    eintraege: [
      { id: 21, nummer: 4, bezeichnung: 'Sandsäcke an den Deich' },
      { id: 22, nummer: 5, bezeichnung: 'Pumpe prüfen' },
    ],
  },
  meldungen: leer,
  nachforderungen: leer,
  betroffene: { anzahl: 1, eintraege: [{ id: 31, nummer: 42, bezeichnung: 'Verbleib offen' }] },
};

const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord mit einer sehr langen Bezeichnung, die nicht gekürzt wird',
  einsatznummer_intern: 'HW-2026-001',
};

function setup(
  opts: {
    pruefung?: AbschlussPruefung | 'haengt' | 'fehler';
    einsatz?: typeof einsatz | { id: number; bezeichnung: string; einsatznummer_intern: null };
    freigaben?: ReturnType<typeof freigabenFixture>;
  } = {},
) {
  const pruefung = opts.pruefung ?? offen;
  server.use(
    http.get('/api/einsaetze/7/abschluss/pruefung', () => {
      if (pruefung === 'haengt') return new Promise<never>(() => {});
      if (pruefung === 'fehler')
        return HttpResponse.json({ error: 'Datenbank nicht erreichbar' }, { status: 500 });
      return HttpResponse.json(pruefung);
    }),
    http.get('/api/einsaetze/7/modul-freigaben', () =>
      HttpResponse.json(opts.freigaben ?? freigabenFixture()),
    ),
  );
  const onSchliessen = vi.fn();
  const r = renderMitProviders(
    <EinsatzAbschlussDialog einsatz={opts.einsatz ?? einsatz} onSchliessen={onSchliessen} />,
    { route: '/einsaetze/7/einsatzdaten' },
  );
  return { ...r, onSchliessen };
}

const dialog = () => screen.getByRole('dialog');
const knopf = () => within(dialog()).getByRole('button', { name: 'Einsatz abschließen' });
const feld = () =>
  within(dialog()).getByRole('textbox', {
    name: /Zur Bestätigung .*eintippen/,
  });

describe('matchesEinsatzkennung', () => {
  const e = { bezeichnung: 'Hochwasser Nord', einsatznummer_intern: 'HW-2026-001' };
  it('passt auf Nummer und Bezeichnung, ohne Groß/Klein und Leerraum am Rand', () => {
    expect(matchesEinsatzkennung('  hw-2026-001 ', e)).toBe(true);
    expect(matchesEinsatzkennung('HOCHWASSER NORD', e)).toBe(true);
  });
  it('passt nicht auf Teile, fremde Einsätze oder nichts', () => {
    expect(matchesEinsatzkennung('Hochwasser', e)).toBe(false);
    expect(matchesEinsatzkennung('Hochwasser Süd', e)).toBe(false);
    expect(matchesEinsatzkennung('', e)).toBe(false);
    expect(matchesEinsatzkennung('   ', { bezeichnung: '', einsatznummer_intern: null })).toBe(
      false,
    );
  });
  it('vergleicht Umlaute nach deutscher Regel', () => {
    expect(
      matchesEinsatzkennung('ÜBUNG ÖLSPUR', {
        bezeichnung: 'Übung Ölspur',
        einsatznummer_intern: null,
      }),
    ).toBe(true);
  });
});

describe('EinsatzAbschlussDialog (LLH-1814)', () => {
  it('zeigt Bezeichnung und Nummer in voller Länge', async () => {
    setup();
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(einsatz.bezeichnung)).toBeInTheDocument();
    expect(within(d).getByText('HW-2026-001')).toBeInTheDocument();
  });

  it('lässt den roten Knopf inaktiv bei falschem Text', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole('dialog');
    expect(knopf()).toBeDisabled();
    expect(knopf()).toHaveClass('ant-btn-dangerous');
    await user.type(feld(), 'Hochwasser Süd');
    expect(knopf()).toBeDisabled();
  });

  it('aktiviert den Knopf bei der Nummer in Kleinbuchstaben', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole('dialog');
    await user.type(feld(), ' hw-2026-001 ');
    expect(knopf()).toBeEnabled();
  });

  it('aktiviert den Knopf bei der Bezeichnung eines Einsatzes ohne Nummer', async () => {
    setup({ einsatz: { id: 7, bezeichnung: 'Ölspur B 27', einsatznummer_intern: null } });
    const user = userEvent.setup();
    await screen.findByRole('dialog');
    expect(feld()).toHaveAccessibleName('Zur Bestätigung Bezeichnung eintippen');
    await user.type(feld(), 'ölspur b 27');
    expect(knopf()).toBeEnabled();
  });

  it('nennt die offenen Punkte je Gruppe mit Zahl, Status der Kraft und Satz zu den Kräften', async () => {
    setup();
    const d = await screen.findByRole('dialog');
    const kraefte = await within(d).findByRole('region', { name: 'Kräfte' });
    expect(within(kraefte).getByText('4')).toBeInTheDocument();
    expect(within(kraefte).getByText('Zug 1')).toBeInTheDocument();
    expect(within(kraefte).getByText('3 – Auf Anfahrt')).toBeInTheDocument();
    expect(within(kraefte).getByText(/3 Einsatzkräfte/)).toBeInTheDocument();
    const auftraege = within(d).getByRole('region', { name: 'Aufträge' });
    expect(within(auftraege).getByText('2')).toBeInTheDocument();
    expect(within(auftraege).getByText('Sandsäcke an den Deich')).toBeInTheDocument();
    const betroffene = within(d).getByRole('region', { name: 'Betroffene' });
    expect(within(betroffene).getByText('R-042')).toBeInTheDocument();
    expect(within(betroffene).getByText('Verbleib offen')).toBeInTheDocument();
    // Gruppen ohne offene Punkte stehen nicht da.
    expect(within(d).queryByRole('region', { name: 'Meldungen' })).toBeNull();
    expect(
      within(d).getByText(
        'Nicht entlassene Kräfte bleiben mit ihrem letzten Status in diesem Einsatz stehen und sind für andere Einsätze frei.',
      ),
    ).toBeInTheDocument();
  });

  it('nennt je Gruppe höchstens drei Einträge, die Zahl zählt alle', async () => {
    const fuenf = [1, 2, 3, 4, 5].map((n) => ({
      id: 100 + n,
      nummer: n,
      bezeichnung: `Meldung ${n}`,
    }));
    setup({ pruefung: { ...nichtsOffen, meldungen: { anzahl: 8, eintraege: fuenf } } });
    const d = await screen.findByRole('dialog');
    const meldungen = await within(d).findByRole('region', { name: 'Meldungen' });
    expect(within(meldungen).getByText('8')).toBeInTheDocument();
    expect(within(meldungen).getAllByRole('listitem')).toHaveLength(3);
    // Eine lange Bezeichnung steht einzeilig; ganz steht sie im Titel.
    expect(within(meldungen).getByText('Meldung 1')).toHaveAttribute('title', 'Meldung 1');
  });

  it('springt je Gruppe ins Modul, nur wenn es für die Person freigegeben ist', async () => {
    setup({ freigaben: freigabenFixture({ personen: { zugriff: false } }) });
    const d = await screen.findByRole('dialog');
    const alle = await within(d).findByRole('link', { name: 'alle Aufträge' });
    expect(alle).toHaveAttribute('href', '/einsaetze/7/auftraege');
    expect(within(d).getByRole('link', { name: 'alle Kräfte' })).toHaveAttribute(
      'href',
      '/einsaetze/7/kraefteuebersicht',
    );
    // Gesperrtes Modul: die Zahl steht, der Sprung fehlt.
    const betroffene = within(d).getByRole('region', { name: 'Betroffene' });
    expect(within(betroffene).getByText('1')).toBeInTheDocument();
    expect(within(betroffene).queryByRole('link')).toBeNull();
  });

  it('sagt „Nichts offen“ ohne offene Punkte', async () => {
    setup({ pruefung: nichtsOffen });
    const d = await screen.findByRole('dialog');
    expect(await within(d).findByText('Nichts offen')).toBeInTheDocument();
  });

  // Der Satz zu den Kräften ist ein fester Pflichtsatz, kein Ergebnis der Prüfung: ohne Antwort
  // darf er nicht entfallen (Spec `einsatz-abschluss`, „Folgen des Abschlusses für gebundene
  // Kräfte“).
  it.each([
    ['ohne offene Punkte', nichtsOffen],
    ['solange die Prüfung lädt', 'haengt'],
    ['wenn die Prüfung scheitert', 'fehler'],
  ] as const)('nennt die Folge für Kräfte immer, auch %s', async (_fall, pruefung) => {
    setup({ pruefung });
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(KRAEFTE_SATZ)).toBeInTheDocument();
  });

  it('nennt bei einem gesperrten Modul nur die Zahl, ohne Einträge und ohne Sprung', async () => {
    setup({
      pruefung: { ...nichtsOffen, meldungen: { anzahl: 2, eintraege: [] } },
      freigaben: freigabenFixture({ meldungen: { zugriff: false } }),
    });
    const d = await screen.findByRole('dialog');
    const meldungen = await within(d).findByRole('region', { name: 'Meldungen' });
    expect(within(meldungen).getByText('2')).toBeInTheDocument();
    expect(within(meldungen).getByText('nicht freigegeben')).toBeInTheDocument();
    expect(within(meldungen).queryByText('keine')).toBeNull();
    expect(within(meldungen).queryByRole('link')).toBeNull();
    expect(within(meldungen).queryByRole('listitem')).toBeNull();
  });

  it('nennt, dass Kopplungen und Maschinenzugänge beendet werden und beendet bleiben', async () => {
    setup({ pruefung: nichtsOffen });
    const d = await screen.findByRole('dialog');
    expect(
      within(d).getByText(/Gekoppelte Geräte und Maschinenzugänge werden getrennt/),
    ).toBeInTheDocument();
  });

  it('zeigt den Ladezustand, ohne den Knopf an die Prüfung zu binden', async () => {
    setup({ pruefung: 'haengt' });
    const user = userEvent.setup();
    const d = await screen.findByRole('dialog');
    expect(within(d).getByLabelText('Noch offen wird geladen')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await user.type(feld(), 'HW-2026-001');
    expect(knopf()).toBeEnabled();
  });

  it('sagt ohne Netz, dass die Prüfung nicht geladen ist, statt endlos zu laden', async () => {
    setzeOnline(false);
    setup();
    const d = await screen.findByRole('dialog');
    const offen = within(d).getByRole('region', { name: 'Noch offen' });
    expect(await within(offen).findByText('Ohne Netz nicht geladen')).toBeInTheDocument();
    expect(within(offen).getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(within(offen).queryByLabelText('Noch offen wird geladen')).toBeNull();
    // Mit dem Netz kommt die Prüfung von selbst.
    setzeOnline(true);
    expect(await within(d).findByRole('region', { name: 'Aufträge' })).toBeInTheDocument();
  });

  it('sperrt den Abschluss ohne Netz mit Grund, und nichts geht danach hinaus', async () => {
    let aufrufe = 0;
    setup({ pruefung: nichtsOffen });
    server.use(
      http.post('/api/einsaetze/7/abschliessen', () => {
        aufrufe += 1;
        return HttpResponse.json({ id: 7, status: 'abgeschlossen' });
      }),
    );
    const user = userEvent.setup();
    await within(await screen.findByRole('dialog')).findByText('Nichts offen');
    await user.type(feld(), 'HW-2026-001');
    setzeOnline(false);
    await waitFor(() => expect(knopf()).toBeDisabled());
    expect(within(dialog()).getByText('Ohne Verbindung nicht änderbar')).toBeInTheDocument();
    await user.click(knopf());
    setzeOnline(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(aufrufe).toBe(0);
  });

  it('hält den Abschluss nie an: er geht sofort hinaus oder scheitert sofort', async () => {
    let aufrufe = 0;
    setup({ pruefung: nichtsOffen });
    server.use(
      http.post('/api/einsaetze/7/abschliessen', () => {
        aufrufe += 1;
        return HttpResponse.json({ id: 7, status: 'abgeschlossen' });
      }),
    );
    const user = userEvent.setup();
    await within(await screen.findByRole('dialog')).findByText('Nichts offen');
    await user.type(feld(), 'HW-2026-001');
    // Nur TanStack hält sich für offline; die App selbst sieht Netz (`useOhneVerbindung`).
    onlineManager.setOnline(false);
    await user.click(knopf());
    await waitFor(() => expect(aufrufe).toBe(1));
  });

  it('zeigt den Fehlerzustand mit „Erneut abrufen“, ohne „Nichts offen“', async () => {
    setup({ pruefung: 'fehler' });
    const d = await screen.findByRole('dialog');
    expect(await within(d).findByText('Daten nicht abrufbar')).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(within(d).queryByText('Nichts offen')).toBeNull();
  });

  it('schließt trotz offener Punkte ab und schließt den Dialog', async () => {
    let aufrufe = 0;
    const { onSchliessen } = setup();
    server.use(
      http.post('/api/einsaetze/7/abschliessen', () => {
        aufrufe += 1;
        return HttpResponse.json({ id: 7, status: 'abgeschlossen' });
      }),
    );
    const user = userEvent.setup();
    await screen.findByRole('dialog');
    await within(dialog()).findByRole('region', { name: 'Aufträge' });
    await user.type(feld(), 'HW-2026-001');
    await user.click(knopf());
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(aufrufe).toBe(1);
  });

  it('zeigt eine Ablehnung im Dialog, ohne Toast, und lässt ihn offen', async () => {
    const { onSchliessen } = setup({ pruefung: nichtsOffen });
    server.use(
      http.post('/api/einsaetze/7/abschliessen', () =>
        HttpResponse.json({ error: 'Einsatz ist bereits abgeschlossen' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    await screen.findByRole('dialog');
    await user.type(feld(), 'HW-2026-001');
    await user.click(knopf());
    const grund = await within(dialog()).findByRole('alert');
    expect(grund).toHaveTextContent('Nicht abgeschlossen');
    expect(grund).toHaveTextContent('Einsatz ist bereits abgeschlossen');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});
