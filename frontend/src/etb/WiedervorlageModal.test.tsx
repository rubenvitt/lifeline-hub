import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import dayjs from 'dayjs';
import { Button } from 'antd';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { mitProzessZone } from '../test/prozessZone';
import { mitVorgehenderGeraeteuhr } from '../test/vorgehendeUhr';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { renderMitProviders } from '../test/utils';
import type { EtbEintragAnzeige } from '../api/types';
import WiedervorlageModal from './WiedervorlageModal';

const EINTRAG = {
  id: 4,
  lfd_nr: 12,
  typ: 'meldung',
  inhalt: 'Keller unter Wasser',
  von: null,
  an: null,
  meldeweg: null,
  veranlassung: null,
  erfasser_id: 1,
  erfasser_name: 'Admin',
  ereigniszeit: '2026-08-21 10:00:00',
  received_at: '2026-08-21 10:00:01',
  erfasst_lokal_at: null,
  berichtigt_eintrag_id: null,
  folgeauftraege: [],
  anhaenge: [],
} as unknown as EtbEintragAnzeige;

/** Die Uhr steht, damit „+30 min" eine prüfbare Zahl ist und kein bewegliches Ziel. */
const JETZT = new Date('2026-08-21T10:00:00Z');

function zeige(onClose = vi.fn(), naechsteLagebesprechungAt?: string | null) {
  return renderMitProviders(
    <WiedervorlageModal
      einsatzId={7}
      eintrag={EINTRAG}
      onClose={onClose}
      naechsteLagebesprechungAt={naechsteLagebesprechungAt}
    />,
  );
}

