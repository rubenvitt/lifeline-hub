import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { Button } from 'antd';
import { useState } from 'react';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import SchadenErfassenModal from './SchadenErfassenModal';

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

  it('begrenzt den Ort auf 500 Zeichen', async () => {
    oeffne();
    expect(await screen.findByLabelText('Ort')).toHaveAttribute('maxlength', '500');
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
