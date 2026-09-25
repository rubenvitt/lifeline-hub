import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { alsBackendZeit, alsOrtszeit } from '../etb/filterZeit';
import FristPaneel from './FristPaneel';

dayjs.extend(customParseFormat);

/**
 * Frist-Paneel (LFH-23, tasks.md 6.5): Verlängern ohne Rückfrage, Verkürzen erst nach
 * Rückfrage mit `bestaetigt: true`, Abbrechen sendet nichts, ohne Recht gesperrt mit Grund,
 * Invalidierungen nach design.md D8.
 */

const ME_ADMIN = { id: 1, anzeigename: 'Admin', system_rolle: 'admin', org_rolle: 'keine' };
const ME_HELFER = { id: 2, anzeigename: 'Helfer', system_rolle: 'keiner', org_rolle: 'keine' };

let gesendet: Record<string, unknown>[];
let antwort: () => Response;

beforeEach(() => {
  gesendet = [];
  antwort = () => HttpResponse.json({ id: 1 });
  server.use(
    http.put('/api/einsaetze/1/aufbewahrungsfrist', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return antwort();
    }),
  );
});

function zeige(
  me: Record<string, unknown>,
  einsatz: {
    status: 'aktiv' | 'abgeschlossen';
    meine_rolle?: string | null;
    retention_bis?: string | null;
  },
) {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(me)));
  return renderMitProviders(
    <FristPaneel
      einsatzId={1}
      einsatz={{ meine_rolle: null, retention_bis: null, ...einsatz } as never}
    />,
  );
}

/**
 * Setzt den DatePicker des Dialogs auf einen Ortszeit-Wert und sendet mit Enter ab — Enter im
 * Feld übernimmt den Wert UND übermittelt das Formular (Erfassungs-Norm: der Knopf liegt im
 * `<form>`). Ein zusätzlicher Klick auf „Frist setzen" träfe den schon schließenden Dialog.
 */
async function fristSetzen(dialog: HTMLElement, ortszeit: string) {
  const u = userEvent.setup();
  const eingabe = within(dialog).getByRole('textbox');
  await u.click(eingabe);
  await u.clear(eingabe);
  await u.type(eingabe, `${ortszeit}{Enter}`);
}

/** Wire-Wert (UTC) einer Ortszeit — derselbe Weg wie das Paneel. */
const wire = (ortszeit: string) => alsBackendZeit(dayjs(ortszeit, 'YYYY-MM-DD HH:mm'));

/**
 * Die Rückfrage über ihren Titeltext statt über den Rollennamen: in jsdom tragen beide offenen
 * antd-Dialoge dieselbe `aria-labelledby`-Kennung (`test-id`), der Name des zweiten löst also
 * auf den Titel des ERSTEN auf.
 */
async function rueckfrageFinden(): Promise<HTMLElement> {
  const titel = await screen.findByText('Aufbewahrungsfrist verkürzen?');
  return titel.closest<HTMLElement>('.ant-modal')!;
}
const rueckfrageOffen = () => screen.queryByText('Aufbewahrungsfrist verkürzen?') != null;

async function dialogOeffnen() {
  await userEvent.click(await screen.findByRole('button', { name: 'Frist ändern' }));
  return screen.findByRole('dialog', { name: 'Aufbewahrungsfrist ändern' });
}