/** Der sichtbare Wert des Fälligkeitsfeldes, unabhängig vom Label-Weg. */
function faelligFeld(): HTMLInputElement {
  const feld = document.querySelector<HTMLInputElement>('.ant-picker input');
  if (!feld) throw new Error('Das Fälligkeitsfeld wurde nicht gefunden');
  return feld;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(JETZT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WiedervorlageModal (LFH-342 · C7, Befund N22)', () => {
  it('LFH-463: entfernt einen während des offenen Dialogs ablaufenden Termin', async () => {
    zeige(vi.fn(), '2026-08-21 10:00:10');
    expect(screen.getByRole('button', { name: 'Nächste Lagebesprechung' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(11_000));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Nächste Lagebesprechung' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('LFH-463: übernimmt nach einem Zeitsprung beim Anklicken keinen abgelaufenen Termin', async () => {
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeige(vi.fn(), '2026-08-21 10:00:10');
    const vorher = faelligFeld().value;
    const chip = screen.getByRole('button', { name: 'Nächste Lagebesprechung' });
    // Ein Systemzeitsprung löst den schon geplanten Timer noch nicht aus.
    vi.setSystemTime(new Date('2026-08-21T10:00:20Z'));
    await nutzer.click(chip);
    expect(faelligFeld()).toHaveValue(vorher);
    expect(
      screen.queryByRole('button', { name: 'Nächste Lagebesprechung' }),
    ).not.toBeInTheDocument();
  });

  it('LFH-463: übernimmt genau den bekannten UTC-Termin einschließlich Sekunden', async () => {
    let gesendet: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 });
      }),
    );
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeige(vi.fn(), '2026-08-21 13:17:43');
    await nutzer.click(screen.getByRole('button', { name: 'Nächste Lagebesprechung' }));
    expect(faelligFeld()).toHaveValue(
      dayjs.utc('2026-08-21 13:17:43').local().format('YYYY-MM-DD HH:mm'),
    );
    await nutzer.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet?.faellig_at).toBe('2026-08-21 13:17:43'));
  });

  it.each([undefined, null, '', 'ungueltig', '2026-08-21 09:59:59', '2026-08-21 10:00:00'])(
    'LFH-463: rendert ohne zukünftigen bekannten Termin keinen Chip (%s)',
    (termin) => {
      zeige(vi.fn(), termin);
      expect(
        screen.queryByRole('button', { name: 'Nächste Lagebesprechung' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '+30 min' })).toBeEnabled();
    },
  );

  it('belegt die Fälligkeit mit +30 min vor, nicht mit „jetzt"', () => {
    zeige();
    // „jetzt" war der einzige nie gemeinte Wert: eine Wiedervorlage auf den aktuellen
    // Zeitpunkt ist im Moment des Anlegens schon fällig.
    expect(faelligFeld().value).toBe(dayjs(JETZT).add(30, 'minute').format('YYYY-MM-DD HH:mm'));
  });

  it('die Schnellwahl setzt die Fälligkeit, ohne das freie Feld zu ersetzen', async () => {
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeige();
    await nutzer.click(screen.getByRole('button', { name: '+2 h' }));
    expect(faelligFeld().value).toBe(dayjs(JETZT).add(2, 'hour').format('YYYY-MM-DD HH:mm'));
    // Der DatePicker bleibt für den freien Fall — die Chips sind eine Vorbelegung
    // desselben Feldes, kein viertes Feld (LFH-19-Budget).
    expect(faelligFeld()).toBeEnabled();
  });

  it('bleibt bei drei Feldern — die Schnellwahl zählt nicht als viertes', () => {
    zeige();
    expect(screen.getByLabelText('Titel')).toBeInTheDocument();
    expect(screen.getByLabelText('Beschreibung (optional)')).toBeInTheDocument();
    expect(
      document.querySelectorAll('.ant-form-item-control-input-content').length,
    ).toBeLessThanOrEqual(4);
  });

  it('sendet mit Enter ab — der Absende-Knopf liegt im Formular', async () => {
    let gesendet: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 });
      }),
    );
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeige();
    await nutzer.type(screen.getByLabelText('Titel'), '{Enter}');
    await waitFor(() => expect(gesendet).not.toBeNull());
    // Die Fälligkeit geht als UTC-Wire-String hinaus, +30 min ab jetzt.
    expect(gesendet!.faellig_at).toBe(
      dayjs(JETZT).add(30, 'minute').utc().format('YYYY-MM-DD HH:mm:ss'),
    );
    expect(gesendet!.bezug_typ).toBe('etb');
    expect(gesendet!.bezug_id).toBe(4);
  });

  it('die Struktur trägt die Enter-Zusicherung: kein antd-Fußzeilenknopf', () => {
    zeige();
    // Prüfbar ist die Struktur, aus der die Zusicherung folgt (Muster
    // `components/Erfassung.test.tsx`): der Knopf liegt IM `<form>`, deshalb sendet die
    // eingebaute Formularübermittlung des Browsers.
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    const knopf = screen.getByRole('button', { name: 'Anlegen' });
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('lässt die Eingaben stehen, wenn der Server ablehnt', async () => {
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', () =>
        HttpResponse.json({ error: 'Titel ist erforderlich' }, { status: 422 }),
      ),
    );
    const onClose = vi.fn();
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeige(onClose);
    const titel = screen.getByLabelText('Titel');
    await nutzer.clear(titel);
    await nutzer.type(titel, 'Kellerpumpe nachfragen');
    await nutzer.click(screen.getByRole('button', { name: 'Anlegen' }));
    // Die Norm aus LFH-332: `onErfassen` muss bei Ablehnung ablehnen. Ein 422 darf den
    // Wortlaut nicht kosten — hier steht er in einer beweissichernden Anwendung.
    await waitFor(() => expect(titel).toHaveValue('Kellerpumpe nachfragen'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Der Grund einer Ablehnung steht im Dialog, kein Toast (LFH-1077, `frontend/AGENTS.md`,
 * „Rückwege und Fehler“). Der Dialog wartet auf die Antwort.
 */
describe('WiedervorlageModal — Ablehnung im Dialog (LFH-1077)', () => {
  const URL = '/api/einsaetze/7/erinnerungen';

  /** Erste Antwort lehnt ab, jede weitere bleibt aus, bis `freigeben` sie beantwortet. */
  function ablehnenDannHalten() {
    let aufrufe = 0;
    const warten: (() => void)[] = [];
    server.use(
      http.post(URL, async () => {
        aufrufe += 1;
        if (aufrufe > 1) await new Promise<void>((r) => warten.push(r));
        return HttpResponse.json({ error: 'Fälligkeit liegt zu weit zurück' }, { status: 422 });
      }),
    );
    return { freigeben: () => warten.splice(0).forEach((r) => r()) };
  }

  function Harness({ einsatzId = 7 }: { einsatzId?: number }) {
    const [offen, setOffen] = useState(true);
    return (
      <>
        <Button onClick={() => setOffen(true)}>Wieder öffnen</Button>
        <WiedervorlageModal
          einsatzId={einsatzId}
          eintrag={offen ? EINTRAG : null}
          onClose={() => setOffen(false)}
        />
      </>
    );
  }

  it('nennt den Grund im Dialog, bleibt offen und zeigt keinen Toast', async () => {
    ablehnenDannHalten();
    const onClose = vi.fn();
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeige(onClose);
    const dialog = await screen.findByRole('dialog');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Fälligkeit liegt zu weit zurück',
    );
    expect(within(dialog).getByText('Wiedervorlage nicht angelegt')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('das nächste Absenden räumt den Grund, Abbrechen ist solange gesperrt', async () => {
    const { freigeben } = ablehnenDannHalten();
    const onClose = vi.fn();
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeige(onClose);
    const dialog = await screen.findByRole('dialog');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await within(dialog).findByRole('alert');

    await nutzer.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
    await act(async () => freigeben());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Fälligkeit liegt zu weit zurück',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
    ablehnenDannHalten();
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await within(dialog).findByRole('alert');

    // rc-dialog friert den schließenden Dialog in jsdom ein: am neuen Dialog prüfen.
    await nutzer.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    const wieder = (await screen.findAllByRole('dialog')).slice(-1)[0];
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });

  it('eine nach dem Einsatzwechsel scheiternde Anfrage meldet nicht im neuen Einsatz', async () => {
    const { freigeben } = ablehnenDannHalten();
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = renderMitProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await within(dialog).findByRole('alert');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());

    rerender(<Harness einsatzId={8} />);
    // Der laufende Versand gehört zu Einsatz 7: er sperrt hier kein Abbrechen.
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeEnabled();
    await act(async () => freigeben());
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});

/**
 * LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. Feld und
 * Vorbelegung stehen in der Anzeigezone, gesendet wird derselbe absolute Zeitpunkt.
 */
describe('WiedervorlageModal — Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  function zeigeBerlin(termin?: string) {
    return renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <WiedervorlageModal
          einsatzId={7}
          eintrag={EINTRAG}
          onClose={vi.fn()}
          naechsteLagebesprechungAt={termin}
        />
      </AnzeigeKonventionenProvider>,
    );
  }

  it('die Vorbelegung (+30 min) steht mit der Berliner Uhrzeit im Feld', () => {
    zeigeBerlin();
    // 10:00 UTC + 30 min = 12:30 in Berlin (Sommerzeit).
    expect(faelligFeld().value).toBe('2026-08-21 12:30');
  });

  it('der Lagebesprechungstermin erscheint in Berlin und geht exakt als UTC hinaus', async () => {
    let gesendet: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 });
      }),
    );
    const nutzer = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    zeigeBerlin('2026-08-21 13:17:43');
    await nutzer.click(screen.getByRole('button', { name: 'Nächste Lagebesprechung' }));
    expect(faelligFeld()).toHaveValue('2026-08-21 15:17');
    await nutzer.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(gesendet?.faellig_at).toBe('2026-08-21 13:17:43'));
  });
});

