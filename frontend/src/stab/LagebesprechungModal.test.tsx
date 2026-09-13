import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lagebesprechung, Stab } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LagebesprechungModal from './LagebesprechungModal';
import { zeigeAbschlussToast } from './abschlussToast';

/**
 * Nur `Date` steht still (`toFake`): `userEvent`, MSW und antds Animationen laufen auf echten
 * Timern weiter. Mit voll gefälschten Timern hinge `findBy*` (CLAUDE.md, Deeplink-Abschnitt).
 * Rückfallweg, falls `toFake` in dieser Vitest-Version nicht greift: das Muster aus
 * `etb/WiedervorlageModal.test.tsx` (`shouldAdvanceTime` + `userEvent.setup({ advanceTimers })`)
 * — dann vergleichen die Zeit-Pins auf Minuten statt Sekunden.
 */
const JETZT = new Date('2026-09-13T10:00:00Z');
const wireAb = (minuten: number) =>
  dayjs(JETZT).add(minuten, 'minute').utc().format('YYYY-MM-DD HH:mm:ss');
const ZEITFORMAT = 'YYYY-MM-DD HH:mm';
const GRUND = 'Die nächste Lagebesprechung muss nach dem Zeitpunkt liegen';

const stab = (over: Partial<Stab> = {}): Stab => ({
  anzahl_lagebesprechungen: 3,
  besetzung: [],
  ...over,
});
const antwort = (letzte: Partial<Lagebesprechung> = {}) => ({
  anzahl_lagebesprechungen: 4,
  besetzung: [],
  letzte_lagebesprechung: {
    id: 9,
    einsatz_id: 1,
    lfd_nr: 4,
    abgehalten_at: wireAb(0),
    entschluss: 'Lage unverändert',
    etb_eintrag_id: 77,
    erfasst_von_id: 1,
    erfasst_at: wireAb(0),
    ...letzte,
  },
});

let gesendet: Record<string, unknown>[];
let postAntwort: () => Response;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
  gesendet = [];
  postAntwort = () => HttpResponse.json(antwort(), { status: 201 });
  server.use(
    http.post('/api/einsaetze/1/stab/lagebesprechungen', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return postAntwort();
    }),
  );
});
afterEach(() => vi.useRealTimers());

function Ort() {
  const ort = useLocation();
  return <output aria-label="Ort">{ort.pathname + ort.search}</output>;
}

/** Wie die Seite: montiert = offen, Toast mit dem `navigate` des Aufrufers. */
function Harness({ daten }: { daten: Stab }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [offen, setOffen] = useState(true);
  return (
    <>
      {offen && (
        <LagebesprechungModal
          einsatzId={1}
          stab={daten}
          onAbgeschlossen={(eigene) =>
            zeigeAbschlussToast(message, { einsatzId: 1, eigene, navigate })
          }
          onSchliessen={() => setOffen(false)}
        />
      )}
      <Ort />
    </>
  );
}

function zeige(daten: Stab = stab()) {
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab" element={<Harness daten={daten} />} />
      <Route path="/einsaetze/:id/etb" element={<Ort />} />
    </Routes>,
    { route: '/einsaetze/1/stab' },
  );
  return screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });
}

/** Das `.ant-form-item` eines Feldes über seine Beschriftung. */
function feldItem(dialog: HTMLElement, label: string): HTMLElement {
  const item = [...dialog.querySelectorAll<HTMLElement>('.ant-form-item')].find(
    (i) => i.querySelector('.ant-form-item-label')?.textContent === label,
  );
  if (!item) throw new Error(`Feld „${label}" nicht gefunden`);
  return item;
}

/** Eingabe eines Feldes über seine Beschriftung — unabhängig vom `for`-Weg des DatePickers. */
function feld(dialog: HTMLElement, label: string): HTMLInputElement {
  const eingabe = feldItem(dialog, label).querySelector<HTMLInputElement>('input, textarea');
  if (!eingabe) throw new Error(`Feld „${label}" nicht gefunden`);
  return eingabe;
}

/**
 * Zählt die BEDIENBAREN Felder — wörtlich aus `pages/MaterialPage.test.tsx`. Die Rollen-Abfrage
 * blendet aus, was im Barrierefreiheitsbaum nicht steht, und genau das ist der eingeklappte
 * Bereich: `forceRender` lässt sein Feld im Baum, `CSSMotion` legt `display: none` DIREKT ans
 * Element. Deshalb hält die Zählung in jsdom.
 */