describe('FristPaneel', () => {
  it('zeigt „keine Frist" mit Hinweis am laufenden Einsatz', async () => {
    zeige(ME_ADMIN, { status: 'aktiv' });
    expect(
      await screen.findByText(/keine Frist — sie entsteht beim Abschluss/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Frist aufheben' })).toBeNull();
  });

  it('Verlängern sendet ohne Rückfrage', async () => {
    const { client } = zeige(ME_ADMIN, {
      status: 'abgeschlossen',
      retention_bis: '2026-10-01 10:00:00',
    });
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    const dialog = await dialogOeffnen();
    await fristSetzen(dialog, '2030-01-01 12:00');
    await waitFor(() => expect(gesendet).toHaveLength(1));
    // Der Wert selbst, nicht nur „irgendein String": sonst bliebe der Test grün, wenn der
    // Picker den Wert nie annähme und die alte Frist unverändert hinausginge.
    expect(gesendet[0]).toEqual({ retention_bis: wire('2030-01-01 12:00') });
    expect(rueckfrageOffen()).toBe(false);
    const keys = invalidiert.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const k of [['aufbewahrung'], ['einsaetze'], ['einsatz', 1], ['etb', 1]]) {
      expect(keys).toContain(JSON.stringify(k));
    }
  });

  it('Verkürzen fragt zuerst (danger, nennt alt und neu) und sendet dann bestaetigt: true', async () => {
    zeige(ME_ADMIN, { status: 'abgeschlossen', retention_bis: '2030-10-01 10:00:00' });
    const dialog = await dialogOeffnen();
    await fristSetzen(dialog, '2029-01-01 12:00');
    const rueckfrage = await rueckfrageFinden();
    expect(gesendet).toHaveLength(0);
    expect(rueckfrage).toHaveTextContent('2030');
    expect(rueckfrage).toHaveTextContent('2029');
    const ok = within(rueckfrage).getByRole('button', { name: 'Verkürzen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    await userEvent.click(ok);
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toEqual({ retention_bis: wire('2029-01-01 12:00'), bestaetigt: true });
  });

  it('erstmaliges Setzen ohne Frist ist eine Verkürzung — Abbrechen sendet nichts', async () => {
    zeige(ME_ADMIN, { status: 'abgeschlossen', retention_bis: null });
    const dialog = await dialogOeffnen();
    await fristSetzen(dialog, '2030-01-01 12:00');
    const rueckfrage = await rueckfrageFinden();
    expect(rueckfrage).toHaveTextContent('unbegrenzt');
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Abbrechen' }));
    // Die Erfassungshülle lässt den Dialog mit Wert stehen, nichts ging hinaus.
    // antd räumt den Knoten erst am Ende der Zoom-Animation ab, jsdom feuert kein
    // `transitionend` — geprüft wird deshalb `ant-zoom-leave` (Konvention MaterialPage.test).
    await waitFor(() => expect(rueckfrage).toHaveClass('ant-zoom-leave'));
    expect(gesendet).toHaveLength(0);
    expect(within(dialog).getByRole('textbox')).toHaveValue('2030-01-01 12:00');
  });

  it('Aufheben geht ohne Rückfrage mit null hinaus', async () => {
    zeige(ME_ADMIN, { status: 'abgeschlossen', retention_bis: '2030-10-01 10:00:00' });
    await userEvent.click(await screen.findByRole('button', { name: 'Frist aufheben' }));
    await waitFor(() => expect(gesendet).toEqual([{ retention_bis: null }]));
  });

  it('ein Fehler steht am Paneel, nicht im Toast', async () => {
    antwort = () => HttpResponse.json({ error: 'Einsatz ist geschwärzt' }, { status: 409 });
    zeige(ME_ADMIN, { status: 'abgeschlossen', retention_bis: '2030-10-01 10:00:00' });
    await userEvent.click(await screen.findByRole('button', { name: 'Frist aufheben' }));
    const text = await screen.findByText('Einsatz ist geschwärzt');
    expect(text.closest('.ant-message')).toBeNull();
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument();
  });

  it('Einsatzleitung darf, auch am abgeschlossenen Einsatz', async () => {
    zeige(ME_HELFER, {
      status: 'abgeschlossen',
      meine_rolle: 'einsatzleitung',
      retention_bis: '2030-10-01 10:00:00',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Frist ändern' })).toBeEnabled());
  });

  it('ohne Recht: Knöpfe gesperrt sichtbar, Hinweis nennt den Grund', async () => {
    zeige(ME_HELFER, {
      status: 'abgeschlossen',
      meine_rolle: 'beobachter',
      retention_bis: '2030-10-01 10:00:00',
    });
    expect(
      await screen.findByText(/Nur die Einsatzleitung oder ein System-Admin/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Frist ändern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Frist aufheben' })).toBeDisabled();
  });

  it('befüllt den Dialog bei jedem Öffnen mit der AKTUELLEN Frist', async () => {
    // Review-Befund: die Formularinstanz lebt im Hook, `initialValues` einer früheren Öffnung
    // überlebte im Speicher von rc-field-form. Nach einer bestätigten Verkürzung stand beim
    // nächsten Öffnen der alte Wert da — ein Absenden hätte die Verkürzung still zurückgenommen.
    server.use(http.get('/api/auth/me', () => HttpResponse.json(ME_ADMIN)));
    const einsatz = (retention_bis: string) =>
      ({ status: 'abgeschlossen', meine_rolle: null, retention_bis }) as never;
    const { rerender } = renderMitProviders(
      <FristPaneel einsatzId={1} einsatz={einsatz('2030-10-01 10:00:00')} />,
    );
    let dialog = await dialogOeffnen();
    const erster = (within(dialog).getByRole('textbox') as HTMLInputElement).value;
    expect(erster).not.toBe('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    rerender(<FristPaneel einsatzId={1} einsatz={einsatz('2029-01-01 10:00:00')} />);
    dialog = await dialogOeffnen();
    await waitFor(() =>
      expect(within(dialog).getByRole('textbox')).toHaveValue(
        alsOrtszeit('2029-01-01 10:00:00')!.format('YYYY-MM-DD HH:mm'),
      ),
    );
  });

  it('dieselbe Minute wie die bestehende Frist ist keine Verkürzung (Sekundenrest)', async () => {
    // Beim Abschluss entsteht die Frist aus abgeschlossen_at + Dauer und trägt Sekunden; der
    // Picker zeigt nur Minuten. Die angezeigte Minute erneut einzugeben ist KEINE Verkürzung.
    const basis = '2030-10-01 10:00:17';
    zeige(ME_ADMIN, { status: 'abgeschlossen', retention_bis: basis });
    const dialog = await dialogOeffnen();
    await fristSetzen(dialog, alsOrtszeit(basis)!.format('YYYY-MM-DD HH:mm'));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(rueckfrageOffen()).toBe(false);
    // Unverändert heißt: der gespeicherte Wert geht sekundengenau zurück, ohne Bestätigung —
    // der Server antwortet dann ohne Schreibvorgang und ohne ETB-Eintrag.
    expect(gesendet[0]).toEqual({ retention_bis: basis });
  });

  it('ein Zeitpunkt in der Vergangenheit nennt in der Rückfrage die sofortige Sperre', async () => {
    zeige(ME_ADMIN, { status: 'abgeschlossen', retention_bis: '2030-10-01 10:00:00' });
    const dialog = await dialogOeffnen();
    await fristSetzen(dialog, '2020-01-01 12:00');
    const rueckfrage = await rueckfrageFinden();
    expect(rueckfrage).toHaveTextContent(/sofort/);
    expect(rueckfrage).toHaveTextContent(/auch für Sie/);
    expect(gesendet).toHaveLength(0);
  });

  it('ein Zeitpunkt in der Zukunft nennt keine sofortige Sperre', async () => {
    zeige(ME_ADMIN, { status: 'abgeschlossen', retention_bis: '2030-10-01 10:00:00' });
    const dialog = await dialogOeffnen();
    await fristSetzen(dialog, '2029-01-01 12:00');
    const rueckfrage = await rueckfrageFinden();
    expect(rueckfrage).not.toHaveTextContent(/sofort/);
  });
});
