import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { EtbEintragAnzeige } from '../api/types';
import WiedervorlageModal from './WiedervorlageModal';

const EINTRAG = {
  id: 4, lfd_nr: 12, typ: 'meldung', inhalt: 'Keller unter Wasser', von: null, an: null,
  meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Admin',
  ereigniszeit: '2026-08-21 10:00:00', received_at: '2026-08-21 10:00:01',
  erfasst_lokal_at: null, berichtigt_eintrag_id: null,
} as unknown as EtbEintragAnzeige;

/** Die Uhr steht, damit „+30 min" eine prüfbare Zahl ist und kein bewegliches Ziel. */
const JETZT = new Date('2026-08-21T10:00:00Z');

function zeige(onClose = vi.fn()) {
  return renderMitProviders(
    <WiedervorlageModal einsatzId={7} eintrag={EINTRAG} onClose={onClose} />,
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
    expect(document.querySelectorAll('.ant-form-item-control-input-content').length)
      .toBeLessThanOrEqual(4);
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
    // `components/Erfassung.test.tsx`): der Knopf liegt IM `<form>`, deshalb sendet
    // die eingebaute Formularübermittlung des Browsers. Ein `onOk` am Modal legte ihn
    // daneben, und Enter wäre tot.
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
