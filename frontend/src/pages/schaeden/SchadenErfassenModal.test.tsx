import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { Button } from 'antd';
import { useState } from 'react';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import SchadenErfassenModal from './SchadenErfassenModal';

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
  }: {
    punkt: { lat: number; lon: number } | null;
    etikett: string;
  }) => (
    <div role="group" aria-label={`Karte: ${etikett}`}>
      {punkt && `${punkt.lat},${punkt.lon}`}
    </div>
  ),
}));

/** Einsatzkopf (Umgebung „Auf Karte wählen“) und Ort-Zeile des Schadensorts. */
beforeEach(() => {
  server.use(
    http.get('/api/einsaetze/:eid', ({ params }) =>
      HttpResponse.json({ id: Number(params.eid), einsatzort_lat: 52.1, einsatzort_lon: 8.6 }),
    ),
    http.get('/api/einsaetze/:eid/ort-vorschau', () =>
      HttpResponse.json({ ortsname: null, peilung: null }),
    ),
  );
  sessionStorage.clear();
});

function oeffne() {
  server.use(
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  renderMitProviders(
    <SchadenErfassenModal
      open
      onClose={vi.fn()}
      einsatzId={1}
      orgId={1}
      orgName="Eigene Organisation"
    />,
  );
}

describe('SchadenErfassenModal — Eingabegrenzen (LFH-937)', () => {
  it('zeigt „6.400 / 8.000“ an der Beschreibung; eine längere bleibt ganz stehen und sperrt', async () => {
    oeffne();
    // Die Beschreibung liegt unter „Weitere Angaben“ (LLH-1115, Feldbudget).
    await userEvent.click(await screen.findByText('Weitere Angaben'));
    const beschreibung = await screen.findByLabelText('Beschreibung');
    fireEvent.change(beschreibung, { target: { value: 'b'.repeat(6_399) } });
    expect(screen.queryByText(/\/ 8\.000/)).toBeNull();
    fireEvent.change(beschreibung, { target: { value: 'b'.repeat(6_400) } });
    expect(screen.getByText('6.400 / 8.000')).toBeInTheDocument();
    fireEvent.change(beschreibung, { target: { value: 'b'.repeat(8_001) } });
    expect(beschreibung).toHaveValue('b'.repeat(8_001));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(
      await screen.findByText('Beschreibung darf höchstens 8.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    // Eine zu lange Beschreibung lässt den Klappteil nicht zuklappen: die Ablehnung bleibt sichtbar.
    const kopf = screen.getByText('Weitere Angaben').closest('[aria-expanded]')!;
    expect(kopf).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByText('Weitere Angaben'));
    expect(kopf).toHaveAttribute('aria-expanded', 'true');
  });

  it('sperrt einen Ort über 500 Zeichen, ohne ihn zu kürzen', async () => {
    const gesendet = vi.fn();
    server.use(
      http.post('/api/einsaetze/1/schaeden', () => {
        gesendet();
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );
    oeffne();
    const ort = await screen.findByLabelText('Ort');
    fireEvent.change(ort, { target: { value: 'o'.repeat(501) } });
    expect(ort).toHaveValue('o'.repeat(501));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Ort darf höchstens 500 Zeichen lang sein')).toBeInTheDocument();
    expect(gesendet).not.toHaveBeenCalled();
  });
});

/**
 * Der Grund einer Ablehnung steht im Dialog, kein Toast (LFH-1077, `frontend/AGENTS.md`,
 * „Rückwege und Fehler“).
 */
describe('SchadenErfassenModal — Ablehnung im Dialog (LFH-1077)', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [offen, setOffen] = useState(true);
    return (
      <>
        <Button onClick={() => setOffen(true)}>Wieder öffnen</Button>
        <SchadenErfassenModal
          open={offen}
          onClose={() => {
            onClose();
            setOffen(false);
          }}
          einsatzId={1}
          orgId={1}
          orgName="Eigene Organisation"
        />
      </>
    );
  }

  function rendere(antwort: Parameters<typeof http.post>[1]) {
    server.use(
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/schaeden', antwort),
    );
    const onClose = vi.fn();
    renderMitProviders(<Harness onClose={onClose} />);
    return onClose;
  }

  async function waehle(dialog: HTMLElement, feld: string, eintrag: string) {
    await userEvent.click(within(dialog).getByLabelText(feld));
    const option = (await screen.findAllByText(eintrag)).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await userEvent.click(option!);
  }

  async function fuelleUndLegeAn(dialog: HTMLElement) {
    await waehle(dialog, 'Typ', 'Sachschaden');
    await waehle(dialog, 'Ausmaß', 'gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
  }

  const ablehnen = () => HttpResponse.json({ error: 'Einsatz ist abgeschlossen' }, { status: 409 });

  it('nennt den Grund im Dialog, behält den Ort und zeigt keinen Toast', async () => {
    const onClose = rendere(ablehnen);
    const dialog = await screen.findByRole('dialog');
    await fuelleUndLegeAn(dialog);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Einsatz ist abgeschlossen');
    expect(within(dialog).getByLabelText('Ort')).toHaveValue('Hauptstr. 17');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('das nächste Absenden räumt den Grund; solange es läuft, ist Abbrechen gesperrt', async () => {
    let erster = true;
    rendere(async () => {
      if (erster) {
        erster = false;
        return ablehnen();
      }
      await delay('infinite');
      return HttpResponse.json({});
    });
    const dialog = await screen.findByRole('dialog');
    await fuelleUndLegeAn(dialog);
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  });

  /**
   * Der Dialog hat keinen `key`: nach einem Einsatzwechsel bleibt er derselbe. Das Anlegen in A
   * sperrt dort weder das Abbrechen, noch steht seine späte Ablehnung darin.
   */
  it('ein laufendes Anlegen aus Einsatz A sperrt in B nichts und meldet dort nichts', async () => {
    let antwortFreigeben!: () => void;
    const antwortGate = new Promise<void>((r) => (antwortFreigeben = r));
    server.use(
      http.get('/api/einsaetze/:eid/personen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/:eid/personal', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/schaeden', async () => {
        await antwortGate;
        return ablehnen();
      }),
    );
    function Wechsel() {
      const [einsatzId, setEinsatzId] = useState(1);
      return (
        <>
          <Button onClick={() => setEinsatzId(2)}>Zu Einsatz B</Button>
          <SchadenErfassenModal
            open
            onClose={() => {}}
            einsatzId={einsatzId}
            orgId={1}
            orgName="Eigene Organisation"
          />
        </>
      );
    }
    const { client } = renderMitProviders(<Wechsel />);
    const dialog = await screen.findByRole('dialog');
    await fuelleUndLegeAn(dialog);
    await waitFor(() => expect(client.isMutating()).toBe(1));

    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeEnabled(),
    );

    await act(async () => antwortFreigeben());
    // Die Ablehnung aus A ist durch: erst jetzt ist „kein Grund in B“ eine Aussage.
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
    rendere(ablehnen);
    const dialog = await screen.findByRole('dialog');
    await fuelleUndLegeAn(dialog);
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert einen schließenden Dialog ein.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = await screen.findByRole('dialog');
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });
});

/** Gefahr und Schadensgrad (LLH-1115, design.md D4). */
describe('SchadenErfassenModal — Gefahr und Schadensgrad (LLH-1115)', () => {
  async function waehle(dialog: HTMLElement, feld: string, eintrag: string) {
    await userEvent.click(within(dialog).getByLabelText(feld));
    const option = (await screen.findAllByText(eintrag)).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await userEvent.click(option!);
  }

  it('zeigt Typ, Ausmaß, Ort und Gefahr; Beschreibung und Schadensgrad liegen eingeklappt', async () => {
    oeffne();
    const dialog = await screen.findByRole('dialog');
    for (const feld of ['Typ', 'Ausmaß', 'Ort', 'Gefahr']) {
      expect(within(dialog).getByLabelText(feld)).toBeInTheDocument();
    }
    expect(within(dialog).queryByLabelText('Beschreibung')).toBeNull();
    expect(within(dialog).queryByLabelText('Schadensgrad')).toBeNull();
    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    expect(within(dialog).getByLabelText('Beschreibung')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Schadensgrad')).toBeInTheDocument();
  });

  it('zeigt neben jeder Gefahr das Kartenzeichen', async () => {
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Gefahr'));
    const option = (await screen.findAllByText('Elektrizität')).find((el) =>
      el.closest('.ant-select-item-option'),
    )!;
    const zeile = option.closest('.ant-select-item-option')!;
    expect(zeile.querySelector('svg')).not.toBeNull();
    expect(zeile.querySelector('svg desc')?.textContent).toMatch(/elektrische Energie/);
  });

  it('sendet Gefahr und Schadensgrad mit', async () => {
    let gesendet: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await waehle(dialog, 'Typ', 'Infrastruktur');
    await waehle(dialog, 'Ausmaß', 'groß');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Trafostation');
    await waehle(dialog, 'Gefahr', 'Elektrizität');
    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    await waehle(dialog, 'Schadensgrad', 'total zerstört');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet).toBeDefined());
    expect(gesendet).toMatchObject({
      typ: 'infrastruktur',
      ausmass: 'gross',
      gefahrenart: 'elektrizitaet',
      schadensgrad: 'zerstoert',
    });
  });

  it('ohne Gefahr sendet es keine Angabe', async () => {
    let gesendet: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await waehle(dialog, 'Typ', 'Sachschaden');
    await waehle(dialog, 'Ausmaß', 'gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'A');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet).toBeDefined());
    expect(gesendet!.gefahrenart).toBeNull();
    expect(gesendet!.schadensgrad).toBeNull();
  });
});

/**
 * Schadensort über das Ortsfeld (LLH-1121, Spec `ortsfeld`): ein gewählter Treffer verortet den
 * Schaden, ohne Auswahl bleibt er nicht verortet. Die Koordinate kommt nur noch über das Ortsfeld.
 */
describe('SchadenErfassenModal — Schadensort über die Ortssuche (LLH-1121)', () => {
  async function waehle(dialog: HTMLElement, feld: string, eintrag: string) {
    await userEvent.click(within(dialog).getByLabelText(feld));
    const option = (await screen.findAllByText(eintrag)).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await userEvent.click(option!);
  }

  function mitschnitt() {
    const gesendet: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/einsaetze/1/ort-suche', () =>
        HttpResponse.json({
          zustand: 'ok',
          treffer: [
            {
              name: 'Hauptstraße 17, 12345 Musterstadt, Niedersachsen, Deutschland',
              kurz: 'Hauptstraße 17, 12345 Musterstadt',
              lat: 52.3,
              lon: 9.7,
            },
          ],
        }),
      ),
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        gesendet.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 1 }, { status: 201 });
      }),
    );
    return gesendet;
  }

  async function pflichtfelder(dialog: HTMLElement) {
    await waehle(dialog, 'Typ', 'Sachschaden');
    await waehle(dialog, 'Ausmaß', 'gering');
  }

  it('ein gewählter Treffer verortet den Schaden, der Text ist die gewählte Adresse', async () => {
    const gesendet = mitschnitt();
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await pflichtfelder(dialog);
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17{Enter}');
    await userEvent.click(
      await within(dialog).findByRole('button', { name: /Hauptstraße 17, 12345 Musterstadt/ }),
    );
    expect(within(dialog).getByLabelText('Ort')).toHaveValue('Hauptstraße 17, 12345 Musterstadt');
    expect(within(dialog).getByRole('group', { name: 'Karte: Schadensort' })).toHaveTextContent(
      '52.3,9.7',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      ort: 'Hauptstraße 17, 12345 Musterstadt',
      lat: 52.3,
      lon: 9.7,
    });
  });

  it('ohne Auswahl bleibt der Schaden nicht verortet', async () => {
    const gesendet = mitschnitt();
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await pflichtfelder(dialog);
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    expect(within(dialog).getByText('Nicht verortet')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ ort: 'Hauptstr. 17', lat: null, lon: null });
  });

  it('übernimmt eine getippte Koordinate', async () => {
    const gesendet = mitschnitt();
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await pflichtfelder(dialog);
    await userEvent.type(within(dialog).getByLabelText('Ort'), '52.512, 13.401');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ ort: '52.512, 13.401', lat: 52.512, lon: 13.401 });
  });

  it('der Ort ist Pflicht', async () => {
    const gesendet = mitschnitt();
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await pflichtfelder(dialog);
    await userEvent.type(within(dialog).getByLabelText('Ort'), '   ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Ort ist Pflicht')).toBeInTheDocument();
    expect(gesendet).toHaveLength(0);
  });

  it('hat unter „Weitere Angaben“ kein eigenes Koordinatenfeld mehr', async () => {
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByText('Weitere Angaben'));
    expect(within(dialog).queryByLabelText('Koordinate')).toBeNull();
  });

  it('„Werte behalten“ übernimmt Ort und Koordinate in den nächsten Schaden', async () => {
    const gesendet = mitschnitt();
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await pflichtfelder(dialog);
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17{Enter}');
    await userEvent.click(
      await within(dialog).findByRole('button', { name: /Hauptstraße 17, 12345 Musterstadt/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    await pflichtfelder(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(gesendet).toHaveLength(2));
    expect(gesendet[1]).toMatchObject({
      ort: 'Hauptstraße 17, 12345 Musterstadt',
      lat: 52.3,
      lon: 9.7,
    });
  });

  it('merkt Ort und Koordinate für das nächste Öffnen in der Sitzung', async () => {
    const gesendet = mitschnitt();
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await pflichtfelder(dialog);
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17{Enter}');
    await userEvent.click(
      await within(dialog).findByRole('button', { name: /Hauptstraße 17, 12345 Musterstadt/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(sessionStorage.getItem('lfh:erfassung:1:schaden:ort')).toBe(
      'Hauptstraße 17, 12345 Musterstadt',
    );
    expect(sessionStorage.getItem('lfh:erfassung:1:schaden:ort_koordinate')).toBe('52.3,9.7');
  });

  it('setzt einen gemerkten Ort mit Koordinate beim Öffnen ein', async () => {
    sessionStorage.setItem('lfh:erfassung:1:schaden:ort', 'Marktplatz');
    sessionStorage.setItem('lfh:erfassung:1:schaden:ort_koordinate', '52.3,9.7');
    const gesendet = mitschnitt();
    oeffne();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Ort')).toHaveValue('Marktplatz'));
    expect(within(dialog).getByRole('group', { name: 'Karte: Schadensort' })).toHaveTextContent(
      '52.3,9.7',
    );
    await pflichtfelder(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ ort: 'Marktplatz', lat: 52.3, lon: 9.7 });
  });
});