/** LFH-1031: Vorgabe und Schnellwahl rechnen ab „jetzt“ nach der Serveruhr. */
describe('WiedervorlageModal — Gerät mit 5 min Vorlauf (LFH-1031)', () => {
  mitVorgehenderGeraeteuhr(JETZT.getTime());

  function sendetNach(): () => Record<string, unknown> | undefined {
    let gesendet: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/einsaetze/7/erinnerungen', async ({ request }) => {
        gesendet = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1 });
      }),
    );
    return () => gesendet;
  }

  it('die Vorgabe +30 min gilt ab der Serverzeit', async () => {
    const gesendet = sendetNach();
    zeige();
    await userEvent.type(screen.getByLabelText('Titel'), '{Enter}');
    await waitFor(() =>
      expect(gesendet()?.faellig_at).toBe(
        dayjs(JETZT).add(30, 'minute').utc().format('YYYY-MM-DD HH:mm:ss'),
      ),
    );
  });

  it('die Schnellwahl „+2 h“ gilt ab der Serverzeit', async () => {
    const gesendet = sendetNach();
    zeige();
    await userEvent.click(screen.getByRole('button', { name: '+2 h' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(gesendet()?.faellig_at).toBe(
        dayjs(JETZT).add(2, 'hour').utc().format('YYYY-MM-DD HH:mm:ss'),
      ),
    );
  });
});