function sichtbareFelder(dialog: HTMLElement): number {
  const rollen = ['textbox', 'spinbutton', 'combobox', 'checkbox', 'radio', 'switch'] as const;
  const felder = new Set<Element>();
  for (const rolle of rollen) {
    for (const el of within(dialog).queryAllByRole(rolle)) {
      const item = el.closest('.ant-form-item');
      if (item) felder.add(item);
    }
  }
  return felder.size;
}

/** Siehe `pages/LageberichtDetailPage.test.tsx` — gezählt wird die Message-Queue selbst. */
function toastsMit(wortlaut: string) {
  return [...document.querySelectorAll<HTMLElement>('.ant-message')].filter((n) =>
    n.textContent?.includes(wortlaut),
  );
}

async function absenden(dialog: HTMLElement, entschluss = 'Lage unverändert') {
  const u = userEvent.setup();
  await u.type(feld(dialog, 'Entschluss'), entschluss);
  await u.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
  await waitFor(() => expect(gesendet).toHaveLength(1));
  return u;
}

describe('LagebesprechungModal · Erfassungs-Norm', () => {
  /** Das erste Feld ist eine TextArea — dort bleibt Enter ein Zeilenumbruch. Geprüft wird die
   *  Struktur, aus der „Enter sendet" folgt (Muster `components/Erfassung.test.tsx`). */
  it('keine Modal-Fusszeile, Absende-Knopf im <form>, Fokus im Entschluss', async () => {
    const dialog = await zeige();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Abschließen' }).closest('form'),
    ).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(feld(dialog, 'Entschluss')));
  });
});

describe('LagebesprechungModal · Feldbudget', () => {
  it('zeigt zwei Felder; der Zeitpunkt liegt eingeklappt IM Baum', async () => {
    const dialog = await zeige();
    // Vorbedingung: die DatePicker-Eingabe wird von der Rollenliste erfasst — sonst wäre die
    // Zahl unten aus dem falschen Grund richtig.
    expect(within(dialog).getAllByRole('textbox')).toContain(
      feld(dialog, 'Nächste Lagebesprechung'),
    );
    // GENAU zwei, nicht „höchstens drei": eine Obergrenze deckte eine Zählung, die ein Feld verliert.
    expect(sichtbareFelder(dialog)).toBe(2);
    // Im Baum (forceRender → der Zeitpunkt geht zugeklappt mit), aber nicht sichtbar.
    expect(feld(dialog, 'Zeitpunkt der Besprechung')).not.toBeVisible();
  });

  it('Aufklappen erhöht die Zahl der sichtbaren Felder', async () => {
    const dialog = await zeige();
    const vorher = sichtbareFelder(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(vorher + 1));
  });
});

