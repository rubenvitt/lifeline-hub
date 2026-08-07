import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { server } from '../test/server';
import { setzeViewportBreite } from '../test/viewport';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import TierePage from './TierePage';
import type { Tier } from '../api/types';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): so prüfen die Rollen-Tests die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = {
  id: 1, anzeigename: 'Nutzer', benutzername: 'nutzer', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-29 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-29 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-29 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const tierBasis: Tier = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'aktiv', spezies: 'hund',
  rasse_beschreibung: 'Schäferhund', rufname: 'Rex', geschlecht: 'maennlich',
  alter_geschaetzt: 3, farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
  halter_person_id: null, halter_kontakt: null, antreff_ort: 'Weide', notiz: null,
  abschluss_grund: null, abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00', erfasst_von: 1, geaendert_at: '2026-05-29 09:00:00',
  geaendert_von: 1, storniert_at: null, halter_registrier_nr: null, halter_storniert_at: null,
};
const tierVermisst: Tier = { ...tierBasis, id: 11, registrier_nr: 2, status: 'vermisst', spezies: 'katze', rufname: 'Mimi' };

/**
 * Zeilenfolge der T-Nummern in Dokumentordnung. Die FOLGE ist die belastbare Behauptung —
 * ein gerenderter Zeitstring hinge an der Zeitzone des Testrechners, weil
 * `renderMitProviders` keinen `EinsatzAnzeigeProvider` einhängt.
 */
function regFolge(): string[] {
  return screen.getAllByText(/^T-\d{3}$/).map((e) => e.textContent ?? '');
}

/**
 * Wartet, bis der Erfassungsdialog wirklich aus dem Baum ist — inklusive des Anstosses, den
 * die Schliess-Bewegung in jsdom braucht.
 *
 * GEMESSEN, und die Reihenfolge der Befunde ist der Grund für die zwei Ereignisnamen:
 * antds Modal geht beim Schliessen in `ant-zoom-leave` und bleibt dort für immer stehen —
 * jsdom hat keine Layout-Engine, die ein Animationsende meldet, und rc-motion setzt hier
 * keine Frist. `destroyOnHidden` greift erst NACH der Bewegung, die Felder bleiben also im
 * Baum, und `queryByRole('dialog')` findet den Dialog weiter (kein `display: none`).
 *
 * `fireEvent.animationEnd(...)` reicht dafür NICHT — das schickt „animationend", rc-motion
 * hört aber auf den Namen, den es aus den Stil-Eigenschaften des Browsers ableitet
 * (`getVendorPrefixedEventName`), und jsdoms `CSSStyleDeclaration` kennt `WebkitAnimation`,
 * nicht `animation`: in dieser Umgebung heisst das Ereignis „webkitAnimationEnd". Beide
 * Namen zu schicken hält den Helfer über einen jsdom-Wechsel hinweg heil.
 */
async function warteBisDialogWeg(timeout?: number) {
  await waitFor(() => {
    const modal = document.querySelector<HTMLElement>('.ant-modal');
    if (modal) {
      fireEvent.animationEnd(modal);
      modal.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }));
    }
    // Am FELD gemessen, nicht an der Dialogrolle: `destroyOnHidden` ist die Zusicherung,
    // dass ein geschlossener Dialog keine Felder stehen lässt.
    expect(screen.queryByLabelText('Rufname')).not.toBeInTheDocument();
  }, timeout != null ? { timeout } : undefined);
}

function render(einsatzObj: typeof einsatzAktiv, tiere: Tier[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json(tiere)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/tiere" element={<TierePage />} />
        <Route path="/einsaetze/:id/tiere/:tierId" element={<div>DETAIL-SEITE</div>} />
        <Route path="/einsaetze/:id/personen" element={<div>Personen-Modul</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/tiere' },
  );
}

function EinsatzWechsel() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/einsaetze/2/tiere')}>Zu Einsatz B</button>;
}

