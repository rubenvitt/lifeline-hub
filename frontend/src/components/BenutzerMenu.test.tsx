/**
 * Das Benutzermenü (LFH-329 · B1/M12, LFH-392).
 *
 * ZWEI SORTEN AUSSAGE, nicht vermischen:
 *
 * 1. BREITENABHÄNGIG ist nur der TRIGGER — schmal schrumpft er auf die Initialen (kein Name,
 *    kein Chevron). Das tragen die Blöcke je Breite.
 * 2. BREITENUNABHÄNGIG sind die drei Leisten der Gruppe „Anzeige“ im Dropdown (LLH-1642): der
 *    EINZIGE sichtbare Bedienweg für Farbschema, Bediendichte und Helligkeit mit aktivem Wert.
 *    Sie stehen im über beide Breiten parametrisierten Block unten.
 *
 * Die Leisten sind nicht verzichtbar: A1 weist Tablet und Handschirm `komfortabel` und
 * `handschuh` zu, und die Kommandopalette zeigt keinen AKTIVEN Wert an.
 *
 * JEDE NULLAUSSAGE BRAUCHT IHRE POSITIVE GEGENPROBE mit derselben Abfrage: eine reine
 * `queryBy…`-Null ist auch bei falscher Beschriftung grün.
 *
 * `setzeViewportBreite` läuft VOR dem Render: antds Beobachter liest beim Abonnieren nur
 * `matches`.
 */
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { ThemeModeProvider, useWarnsperre } from '../theme/ThemeModeProvider';
import BenutzerMenu from './BenutzerMenu';
import { adminFixture } from '../test/fixtures';

/** Zwei Wörter, damit die Initialen (erstes + letztes Wort) prüfbar sind. */
const ANZEIGENAME = 'Chef Dienst';
const INITIALEN = 'CD';

const benutzer = adminFixture({ anzeigename: ANZEIGENAME });

function zeige() {
  server.use(meHandler(benutzer));
  return renderMitProviders(
    <ThemeModeProvider>
      <BenutzerMenu />
    </ThemeModeProvider>,
  );
}

/** Der Trigger, über sein `aria-label` — daran hängt auch AppLayout.test.tsx. */
function trigger() {
  return screen.findByRole('button', { name: 'Benutzermenü' });
}

async function oeffne() {
  await userEvent.click(await trigger());
}

// `setup.ts` räumt den Speicher, nicht das Merkmalsverzeichnis am `<html>` — sonst erbte der
// nächste Test die zuletzt geklickte Stufe.
afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
});

describe('BenutzerMenu — ab xl', () => {
  // Der Name steht erst ab `xl` (1200 px) im Trigger; der Vorgabe-Viewport des Stubs ist 1024 px.
  beforeEach(() => setzeViewportBreite(1366));

  it('der Trigger trägt den Anzeigenamen', async () => {
    zeige();
    // Am TRIGGER geprüft: der Name steht auch in der Kopfgruppe des Dropdowns.
    expect((await trigger()).textContent).toContain(ANZEIGENAME);
  });

  it('der Trigger trägt die Funktion statt des Namens, wenn sie bekannt ist (Neuentwurf)', async () => {
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu funktion="S2 Lage" />
      </ThemeModeProvider>,
    );
    const knopf = await trigger();
    expect(knopf.textContent).toContain('S2 Lage');
    expect(knopf.textContent).toContain(INITIALEN);
    expect(knopf.textContent).not.toContain(ANZEIGENAME);
    // Der zugängliche Name bleibt — daran hängen die Layout-Suiten.
    expect(knopf).toHaveAttribute('aria-label', 'Benutzermenü');
  });

  /*
   * LLH-1272: im Einsatzrahmen kommt die Funktion erst mit dem Einsatz, davor steht der Name. An der
   * Umbruchkante des Kopfs brachen 4 px Unterschied („Administrator“ → „Einsatzleitung“) ihn auf
   * zwei Zeilen um, und die Seite sprang (CLS 0,556). Die Gegenprobe ohne `hasFixedWidth` hält die
   * Breite frei, damit der Test nicht an einer immer gesetzten Breite grün wird.
   */
  it.each([
    ['ohne Funktion (Einsatz lädt)', undefined],
    ['mit Funktion', 'Einsatzleitung'],
  ])('mit hasFixedWidth hält das Etikett seine Breite, %s', async (_fall, funktion) => {
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu funktion={funktion} hasFixedWidth />
      </ThemeModeProvider>,
    );
    const etikett = (await screen.findByText(funktion ?? ANZEIGENAME)) as HTMLElement;
    expect(etikett.style.width).toBe('120px');
    // Ohne `inline-block` griffe die Breite im Inline-`span` von antds Knopf nicht (gemessen:
    // das Etikett blieb so breit wie sein Text); die Wirkung belegt `e2e/rahmen-cls-dichte.spec.ts`.
    expect(etikett.style.display).toBe('inline-block');
    expect(etikett.style.textOverflow).toBe('ellipsis');
    // Was „…“ abschneidet, steht ganz im `title`.
    expect(etikett).toHaveAttribute('title', funktion ?? ANZEIGENAME);
  });

  it('ohne hasFixedWidth richtet sich das Etikett nach seinem Text', async () => {
    zeige();
    const etikett = (await screen.findByText(ANZEIGENAME)) as HTMLElement;
    expect(etikett.style.width).toBe('');
    expect(etikett.style.maxWidth).toBe('180px');
    expect(etikett).not.toHaveAttribute('title');
  });

  it('zeigt die gebaute Frontend-Version sichtbar im Dropdown', async () => {
    zeige();
    await oeffne();
    expect(await screen.findByText(/^Version \d+\.\d+\.\d+/)).toBeInTheDocument();
  });
});

