import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ArchivAkte, ArchivEtbEintrag, AufbewahrungZustand } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ArchivAktePage, { archivHinweis, berichtigungText } from './ArchivAktePage';

/** Archivakte (LFH-23, tasks.md 6.9). */

const ME_ADMIN = { id: 1, anzeigename: 'Admin', system_rolle: 'admin', org_rolle: 'keine' };

function akte(zustand: AufbewahrungZustand): ArchivAkte {
  return {
    kopf: {
      id: 7,
      bezeichnung: 'Hochwasser Nord',
      einsatzart: 'realeinsatz',
      einsatznummer_intern: 'E-2026-0007',
      begonnen_at: '2026-05-01 08:00:00',
      abgeschlossen_at: '2026-05-01 18:00:00',
      retention_bis: '2026-06-01 18:00:00',
      geloescht_at: zustand === 'vorgemerkt' ? '2026-06-01 18:10:00' : undefined,
    },
    zustand,
    karenz_ende: zustand === 'vorgemerkt' ? '2026-07-01 18:10:00' : undefined,
    personen: [
      {
        registrier_nr: 1,
        registrier_anzeige: 'R-001',
        status: 'betroffen',
        aktuelle_sichtung: 'sk2',
        aktuelle_verbleib_art: 'transport',
        erfasst_at: '2026-05-01 09:00:00',
      },
    ],
    tiere: [],
    schaeden: [
      {
        registrier_nr: 1,
        registrier_anzeige: 'S-001',
        typ: 'sachschaden',
        ausmass: 'mittel',
        status: 'abgeschlossen',
        abschluss_grund: 'behoben',
        erfasst_at: '2026-05-01 10:00:00',
      },
    ],
  };
}

function eintrag(lfd: number, over: Partial<ArchivEtbEintrag> = {}): ArchivEtbEintrag {
  return {
    id: 1000 + lfd,
    lfd_nr: lfd,
    typ: 'meldung',
    inhalt: `Eintrag ${lfd}`,
    erfasser_id: 1,
    erfasser_name: 'Anna',
    ereigniszeit: '2026-05-01 10:00:00',
    received_at: '2026-05-01 10:00:00',
    ...over,
  };
}

let etbAufrufe: string[];

function zeige(
  zustand: AufbewahrungZustand,
  seiten?: ArchivEtbEintrag[][],
  route = '/admin/aufbewahrung/7',
) {
  etbAufrufe = [];
  const vorgabe = [
    [eintrag(3), eintrag(2, { typ: 'berichtigung', berichtigt_eintrag_id: 1001 }), eintrag(1)],
  ];
  const liste = seiten ?? vorgabe;
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(ME_ADMIN)),
    http.get('/api/aufbewahrung/einsaetze/7', () => HttpResponse.json(akte(zustand))),
    http.get('/api/aufbewahrung/einsaetze/7/etb', ({ request }) => {
      const url = new URL(request.url);
      etbAufrufe.push(url.search);
      const vor = url.searchParams.get('before_lfd_nr');
      return HttpResponse.json(vor == null ? liste[0] : (liste[1] ?? []));
    }),
  );
  function Ort() {
    return <output aria-label="Ort">{useLocation().pathname}</output>;
  }
  return renderMitProviders(
    <Routes>
      <Route path="/admin/aufbewahrung/:einsatzId" element={<ArchivAktePage />} />
      <Route path="/admin/aufbewahrung" element={<Ort />} />
    </Routes>,
    { route },
  );
}

async function kopfAktionen(): Promise<HTMLElement[]> {
  await screen.findByText('Hochwasser Nord', { exact: false });
  const slot = document.querySelector<HTMLElement>('[data-lfh="adminpage-aktionen"]');
  return slot ? within(slot).queryAllByRole('button') : [];
}

describe('ArchivAktePage — genau eine Primäraktion je Zustand', () => {
  it.each([
    ['ohne_frist', 'Frist ändern'],
    ['frist_laeuft', 'Frist ändern'],
    ['faellig', 'Frist ändern'],
    ['vorgemerkt', 'Wiederherstellen'],
  ] as const)('%s → „%s“', async (zustand, knopf) => {
    zeige(zustand);
    const knoepfe = await kopfAktionen();
    expect(knoepfe.map((k) => k.textContent)).toEqual([knopf]);
    expect(knoepfe[0]).toHaveClass('ant-btn-primary');
  });

  it.each(['schwaerzung_ausstehend', 'geschwaerzt'] as const)('%s → keine', async (zustand) => {
    zeige(zustand);
    expect(await kopfAktionen()).toEqual([]);
  });

  it('Wiederherstellen öffnet den Dialog', async () => {
    zeige('vorgemerkt');
    const [knopf] = await kopfAktionen();
    await userEvent.click(knopf);
    expect(
      await screen.findByRole('dialog', { name: 'E-2026-0007 wiederherstellen' }),
    ).toBeInTheDocument();
  });
});