describe('TierePage', () => {
  it('zeigt aktive Tiere mit T-Nummer und Status', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    expect(await screen.findByText('T-001')).toBeInTheDocument();
    expect(screen.getByText('Rex')).toBeInTheDocument();
    // vermisste Katze ist in der Default-Sicht „Aktiv" nicht sichtbar:
    expect(screen.queryByText('T-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Vermisst', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    await screen.findByText('T-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('T-002')).toBeInTheDocument();
    expect(screen.getByText('Mimi')).toBeInTheDocument();
  });

  it('nimmt den Suchbegriff nicht in den nächsten Reiter mit', async () => {
    /**
     * VIER Reiter auf EINER `Datensicht` — bei konstantem `key` reicht React beim
     * Reiterwechsel dieselbe Instanz weiter, und `suchbegriff` lebt IN der Sicht: der Begriff
     * aus „Vermisst" filtert danach die Menge von „Alle".
     *
     * Drei Schritte, weil der letzte allein nichts belegte: eine Behauptung über das leere
     * Feld bliebe auch grün, wenn die Suche gar nicht filterte (etwa ohne `suchText` an der
     * Rufnamen-Spalte). Schritt 1 zeigt erst, dass der Begriff beißt; Schritt 3 nennt den
     * Schaden beim Namen — eine fremde Menge auf einen fremden Begriff gefiltert.
     *
     * FIXTUREN BEWUSST QUER: `suchText` greift auf Reg.-Nr., Rufname, Rasse UND Halter zu.
     * Träfe der Begriff die Zielzeile über irgendeines dieser Felder, stünde sie nach dem
     * Wechsel sichtbar da, WEIL sie passt — und nicht, weil das Feld geleert wurde. „Mimi"
     * trifft deshalb genau eine der drei Zeilen, und alle drei tragen eine eigene Rasse.
     */
    const mimi: Tier = { ...tierBasis, id: 70, registrier_nr: 4, status: 'vermisst',
      spezies: 'katze', rufname: 'Mimi', rasse_beschreibung: 'Perser' };
    const bello: Tier = { ...tierBasis, id: 71, registrier_nr: 5, status: 'vermisst',
      rufname: 'Bello', rasse_beschreibung: 'Dackel' };
    const rex: Tier = { ...tierBasis, id: 72, registrier_nr: 6, status: 'aktiv',
      rufname: 'Rex', rasse_beschreibung: 'Schäferhund' };
    render(einsatzAktiv, [mimi, bello, rex]);
    await userEvent.click(await screen.findByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('Bello')).toBeInTheDocument();

    // 1. Die Suche wirkt überhaupt: die nicht passende Zeile fällt heraus.
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Suche in Tiere im Einsatz' }),
      'Mimi',
    );
    await vi.waitFor(() => expect(screen.queryByText('Bello')).not.toBeInTheDocument());
    expect(screen.getByText('Mimi')).toBeInTheDocument();

    // 2. + 3. Reiterwechsel: die fremde Zeile steht ungefiltert da, das Feld ist leer.
    await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
    expect(await screen.findByText('Rex')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Suche in Tiere im Einsatz' })).toHaveValue('');
  });

  it('filtert nach Spezies', async () => {
    render(einsatzAktiv, [tierBasis, { ...tierBasis, id: 12, registrier_nr: 3, spezies: 'katze', rufname: 'Felix' }]);
    await screen.findByText('Rex');
    // Namensfilter, nicht „die einzige Combobox der Seite": die Werkzeugzeile von
    // `Datensicht` kann ein zweites Combobox-artiges Element mitbringen (Spaltenschalter,
    // Spaltenfilter). Ohne den Namen bräche diese Zeile aus einem Grund, der mit Tieren
    // nichts zu tun hat.
    await userEvent.click(screen.getByRole('combobox', { name: 'Spezies' }));
    // Tabellenzelle und Dropdown-Option tragen beide "Katze" → auf die Option im Dropdown zielen.
    const katzeOption = (await screen.findAllByText('Katze')).find((el) => el.closest('.ant-select-item-option'));
    expect(katzeOption).toBeTruthy();
    await userEvent.click(katzeOption!);
    expect(await screen.findByText('Felix')).toBeInTheDocument();
    expect(screen.queryByText('Rex')).not.toBeInTheDocument();
  });

  it('Einsatzleitung sieht Anlege-Buttons', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Tiere' });
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [tierBasis]);
    await screen.findByText('T-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('Schnellerfassung schickt status=aktiv + spezies', async () => {
    let body: { spezies?: string; status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { spezies?: string; status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99 }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('aktiv'));
    expect(body.spezies).toBe('hund'); // initialValues
  });

  it('Vermisst-Meldung schickt status=vermisst', async () => {
    let body: { status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99, status: 'vermisst' }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('vermisst'));
  });

  it('wechselt nach dem Erfassen in die Antwort-Sicht und hebt das neue Tier hervor', async () => {
    const neu = {
      ...tierBasis,
      id: 99,
      registrier_nr: 9,
      status: 'vermisst' as const,
      rufname: 'Fundtier Neu',
    };
    server.use(http.post('/api/einsaetze/1/tiere', () => HttpResponse.json(neu, { status: 201 })));
    const { container, client } = render(einsatzAktiv, []);
    await waitFor(() => expect(client.getQueryState(einsatzKeys.tiere(1))?.status).toBe('success'));
    let veralteteRefetches = 0;
    // Replikations-/Refetch-Lücke simulieren: direkt nach dem POST kennt der GET das neue
    // Tier noch nicht. Die Antwortzeile muss trotzdem stehen bleiben.
    server.use(http.get('/api/einsaetze/1/tiere', () => {
      veralteteRefetches += 1;
      return HttpResponse.json([]);
    }));

    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(await screen.findByText('T-009')).toBeInTheDocument();
    await waitFor(() => expect(veralteteRefetches).toBeGreaterThan(0));
    expect(screen.getByText('T-009')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vermisst' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-row-key="99"]')).toHaveClass('zeile-hervorgehoben');
  });

  it('rendert eine verspätete Antwort aus Einsatz A weder als Overlay noch als Highlight in B', async () => {
    const tierA: Tier = {
      ...tierBasis,
      id: 99,
      registrier_nr: 9,
      status: 'vermisst',
      rufname: 'Tier A',
    };
    const tierB: Tier = {
      ...tierBasis,
      id: 99,
      einsatz_id: 2,
      registrier_nr: 20,
      status: 'aktiv',
      rufname: 'Tier B',
    };
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => { postGestartet = resolve; });
    const antwortGate = new Promise<void>((resolve) => { antwortFreigeben = resolve; });
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const id = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatzAktiv, id, bezeichnung: `Einsatz ${id}` });
      }),
      http.get('/api/einsaetze/:einsatzId/tiere', ({ params }) =>
        HttpResponse.json(params.einsatzId === '2' ? [tierB] : [])),
      http.post('/api/einsaetze/1/tiere', async () => {
        postGestartet();
        await antwortGate;
        return HttpResponse.json(tierA, { status: 201 });
      }),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/tiere" element={<><EinsatzWechsel /><TierePage /></>} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/tiere' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    expect(await screen.findByText('Tier B')).toBeInTheDocument();

    await act(async () => { antwortFreigeben(); });
    await waitFor(() => expect(screen.queryByText('Tier A')).not.toBeInTheDocument());
    expect(screen.getByText('Tier B')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aktiv' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-row-key="99"]')).not.toHaveClass('zeile-hervorgehoben');
  });

  /**
   * SCHNELLERFASSUNG auf der Erfassungshülle (LFH-332 · B4). Die drei Fälle prüfen die
   * VERDRAHTUNG dieser Seite, nicht die Hülle: dass das erste Feld dieser Maske den Fokus
   * bekommt, dass Enter den Wortlaut MIT dem aus dem Modus abgeleiteten Status schickt, und
   * dass der Serienlauf die zwei Übernahmefelder dieser Maske mitnimmt. Das allgemeine
   * Verhalten der Hülle steht in `components/Erfassung.test.tsx`.
   */
  it('setzt den Fokus beim Öffnen ins erste Feld der Maske', async () => {
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await screen.findByRole('dialog');
    // IM Dialog gesucht: die zweite Combobox der Seite ist der Spezies-Filter der
    // Werkzeugzeile, und der steht ausserhalb.
    await waitFor(() => expect(within(dialog).getByRole('combobox')).toHaveFocus());
  });

  it('Enter im Rufnamen sendet ab — mit dem Status aus dem Modus', async () => {
    let body: { rufname?: string | null; status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { rufname?: string | null; status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99, status: 'vermisst' }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await screen.findByRole('dialog');

    // KEIN Klick auf „Erfassen": nur die Enter-Taste im Feld belegt, dass der Absende-Knopf
    // im Formular liegt. Über `onOk` am Modal blieb Enter wirkungslos.
    await userEvent.type(screen.getByLabelText('Rufname'), 'Mimi{Enter}');

    await waitFor(() => expect(body.rufname).toBe('Mimi'));
    // Die Ableitung aus dem Modus hat den Umbau überlebt.
    expect(body.status).toBe('vermisst');
    // Einzel-Erfassen schliesst — das macht `onFertig`, nicht mehr `onSuccess`.
    await warteBisDialogWeg();
  });

  it('„Speichern und nächste" hält den Dialog offen und nimmt Spezies und Antreffort mit', async () => {
    type Wortlaut = { spezies?: string; status?: string; antreff_ort?: string | null; rufname?: string | null };
    const wortlaute: Wortlaut[] = [];
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      wortlaute.push(await request.json() as Wortlaut);
      return HttpResponse.json({ ...tierBasis, id: 99 }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await screen.findByRole('dialog');

    // Der Schalter steht per Vorgabe AUS (30.07.2026) — ohne ihn gäbe es keine Übernahme.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    // Spezies WEG vom Startwert 'hund' stellen — sonst wäre 'hund' nach dem Zurücksetzen
    // auch ohne Übernahme wieder da, und der zweite Wortlaut bewiese nichts.
    await userEvent.click(within(dialog).getByRole('combobox'));
    const katze = (await screen.findAllByText('Katze')).find((el) => el.closest('.ant-select-item-option'));
    expect(katze).toBeTruthy();
    await userEvent.click(katze!);
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Sammelstelle Nord');
    await userEvent.type(screen.getByLabelText('Rufname'), 'Rex');

    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(wortlaute).toHaveLength(1));
    await waitFor(() => expect(
      sessionStorage.getItem('lfh:erfassung:1:tier:antreff_ort'),
    ).toBe('Sammelstelle Nord'));

    /**
     * Der Dialog bleibt stehen — und die Gegenprobe steckt IM Anstoss.
     *
     * `getByRole('dialog')` allein unterschiede die beiden Fälle NICHT: ein sich
     * schliessender antd-Dialog steht in jsdom genauso im Baum (kein `display: none`,
     * Felder noch da), weil die Schliess-Bewegung ohne Anstoss nie endet — gemessen beim
     * Bau von `warteBisDialogWeg`. Auch der Zähler trennt nicht: die Hülle zählt hoch,
     * bevor sie sich für einen der beiden Wege entscheidet.
     *
     * Der Anstoss trennt sie: derselbe Helfer, der den Einzel-Weg beim Verschwinden
     * beobachtet, läuft hier in seine Wartezeit — die Bewegung, die er beenden könnte, gibt
     * es nicht. Auf dem Einzel-Weg ginge er durch.
     */
    await expect(warteBisDialogWeg(400)).rejects.toThrow();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Rufname')).toBeInTheDocument();
    expect(await screen.findByText('Erfasst: 1')).toBeInTheDocument();
    // Einzelfeld geleert, Wiederholfelder stehen.
    await waitFor(() => expect(screen.getByLabelText('Rufname')).toHaveValue(''));
    expect(screen.getByLabelText('Antreffort')).toHaveValue('Sammelstelle Nord');

    // Zweiter Satz: die Übernahme steht auch im WORTLAUT, nicht bloß im Feld.
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(wortlaute).toHaveLength(2));
    expect(wortlaute[1].spezies).toBe('katze');
    expect(wortlaute[1].antreff_ort).toBe('Sammelstelle Nord');
    expect(wortlaute[1].status).toBe('aktiv');
    // Das Einzelfeld ist NICHT mitgewandert — sonst stünde der vorige Satz zweimal in der Liste.
    expect(wortlaute[1].rufname ?? '').toBe('');
  });

  it('merkt einen erfolgreichen Antreffort für das Wiederöffnen dieser Tiermaske', async () => {
    let versuche = 0;
    server.use(http.post('/api/einsaetze/1/tiere', () => {
      versuche += 1;
      return HttpResponse.json({ ...tierBasis, id: 99 }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Tier-Sammelstelle');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(versuche).toBe(1));
    await warteBisDialogWeg();

    await userEvent.click(screen.getByRole('button', { name: 'Schnellerfassung' }));
    await waitFor(() => expect(screen.getByLabelText('Antreffort')).toHaveValue('Tier-Sammelstelle'));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  it('speichert den Antreffort bei einem fehlgeschlagenen Tier nicht', async () => {
    let versuche = 0;
    server.use(http.post('/api/einsaetze/1/tiere', () => {
      versuche += 1;
      return HttpResponse.json({ error: 'Tier abgelehnt' }, { status: 500 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Fehlerort Tier');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(versuche).toBe(1));
    expect(screen.getByLabelText('Antreffort')).toHaveValue('Fehlerort Tier');
    expect(sessionStorage.getItem('lfh:erfassung:1:tier:antreff_ort')).toBeNull();
  });

  it('speichert den Antreffort nach Schließen während des POST nicht', async () => {
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    const postStart = new Promise<void>((resolve) => { postGestartet = resolve; });
    const antwortGate = new Promise<void>((resolve) => { antwortFreigeben = resolve; });
    server.use(http.post('/api/einsaetze/1/tiere', async () => {
      postGestartet();
      await antwortGate;
      return HttpResponse.json({
        ...tierBasis,
        id: 99,
        registrier_nr: 99,
        rufname: 'Abbruch-Tier',
      }, { status: 201 });
    }));
    render(einsatzAktiv, []);

    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.type(screen.getByLabelText('Antreffort'), 'Abbruchort Tier');
    await userEvent.type(screen.getByLabelText('Rufname'), 'Abbruch-Tier');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));
    await act(async () => { antwortFreigeben(); });
    await screen.findByText('Abbruch-Tier');

    expect(sessionStorage.getItem('lfh:erfassung:1:tier:antreff_ort')).toBeNull();
  });

  it('liest nur den Tierwert des aktuellen Einsatzes und füllt ihn nach Serien-Reset nicht erneut ein', async () => {
    sessionStorage.setItem('lfh:erfassung:2:tier:antreff_ort', 'Falscher Einsatz');
    sessionStorage.setItem('lfh:erfassung:1:person:antreff_ort', 'Falsche Maske');
    sessionStorage.setItem('lfh:erfassung:1:tier:antreff_ort', 'Tierlager Nord');
    let versuche = 0;
    server.use(http.post('/api/einsaetze/1/tiere', () => {
      versuche += 1;
      return HttpResponse.json({ ...tierBasis, id: 99 }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));

    await waitFor(() => expect(screen.getByLabelText('Antreffort')).toHaveValue('Tierlager Nord'));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(versuche).toBe(1));
    expect(screen.getByLabelText('Antreffort')).toHaveValue('');
  });

  it('setzt beim Einsatzwechsel alle Tierwerte zurück und lädt nur den B-Sitzungsort', async () => {
    sessionStorage.setItem('lfh:erfassung:1:tier:antreff_ort', 'Tierlager A');
    sessionStorage.setItem('lfh:erfassung:2:tier:antreff_ort', 'Tierlager B');
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const id = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatzAktiv, id, bezeichnung: `Einsatz ${id}` });
      }),
      http.get('/api/einsaetze/:einsatzId/tiere', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/tiere" element={<><EinsatzWechsel /><TierePage /></>} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/tiere' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await waitFor(() => expect(screen.getByLabelText('Antreffort')).toHaveValue('Tierlager A'));
    const dialogA = screen.getByRole('dialog');
    await userEvent.click(within(dialogA).getByRole('combobox'));
    const katze = (await screen.findAllByText('Katze')).find((el) => el.closest('.ant-select-item-option'));
    expect(katze).toBeTruthy();
    await userEvent.click(katze!);
    await userEvent.type(within(dialogA).getByLabelText('Rufname'), 'Nur Einsatz A');
    await userEvent.type(within(dialogA).getByLabelText('Notiz'), 'Alte Notiz');
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));
    await warteBisDialogWeg();
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));

    const dialogB = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialogB).getByLabelText('Antreffort')).toHaveValue('Tierlager B'));
    expect(within(dialogB).getByTitle('Hund')).toBeInTheDocument();
    expect(within(dialogB).getByLabelText('Rufname')).toHaveValue('');
    expect(within(dialogB).getByLabelText('Notiz')).toHaveValue('');
  });

  it('navigiert beim Klick auf eine Zeile zur Detail-Vollseite', async () => {
    render(einsatzAktiv, [tierBasis]);
    await userEvent.click((await screen.findAllByText('Rex'))[0]);
    // Drawer entfernt (LFH-147) → Zeilen-Klick navigiert auf /tiere/:tierId.
    expect(await screen.findByText('DETAIL-SEITE')).toBeInTheDocument();
  });

  it('rendert genau einen Datensatz-Link pro Tierzeile', async () => {
    render(einsatzAktiv, [tierBasis, { ...tierBasis, id: 12, registrier_nr: 3, rufname: 'Bello' }]);

    const links = await screen.findAllByRole('link', { name: /^T-00[13]$/ });
    expect(links).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'T-001' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'T-003' })).toHaveLength(1);
  });

  it('sortiert die Liste selbst, statt die Lieferreihenfolge zu übernehmen', async () => {
    // AUFSTEIGEND geliefert, obwohl das Backend `ORDER BY t.registrier_nr DESC` fährt
    // (`src/tier/repo.rs`): nur so beweist die absteigende Zeilenfolge, dass die Umkehrung
    // im Client passiert. In Backend-Reihenfolge geliefert könnte dieser Test nicht
    // fehlschlagen.
    const drei = [
      tierBasis,
      { ...tierBasis, id: 21, registrier_nr: 2, rufname: 'Bello' },
      { ...tierBasis, id: 22, registrier_nr: 3, rufname: 'Cleo' },
    ];
    render(einsatzAktiv, drei);
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    expect(regFolge()).toEqual(['T-003', 'T-002', 'T-001']);
  });

  it('zeigt „seit" aus dem Erfassungszeitpunkt und sortiert danach', async () => {
    /**
     * Für Tiere gibt es KEINE Dringlichkeitssortierung: `TierAnzeige` trägt weder
     * Sichtungskategorie noch Sichtungszeitpunkt (verifiziert am generierten Typ, die
     * Rust-Doku nennt das Modul „bewusst schlank"). „seit" kommt deshalb aus `erfasst_at`;
     * `geaendert_at` wäre falsch, weil es bei jeder Notiz weiterläuft.
     *
     * Der Klick auf den Spaltenkopf ist die tragende Hälfte. Gemessen: eine Prüfung, die nur
     * Kopf und Zellmuster sieht, blieb grün, als der `sortWert` der Spalte entfiel UND als
     * der Kopf umbenannt wurde — sie belegte also weder Sortierbarkeit noch Beschriftung.
     *
     * Die Zeitstempel liegen ABSICHTLICH quer zur Registriernummer, sonst wäre die
     * Zeitsortierung von der Nummernsortierung nicht zu unterscheiden. Und sie sind
     * verschieden: alle Bestandsfixtures teilen `erfasst_at`, eine Behauptung darüber wäre
     * dort eine Attrappe.
     */
    const drei = [
      { ...tierBasis, id: 30, registrier_nr: 1, rufname: 'Alt', erfasst_at: '2026-05-29 07:00:00' },
      { ...tierBasis, id: 31, registrier_nr: 2, rufname: 'Neu', erfasst_at: '2026-05-29 12:00:00' },
      { ...tierBasis, id: 32, registrier_nr: 3, rufname: 'Mitte', erfasst_at: '2026-05-29 09:00:00' },
    ];
    render(einsatzAktiv, drei);
    await vi.waitFor(() => expect(regFolge()).toHaveLength(3));
    // Muster statt Fixwert: ohne `EinsatzAnzeigeProvider` rendert die Zeit in der Zeitzone
    // des Testrechners.
    const dtg = screen
      .getAllByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/)
      .map((e) => e.textContent);
    expect(dtg).toHaveLength(3);
    // DREI VERSCHIEDENE Werte. Gemessen als Lücke: die Fixtures teilen `geaendert_at`, also
    // blieb ein `render` auf dem falschen Feld grün, solange nur das Format geprüft wurde.
    expect(new Set(dtg).size).toBe(3);
    // Vorgabe ist die Nummer, absteigend …
    expect(regFolge()).toEqual(['T-003', 'T-002', 'T-001']);
    // … und ein Klick auf den seit-Kopf ordnet nach Zeit, ältestes zuerst.
    await userEvent.click(screen.getByRole('columnheader', { name: 'seit' }));
    expect(regFolge()).toEqual(['T-001', 'T-003', 'T-002']);
  });

  it('trägt „seit" auch in den Kartenzweig bei 390 px', async () => {
    /**
     * Ohne diesen Fall belegte das Bündel die Zeitachse NUR für die Tabelle. Unter `md`
     * rendert `Datensicht` genau einen anderen Zweig, und dort kommt die Zeit aus dem
     * `sekundaer`-Tupel des Kartenplans — ein dort fehlender Slot wäre in jeder
     * Tabellenprüfung unsichtbar.
     *
     * Die Breite VOR dem Rendern setzen: antds Beobachter ruft seinen Zuhörer beim
     * Abonnieren synchron auf und liest dabei nur den Trefferstand.
     */
    setzeViewportBreite(390);
    const schmal = render(einsatzAktiv, [tierBasis]);
    await screen.findByRole('region', { name: 'Tiere im Einsatz' });
    // Genau EIN Zweig im Baum — sonst wäre die Aussage darüber, welcher gilt, wertlos.
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    // Etikett UND Wert: das Etikett ist der zweite Kanal der Karte.
    expect(screen.getByText('seit')).toBeInTheDocument();
    expect(
      screen.getByText(/^\d{6}(JAN|FEB|MÄR|APR|MAI|JUN|JUL|AUG|SEP|OKT|NOV|DEZ)2026$/),
    ).toBeInTheDocument();
    // Das Tastaturziel der Zeile ist der Titel-Link, nicht die Kartenfläche.
    expect(screen.getByRole('link', { name: 'T-001' })).toHaveAttribute(
      'href',
      '/einsaetze/1/tiere/10',
    );
  });

  it('zeigt die Halter-R-Nr und „storniert" aus den Join-Feldern', async () => {
    const mitHalter: Tier = { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7, halter_storniert_at: '2026-05-29 11:00:00' };
    render(einsatzAktiv, [mitHalter]);
    expect(await screen.findByText(/Halter \(storniert\): R-007/)).toBeInTheDocument();
  });

  /**
   * Partnerpaar zu AK4 (LFH-331 · B3): die negative Hälfte allein wäre auch dann grün, wenn
   * der Umbau den Leertext bloß umformuliert hätte. Erst der Fall darunter — gleiches
   * Literal, gleiche Datei — macht daraus eine Aussage über die Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/tiere', () => new HttpResponse(null, { status: 500 })),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/tiere" element={<TierePage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/tiere' },
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByText('Tiere konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine Tiere in dieser Sicht')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Menge den Leertext und KEINEN Fehler', async () => {
    render(einsatzAktiv, []);

    expect(await screen.findByText('Keine Tiere in dieser Sicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher (D5) — nicht `isFetching`,
   * nicht `isStale`. Der Ablauf ist der echte: geglückter Abruf, dann gescheiterte
   * Aktualisierung. Ein bloß vorbefüllter Zwischenspeicher ließe offen, ob TanStack nach
   * einem HINTERGRUND-Fehlschlag überhaupt auf `error` stellt statt auf `success` zu bleiben.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = render(einsatzAktiv, [tierBasis]);
    await screen.findByText('T-001');

    server.use(http.get('/api/einsaetze/1/tiere', () => new HttpResponse(null, { status: 500 })));
    await client.refetchQueries({ queryKey: einsatzKeys.tiere(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeilen aus dem Zwischenspeicher bleiben stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('T-001')).toBeInTheDocument();
    expect(screen.queryByText('Tiere konnten nicht geladen werden')).not.toBeInTheDocument();
  });
});
