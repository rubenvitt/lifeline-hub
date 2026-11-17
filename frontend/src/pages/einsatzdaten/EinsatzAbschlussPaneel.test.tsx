import { http, HttpResponse } from 'msw';
import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { server } from '../../test/server';
import { renderMitProviders, setzeOnline } from '../../test/utils';
import { einsatzFixture, freigabenFixture } from '../../test/fixtures';
import type { AbschlussPruefung, EinsatzAnzeige } from '../../api/types';
import EinsatzAbschlussPaneel from './EinsatzAbschlussPaneel';

dayjs.extend(utc);

/**
 * Paneel „Einsatzabschluss“ (LLH-1814, Spec `einsatz-abschluss`, design.md D6): ein offener Dialog
 * folgt dem Zustand des Einsatzes, den der Live-Kanal nachzieht; das Wiederöffnen ist ohne Netz
 * gesperrt und wird nie angehalten.
 */

const leer = { anzahl: 0, eintraege: [] };
const nichtsOffen: AbschlussPruefung = {
  kraefte: { anzahl: 0, eintraege: [], personal: 0 },
  auftraege: leer,
  meldungen: leer,
  nachforderungen: leer,
  betroffene: leer,
};

/** Vor einer Stunde abgeschlossen, im Format des Wire (UTC). */
const vorEinerStunde = () => dayjs.utc().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss');

const aktiv = (): EinsatzAnzeige =>
  einsatzFixture({ id: 7, bezeichnung: 'Hochwasser Nord', einsatznummer_intern: 'HW-1' });
const abgeschlossen = (): EinsatzAnzeige =>
  einsatzFixture({
    id: 7,
    bezeichnung: 'Hochwasser Nord',
    einsatznummer_intern: 'HW-1',
    status: 'abgeschlossen',
    abgeschlossen_at: vorEinerStunde(),
    abgeschlossen_von_name: 'Erika Muster',
  });

const benutzer = { system_rolle: 'keiner', org_id: 1 } as const;

function setup(einsatz: EinsatzAnzeige) {
  server.use(
    http.get('/api/einsaetze/7/abschluss/pruefung', () => HttpResponse.json(nichtsOffen)),
    http.get('/api/einsaetze/7/modul-freigaben', () => HttpResponse.json(freigabenFixture())),
  );
  const r = renderMitProviders(<EinsatzAbschlussPaneel einsatz={einsatz} benutzer={benutzer} />, {
    route: '/einsaetze/7/einsatzdaten',
  });
  const neu = (e: EinsatzAnzeige) =>
    r.rerender(<EinsatzAbschlussPaneel einsatz={e} benutzer={benutzer} />);
  return { ...r, neu };
}

async function oeffneWiedereroeffnen() {
  await userEvent.click(screen.getByRole('button', { name: 'Einsatz wieder öffnen…' }));
  return screen.findByRole('dialog', { name: 'Einsatz wieder öffnen' });
}

describe('EinsatzAbschlussPaneel (LLH-1814)', () => {
  it('schließt den Abschlussdialog, sobald der Einsatz live abgeschlossen ist, und öffnet ihn nicht wieder', async () => {
    const { neu } = setup(aktiv());
    await userEvent.click(screen.getByRole('button', { name: 'Einsatz abschließen…' }));
    expect(await screen.findByRole('dialog', { name: 'Einsatz abschließen' })).toBeInTheDocument();

    // Ein anderes Mitglied der Einsatzleitung schließt ab; der Live-Kanal zieht den Kopf nach.
    neu(abgeschlossen());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/Abgeschlossen am/)).toBeInTheDocument();

    // Wird der Einsatz danach wieder geöffnet, kommt der alte Dialog nicht zurück.
    neu(aktiv());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('schließt den Dialog zum Wiederöffnen, sobald der Einsatz live wieder aktiv ist', async () => {
    const { neu } = setup(abgeschlossen());
    await oeffneWiedereroeffnen();
    neu(aktiv());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    neu(abgeschlossen());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('schließt den Dialog zum Wiederöffnen, wenn die Frist abläuft', async () => {
    const { neu } = setup(abgeschlossen());
    await oeffneWiedereroeffnen();
    // Die Frist ist vorbei: derselbe Einsatz, vor 25 Stunden abgeschlossen.
    neu({
      ...abgeschlossen(),
      abgeschlossen_at: dayjs.utc().subtract(25, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Einsatz wieder öffnen…' })).toBeNull();
  });

  it('sperrt das Wiederöffnen ohne Netz mit Grund, und nichts geht danach hinaus', async () => {
    let aufrufe = 0;
    setup(abgeschlossen());
    server.use(
      http.post('/api/einsaetze/7/wiedereroeffnen', () => {
        aufrufe += 1;
        return HttpResponse.json(aktiv());
      }),
    );
    const d = await oeffneWiedereroeffnen();
    await userEvent.type(within(d).getByLabelText('Grund'), 'Versehen');
    setzeOnline(false);
    const knopf = within(d).getByRole('button', { name: 'Einsatz wieder öffnen' });
    await waitFor(() => expect(knopf).toBeDisabled());
    expect(within(d).getByText('Ohne Verbindung nicht änderbar')).toBeInTheDocument();
    await userEvent.click(knopf);
    setzeOnline(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(aufrufe).toBe(0);
  });

  it('hält das Wiederöffnen nie an: es geht sofort hinaus oder scheitert sofort', async () => {
    let aufrufe = 0;
    setup(abgeschlossen());
    server.use(
      http.post('/api/einsaetze/7/wiedereroeffnen', () => {
        aufrufe += 1;
        return HttpResponse.json(aktiv());
      }),
    );
    const d = await oeffneWiedereroeffnen();
    await userEvent.type(within(d).getByLabelText('Grund'), 'Versehen');
    // Nur TanStack hält sich für offline; die App selbst sieht Netz (`useOhneVerbindung`).
    onlineManager.setOnline(false);
    await userEvent.click(within(d).getByRole('button', { name: 'Einsatz wieder öffnen' }));
    await waitFor(() => expect(aufrufe).toBe(1));
  });
});
