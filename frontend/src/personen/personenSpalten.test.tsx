import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR } from '../offline/verbindung';
import { koordinatenText } from './koordinate';
import { effektiveDaten, pruefeKartenplan, type Kartenplan } from '../components/Datensicht';
import type { Person } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { lagebildKuerzen } from '../offline/lagebildKuerzung';
import {
  SkTag,
  abgleichSpalten,
  geschlechtAlter,
  nameText,
  personenKarte,
  personenSpalten as spaltenFabrik,
  seitWert,
  verbleibText,
  type PersonenSpaltenKey,
} from './personenSpalten';

const uhsNamen: Record<number, string> = { 7: 'Weserstadion' };
const personenSpalten = spaltenFabrik((id) => uhsNamen[id]);

/**
 * Register- und Helferprüfungen der Personenspalten: reine Funktionen (`seitWert`) ohne
 * Rendern, und die Registerform — `seit`-Spalte, derselbe `sortWert`, Kartenplan gegen das
 * Register über einen DIREKTEN Aufruf von `pruefeKartenplan`.
 */

const basis: Person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  // ABSICHTLICH ungleich `erfasst_at`: sonst bliebe ein falscher Umbau auf `geaendert_at` grün.
  geaendert_at: '2026-05-27 11:22:00',
  geaendert_von: 1,
  storniert_at: null,
};

describe('seitWert', () => {
  it('nimmt den Sichtungszeitpunkt, wenn er gesetzt ist', () => {
    const gesichtet: Person = {
      ...basis,
      aktuelle_sichtung: 'sk2',
      aktuelle_sichtung_at: '2026-05-27 09:40:00',
    };
    expect(seitWert(gesichtet)).toBe('2026-05-27 09:40:00');
  });

  it('fällt ohne Sichtung auf den Erfassungszeitpunkt zurück', () => {
    // Der Fall, der bei `p.aktuelle_sichtung_at?.` statt `??` durchfällt.
    expect(seitWert(basis)).toBe('2026-05-27 09:00:00');
  });

  it('fällt auch bei ausdrücklichem null auf den Erfassungszeitpunkt zurück', () => {
    expect(seitWert({ ...basis, aktuelle_sichtung_at: null })).toBe('2026-05-27 09:00:00');
  });

  it('liefert nie einen Leerwert — erfasst_at ist Pflichtfeld von PersonAnzeige', () => {
    // Gepinnt gegen einen Umbau auf `geaendert_at` o. ä.: eine leere Zeitangabe wäre in der
    // Spalte unsichtbar.
    for (const p of [basis, { ...basis, aktuelle_sichtung_at: null }]) {
      expect(seitWert(p)).toBeTruthy();
    }
  });
});