describe('LagebesprechungModal · Vorbelegung und Tri-State', () => {
  it('belegt einen zukünftigen Termin vor — einen vergangenen nicht', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(45) }));
    expect(feld(dialog, 'Nächste Lagebesprechung').value).toBe(
      dayjs(JETZT).add(45, 'minute').format(ZEITFORMAT),
    );
  });

  it('lässt das Feld bei vergangenem Termin leer (Gegenfall)', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(-5) }));
    expect(feld(dialog, 'Nächste Lagebesprechung').value).toBe('');
  });

  it('unverändert abgeschickt → der Schlüssel naechste_at FEHLT', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(45) }));
    await absenden(dialog);
    expect(gesendet[0]).toEqual({ entschluss: 'Lage unverändert', abgehalten_at: wireAb(0) });
  });

  /**
   * I3: `stab` wird live invalidiert, die Maske friert beim ÖFFNEN ein (LFH-303). Neu gerendert
   * wird mit einem NEUEN Element — dasselbe Element-Objekt liesse React den Teilbaum
   * überspringen, und der Test wäre ohne jedes Einfrieren grün.
   */
  it('friert den Termin beim Öffnen ein: ein live geänderter Stand ändert weder Feld noch Body', async () => {
    const routen = (daten: Stab) => (
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<Harness daten={daten} />} />
      </Routes>
    );
    const { rerender } = renderMitProviders(
      routen(stab({ naechste_lagebesprechung_at: wireAb(45) })),
      { route: '/einsaetze/1/stab' },
    );
    const dialog = await screen.findByRole('dialog', { name: 'Lagebesprechung abschließen' });

    rerender(routen(stab({ naechste_lagebesprechung_at: wireAb(90) })));
    expect(feld(dialog, 'Nächste Lagebesprechung').value).toBe(
      dayjs(JETZT).add(45, 'minute').format(ZEITFORMAT),
    );
    await absenden(dialog);
    // Fremd geändert (Regel 2 in `abschlussBody`): der unberührte Termin geht nicht mit.
    expect(Object.keys(gesendet[0])).not.toContain('naechste_at');
  });

  it('„kein Termin" → naechste_at ist null', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(45) }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'kein Termin' }));
    await absenden(dialog);
    expect(gesendet[0]).toHaveProperty('naechste_at', null);
  });

  it('vergangener Termin, leer gelassen → null, nicht weggelassen (Ruling 1)', async () => {
    const dialog = await zeige(stab({ naechste_lagebesprechung_at: wireAb(-5) }));
    await absenden(dialog);
    expect(gesendet[0]).toHaveProperty('naechste_at', null);
  });

  it('bietet genau +30 min / +1 h / +2 h an', async () => {
    const dialog = await zeige();
    for (const label of ['+30 min', '+1 h', '+2 h']) {
      expect(within(dialog).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('button', { name: '+15 min' })).toBeNull();
  });

  /**
   * M2 (Ruling 12): Bezug der Schnellwahl ist der SPÄTERE von Zeitpunkt der Besprechung und
   * jetzt. Die drei Fälle unterscheiden sich nur im Zeitpunkt — jeder trennt eine andere
   * Fehlrechnung ab (nur Zeitpunkt · nur Wanduhr).
   */
  async function setzeZeitpunkt(dialog: HTMLElement, minuten: number) {
    const u = userEvent.setup();
    await u.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    // Kein `toBeVisible` als Wartebedingung: jsdom beendet die Aufklapp-Bewegung von `CSSMotion`
    // nicht, das Feld bliebe dafür „unsichtbar". Getragen wird die Aussage vom gesendeten Body.
    const eingabe = feld(dialog, 'Zeitpunkt der Besprechung');
    await u.click(eingabe);
    await u.clear(eingabe);
    await u.type(eingabe, `${dayjs(JETZT).add(minuten, 'minute').format(ZEITFORMAT)}{Enter}`);
  }

  it('Schnellwahl: der Zeitpunkt liegt zurück (eingefroren, die Wanduhr läuft) → ab jetzt', async () => {
    const dialog = await zeige();
    // Die Wanduhr läuft zehn Minuten weiter, der eingefrorene Zeitpunkt nicht. Ab dem Zeitpunkt
    // gerechnet käme wireAb(60) an — ein Termin, der schon zehn Minuten näher liegt als gewählt.
    vi.setSystemTime(new Date(JETZT.getTime() + 10 * 60_000));
    await userEvent.click(within(dialog).getByRole('button', { name: '+1 h' }));
    await absenden(dialog);
    expect(gesendet[0]).toMatchObject({ abgehalten_at: wireAb(0), naechste_at: wireAb(70) });
  });

  it('Schnellwahl: nachträglich erfasste Besprechung (Zeitpunkt −60 min) → ab jetzt', async () => {
    const dialog = await zeige();
    await setzeZeitpunkt(dialog, -60);
    await userEvent.click(within(dialog).getByRole('button', { name: '+1 h' }));
    await absenden(dialog);
    // Ab dem Zeitpunkt gerechnet käme wireAb(0) an: „+1 h" läge in der Vergangenheit.
    expect(gesendet[0]).toMatchObject({ abgehalten_at: wireAb(-60), naechste_at: wireAb(60) });
  });

  it('Schnellwahl: Zeitpunkt in der Zukunft → ab dem Zeitpunkt (Gegenfall)', async () => {
    const dialog = await zeige();
    await setzeZeitpunkt(dialog, 30);
    await userEvent.click(within(dialog).getByRole('button', { name: '+1 h' }));
    await absenden(dialog);
    // Ab jetzt gerechnet käme wireAb(60) an — nur 30 min nach der Besprechung.
    expect(gesendet[0]).toMatchObject({ abgehalten_at: wireAb(30), naechste_at: wireAb(90) });
  });
});