describe('BenutzerMenu — Führungs-Tablet zwischen lg und xl', () => {
  // 1024 px: die Kopfzeile soll einzeilig bleiben.
  beforeEach(() => setzeViewportBreite(1024));

  it('der Trigger trägt nur die Initialen — die Funktion steht im zugänglichen Namen nicht', async () => {
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu funktion="S2 Lage" />
      </ThemeModeProvider>,
    );
    const knopf = await trigger();
    expect(knopf.textContent).toContain(INITIALEN);
    expect(knopf.textContent).not.toContain('S2 Lage');
    expect(knopf).toHaveAttribute('aria-label', 'Benutzermenü');
  });
});

describe('BenutzerMenu — unter lg', () => {
  // Breite VOR dem Render setzen (siehe Dateikopf).
  beforeEach(() => setzeViewportBreite(390));

  it('der Trigger schrumpft auf die Initialen — kein Name, kein Chevron', async () => {
    zeige();
    const knopf = await trigger();
    expect(knopf.textContent).not.toContain(ANZEIGENAME);
    expect(knopf.textContent).toContain(INITIALEN);
    // Das `aria-label` bleibt: AppLayout.test.tsx und EinsatzLayout.test.tsx greifen den Trigger
    // darüber.
    expect(knopf).toHaveAttribute('aria-label', 'Benutzermenü');
  });

  it('hält die A1-Trefffläche (Gate 3: ≥ 24 px in der kurzen Achse)', async () => {
    zeige();
    // jsdom rechnet kein Layout — geprüft wird die gesetzte Höhe; die gerenderte Fläche belegt
    // `e2e/kopfzeile-schmal.spec.ts`.
    expect((await trigger()).style.height).toBe('40px');
  });

  it('Profil und Abmelden bleiben erreichbar', async () => {
    // Die Leisten kommen HINZU, sie ersetzen nichts.
    zeige();
    await oeffne();
    // Regex, nicht exakt: aus der Zeit, als antds Symbol-Span ein eigenes `aria-label` (`user`,
    // `logout`) trug. Die Icons des Satzes sind `aria-hidden` (LFH-595); die Einträge der zwei
    // Gruppen werden exakt geprüft.
    expect(await screen.findByRole('menuitem', { name: /Profil/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Abmelden/ })).toBeInTheDocument();
  });
});

/**
 * LFH-952 (U89), LLH-1642: Profil und Abmelden stehen DIREKT unter dem Kopf, vor der Gruppe
 * „Anzeige“; danach Benachrichtigungen, Neuigkeiten, Hilfe. Rückmeldung und Lizenzen stehen auf
 * der Hilfe-Seite (Spec `benutzermenue`). Die Lage im Fenster misst
 * `e2e/rahmen-stehen-bleiben.spec.ts`, hier die Reihenfolge.
 */