describe('ArchivAktePage — Inhalt', () => {
  it('Register mit Registriernummer und Kategorie, Zustand mit Wort', async () => {
    zeige('vorgemerkt');
    expect(await screen.findByText('R-001')).toBeInTheDocument();
    expect(screen.getByText('S-001')).toBeInTheDocument();
    expect(screen.getByText('Keine Tiere erfasst')).toBeInTheDocument();
    expect(screen.getAllByText('zur Löschung vorgemerkt').length).toBeGreaterThan(0);
  });

  it('die Zeitachse trägt keine Links, der Berichtigungsverweis steht als Text', async () => {
    zeige('geschwaerzt');
    const achse = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-lfh="archiv-zeitachse"]');
      if (!el) throw new Error('Zeitachse fehlt');
      return el;
    });
    expect(within(achse).getByText('Eintrag 3')).toBeInTheDocument();
    expect(within(achse).getByText('berichtigt Nr. 1')).toBeInTheDocument();
    expect(achse.querySelectorAll('a')).toHaveLength(0);
  });

  it('„Ältere laden“ hängt die nächste Seite an (Cursor über lfd_nr)', async () => {
    const erste = Array.from({ length: 100 }, (_, i) => eintrag(200 - i));
    const zweite = [eintrag(100), eintrag(99)];
    zeige('geschwaerzt', [erste, zweite]);
    await userEvent.click(await screen.findByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByText('Eintrag 99')).toBeInTheDocument();
    expect(screen.getByText('Eintrag 200')).toBeInTheDocument();
    expect(etbAufrufe[1]).toContain('before_lfd_nr=101');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull());
  });

  it('ein gescheitertes „Ältere laden“ meldet sich unter der Liste', async () => {
    const erste = Array.from({ length: 100 }, (_, i) => eintrag(200 - i));
    zeige('geschwaerzt', [erste]);
    server.use(
      http.get('/api/aufbewahrung/einsaetze/7/etb', ({ request }) =>
        new URL(request.url).searchParams.get('before_lfd_nr') == null
          ? HttpResponse.json(erste)
          : HttpResponse.json({ error: 'Datenbank ausgelastet' }, { status: 503 }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByText('Ältere Einträge nicht ladbar')).toBeInTheDocument();
    expect(screen.getByText('Datenbank ausgelastet')).toBeInTheDocument();
    // Die geladene Seite bleibt lesbar.
    expect(screen.getByText('Eintrag 200')).toBeInTheDocument();
  });

  it('eine ungültige id leitet auf die Übersicht', async () => {
    zeige('geschwaerzt', undefined, '/admin/aufbewahrung/abc');
    expect(await screen.findByLabelText('Ort')).toHaveTextContent('/admin/aufbewahrung');
  });
});

describe('berichtigungText', () => {
  it('nennt die laufende Nummer oder, ohne geladenen Grundeintrag, keinen Schlüssel', () => {
    const e = eintrag(5, { typ: 'berichtigung', berichtigt_eintrag_id: 42 });
    expect(berichtigungText(e, new Map([[42, 3]]))).toBe('berichtigt Nr. 3');
    expect(berichtigungText(e, new Map())).toBe('berichtigt einen älteren Eintrag');
    expect(berichtigungText(eintrag(6), new Map())).toBeNull();
  });
});

describe('archivHinweis', () => {
  const zeit = (s: string) => `Z(${s})`;
  it('nennt Nachtrag, Berichtigung und Veranlassung als Text', () => {
    const e = eintrag(5, {
      typ: 'berichtigung',
      berichtigt_eintrag_id: 42,
      ereigniszeit: '2026-05-01 10:00:00',
      received_at: '2026-05-01 11:30:00',
      veranlassung: 'Lagebesprechung',
    });
    expect(archivHinweis(e, new Map([[42, 3]]), zeit)).toBe(
      'nachgetragen um Z(2026-05-01 11:30:00) · berichtigt Nr. 3 · Veranlassung: Lagebesprechung',
    );
  });

  it('ohne Angaben keine Hinweiszeile', () => {
    expect(archivHinweis(eintrag(6), new Map(), zeit)).toBeUndefined();
  });
});