describe('LagebesprechungModal · Termin nach dem Zeitpunkt (Spiegel des 422)', () => {
  const ZU_FRUEH = 'Die nächste Lagebesprechung muss nach dem Zeitpunkt der Besprechung liegen';

  async function setzeTermin(dialog: HTMLElement, minuten: number) {
    const u = userEvent.setup();
    const eingabe = feld(dialog, 'Nächste Lagebesprechung');
    await u.click(eingabe);
    await u.clear(eingabe);
    await u.type(eingabe, `${dayjs(JETZT).add(minuten, 'minute').format(ZEITFORMAT)}{Enter}`);
  }
  const abschliessen = (dialog: HTMLElement) =>
    userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));

  it('Termin vor dem Zeitpunkt → Meldung AM Feld, kein POST', async () => {
    const dialog = await zeige();
    await setzeTermin(dialog, -30);
    await userEvent.type(feld(dialog, 'Entschluss'), 'Lage unverändert');
    await abschliessen(dialog);

    const item = feldItem(dialog, 'Nächste Lagebesprechung');
    await waitFor(() =>
      expect(item.querySelector('.ant-form-item-explain-error')).toHaveTextContent(ZU_FRUEH),
    );
    expect(gesendet).toHaveLength(0);
  });

  it('Termin nach dem Zeitpunkt → genau ein POST, ohne Meldung (Gegenfall)', async () => {
    const dialog = await zeige();
    await setzeTermin(dialog, 30);
    await userEvent.type(feld(dialog, 'Entschluss'), 'Lage unverändert');
    await abschliessen(dialog);

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toHaveProperty('naechste_at', wireAb(30));
    expect(screen.queryByText(ZU_FRUEH)).toBeNull();
  });
});

describe('LagebesprechungModal · Fehler im Modal, Erfolg im Toast', () => {
  it('zeigt den Grund eines abgelehnten POST IM Dialog und nicht im Toast', async () => {
    postAntwort = () => HttpResponse.json({ error: GRUND }, { status: 422 });
    const dialog = await zeige();
    await absenden(dialog);

    const treffer = await within(dialog).findByText(GRUND);
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit(GRUND)).toHaveLength(0);
    expect(within(dialog).getByText('Abschluss fehlgeschlagen')).toBeInTheDocument();
    // Offen und mit stehendem Wortlaut — die Hülle leert nur bei Erfolg.
    expect(dialog).not.toHaveClass('ant-zoom-leave');
    expect(feld(dialog, 'Entschluss')).toHaveValue('Lage unverändert');
  });

  /**
   * Gegenaussage zur Zählung oben (die Queue IST zählbar) und Messauftrag aus
   * Controller-Entscheidung 3: der Klick im Toast wechselt die Route wirklich.
   * Rückfallweg, falls die Route hier NICHT wechselt: der Toast bleibt Text ohne Knopf, und der
   * Beleg-Link der Zeile „Letzte" (Task 5) trägt den Deeplink allein — kein `window.location`.
   */
  it('quittiert per Toast und führt über ihn zum eigenen ETB-Eintrag', async () => {
    const dialog = await zeige();
    const u = await absenden(dialog);

    await waitFor(() => expect(toastsMit('Lagebesprechung Nr. 4 abgeschlossen')).toHaveLength(1));
    const [toast] = toastsMit('Lagebesprechung Nr. 4 abgeschlossen');
    await u.click(within(toast).getByRole('button', { name: 'Zum ETB-Eintrag' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent(
        '/einsaetze/1/etb?eintrag=77',
      ),
    );
  });

  it('verlinkt bei einer fremden Zeile in der Antwort nur auf das ETB', async () => {
    postAntwort = () =>
      HttpResponse.json(
        antwort({ lfd_nr: 5, entschluss: 'Fremder Entschluss', etb_eintrag_id: 88 }),
        {
          status: 201,
        },
      );
    const dialog = await zeige();
    const u = await absenden(dialog);

    await waitFor(() => expect(toastsMit('Lagebesprechung abgeschlossen')).toHaveLength(1));
    expect(toastsMit('Nr. 5')).toHaveLength(0);
    const [toast] = toastsMit('Lagebesprechung abgeschlossen');
    await u.click(within(toast).getByRole('button', { name: 'Zum ETB' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Ort' })).toHaveTextContent(
        /^\/einsaetze\/1\/etb$/,
      ),
    );
  });
});