describe('BenutzerMenu — Aufbau (LFH-952, LLH-1642)', () => {
  beforeEach(() => setzeViewportBreite(390));

  it('Einträge in Reihenfolge, die Gruppe „Anzeige“ zwischen Abmelden und Benachrichtigungen', async () => {
    zeige();
    await oeffne();
    const eintraege = await screen.findAllByRole('menuitem');
    expect(eintraege.map((e) => e.textContent)).toEqual([
      'Profil',
      'Abmelden',
      'Benachrichtigungen',
      'Neuigkeiten',
      'Hilfe',
    ]);
    const anzeige = screen.getByRole('group', { name: 'Anzeige' });
    const vor = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(vor(eintraege[1]!, anzeige)).toBe(true);
    expect(vor(anzeige, eintraege[2]!)).toBe(true);
  });

  it.each([
    [390, 'kompakt', 'calc(100vw - 16px)'],
    [1024, 'kompakt', '320px'],
    [390, 'handschuh', 'calc(100vw - 16px)'],
    [1024, 'handschuh', '480px'],
  ])('Menübreite bei %i px in %s: %s (LLH-1642 D12)', async (breite, dichte, erwartet) => {
    localStorage.setItem('lifeline-hub.dichte', dichte);
    setzeViewportBreite(breite);
    zeige();
    await oeffne();
    expect((await screen.findByRole('menu')).style.width).toBe(erwartet);
  });

  it('kein Eintrag „Rückmeldung“ und keiner „Lizenzen“ — die stehen auf der Hilfe-Seite', async () => {
    zeige();
    await oeffne();
    // Positive Gegenprobe mit derselben Abfrage: die Einträge sind geladen.
    expect(await screen.findByRole('menuitem', { name: 'Hilfe' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Rückmeldung/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Lizenzen/ })).not.toBeInTheDocument();
  });

  it('„Hilfe“ öffnet die Hilfe-Seite und gibt die Herkunft mit (LFH-1096, LLH-1642 D5)', async () => {
    server.use(meHandler(benutzer));
    function HilfeSeite() {
      const { state } = useLocation() as { state: { von?: string } | null };
      return <h1>Hilfe von {state?.von ?? '—'}</h1>;
    }
    renderMitProviders(
      <ThemeModeProvider>
        <Routes>
          <Route path="/einsatz/:id/etb" element={<BenutzerMenu />} />
          <Route path="/hilfe" element={<HilfeSeite />} />
        </Routes>
      </ThemeModeProvider>,
      { route: '/einsatz/42/etb' },
    );
    await oeffne();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hilfe' }));
    expect(
      await screen.findByRole('heading', { name: 'Hilfe von /einsatz/42/etb' }),
    ).toBeInTheDocument();
  });

  it('„Benachrichtigungen“ öffnet die eigenen Einstellungen (kcjecn9e D6)', async () => {
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <Routes>
          <Route path="/" element={<BenutzerMenu />} />
          <Route path="/benachrichtigungen" element={<h1>Benachrichtigungen-Seite</h1>} />
        </Routes>
      </ThemeModeProvider>,
    );
    await oeffne();
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Benachrichtigungen$/ }));
    expect(
      await screen.findByRole('heading', { name: 'Benachrichtigungen-Seite' }),
    ).toBeInTheDocument();
  });

  /*
   * D11 (LLH-1642): im Handschuh-Betrieb ist der App-Kopf am Handy zweizeilig; damit die drei
   * Leisten ohne Rollen ins Fenster passen, stehen Profil und Abmelden nebeneinander und der Kopf
   * rückt zusammen. Die Lage im Fenster misst `e2e/benutzermenue.spec.ts`; hier die Form, mit der
   * Gegenprobe `komfortabel` (dieselbe Abfrage, untereinander).
   */
  it.each([
    ['handschuh', true],
    ['komfortabel', false],
  ])(
    'Dichte %s: Profil und Abmelden nebeneinander = %s, beide wählbar',
    async (dichte, nebeneinander) => {
      localStorage.setItem('lifeline-hub.dichte', dichte);
      zeige();
      await oeffne();
      const profil = await screen.findByRole('menuitem', { name: 'Profil' });
      const abmelden = screen.getByRole('menuitem', { name: 'Abmelden' });
      for (const eintrag of [profil, abmelden]) {
        expect(eintrag.style.display).toBe(nebeneinander ? 'inline-flex' : '');
        expect(eintrag.style.width).toBe(nebeneinander ? 'calc(50% - 4px)' : '');
      }
      const kopf = screen.getByTestId('benutzermenue-kopf');
      // Knapper Kopf: Benutzername und Version in einer Zeile.
      expect(kopf.textContent).toContain(`@${benutzer.benutzername}`);
      expect(
        within(kopf).queryByText(`@${benutzer.benutzername} · Version ${__APP_VERSION__}`),
      ).toEqual(nebeneinander ? expect.anything() : null);
      expect(within(kopf).getAllByText(new RegExp(`Version ${__APP_VERSION__}`))).toHaveLength(1);
    },
  );

  it('der Menükopf nennt die Funktion auch unter xl', async () => {
    setzeViewportBreite(1024);
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu funktion="S2 Lage" />
      </ThemeModeProvider>,
    );
    await oeffne();
    const kopf = await screen.findByTestId('benutzermenue-kopf');
    expect(kopf.textContent).toContain('S2 Lage');
    expect(kopf.textContent).toContain(ANZEIGENAME);
  });

  it('ohne Funktion steht im Menükopf keine leere Funktionszeile', async () => {
    zeige();
    await oeffne();
    const kopf = await screen.findByTestId('benutzermenue-kopf');
    expect(kopf.textContent).toContain(ANZEIGENAME);
    expect(kopf.querySelector('[data-lfh="benutzermenue-funktion"]')).toBeNull();
  });
});