describe('SkTag', () => {
  it('zeigt das Etikett der Sichtungskategorie', () => {
    render(<SkTag p={{ ...basis, aktuelle_sichtung: 'sk2' }} />);
    expect(screen.getByText('SK II')).toBeInTheDocument();
  });

  it('zeigt einen Gedankenstrich, wenn nicht gesichtet ist', () => {
    render(<SkTag p={basis} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('nameText', () => {
  it('setzt Name und Vorname zusammen', () => {
    expect(nameText(basis)).toBe('Mustermann, Max');
  });

  it('ist LEERWERTIG, wenn kein Name bekannt ist — nicht „unbekannt"', () => {
    // Sonst träfe die Suche nach „unbekannt" jede namenlose Person.
    expect(nameText({ ...basis, name: null, vorname: null })).toBeNull();
  });

  it('trägt einen einzeln gesetzten Namensteil', () => {
    expect(nameText({ ...basis, vorname: null })).toBe('Mustermann');
    expect(nameText({ ...basis, name: null })).toBe(', Max');
  });
});

/** Hilfsgriff aufs Register — `key` ist Pflichtfeld, also ist das eindeutig. */
const spalte = (key: string) => personenSpalten.filter((s) => s.key === key);

describe('personenSpalten — Registerform (Neuentwurf S7)', () => {
  it('trägt die Spalten des Entwurfs — „Zustand" nach der Sichtung (LFH-613)', () => {
    expect(personenSpalten.map((s) => s.key)).toEqual([
      'reg',
      'person',
      'sk',
      'zustand',
      'status',
      'fundort',
      'verbleib',
      'transport',
      'vermerk',
      'seit',
    ]);
  });

  it('sortiert seit über DIESELBE Regel, die die Zelle zeigt', () => {
    const sortWert = spalte('seit')[0].sortWert;
    expect(sortWert).toBeDefined();
    for (const p of [basis, { ...basis, aktuelle_sichtung_at: '2026-05-27 09:40:00' }]) {
      expect(sortWert!(p)).toBe(seitWert(p));
    }
  });

  it('macht Nr. sortierbar und suchbar, in der ANZEIGE-Schreibweise, und setzt sie Mono', () => {
    const reg = spalte('reg')[0];
    // Sortiert wird über die ZAHL (sonst läge R-10 vor R-9), gesucht über den Text, den
    // jemand auch eintippt.
    expect(reg.sortWert!(basis)).toBe(1);
    expect(reg.suchText!(basis)).toBe('R-001');
    expect(reg.immerSichtbar).toBe(true);
    expect(reg.zahl).toBe(true);
    expect(spalte('seit')[0].zahl).toBe(true);
  });

  it('findet eine Person über ihre PAT-Nummer in der Spalte Nr. (LLH-1326, D12)', () => {
    const reg = personenSpalten.find((s) => s.key === 'reg')!;
    expect(reg.suchText!({ ...basis, registrier_nr: 12, pat_nummer: 'A-4711' })).toBe(
      'R-012 A-4711',
    );
    expect(reg.suchText!(basis)).toBe('R-001');
    const zeilen = [
      { ...basis, id: 1, registrier_nr: 12, pat_nummer: 'A-4711' },
      { ...basis, id: 2, registrier_nr: 13, pat_nummer: 'B-12' },
      { ...basis, id: 3, registrier_nr: 14 },
    ];
    const treffer = effektiveDaten({
      daten: zeilen,
      spalten: personenSpalten,
      sortierung: null,
      suchbegriff: '4711',
      filterWerte: {},
      baum: false,
    });
    expect(treffer.map((p) => p.registrier_nr)).toEqual([12]);
  });

  it('bricht die Nr. nie um, auch nicht in der Handschuh-Dichte (LFH-1151)', () => {
    // „R-“ / „001“ auf zwei Zeilen las sich am Gerät wie zwei Angaben. Ohne Umbruch wächst die
    // Spalte im `auto`-Layout der Fließtabelle über ihre 84 px hinaus.
    const reg = spalte('reg')[0];
    render(<>{reg.render!(undefined, basis, 0)}</>);
    expect(screen.getByText('R-001')).toHaveStyle({ whiteSpace: 'nowrap' });
  });

  it('lässt den Namen zur Suche beitragen, ohne „unbekannt" als Namen zu führen', () => {
    const person = spalte('person')[0];
    expect(person.suchText!(basis)).toBe('Mustermann, Max');
    expect(person.suchText!({ ...basis, name: null, vorname: null })).toBeFalsy();
  });

  it('staffelt die Nebenspalten über abBreite; Zeit und Verbleib tragen keine Schwelle', () => {
    expect(spalte('fundort')[0].abBreite).toBe('lg');
    expect(spalte('vermerk')[0].abBreite).toBe('xxl');
    // Eine Spalte mit Schwelle wäre in jeder jsdom-Prüfung unter 1200 px abwesend.
    expect(spalte('seit')[0].abBreite).toBeUndefined();
    expect(spalte('verbleib')[0].abBreite).toBeUndefined();
  });

  it('zeigt Person mit Geschlecht/Alter und schreibt eine Lücke als Wort aus', () => {
    const render_ = spalte('person')[0].render!;
    const { container, rerender } = render(<>{render_(undefined, basis, 0)}</>);
    expect(container.textContent).toBe('Mustermann, Maxm ~40Verbleib offen');
    rerender(
      <>
        {render_(
          undefined,
          { ...basis, aktueller_verbleib: 'entlassen', aktuelle_verbleib_art: 'entlassung' },
          0,
        )}
      </>,
    );
    expect(container.textContent).toBe('Mustermann, Maxm ~40');
    expect(container.querySelector('[data-lfh="luecke"]')).toBeNull();
  });
});

describe('geschlechtAlter / verbleibText', () => {
  it('schreibt Geschlecht und Alter in der Kurzform der Zeile', () => {
    expect(geschlechtAlter(basis)).toBe('m ~40');
    expect(geschlechtAlter({ ...basis, geschlecht: null, alter_geschaetzt: null })).toBeNull();
    // Kalenderdatum als TT.MM.JJJJ (LLH-1103, D6), Altbestand roh.
    expect(geschlechtAlter({ ...basis, geburtsdatum: '1990-01-02' })).toBe('m 02.01.1990');
    expect(geschlechtAlter({ ...basis, geburtsdatum: 'ca. 1990' })).toBe('m ca. 1990');
  });

  it('nennt die Kurzform der Art, sonst die UHS beim Namen, sonst nichts', () => {
    const name = (id: number) => uhsNamen[id];
    expect(
      verbleibText(
        {
          aktuelle_verbleib_art: 'transport',
          aktueller_verbleib: 'Transport → KH Nord',
          aktuelle_uhs_id: 7,
        },
        name,
      ),
    ).toBe('Transport → KH Nord');
    expect(verbleibText({ aktueller_verbleib: null, aktuelle_uhs_id: 7 }, name)).toBe(
      'UHS Weserstadion',
    );
    expect(verbleibText({ aktueller_verbleib: null, aktuelle_uhs_id: 99 }, name)).toBe('UHS');
    expect(verbleibText({ aktueller_verbleib: null, aktuelle_uhs_id: null }, name)).toBeNull();
  });

  it('fällt ohne Kurzform auf das Wort der Art zurück, statt „—" zu zeigen', () => {
    const name = (id: number) => uhsNamen[id];
    expect(
      verbleibText(
        { aktuelle_verbleib_art: 'notunterkunft', aktueller_verbleib: null, aktuelle_uhs_id: null },
        name,
      ),
    ).toBe('Notunterkunft');
  });
});

describe('Fundort mit Koordinate (LFH-613)', () => {
  const zelle = (p: Person) => spalte('fundort')[0].render!(undefined, p, 0);

  it('zeigt Freitext und darunter die Koordinate in Mono', () => {
    const { container } = render(
      <>{zelle({ ...basis, antreff_lat: 52.2691, antreff_lon: 9.1342 })}</>,
    );
    expect(container).toHaveTextContent('Brücke52.2691/9.1342');
    expect(container.querySelector('[data-lfh="koordinate"]')).toHaveTextContent('52.2691/9.1342');
  });

  it('zeigt die Koordinate allein ohne „—", wenn der Freitext fehlt', () => {
    const { container } = render(
      <>{zelle({ ...basis, antreff_ort: null, antreff_lat: 52.2691, antreff_lon: 9.1342 })}</>,
    );
    expect(container.textContent).toBe('52.2691/9.1342');
  });

  it('macht die Koordinate suchbar und kennt kein halbes Paar', () => {
    const such = spalte('fundort')[0].suchText!;
    expect(such({ ...basis, antreff_lat: 52.2691, antreff_lon: 9.1342 })).toBe(
      'Brücke 52.2691/9.1342',
    );
    expect(such({ ...basis, antreff_ort: null })).toBeNull();
    expect(koordinatenText({ antreff_lat: 52.2691 })).toBeNull();
  });
});

describe('Zustand-Spalte (LFH-613)', () => {
  const mitSchreibrecht = spaltenFabrik(() => undefined, { einsatzId: 1, darfSchreiben: true });
  const ohneSchreibrecht = spaltenFabrik(() => undefined, { einsatzId: 1, darfSchreiben: false });
  const zelle = (spalten: typeof personenSpalten, p: Person) =>
    spalten.find((s) => s.key === 'zustand')!.render!(undefined, p, 0) as ReactNode;

  it('bearbeitet den leeren Zustand in der Zeile: PATCH mit NUR dem Zustand (Spec-Szenario)', async () => {
    const koerper: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push(await request.json());
        return HttpResponse.json({ ...basis, zustand: 'gehfähig, unterkühlt' });
      }),
    );
    const zeilenKlick = vi.fn();
    renderMitProviders(<div onClick={zeilenKlick}>{zelle(mitSchreibrecht, basis)}</div>);

    // Die Zeilenkennung trägt den Namen — n Zeilen, n unterscheidbare Knöpfe.
    const knopf = screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' });
    expect(knopf).toHaveTextContent('Zustand / Verdacht hinzufügen');
    await userEvent.click(knopf);
    // Der Klick bleibt in der Zelle — die Zeile navigiert nicht auf die Detailseite.
    expect(zeilenKlick).not.toHaveBeenCalled();

    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, 'gehfähig, unterkühlt');
    fireEvent.blur(feld);
    await waitFor(() => expect(koerper).toHaveLength(1));
    expect(koerper[0]).toEqual({ zustand: 'gehfähig, unterkühlt' });
  });

  it('zeigt während des Speicherns den GETIPPTEN Wert mit Ladeanzeige, nicht wieder den Platzhalter (LFH-650)', async () => {
    /**
     * Bis zur Serverantwort darf bei vorher leerem Feld nicht wieder „Zustand / Verdacht hinzufügen" stehen;
     * die Antwort wird festgehalten, damit der Zwischenzustand beobachtbar ist.
     */
    let freigeben!: () => void;
    const gehalten = new Promise<void>((r) => (freigeben = r));
    server.use(
      http.patch('/api/einsaetze/1/personen/10', async () => {
        await gehalten;
        return HttpResponse.json({ ...basis, zustand: 'gehfähig' });
      }),
    );
    renderMitProviders(<>{zelle(mitSchreibrecht, basis)}</>);
    await userEvent.click(
      screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    );
    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, 'gehfähig');
    fireEvent.blur(feld);

    const knopf = await screen.findByRole('button', {
      name: 'Zustand / Verdacht zu R-001 bearbeiten',
    });
    expect(knopf).toHaveTextContent('gehfähig');
    // Warten auf die Bedingung, nicht auf den Takt (LFH-531): antds Button führt `loading` über
    // einen eigenen Zustand (`useDelayState`, gesetzt im Layout-Effekt) und trägt die Klasse erst
    // einen Commit nach Wert und Namen. `findByRole` kann genau dazwischen auflösen — im Volllauf
    // hing das an der Reihenfolge von Reacts Scheduler und RTLs `setTimeout(0)`. Die Antwort ist
    // festgehalten, die Ladeanzeige muss also stehen und bleiben.
    await waitFor(() => expect(knopf).toHaveClass('ant-btn-loading'));
    expect(knopf).toHaveTextContent('gehfähig');
    expect(
      screen.queryByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    ).toBeNull();
    freigeben();
  });

  it('hält den Laufzustand über die Serverantwort hinaus, bis der Refetch steht — kein Zurückspringen (Review LFH-650)', async () => {
    /**
     * `onSuccess` GIBT die Invalidierung zurück, react-query hält `isPending` bis zum Refetch. Hier
     * wird die Invalidierung festgehalten: die Antwort ist da, die Zelle muss trotzdem den
     * getippten Wert zeigen.
     */
    const koerper: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push(await request.json());
        return HttpResponse.json({ ...basis, zustand: 'gehfähig' });
      }),
    );
    const client = new QueryClient();
    let freigeben!: () => void;
    const gehalten = new Promise<void>((r) => (freigeben = r));
    vi.spyOn(client, 'invalidateQueries').mockImplementation(() => gehalten);
    renderMitProviders(<>{zelle(mitSchreibrecht, basis)}</>, { client });
    await userEvent.click(
      screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'gehfähig');
    fireEvent.blur(screen.getByRole('textbox'));

    await waitFor(() => expect(koerper).toHaveLength(1));
    await waitFor(() => expect(client.invalidateQueries).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    const knopf = screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 bearbeiten' });
    expect(knopf).toHaveTextContent('gehfähig');
    expect(knopf).toHaveClass('ant-btn-loading');
    freigeben();
    // Gegenhälfte: steht der Refetch, endet der Laufzustand (ohne neue Daten kehrt der
    // Platzhalter zurück).
    expect(
      await screen.findByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    ).toBeInTheDocument();
  });

  it('meldet einen Fehler AN DER ZELLE statt als Toast, und der nächste Versuch räumt ihn (LFH-650)', async () => {
    /**
     * Ein Fehler steht an der Zelle (`data-fehler`) mit Grund, kein Toast; die zweite Hälfte: die
     * Marke bleibt nicht stehen.
     */
    let scheitern = true;
    server.use(
      http.patch('/api/einsaetze/1/personen/10', () =>
        scheitern
          ? HttpResponse.json({ error: 'Datenbank gesperrt' }, { status: 409 })
          : HttpResponse.json({ ...basis, zustand: 'gehfähig' }),
      ),
    );
    const { container } = renderMitProviders(<>{zelle(mitSchreibrecht, basis)}</>);
    await userEvent.click(
      screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'gehfähig');
    fireEvent.blur(screen.getByRole('textbox'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nicht gespeichert: Datenbank gesperrt',
    );
    const zellHuelle = container.querySelector('[data-lfh="zustand-zelle"]')!;
    expect(zellHuelle).toHaveAttribute('data-fehler', 'true');
    // Kein Toast mehr: die Meldung steht nirgends in antds Message-Portal.
    expect(document.querySelector('.ant-message')?.textContent ?? '').not.toContain(
      'Datenbank gesperrt',
    );

    scheitern = false;
    await userEvent.click(
      screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'gehfähig');
    fireEvent.blur(screen.getByRole('textbox'));
    await waitFor(() => expect(zellHuelle).not.toHaveAttribute('data-fehler'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('bietet einer VERMISSTEN Person keinen Zustand an — auch mit Schreibrecht', () => {
    renderMitProviders(<>{zelle(mitSchreibrecht, { ...basis, status: 'vermisst' })}</>);
    expect(screen.queryByRole('button', { name: /Zustand \/ Verdacht zu R-001/ })).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('schickt nichts, wenn der Wert unverändert bleibt (Wertgleichheits-Riegel)', async () => {
    const patch = vi.fn();
    server.use(
      http.patch('/api/einsaetze/1/personen/10', () => {
        patch();
        return HttpResponse.json(basis);
      }),
    );
    renderMitProviders(<>{zelle(mitSchreibrecht, basis)}</>);
    await userEvent.click(
      screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    );
    fireEvent.blur(screen.getByRole('textbox'));
    await new Promise((r) => setTimeout(r, 20));
    expect(patch).not.toHaveBeenCalled();
  });

  /**
   * Ohne Netz gesperrt mit Grund an der Zelle (LLH-1103, design.md D8, Spec
   * `personendaten-bearbeiten`, „Ohne Netz gesperrt“): die Mutation liefe mit `networkMode:
   * 'online'` in die Pause und überschriebe nach der Rückkehr still einen Wert, den niemand
   * gesehen hat. Ein getippter Entwurf bleibt stehen.
   */
  it('ohne Netz gesperrt mit Grund an der Zelle', async () => {
    renderMitProviders(<>{zelle(mitSchreibrecht, { ...basis, zustand: 'gehfähig' })}</>);
    setzeOnline(false);
    try {
      // Mutationsprobe: Sperre in `ZustandSchreiben` entfernt — der Knopf bleibt bedienbar, rot.
      const knopf = screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 bearbeiten' });
      await waitFor(() => expect(knopf).toBeDisabled());
      expect(screen.getByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeVisible();
      expect(knopf).toHaveAccessibleDescription(`gehfähig ${OHNE_VERBINDUNG_NICHT_AENDERBAR}`);
    } finally {
      setzeOnline(true);
    }
  });

  it('ohne Netz bleibt ein getippter Entwurf stehen und geht nicht nachträglich hinaus', async () => {
    const koerper: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        koerper.push(await request.json());
        return HttpResponse.json({ ...basis, zustand: 'gehfähig' });
      }),
    );
    renderMitProviders(<>{zelle(mitSchreibrecht, basis)}</>);
    await userEvent.click(
      screen.getByRole('button', { name: 'Zustand / Verdacht zu R-001 hinzufügen' }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'gehfähig');
    setzeOnline(false);
    try {
      expect(await screen.findByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeVisible();
      fireEvent.blur(screen.getByRole('textbox'));
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.getByRole('textbox')).toHaveValue('gehfähig');
    } finally {
      setzeOnline(true);
    }
    // Mutationsprobe: das Senden ohne Netz nicht sperren — die pausierte Mutation holt nach der
    // Rückkehr still nach, rot.
    await new Promise((r) => setTimeout(r, 30));
    expect(koerper).toEqual([]);
    fireEvent.blur(screen.getByRole('textbox'));
    await waitFor(() => expect(koerper).toEqual([{ zustand: 'gehfähig' }]));
  });

  it('bleibt ohne Schreibrecht reine Anzeige — Wert oder „—", kein Knopf', () => {
    const { container, rerender } = renderMitProviders(
      <>{zelle(ohneSchreibrecht, { ...basis, zustand: 'Beinfraktur' })}</>,
    );
    expect(container).toHaveTextContent('Beinfraktur');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<>{zelle(ohneSchreibrecht, basis)}</>);
    expect(container.textContent).toBe('—');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ist ohne Bedienung (Fabrik mit nur uhsName) ebenfalls nur Anzeige', () => {
    renderMitProviders(<>{zelle(personenSpalten, basis)}</>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ohne Netz nicht geladene Felder (LFH-1095)', () => {
  const mitSchreibrecht = spaltenFabrik(() => undefined, { einsatzId: 1, darfSchreiben: true });
  const voll: Person = {
    ...basis,
    zustand: 'unterkühlt',
    notiz: 'Diabetiker',
    antreff_lat: 52.2691,
    antreff_lon: 9.1342,
  };
  const [gekuerzt] = lagebildKuerzen({
    queryKey: [...einsatzKeys.personen(1)],
    state: { data: [voll] },
  }).state.data as Person[];
  const zelle = (key: string, p: Person, spalten = personenSpalten) =>
    spalten.find((s) => s.key === key)!.render!(undefined, p, 0) as ReactNode;

  it('zeigt Fundort, Zustand und Vermerk als „nicht geladen", nicht als leer', () => {
    for (const key of ['fundort', 'zustand', 'vermerk']) {
      const { container, unmount } = renderMitProviders(<>{zelle(key, gekuerzt)}</>);
      expect(container.textContent).toBe('nicht geladen');
      unmount();
    }
  });

  it('bietet den nicht geladenen Zustand nicht zum Bearbeiten an — auch mit Schreibrecht', () => {
    renderMitProviders(<>{zelle('zustand', gekuerzt, mitSchreibrecht)}</>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('nicht geladen')).toBeInTheDocument();
  });

  it('nennt einen nicht geladenen Fundort nicht „offen"', () => {
    const { container } = renderMitProviders(
      <>{zelle('person', { ...gekuerzt, aktuelle_verbleib_art: 'transport' })}</>,
    );
    expect(container.querySelector('[data-lfh="luecke"]')).toBeNull();
  });
});

describe('personenKarte', () => {
  it('geht gegen das Register auf — inklusive Abgleichspalte', () => {
    // DIREKTER Aufruf, kein console-Spion: `pruefeKartenplan` fängt das `const K`-Widening, das der
    // Typ nicht sieht, wenn eine Spaltenliste annotiert statt durch `spaltenFuer` geführt wird.
    expect(
      pruefeKartenplan({ spalten: personenSpalten, karte: personenKarte(1) }, 'Personen'),
    ).toEqual([]);
    expect(
      pruefeKartenplan(
        {
          spalten: [...personenSpalten, ...abgleichSpalten([], () => {})],
          karte: personenKarte(1),
        },
        'Personen',
      ),
    ).toEqual([]);
  });

  it('verlinkt den Titel auf die Personen-Detailseite', () => {
    const karte = personenKarte(7);
    if (karte.art !== 'plan') throw new Error('personenKarte ist ein Plan, kein Eigenbau');
    expect(karte.titel.spalte).toBe('reg');
    expect(karte.titel.ziel!(basis)).toBe('/einsaetze/7/personen/10');
  });

  it('führt Person, Sichtung und Zeit als Sekundärfelder, den Status im Status-Slot', () => {
    // Ohne `seit` blieb das Register grün, während die Zeit aus dem Kartenplan verschwand. `person`
    // trägt im Kartenzweig den Lückenvermerk.
    const karte = personenKarte(1);
    if (karte.art !== 'plan') throw new Error('personenKarte ist ein Plan, kein Eigenbau');
    expect(karte.sekundaer).toEqual(['person', 'sk', 'seit']);
    expect(karte.status!({ ...basis, status: 'vermisst' })).toMatchObject({ label: 'vermisst' });
  });

  it('lehnt einen Tippfehler im Sekundärslot schon am Typcheck ab', () => {
    /**
     * Der Riegel VOR der Laufzeit, und er ist selbsttragend: weitet `K` auf `string` (weil
     * jemand die Spaltenliste annotiert statt sie durch `spaltenFuer` zu führen), dann
     * kompiliert die Zeile darunter — und `@ts-expect-error` wird selbst zum tsc-Fehler
     * („unused directive"). Diese Prüfung kann also nur an EINER Stelle grün sein.
     */
    const kaputt: Kartenplan<Person, PersonenSpaltenKey> = {
      art: 'plan',
      titel: { spalte: 'reg' },
      // @ts-expect-error 'seitt' ist kein Schlüssel des Registers
      sekundaer: ['seitt'],
    };
    expect(kaputt.art).toBe('plan');
  });

  it('meldet einen Tippfehler im Kartenplan, statt ihn zu schlucken', () => {
    // Gegenprobe zur Zusicherung oben: ohne sie wäre `toEqual([])` auch bei einem
    // wirkungslosen `pruefeKartenplan` grün.
    const befunde = pruefeKartenplan(
      {
        spalten: personenSpalten,
        karte: { art: 'plan', titel: { spalte: 'reg' }, sekundaer: ['seitt' as 'seit'] },
      },
      'Personen',
    );
    expect(befunde).toHaveLength(1);
    expect(befunde[0]).toContain('seitt');
  });
});

describe('Spalte „Transport“ (LLH-1325, design.md D10)', () => {
  const mit = (nr: number, over: Partial<Person> = {}): Person => ({
    ...basis,
    id: nr,
    registrier_nr: nr,
    ...over,
  });
  const zeilen = [
    mit(1),
    mit(2, { transport_prioritaet: 'normal', transport_art: 'sitzend' }),
    mit(3, { transport_prioritaet: 'sofort', transport_art: 'liegend' }),
    mit(4, { transport_art: 'mit_notarzt' }),
    mit(5, { transport_prioritaet: 'dringlich' }),
  ];
  const sortiert = (richtung: 'auf' | 'ab') =>
    effektiveDaten({
      daten: zeilen,
      spalten: personenSpalten,
      sortierung: { spalte: 'transport', richtung },
      suchbegriff: '',
      filterWerte: {},
      baum: false,
    }).map((p) => p.registrier_nr);

  it('hält das Fließspalten-Budget: feste Zahlbreite, keine zweite Fließspalte', () => {
    const [transport] = spalte('transport');
    expect(transport.title).toBe('Transport');
    expect(typeof transport.width).toBe('number');
    expect(transport.mindestBreite).toBeUndefined();
    expect(transport.abBreite).toBe('lg');
  });

  it('sortiert nach dem Rang der Priorität, ohne Priorität in beiden Richtungen hinten', () => {
    expect(sortiert('auf')).toEqual([3, 5, 2, 1, 4]);
    expect(sortiert('ab').slice(0, 3)).toEqual([2, 5, 3]);
    expect(sortiert('ab').slice(3).sort()).toEqual([1, 4]);
  });

  it('zeigt die Priorität als neutrale Marke mit Wort und die Art dahinter', () => {
    const [transport] = spalte('transport');
    const { container, rerender } = render(<>{transport.render!(undefined, zeilen[2], 0)}</>);
    expect(screen.getByText('sofort').closest('.ant-tag')).not.toBeNull();
    expect(container).toHaveTextContent('sofort liegend');
    rerender(<>{transport.render!(undefined, zeilen[3], 0)}</>);
    expect(container).toHaveTextContent('mit Notarzt');
    expect(container.querySelector('.ant-tag')).toBeNull();
    rerender(<>{transport.render!(undefined, zeilen[0], 0)}</>);
    expect(container).toHaveTextContent('—');
    expect(transport.suchText!(zeilen[2])).toBe('sofort liegend');
  });

  it('die Vorgabe-Sortierung der Liste bleibt die Zeit', () => {
    expect(spalte('seit')[0].sortWert).toBe(seitWert);
  });
});

describe('Marke „kontaminiert“ (LLH-1326, design.md D11)', () => {
  it('steht in der Personenzelle nur bei „ja“, mit Wort und Rolle achtung', () => {
    const render_ = spalte('person')[0].render!;
    const { container, rerender } = render(
      <>{render_(undefined, { ...basis, kontamination: true }, 0)}</>,
    );
    const marke = screen.getByText('kontaminiert');
    expect(marke.closest('[data-rolle="achtung"]')).not.toBeNull();
    for (const kontamination of [false, undefined]) {
      rerender(<>{render_(undefined, { ...basis, kontamination }, 0)}</>);
      expect(container).not.toHaveTextContent('kontaminiert');
    }
  });
});
