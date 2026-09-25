import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { erzeugeQueryClient } from '../api/queryClient';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { DemoDatenStatus } from '../api/types';
import AdminLayout from './AdminLayout';
import DemoDatenPage from './DemoDatenPage';
import { adminDemoDatenPfad } from './adminNav';

/**
 * Verwaltungssektion „Demo-Daten“ (LFH-690, Task 6.2; Spec „Verwaltungssektion Demo-Daten“,
 * design.md D2/D13).
 *
 * Die Zeitangaben setzen `TZ=Europe/Berlin` voraus (`scripts/check-all.sh` erzwingt sie):
 * 08:00 UTC ist dann 10:00 Ortszeit, und nur so trennt die Erwartung `dayjs.utc(s)` von
 * `dayjs(s)` — in UTC gerechnet stünde beides auf 08:00.
 */

const admin = {
  id: 1,
  anzeigename: 'Chef',
  benutzername: 'chef',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

const fuehrungskraft = {
  id: 2,
  anzeigename: 'Eva',
  benutzername: 'eva',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

const NICHT_IMPORTIERT: DemoDatenStatus = { importiert: false };

function importiert(einsatzId: number, bezeichnung: string, zeit: string): DemoDatenStatus {
  return {
    importiert: true,
    import: {
      id: einsatzId,
      importiert_at: zeit,
      einsatz_id: einsatzId,
      einsatz_bezeichnung: bezeichnung,
    },
    bericht: {
      vorgang: 'importiert',
      zeitpunkt: zeit,
      je_art: [
        { art: 'fahrzeug', angelegt: 12, mitbenutzt: 1, entfernt: 0, behalten: 0 },
        { art: 'personal', angelegt: 30, mitbenutzt: 0, entfernt: 0, behalten: 0 },
        { art: 'material', angelegt: 8, mitbenutzt: 2, entfernt: 0, behalten: 0 },
      ],
    },
  };
}

const IMPORTIERT = importiert(41, 'ÜBUNG – Starkregen Musterstadt', '2026-09-24 08:00:00');
const NEU_IMPORTIERT = importiert(52, 'ÜBUNG – Starkregen Musterstadt', '2026-09-24 11:15:00');

const ENTFERNT: DemoDatenStatus = {
  importiert: false,
  bericht: {
    vorgang: 'entfernt',
    zeitpunkt: '2026-09-24 09:30:00',
    je_art: [
      { art: 'fahrzeug', angelegt: 0, mitbenutzt: 0, entfernt: 11, behalten: 1 },
      { art: 'personal', angelegt: 0, mitbenutzt: 0, entfernt: 30, behalten: 0 },
      { art: 'material', angelegt: 0, mitbenutzt: 0, entfernt: 8, behalten: 0 },
    ],
  },
};

interface Zaehler {
  get: number;
  post: number;
  neu: number;
  delete: number;
}

/**
 * Ein kleiner Server mit Zustand: jeder Schreibvorgang setzt den Stand, den das nächste GET
 * liefert — so wie das Backend, dessen Schreibantwort dem GET danach gleicht (block-5-report).
 * `'aus'` ist der Zustand ohne `--demo-daten`: 404 auf allem.
 */
function demoServer(start: DemoDatenStatus | 'aus'): Zaehler {
  const z: Zaehler = { get: 0, post: 0, neu: 0, delete: 0 };
  let stand = start;
  const aus = () => HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  server.use(
    http.get('/api/demo-daten', () => {
      z.get += 1;
      return stand === 'aus' ? aus() : HttpResponse.json(stand);
    }),
    http.post('/api/demo-daten', () => {
      z.post += 1;
      stand = IMPORTIERT;
      return HttpResponse.json(IMPORTIERT, { status: 201 });
    }),
    http.post('/api/demo-daten/neu', () => {
      z.neu += 1;
      stand = NEU_IMPORTIERT;
      return HttpResponse.json(NEU_IMPORTIERT);
    }),
    http.delete('/api/demo-daten', () => {
      z.delete += 1;
      stand = ENTFERNT;
      return HttpResponse.json(ENTFERNT);
    }),
  );
  return z;
}

function Pfad() {
  return <div>PFAD:{useLocation().pathname}</div>;
}

function setup(me: Record<string, unknown>, route = adminDemoDatenPfad(), client?: QueryClient) {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(me)));
  return renderMitProviders(
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="demo-daten" element={<DemoDatenPage />} />
        <Route path=":gruppe/:sektion" element={<Pfad />} />
      </Route>
      <Route path="/einsaetze" element={<div>Einsatzliste</div>} />
      <Route path="/einsaetze/:id" element={<Pfad />} />
    </Routes>,
    { route, client },
  );
}