/** LFH-387: „Abmelden“ aus einem veralteten Tab beendet keine fremde Sitzung und verlässt die
 *  Seite nicht — der Server lehnt mit 412 ab, der Tab zeigt den Benutzerkonflikt. */
describe('Abmelden', () => {
  function zeigeMitAnmeldeseite(logoutStatus: number) {
    server.use(
      meHandler(benutzer),
      http.post('/api/auth/logout', () =>
        logoutStatus === 204
          ? new HttpResponse(null, { status: 204 })
          : HttpResponse.json({ error: 'fremd' }, { status: logoutStatus }),
      ),
    );
    return renderMitProviders(
      <ThemeModeProvider>
        <Routes>
          <Route path="/login" element={<div>Anmeldeseite</div>} />
          <Route path="*" element={<BenutzerMenu />} />
        </Routes>
      </ThemeModeProvider>,
    );
  }

  it('führt nach dem Abmelden zur Anmeldeseite', async () => {
    zeigeMitAnmeldeseite(204);
    await oeffne();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Abmelden/ }));
    expect(await screen.findByText('Anmeldeseite')).toBeInTheDocument();
  });

  it('bleibt stehen, wenn der Server das Abmelden mit 412 ablehnt', async () => {
    zeigeMitAnmeldeseite(412);
    await oeffne();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Abmelden/ }));
    await waitFor(() => expect(screen.queryByText('Anmeldeseite')).not.toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('Anmeldeseite')).not.toBeInTheDocument();
    expect(await trigger()).toBeInTheDocument();
  });
});

/**
 * Die drei Leisten der Gruppe „Anzeige“ hängen an KEINER Breite (LFH-392, LLH-1642). Die
 * Parametrisierung schreibt die Abwesenheit einer Breitenregel hin.
 *
 * Die Breite steht als LITERAL da (1024 = Vitest-Vorgabe, 390 = Handschirm); aus `useViewport`
 * zurückgelesen prüfte sie sich selbst.
 */