/** Siehe `pages/LageberichtDetailPage.test.tsx` — gezählt wird die Message-Queue selbst. */
function toastsMit(wortlaut: string) {
  return [...document.querySelectorAll<HTMLElement>('.ant-message')].filter((n) =>
    n.textContent?.includes(wortlaut),
  );
}

async function offenerDialog(titel: string) {
  return screen.findByRole('dialog', { name: titel });
}

describe('DemoDatenPage — Menüeintrag (D13)', () => {
  it('System-Admin + 200: Eintrag „Demo-Daten“ steht im Menü und führt auf die Sektion', async () => {
    demoServer(NICHT_IMPORTIERT);
    setup(admin, '/admin/stammdaten/fahrzeuge');
    const eintrag = await screen.findByRole('menuitem', { name: 'Demo-Daten' });
    await userEvent.click(eintrag);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Demo-Daten' }),
    ).toBeInTheDocument();
    // Die Markierung folgt der URL auch für den Sonderfall (menuKeys).
    expect(screen.getByRole('menuitem', { name: 'Demo-Daten' })).toHaveClass(
      'ant-menu-item-selected',
    );
  });

  it('System-Admin + 404: kein Eintrag, und kein Fehlerbild', async () => {
    const z = demoServer('aus');
    setup(admin, '/admin/stammdaten/fahrzeuge');
    // Ankerpunkt: die Abfrage IST gelaufen — ohne ihn wäre die Abwesenheit auch dann grün,
    // wenn der Hook nie feuert.
    await waitFor(() => expect(z.get).toBe(1));
    await screen.findByText('PFAD:/admin/stammdaten/fahrzeuge');
    expect(screen.getByRole('menuitem', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Demo-Daten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // `retry: false`: ein 404 löst keine Wiederholungen aus.
    await new Promise((r) => setTimeout(r, 50));
    expect(z.get).toBe(1);
  });

  it('Führungskraft: kein Eintrag und keine Anfrage an /api/demo-daten', async () => {
    const z = demoServer(NICHT_IMPORTIERT);
    setup(fuehrungskraft, '/admin/stammdaten/fahrzeuge');
    // Ankerpunkt: die Anmeldung ist aufgelöst, das Menü steht.
    expect(await screen.findByRole('menuitem', { name: 'Fahrzeuge' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('menuitem', { name: 'Demo-Daten' })).not.toBeInTheDocument();
    expect(z.get).toBe(0);
  });
});

describe('DemoDatenPage — Selbstschutz der Route', () => {
  it('404: die Route leitet auf /einsaetze', async () => {
    const z = demoServer('aus');
    setup(admin);
    expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
    expect(z.get).toBe(1);
  });

  it('Führungskraft: die Route leitet auf /einsaetze, ohne den Status abzufragen', async () => {
    const z = demoServer(NICHT_IMPORTIERT);
    setup(fuehrungskraft);
    expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
    expect(z.get).toBe(0);
  });
});

describe('DemoDatenPage — Status-Abfrage scheitert (Spec „Status-Abfrage scheitert“)', () => {
  it('500: Fehlerbild mit „Erneut abrufen“, keine Aktion, keine Umleitung', async () => {
    let gets = 0;
    server.use(
      http.get('/api/demo-daten', () => {
        gets += 1;
        return HttpResponse.json({ error: 'Datenbank nicht erreichbar' }, { status: 500 });
      }),
    );
    setup(admin);
    expect(
      await screen.findByText('Der Stand der Demo-Daten konnte nicht geladen werden.'),
    ).toBeInTheDocument();
    const wiederholen = screen.getByRole('button', { name: 'Erneut abrufen' });
    expect(screen.queryByRole('button', { name: 'Importieren' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Neu importieren' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();
    expect(screen.queryByText('Einsatzliste')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Demo-Daten' })).toBeInTheDocument();
    // „Erneut abrufen“ fragt wirklich neu (retry: false — ohne Klick bleibt es bei einem).
    expect(gets).toBe(1);
    await userEvent.click(wiederholen);
    await waitFor(() => expect(gets).toBe(2));
  });

  it('500: das Menü zeigt keinen Eintrag und kein Fehlerbild', async () => {
    // Entscheidung: der Eintrag hängt an „freigeschaltet“ = Status 200. Bei 500 ist das
    // unbekannt, der Eintrag fehlt also — wie bei 404. Die Sektion selbst bleibt über den
    // Deeplink erreichbar und zeigt dort das Fehlerbild (Test darüber).
    let gets = 0;
    server.use(
      http.get('/api/demo-daten', () => {
        gets += 1;
        return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
      }),
    );
    setup(admin, '/admin/stammdaten/fahrzeuge');
    await waitFor(() => expect(gets).toBe(1));
    await screen.findByText('PFAD:/admin/stammdaten/fahrzeuge');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('menuitem', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Demo-Daten' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('DemoDatenPage — nicht importiert', () => {
  it('genau eine Primäraktion „Importieren“ im Kopf, keine Aktion im Inhalt', async () => {
    demoServer(NICHT_IMPORTIERT);
    setup(admin);
    expect(await screen.findByText('Nicht importiert')).toBeInTheDocument();
    const kopf = document.querySelector<HTMLElement>('[data-lfh="adminpage-aktionen"]');
    expect(kopf).not.toBeNull();
    const knoepfe = within(kopf!).getAllByRole('button');
    expect(knoepfe).toHaveLength(1);
    expect(knoepfe[0]).toHaveAccessibleName('Importieren');
    expect(knoepfe[0]).toHaveClass('ant-btn-primary');
    expect(screen.queryByRole('button', { name: 'Neu importieren' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    // Ohne je importiert zu haben gibt es keinen Bericht.
    expect(screen.queryByRole('region', { name: 'Letzter Vorgang' })).not.toBeInTheDocument();
  });

  it('Importieren sendet POST, zeigt danach den Status und quittiert per Toast', async () => {
    const z = demoServer(NICHT_IMPORTIERT);
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Importieren' }));
    expect(await screen.findByText('24.09.2026 10:00')).toBeInTheDocument();
    expect(z.post).toBe(1);
    expect(toastsMit('Demo-Daten importiert')).toHaveLength(1);
    // Der Kopf-Slot ist bei aktivem Import leer.
    expect(document.querySelector('[data-lfh="adminpage-aktionen"]')).toBeNull();
  });
});

describe('DemoDatenPage — importiert', () => {
  it('Status mit Datum in Ortszeit und Einsatz als Link, Bericht je Art', async () => {
    demoServer(IMPORTIERT);
    setup(admin);
    const stand = await screen.findByRole('region', { name: 'Stand' });
    expect(within(stand).getByText('Importiert')).toBeInTheDocument();
    // 08:00 UTC → 10:00 in Berlin (Sommerzeit). `dayjs(s)` läse 08:00.
    expect(within(stand).getByText('24.09.2026 10:00')).toBeInTheDocument();
    const link = within(stand).getByRole('link', { name: 'ÜBUNG – Starkregen Musterstadt' });
    expect(link).toHaveAttribute('href', '/einsaetze/41');

    const bericht = screen.getByRole('region', { name: 'Letzter Vorgang' });
    expect(within(bericht).getByText('12 angelegt · 1 mitbenutzt')).toBeInTheDocument();
    expect(within(bericht).getByText('30 angelegt · 0 mitbenutzt')).toBeInTheDocument();
    expect(within(bericht).getByText('8 angelegt · 2 mitbenutzt')).toBeInTheDocument();
    expect(within(bericht).getByText('Fahrzeuge')).toBeInTheDocument();
    expect(within(bericht).getByText('Personal')).toBeInTheDocument();
    expect(within(bericht).getByText('Material')).toBeInTheDocument();

    // Keine Primäraktion im Kopf; die beiden Vorgänge stehen beim Status und sind `danger`.
    expect(document.querySelector('[data-lfh="adminpage-aktionen"]')).toBeNull();
    expect(within(stand).getByRole('button', { name: 'Neu importieren' })).toHaveClass(
      'ant-btn-dangerous',
    );
    expect(within(stand).getByRole('button', { name: 'Entfernen' })).toHaveClass(
      'ant-btn-dangerous',
    );
  });

  it('verwaister Kopf (Einsatz fehlt): neutraler Ersatztext statt leerem Link', async () => {
    demoServer(importiert(41, '', '2026-09-24 08:00:00'));
    setup(admin);
    const stand = await screen.findByRole('region', { name: 'Stand' });
    expect(within(stand).getByText('Einsatz nicht mehr vorhanden')).toBeInTheDocument();
    expect(within(stand).queryByRole('link')).not.toBeInTheDocument();
  });

  it('Entfernen: Rückfrage mit danger-Knopf, DELETE erst nach Bestätigung', async () => {
    const z = demoServer(IMPORTIERT);
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const dialog = await offenerDialog('Demo-Daten entfernen?');
    const ok = within(dialog).getByRole('button', { name: 'Endgültig entfernen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    // Die Rückfrage allein sendet nichts.
    expect(z.delete).toBe(0);
    await userEvent.click(ok);
    await waitFor(() => expect(z.delete).toBe(1));

    // Danach: nicht importiert, Bericht des Entfernens, wieder die Primäraktion im Kopf.
    const stand = await screen.findByRole('region', { name: 'Stand' });
    expect(await within(stand).findByText('Nicht importiert')).toBeInTheDocument();
    const bericht = screen.getByRole('region', { name: 'Letzter Vorgang' });
    expect(within(bericht).getByText('11 entfernt · 1 behalten')).toBeInTheDocument();
    expect(within(bericht).getByText('30 entfernt · 0 behalten')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importieren' })).toBeInTheDocument();
    expect(toastsMit('Demo-Daten entfernt')).toHaveLength(1);
  });

  it('Entfernen abbrechen sendet nichts', async () => {
    const z = demoServer(IMPORTIERT);
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const dialog = await offenerDialog('Demo-Daten entfernen?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(z.delete).toBe(0);
  });

  it('Neu importieren: Rückfrage mit danger-Knopf, POST /neu erst nach Bestätigung', async () => {
    const z = demoServer(IMPORTIERT);
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Neu importieren' }));
    const dialog = await offenerDialog('Demo-Daten neu importieren?');
    const ok = within(dialog).getByRole('button', { name: 'Ersetzen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(z.neu).toBe(0);
    await userEvent.click(ok);
    await waitFor(() => expect(z.neu).toBe(1));
    expect(await screen.findByText('24.09.2026 13:15')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ÜBUNG – Starkregen Musterstadt' })).toHaveAttribute(
      'href',
      '/einsaetze/52',
    );
    expect(toastsMit('Demo-Daten neu importiert')).toHaveLength(1);
  });
});

describe('DemoDatenPage — Fehler stehen an der Seite (LFH-345)', () => {
  it('409 beim Import: Alert an der Seite mit Servertext, nicht in der Message-Queue', async () => {
    demoServer(NICHT_IMPORTIERT);
    server.use(
      http.post('/api/demo-daten', () =>
        HttpResponse.json({ error: 'Demo-Daten sind bereits importiert' }, { status: 409 }),
      ),
    );
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Importieren' }));
    const treffer = await screen.findByText('Demo-Daten sind bereits importiert');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(treffer.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText('Import fehlgeschlagen')).toBeInTheDocument();
    expect(toastsMit('Demo-Daten sind bereits importiert')).toHaveLength(0);
    expect(toastsMit('Demo-Daten importiert')).toHaveLength(0);
  });

  it('422 beim Neu-Import: Alert an der Seite, der Dialog ist zu', async () => {
    demoServer(IMPORTIERT);
    server.use(
      http.post('/api/demo-daten/neu', () =>
        HttpResponse.json(
          { error: 'Katalogeintrag fehlt: Einheitstyp „Betreuungszug“' },
          { status: 422 },
        ),
      ),
    );
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Neu importieren' }));
    const dialog = await offenerDialog('Demo-Daten neu importieren?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ersetzen' }));
    const treffer = await screen.findByText('Katalogeintrag fehlt: Einheitstyp „Betreuungszug“');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(treffer.closest('.ant-modal')).toBeNull();
    expect(screen.getByText('Neu-Import fehlgeschlagen')).toBeInTheDocument();
    expect(toastsMit('Katalogeintrag fehlt')).toHaveLength(0);
    // Der Stand ist unverändert.
    expect(screen.getByText('24.09.2026 10:00')).toBeInTheDocument();
  });

  it('409: der Stand wird neu geladen, der Alert bleibt stehen', async () => {
    // Ein 409 heißt: jemand anderes hat den Stand schon geändert (zweiter Tab, zweiter
    // Admin). Ohne Neuladen böte die Seite weiter genau den Vorgang an, der gerade
    // gescheitert ist, und ein zweiter Klick liefe in denselben 409.
    const z = demoServer(IMPORTIERT);
    let deletes = 0;
    server.use(
      http.get('/api/demo-daten', () => {
        z.get += 1;
        // Ab dem gescheiterten DELETE liefert der Server den Stand des anderen Tabs.
        return HttpResponse.json(deletes > 0 ? ENTFERNT : IMPORTIERT);
      }),
      http.delete('/api/demo-daten', () => {
        deletes += 1;
        return HttpResponse.json({ error: 'Es sind keine Demo-Daten importiert' }, { status: 409 });
      }),
    );
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const dialog = await offenerDialog('Demo-Daten entfernen?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Endgültig entfernen' }));
    expect(await screen.findByText('Es sind keine Demo-Daten importiert')).toBeInTheDocument();
    await waitFor(() => expect(z.get).toBe(2));
    const stand = screen.getByRole('region', { name: 'Stand' });
    expect(await within(stand).findByText('Nicht importiert')).toBeInTheDocument();
    expect(screen.getByText('Entfernen fehlgeschlagen')).toBeInTheDocument();
    expect(screen.getByText('Es sind keine Demo-Daten importiert')).toBeInTheDocument();
  });

  it('der Alert geht beim nächsten Vorgang weg', async () => {
    demoServer(NICHT_IMPORTIERT);
    let erster = true;
    server.use(
      http.post('/api/demo-daten', () => {
        if (erster) {
          erster = false;
          return HttpResponse.json({ error: 'Kurz belegt' }, { status: 409 });
        }
        return undefined;
      }),
    );
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Importieren' }));
    expect(await screen.findByText('Kurz belegt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Importieren' }));
    expect(await screen.findByText('24.09.2026 10:00')).toBeInTheDocument();
    expect(screen.queryByText('Kurz belegt')).not.toBeInTheDocument();
  });
});

describe('DemoDatenPage — Netzfehler beim Vorgang', () => {
  it('nennt unter „Import fehlgeschlagen“ die Erreichbarkeit, nicht „Speichern fehlgeschlagen“', async () => {
    demoServer(NICHT_IMPORTIERT);
    server.use(http.post('/api/demo-daten', () => HttpResponse.error()));
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Importieren' }));
    expect(await screen.findByText('Import fehlgeschlagen')).toBeInTheDocument();
    const text = screen.getByText('Der Server hat nicht geantwortet. Bitte erneut versuchen.');
    expect(text.closest('.ant-message')).toBeNull();
    expect(screen.queryByText('Speichern fehlgeschlagen')).toBeNull();
  });
});

describe('DemoDatenPage — Riegel gegen doppeltes Senden', () => {
  it('zwei Klicks im selben Takt senden genau einen POST', async () => {
    demoServer(NICHT_IMPORTIERT);
    let freigeben: () => void = () => {};
    let posts = 0;
    server.use(
      http.post('/api/demo-daten', async () => {
        posts += 1;
        await new Promise<void>((r) => {
          freigeben = r;
        });
        return HttpResponse.json(IMPORTIERT, { status: 201 });
      }),
    );
    setup(admin);
    const knopf = await screen.findByRole('button', { name: 'Importieren' });
    // Zwei synchrone Klicks: react-query meldet `pending` erst im nächsten Takt, antds
    // `loading` sperrt den zweiten Klick also NICHT. Trägt nur der Riegel in der
    // Absende-Funktion.
    fireEvent.click(knopf);
    fireEvent.click(knopf);
    await waitFor(() => expect(posts).toBe(1));
    // Sichtbar gesperrt, solange der Vorgang läuft (`disabled` neben dem Riegel).
    await waitFor(() => expect(knopf).toBeDisabled());
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toBe(1);
    freigeben();
    // Quittung statt Stand: dieser Handler setzt den Serverstand nicht, das Nachladen nach
    // der Invalidierung zeigt also wieder „nicht importiert“.
    await waitFor(() => expect(toastsMit('Demo-Daten importiert')).toHaveLength(1));
    expect(posts).toBe(1);
  });
});

describe('DemoDatenPage — laufender Vorgang sperrt beide Knöpfe sichtbar', () => {
  it('während DELETE läuft, sind „Neu importieren“ und „Entfernen“ gesperrt', async () => {
    demoServer(IMPORTIERT);
    let freigeben: () => void = () => {};
    server.use(
      http.delete('/api/demo-daten', async () => {
        await new Promise<void>((r) => {
          freigeben = r;
        });
        return HttpResponse.json(ENTFERNT);
      }),
    );
    setup(admin);
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const dialog = await offenerDialog('Demo-Daten entfernen?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Endgültig entfernen' }));
    const stand = screen.getByRole('region', { name: 'Stand' });
    await waitFor(() =>
      expect(within(stand).getByRole('button', { name: 'Neu importieren' })).toBeDisabled(),
    );
    expect(within(stand).getByRole('button', { name: /Entfernen/ })).toBeDisabled();
    freigeben();
    // Quittung statt Stand: dieser Handler setzt den Serverstand nicht (siehe Doppelklick-Test).
    await waitFor(() => expect(toastsMit('Demo-Daten entfernt')).toHaveLength(1));
  });
});

describe('DemoDatenPage — Invalidierung nach dem Vorgang (D13)', () => {
  /**
   * Eigener Client mit `gcTime: Infinity`: `neuerQueryClient()` räumt unbeobachtete Einträge
   * beim ersten `await` weg (CLAUDE.md, Query-Key-Registry), und `isInvalidated` wäre dann
   * an einem Eintrag geprüft, den es nicht mehr gibt.
   */
  function clientMitFaechern() {
    const client = erzeugeQueryClient({
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    });
    const betroffen = [
      globalKeys.einsaetze(),
      globalKeys.fahrzeugeListe('alle'),
      globalKeys.fahrzeugVorschlaege(),
      globalKeys.personalListe('im-dienst'),
      globalKeys.personalVorschlaege(),
      globalKeys.materialListe('alle'),
      globalKeys.materialKategorien(),
      einsatzKeys.etb(41),
      einsatzKeys.einsatz(41),
      einsatzKeys.person(41, 3),
    ];
    const unberuehrt = [einsatzKeys.etb(99), globalKeys.benutzer(), globalKeys.qualifikationen()];
    for (const k of [...betroffen, ...unberuehrt, einsatzKeys.einsatz(52)]) {
      client.setQueryData(k, []);
    }
    return { client, betroffen, unberuehrt };
  }

  const invalidiert = (client: QueryClient, key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated;

  it('Neu importieren: Einsatzliste, Stammdaten, Status und alter wie neuer Demo-Einsatz', async () => {
    const z = demoServer(IMPORTIERT);
    const { client, betroffen, unberuehrt } = clientMitFaechern();
    setup(admin, adminDemoDatenPfad(), client);
    await userEvent.click(await screen.findByRole('button', { name: 'Neu importieren' }));
    const dialog = await offenerDialog('Demo-Daten neu importieren?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ersetzen' }));
    await waitFor(() => expect(z.neu).toBe(1));
    await waitFor(() => expect(invalidiert(client, globalKeys.einsaetze())).toBe(true));
    for (const k of [...betroffen, einsatzKeys.einsatz(52)]) {
      expect(invalidiert(client, k), JSON.stringify(k)).toBe(true);
    }
    for (const k of unberuehrt) {
      expect(invalidiert(client, k), JSON.stringify(k)).toBe(false);
    }
    // Der Status ist beobachtet: er wird nicht bloß markiert, sondern neu geladen.
    await waitFor(() => expect(z.get).toBe(2));
    // Kein `removeQueries`: die Fächer stehen noch da.
    expect(client.getQueryData(einsatzKeys.etb(41))).toEqual([]);
  });

  it('Entfernen: die ID des alten Einsatzes kommt aus dem Stand VOR dem Vorgang', async () => {
    // Die DELETE-Antwort trägt kein `import` mehr — ohne den gemerkten Stand ginge die
    // Invalidierung der Einsatz-Abfragen ins Leere.
    demoServer(IMPORTIERT);
    const { client } = clientMitFaechern();
    setup(admin, adminDemoDatenPfad(), client);
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const dialog = await offenerDialog('Demo-Daten entfernen?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Endgültig entfernen' }));
    await waitFor(() => expect(invalidiert(client, einsatzKeys.etb(41))).toBe(true));
    expect(invalidiert(client, einsatzKeys.person(41, 3))).toBe(true);
    expect(invalidiert(client, globalKeys.fahrzeugeListe('alle'))).toBe(true);
    expect(invalidiert(client, einsatzKeys.etb(99))).toBe(false);
  });
});