describe.each([
  ['ab lg', 1024],
  ['unter lg', 390],
])('BenutzerMenu — Anzeige, %s', (_lage, breite) => {
  beforeEach(() => setzeViewportBreite(breite));

  function leiste(name: string) {
    return within(screen.getByRole('radiogroup', { name }));
  }

  it('drei benannte Leisten, der gewählte Wert ist ausgewählt', async () => {
    zeige();
    await oeffne();
    // Ohne gespeicherte Wahl: Nachtbetrieb, `kompakt` (jsdom hat keinen groben Zeiger), 100 %.
    await screen.findByRole('radiogroup', { name: 'Darstellung' });
    expect(
      leiste('Darstellung')
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Hell', 'Dunkel', 'System']);
    expect(leiste('Darstellung').getByRole('radio', { name: 'Dunkel' })).toBeChecked();
    expect(
      leiste('Bediendichte')
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Kompakt', 'Komfortabel', 'Handschuh']);
    expect(leiste('Bediendichte').getByRole('radio', { name: 'Kompakt' })).toBeChecked();
    expect(leiste('Helligkeit in %').getByRole('radio', { name: '100 %' })).toBeChecked();
    // Genau ein gewählter Wert je Leiste.
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(3);
  });

  it('eine Wahl führt bis ans <html> durch, beide Achsen unabhängig, das Menü bleibt offen', async () => {
    // Gemessen am Wurzelelement: eine Wahl, die das Segment markiert, aber das Merkmal nicht setzt,
    // ließe das CSS auf der Ausgangsstufe stehen.
    zeige();
    await oeffne();
    // Gewählt wird der NICHT aktive Modus: ein Klick auf „Dunkel“ (Vorgabe) bewiese nichts.
    await screen.findByRole('radiogroup', { name: 'Darstellung' });
    await userEvent.click(leiste('Darstellung').getByRole('radio', { name: 'Hell' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    // Das Menü schließt nicht: dieselbe Leiste zeigt die neue Wahl.
    expect(leiste('Darstellung').getByRole('radio', { name: 'Hell' })).toBeChecked();

    await userEvent.click(leiste('Bediendichte').getByRole('radio', { name: 'Handschuh' }));
    expect(document.documentElement.dataset.dichte).toBe('handschuh');
    expect(leiste('Bediendichte').getByRole('radio', { name: 'Handschuh' })).toBeChecked();
    // DIE ACHSEN SIND UNABHÄNGIG — der Dichte-Klick setzt das Farbschema nicht mit.
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  /*
   * TASTATUR MIT `keyCode` (LLH-1642 D2): `rc-dropdown` liest `keyCode`, und user-event setzt ihn
   * nicht — sein Tab-Weg liefe hier sonst nie. Deshalb `fireEvent.keyDown` mit `keyCode`. Dass die
   * Pfeiltasten nicht an `rc-menu` weitergehen, belegt jsdom nicht (`rc-menu` setzt den Fokus erst
   * im nächsten Frame); das prüft `e2e/benutzermenue.spec.ts` mit Pfeil runter und Ende.
   */
  it('Pfeiltaste wählt den Nachbarn in der Leiste, Pos1 springt an ihren Anfang', async () => {
    zeige();
    await oeffne();
    const dunkel = (
      await screen.findByRole('radiogroup', { name: 'Darstellung' })
    ).querySelector<HTMLButtonElement>('[aria-checked="true"]')!;
    dunkel.focus();
    fireEvent.keyDown(dunkel, { key: 'ArrowRight', keyCode: 39 });
    const system = leiste('Darstellung').getByRole('radio', { name: 'System' });
    expect(system).toBeChecked();
    expect(system).toHaveFocus();
    fireEvent.keyDown(system, { key: 'Home', keyCode: 36 });
    expect(leiste('Darstellung').getByRole('radio', { name: 'Hell' })).toHaveFocus();
  });

  it('Tab führt vom Menü in die Leisten und von Leiste zu Leiste, Umschalt+Tab zurück', async () => {
    zeige();
    await oeffne();
    await screen.findByRole('radiogroup', { name: 'Darstellung' });
    const tab = (shiftKey = false) =>
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', keyCode: 9, shiftKey });
    // Der Fokus steht am Auslöser; der erste Tab gehört `rc-dropdown`: Fokus ins Menü. Wohin
    // `rc-menu` ihn setzt, rechnet jsdom nicht nach; im Browser landet er auf dem ersten Eintrag.
    expect(screen.getByRole('button', { name: 'Benutzermenü' })).toHaveFocus();
    tab();
    screen.getByRole('menuitem', { name: 'Profil' }).focus();
    tab();
    expect(leiste('Darstellung').getByRole('radio', { name: 'Dunkel' })).toHaveFocus();
    tab();
    expect(leiste('Bediendichte').getByRole('radio', { name: 'Kompakt' })).toHaveFocus();
    tab();
    expect(leiste('Helligkeit in %').getByRole('radio', { name: '100 %' })).toHaveFocus();
    tab(true);
    expect(leiste('Bediendichte').getByRole('radio', { name: 'Kompakt' })).toHaveFocus();
    // Bis hierher hält das Menü: `rc-dropdown` hat keinen Tab gesehen.
    expect(screen.getByRole('button', { name: 'Benutzermenü' })).toHaveClass('ant-dropdown-open');
    tab();
    // Hinter der letzten Leiste fällt Tab an `rc-dropdown` und schließt das Menü wie bisher.
    tab();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Benutzermenü' })).not.toHaveClass(
        'ant-dropdown-open',
      ),
    );
  });
});

/**
 * Die Leiste „Helligkeit“ (LFH-397, LLH-1642). Mit Warnung wird die Sperre ERKLÄRT, nicht stumm
 * weggeschaltet (M16): das Etikett nennt Boden und Grund, die Stufen darunter sind gesperrt und
 * nennen den Grund, und eine Wahl unter dem Boden sagt, was wirkt.
 */
describe('BenutzerMenu — Helligkeit (LFH-397)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.helligkeit;
  });

  function Warnquelle() {
    useWarnsperre(true);
    return null;
  }

  function helligkeit() {
    return within(screen.getByRole('radiogroup', { name: 'Helligkeit in %' }));
  }

  it('fünf Stufen, die gewählte ist ausgewählt, ein Klick führt bis ans <html> durch', async () => {
    zeige();
    await oeffne();
    await screen.findByRole('radiogroup', { name: 'Helligkeit in %' });
    expect(
      helligkeit()
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['100', '80', '60', '40', '20']);
    expect(helligkeit().getByRole('radio', { name: '100 %' })).toBeChecked();
    await userEvent.click(helligkeit().getByRole('radio', { name: '40 %' }));
    expect(document.documentElement.dataset.helligkeit).toBe('40');
    expect(localStorage.getItem('lifeline-hub.helligkeit')).toBe('40');
    expect(helligkeit().getByRole('radio', { name: '40 %' })).toBeChecked();
  });

  it('ohne Warnung ist keine Stufe gesperrt und das Etikett nennt keinen Boden', async () => {
    zeige();
    await oeffne();
    await screen.findByRole('radiogroup', { name: 'Helligkeit in %' });
    expect(helligkeit().getByRole('radio', { name: '20 %' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('Helligkeit in %')).toBeInTheDocument();
    expect(screen.queryByText(/Warnung aktiv/)).not.toBeInTheDocument();
    expect(screen.queryByText(/wirkt/)).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Helligkeit in %' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('mit Warnung: Boden und Grund im Etikett, Stufen darunter gesperrt mit Grund, Wahl zeigt die Wirkung', async () => {
    localStorage.setItem('lifeline-hub.helligkeit', '40');
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu />
        <Warnquelle />
      </ThemeModeProvider>,
    );
    await oeffne();
    expect(
      await screen.findByText('Helligkeit in % · mind. 80 % (Warnung aktiv)'),
    ).toBeInTheDocument();
    const vierzig = helligkeit().getByRole('radio', { name: '40 %' });
    expect(vierzig).toBeChecked();
    expect(vierzig).toHaveAttribute('aria-disabled', 'true');
    expect(vierzig).toHaveAccessibleDescription('Warnung aktiv: mindestens 80 %');
    expect(screen.getByText('Gewählt 40 %, wirkt 80 %')).toBeInTheDocument();
    // Die Leiste verweist auf den Hinweis, wie früher der Name „40 % ✓ (wirkt 80 %)“ ihn trug.
    expect(screen.getByRole('radiogroup', { name: 'Helligkeit in %' })).toHaveAccessibleDescription(
      'Gewählt 40 %, wirkt 80 %',
    );
    for (const s of ['60 %', '20 %']) {
      expect(helligkeit().getByRole('radio', { name: s })).toHaveAttribute('aria-disabled', 'true');
    }
    for (const s of ['100 %', '80 %']) {
      expect(helligkeit().getByRole('radio', { name: s })).not.toHaveAttribute('aria-disabled');
    }
  });
});
