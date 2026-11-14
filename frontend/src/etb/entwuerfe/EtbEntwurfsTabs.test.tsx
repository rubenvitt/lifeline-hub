import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { NeuerEintrag } from '../../api/etb';
import type { EtbBaustein } from '../../api/types';
import { meHandler, server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { entwuerfeLaden, entwuerfeLeerenFuerTests, entwurfEntfernen } from './entwurfStore';
import EtbEntwurfsTabs, { entfernenStil } from './EtbEntwurfsTabs';
import { benutzerFixture, einsatzFixture } from '../../test/fixtures';
import { rufnameZugriff } from '../../test/standardRufname';
import { waehle } from '../../test/auswahlListe';

// Durchgereicht; ein Test lässt das Räumen nach dem Senden einmal scheitern.
vi.mock('./entwurfStore', async (echt) => {
  const modul = await echt<typeof import('./entwurfStore')>();
  return { ...modul, entwurfEntfernen: vi.fn(modul.entwurfEntfernen) };
});

/** Überschrift des Hinweises, wenn das Entfernen aus dem Gerätespeicher scheitert (LFH-1139). */
const ENTFERNEN_GESCHEITERT = 'Entwurf nicht aus dem Gerätespeicher entfernt';

const einsatz = einsatzFixture({ id: 7, bezeichnung: 'Test' });
/** Angemeldete Person (LFH-767): Die Reiter zeigen nur ihre Entwürfe. */
const ich = benutzerFixture();

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  localStorage.clear();
  server.use(
    meHandler(ich),
    http.get('/api/einsaetze/:id/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/einheiten', () => HttpResponse.json([])),
  );
});

function props(over: Partial<React.ComponentProps<typeof EtbEntwurfsTabs>> = {}) {
  return {
    einsatzId: 7,
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    bausteine: [] as EtbBaustein[],
    einsatz,
    werteBehalten: true,
    onWerteBehaltenChange: vi.fn(),
    rufname: rufnameZugriff(),
    ...over,
  };
}

/**
 * Wrapper, der den Schalterzustand hält — der liegt in `EtbPage`, nicht in den Tabs. Wer ihn
 * im Test umlegen will, braucht diesen Zustand.
 */
function MitSchalter(p: React.ComponentProps<typeof EtbEntwurfsTabs>) {
  const [behalten, setBehalten] = useState(p.werteBehalten);
  return <EtbEntwurfsTabs {...p} werteBehalten={behalten} onWerteBehaltenChange={setBehalten} />;
}

/**
 * Eine Meldung — der Typ jedes neuen Entwurfs — trägt als Vorgabe nur An = eigene Stelle; Von ist
 * Pflicht (Change `kwc2yszv-etb-neuentwurf`, Spec `etb-absender-empfaenger`). Wer senden will,
 * setzt Von über die Feldzeile; Enter übernimmt und springt in den Inhalt. Eingefügt statt
 * getippt: jeder Tastendruck zeichnet die Erfassung neu (LFH-672).
 */
async function setzeVon(wert = 'Florian 3') {
  const von = await screen.findByRole('combobox', { name: 'Von' });
  await userEvent.clear(von);
  await userEvent.paste(wert);
  await userEvent.keyboard('{Enter}');
}

/** Der angezeigte Wert von Von oder An in der Feldzeile. */
function feldWert(name: 'Von' | 'An') {
  return (screen.getByRole('combobox', { name }) as HTMLInputElement).value;
}

/** Der gewählte Meldeweg der Feldzeile, leer ohne Wahl. */
function meldewegWert() {
  const auswahl = screen.getByRole('combobox', { name: 'Meldeweg' }).closest('.ant-select');
  // Ohne Optionsstil steht die Wahl als Titel am Inhalt der Auswahl (`@rc-component/select`).
  return auswahl?.querySelector('.ant-select-content')?.getAttribute('title') ?? '';
}

/**
 * Legt einen weiteren Entwurf über die Fußzeile an: mit einem Entwurf gibt es kein Reiterband und
 * also kein „+“ darin (Spec „Entwurfsreiter und Vorschau nur bei Bedarf“).
 */
async function weitererEntwurf() {
  const vorher = screen.queryAllByRole('tab', { hidden: true }).length;
  await userEvent.click(screen.getByRole('button', { name: '+ weiterer Entwurf' }));
  await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(vorher + 1));
}

describe('EtbEntwurfsTabs', () => {
  it('LFH-894: der Standard-Rufname überlebt Absenden und Remount, ohne im Entwurf zu stehen', async () => {
    const p = props({
      einsatz: { ...einsatz, meine_fuehrungsstelle: 'Florian Leitung' },
      werteBehalten: false,
    });
    const ersteAnsicht = renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await screen.findByPlaceholderText(/Inhalt/);
    // Meldung: An trägt die eigene Stelle aus dem Standard, Von ist leer (Pflicht).
    expect(feldWert('An')).toBe('ELW 1');
    expect(feldWert('Von')).toBe('');
    // Die Führungsstelle belegt nichts mehr vor (design.md D3).
    expect(feldWert('An')).not.toBe('Florian Leitung');
    await setzeVon();
    // Enter im Feld Von springt in den Inhalt; eingefügt statt getippt (LFH-672).
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
    await userEvent.paste('Meldung');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'Florian 3',
      an: 'ELW 1',
    });
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
    expect(feldWert('An')).toBe('ELW 1');
    // Ein Entwurf nur mit dem Standard ist leer und wird nicht gespeichert (design.md D2).
    await waitFor(async () => expect(await entwuerfeLaden(ich.id, 7)).toHaveLength(0));
    ersteAnsicht.unmount();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await screen.findByPlaceholderText(/Inhalt/);
    expect(feldWert('An')).toBe('ELW 1');
    expect(feldWert('Von')).toBe('');
  });

  it('LFH-894: ein geänderter Standard erreicht einen offenen Entwurf', async () => {
    const p = props();
    const { rerender } = renderMitProviders(<EtbEntwurfsTabs {...p} />);
    // Lage: Von und An tragen beide die eigene Stelle als Vorgabe.
    await userEvent.click(await screen.findByRole('radio', { name: 'Lage' }));
    await userEvent.click(screen.getByPlaceholderText(/Inhalt/));
    await userEvent.paste('Halb fertig');
    expect(feldWert('Von')).toBe('ELW 1');
    expect(feldWert('An')).toBe('ELW 1');
    rerender(<EtbEntwurfsTabs {...p} rufname={rufnameZugriff({ von: 'ELW 2', an: 'S2' })} />);
    await waitFor(() => expect(feldWert('Von')).toBe('ELW 2'));
    expect(feldWert('An')).toBe('S2');
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Halb fertig');
  });

  it('öffnet mit einem leeren Entwurf-Tab und Eingabefeld', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    expect(await screen.findByPlaceholderText(/Inhalt/)).toBeInTheDocument();
  });

  it('autosaved Eingaben in IndexedDB', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Lagemeldung');
    await waitFor(async () => {
      const liste = await entwuerfeLaden(ich.id, 7);
      expect(liste[0]?.inhalt).toBe('Lagemeldung');
    });
  });

  it('entfernt den Entwurf nach erfolgreichem Absenden', async () => {
    const p = props();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await setzeVon();
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Fertig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await entwuerfeLaden(ich.id, 7)).toHaveLength(0));
  });

  it('meldet kein „Senden fehlgeschlagen“, wenn nach dem Senden nur das Räumen scheitert', async () => {
    const p = props();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await setzeVon();
    await userEvent.type(feld, 'Fertig');
    vi.mocked(entwurfEntfernen).mockRejectedValueOnce(new Error('Speicher gesperrt'));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));

    // Der Eintrag steht: das Feld leert sich, ein Sendegrund erscheint nicht.
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
    expect(document.querySelector('[data-lfh="etb-ablehnung"]')).toBeNull();
    expect(screen.queryByText('Senden fehlgeschlagen')).toBeNull();
    // Der Grund steht an der Leiste, nicht an der Erfassung (LFH-1139), und der gesendete
    // Entwurf ist zu: nur ein Reiter, und der ist leer. Mit einem Entwurf steht das Reiterband
    // ausgeblendet (Spec „Entwurfsreiter und Vorschau nur bei Bedarf“).
    expect(await screen.findByText(ENTFERNEN_GESCHEITERT)).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1);
    warn.mockRestore();
  });

  it('behält das Erfassungsfeld nach dem Absenden — auch unter StrictMode (LFH-214)', async () => {
    // Unter React.StrictMode (e2e über den Vite-Dev-Server) laufen Updater doppelt. Ein impurer
    // setEntwuerfe-Updater in entwurfSchliessen desynchronisierte entwuerfe und aktiverId, und das
    // Erfassungsfeld verschwand nach dem Absenden.
    const p = props();
    renderMitProviders(
      <StrictMode>
        <EtbEntwurfsTabs {...p} />
      </StrictMode>,
    );
    await setzeVon();
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Fertig');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    // Neuer leerer Entwurf-Tab: Feld wieder vorhanden und leer.
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('');
  });

  it('behält den Entwurf, wenn das Absenden fachlich abgelehnt wird', async () => {
    // Die Ablehnung propagiert korrekt aus erfassenUndSchliessen → void absenden() →
    // unhandled rejection im Runner. Wir unterdrücken sie hier für diesen Test,
    // da es erwartetes Verhalten ist (Entwurf bleibt, Schließen wird nicht aufgerufen).
    const originalOnUnhandledRejection = process.listeners('unhandledRejection').slice();
    process.removeAllListeners('unhandledRejection');
    process.once('unhandledRejection', () => {
      /* erwartet */
    });

    const p = props({
      erfassen: vi
        .fn<(e: NeuerEintrag) => Promise<void>>()
        .mockRejectedValue(new Error('abgelehnt')),
    });
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await setzeVon();
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Bleibt{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    // Entwurf wurde durch das Tippen persistiert und bleibt nach Reject erhalten.
    await waitFor(async () => {
      const liste = await entwuerfeLaden(ich.id, 7);
      expect(liste[0]?.inhalt).toBe('Bleibt');
    });

    // Listener wiederherstellen
    for (const listener of originalOnUnhandledRejection) {
      process.on('unhandledRejection', listener as NodeJS.UnhandledRejectionListener);
    }
  });

  // -------------------------------------------------------------------------
  // Wertübernahme über die Remount-Grenze (LFH-332)
  //
  // Nur hier prüfbar: nach erfolgreichem Erfassen schließt dieser Container den Entwurfs-Tab,
  // und das key-Prop erzwingt einen Remount der Schnellerfassung. Ein Wert, der nur in deren
  // useState läge, wäre danach weg.
  // -------------------------------------------------------------------------

  /**
   * Von, An und Meldeweg über die Feldzeile. An trägt schon den Standard-Rufnamen (LFH-894) und
   * wird überschrieben. Eingefügt statt getippt (LFH-672, Begründung im Test unten); Enter
   * übernimmt wie getippt und springt in den Inhalt, die Wahl des Meldewegs ebenso.
   */
  async function setzeVonAnUndMeldeweg() {
    await setzeVon();
    const an = screen.getByRole('combobox', { name: 'An' });
    await userEvent.clear(an);
    await userEvent.paste('Florian 1');
    await userEvent.keyboard('{Enter}');
    await waehle('Meldeweg', 'Funk');
  }

  it('ein Entwurf steht ohne Reiterband; ab dem zweiten stehen die Reiter (Spec „Entwurfsreiter und Vorschau nur bei Bedarf“)', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await screen.findByPlaceholderText(/Inhalt/);
    // Genau ein Entwurf: kein Reiter, kein „+“ und kein × im Band — es ist ausgeblendet.
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Weiteren Entwurf anlegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entwurf verwerfen' })).toBeNull();
    expect(document.querySelector('.ant-tabs-nav')).toHaveStyle({ display: 'none' });
    // Die Einstellungen stehen nicht mehr im Band, sondern in der Fußzeile der Erfassung.
    for (const name of ['Auch in den Meldungseingang', 'Werte behalten']) {
      const schalter = screen.getByRole('checkbox', { name });
      expect(schalter.closest('.ant-tabs-nav'), name).toBeNull();
      expect(schalter.closest('[data-lfh="etb-fusszeile"]'), name).not.toBeNull();
    }

    await weitererEntwurf();
    expect(screen.getAllByRole('tab', { name: /Neuer Eintrag/ })).toHaveLength(2);
    expect(document.querySelector('.ant-tabs-nav')).not.toHaveStyle({ display: 'none' });
    expect(screen.getByRole('button', { name: 'Weiteren Entwurf anlegen' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Entwurf verwerfen' })).toHaveLength(2);
  });

  it('übernimmt Von, An und Meldeweg in den nächsten Entwurf (Schalter an)', async () => {
    const p = props();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    // In `props()` steht der Schalter auf AN.
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).toBeChecked();

    // Meldungstext EINGEFÜGT, nicht getippt: jeder Tastendruck zeichnet die Schnellerfassung neu
    // (~85 ms in jsdom); mit ~50 Tasten stand der Test bei 3,7 s und riss unter Last die 10 s
    // (LFH-672). Getippt bleibt, was der Test prüft: die Felder und das Absenden.
    await userEvent.click(feld);
    await userEvent.paste('Erste Meldung');
    await setzeVonAnUndMeldeweg();
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      inhalt: 'Erste Meldung',
      von: 'Florian 3',
      an: 'Florian 1',
      meldeweg: 'funk',
    });

    // Der leere Inhalt beweist, dass wir den NEUEN Entwurf sehen: die alte Instanz ist
    // beim Schließen des Tabs unmountet worden und hat ihr Feld nie geleert.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('');
      expect(feldWert('Von')).toBe('Florian 3');
      expect(feldWert('An')).toBe('Florian 1');
      expect(meldewegWert()).toBe('Funk');
    });

    // Kein Geister-Entwurf: Die übernommenen Werte dürfen den gerade gelöschten Entwurf
    // nicht wieder in den Speicher schreiben. Die Schnellerfassung setzt nach dem Erfassen
    // metadaten auf die Übernahme — träfe dieser Autosave noch den ALTEN Entwurf, wäre
    // `istLeer` wegen der gesetzten Metadaten falsch und der Entwurf käme leer zurück.
    await waitFor(async () => expect(await entwuerfeLaden(ich.id, 7)).toHaveLength(0));

    // …und sie werden beim nächsten Eintrag ohne erneutes Tippen mitgesendet.
    await userEvent.click(screen.getByPlaceholderText(/Inhalt/));
    await userEvent.paste('Zweite Meldung');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(2));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatchObject({
      inhalt: 'Zweite Meldung',
      von: 'Florian 3',
      an: 'Florian 1',
      meldeweg: 'funk',
    });
  });

  it('lässt den nächsten Entwurf leer, wenn der Schalter aus ist', async () => {
    const p = props();
    renderMitProviders(<MitSchalter {...p} />);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();

    await userEvent.type(feld, 'Erste Meldung');
    await setzeVonAnUndMeldeweg();
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveFocus());
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      von: 'Florian 3',
      an: 'Florian 1',
      meldeweg: 'funk',
    });

    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
    expect(feldWert('Von')).toBe('');
    expect(meldewegWert()).toBe('');
    // Verworfen wird der eigene Wert; An fällt auf den Standard-Rufnamen zurück (LFH-894).
    expect(feldWert('An')).toBe('ELW 1');
    // Der Schalterzustand selbst überlebt den Remount ebenfalls.
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  /** Eine Anordnung hat Von = eigene Stelle, An ist Pflicht: der Test setzt es vorab. */
  /**
   * Der Fokus beim Laden (Meldung ohne Von: im Feld Von). Abgewartet, bevor der Test An leert:
   * käme er danach, verließe er An, und das leere Feld fiele auf seine Vorgabe zurück.
   */
  async function startfokusInVon() {
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Von' })).toHaveFocus());
  }

  async function anordnungErfassen(p: ReturnType<typeof props>) {
    const an = screen.getByRole('combobox', { name: 'An' });
    await userEvent.clear(an);
    await userEvent.paste('Abschnitt Nord');
    await userEvent.keyboard('{Enter}');
    // Der Typ über den getippten Slash-Befehl, der Rest eingefügt (LFH-672).
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '/anordnung ');
    await userEvent.paste('Abschnitt Nord räumen');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      typ: 'anordnung',
      von: 'ELW 1',
      an: 'Abschnitt Nord',
    });
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
  }

  it('behält mit „Werte behalten“ den Typ für den nächsten Entwurf, ohne Schalter Meldung (LLH-1112)', async () => {
    const p = props();
    renderMitProviders(<MitSchalter {...p} />);
    await startfokusInVon();
    await anordnungErfassen(p);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Anordnung' })).toBeChecked());
    // Ein neuer Entwurf über „+ weiterer Entwurf“ ist keine Übernahme: er beginnt als Meldung.
    await weitererEntwurf();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Meldung' })).toBeChecked());
  });

  it('beginnt ohne „Werte behalten“ nach einer Anordnung wieder als Meldung (LLH-1112)', async () => {
    const p = props();
    renderMitProviders(<MitSchalter {...p} />);
    await startfokusInVon();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await anordnungErfassen(p);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Meldung' })).toBeChecked());
  });

  it('„+ weiterer Entwurf“ öffnet einen zweiten Reiter, das „+“ im Band einen dritten', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await screen.findByPlaceholderText(/Inhalt/);
    await weitererEntwurf();
    expect(screen.getAllByRole('tab', { name: /Neuer Eintrag/ })).toHaveLength(2);
    // Antd rendert auch die Remove-Buttons mit role="tab"; nur Tab-Btn-Elemente zählen.
    await userEvent.click(screen.getByRole('button', { name: 'Weiteren Entwurf anlegen' }));
    await waitFor(() =>
      expect(screen.getAllByRole('tab', { name: /Neuer Eintrag/ })).toHaveLength(3),
    );
  });

  // --- Anhänge je Entwurf, nur im Speicher ---

  function dateiEingabe(): HTMLInputElement {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!el) throw new Error('Dateieingabe fehlt');
    return el;
  }

  it('LFH-117: gewählte Dateien gehören ihrem Entwurf und überleben den Tabwechsel', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto-a.jpg', { type: 'image/jpeg' }));
    expect(screen.getByRole('list', { name: 'Gewählte Anhänge' })).toHaveTextContent('foto-a.jpg');

    await weitererEntwurf();
    const ersterTab = screen.getAllByRole('tab')[0];
    expect(screen.getAllByRole('tab', { name: /Neuer Eintrag/ })).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'Gewählte Anhänge' })).toBeNull();

    await userEvent.click(ersterTab);
    expect(await screen.findByRole('list', { name: 'Gewählte Anhänge' })).toHaveTextContent(
      'foto-a.jpg',
    );
  });

  it('LFH-117: der Entwurfsspeicher nimmt keine Dateien auf', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto-b.jpg', { type: 'image/jpeg' }));
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Foto');
    await waitFor(async () => expect((await entwuerfeLaden(ich.id, 7))[0]?.inhalt).toBe('Foto'));
    expect(JSON.stringify(await entwuerfeLaden(ich.id, 7))).not.toContain('foto-b.jpg');
  });

  it('LFH-117: ein geschlossener Entwurf nimmt seine Dateien mit', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto-c.jpg', { type: 'image/jpeg' }));
    await weitererEntwurf();
    expect(screen.getAllByRole('tab', { name: /Neuer Eintrag/ })).toHaveLength(2);
    // Den ersten Entwurf schliessen (antds Entfernen-Knopf je Tab).
    const entfernen = document.querySelectorAll<HTMLElement>('.ant-tabs-tab-remove');
    await userEvent.click(entfernen[0]);
    // Mit Datei fragt das × nach (LFH-957).
    const dialog = await screen.findByRole('dialog', { name: 'Entwurf verwerfen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verwerfen' }));
    // Ein Entwurf bleibt: das Band ist wieder ausgeblendet, sein Reiter zählt verborgen mit.
    await waitFor(() =>
      expect(screen.getAllByRole('tab', { hidden: true, name: /Neuer Eintrag/ })).toHaveLength(1),
    );
    expect(screen.queryByText(/foto-c\.jpg/)).toBeNull();
  });

  // --- Der Sendezustand gehört dem Entwurf, nicht der Montierung ---

  /** Ein Upload, der hängt, bis der Test ihn freigibt (oder scheitern lässt). */
  function haengenderUpload() {
    const s: { freigeben: () => void; scheitern: () => void } = {
      freigeben: () => {},
      scheitern: () => {},
    };
    server.use(
      http.post(
        '/api/einsaetze/7/etb/anhaenge',
        () =>
          new Promise<Response>((r) => {
            s.freigeben = () =>
              r(
                HttpResponse.json(
                  [
                    {
                      id: 41,
                      einsatz_id: 7,
                      dateiname: 'foto.jpg',
                      mime: 'image/jpeg',
                      groesse: 1,
                      hochgeladen_von: 1,
                      erstellt_at: '2026-09-25 10:00:00',
                    },
                  ],
                  { status: 201 },
                ),
              );
            s.scheitern = () => r(HttpResponse.json({ error: 'Speicher voll' }, { status: 507 }));
          }),
      ),
    );
    return s;
  }

  function aktiveEntwurfsId(): string | null {
    return document.querySelector('.ant-tabs-tab-active')?.getAttribute('data-node-key') ?? null;
  }

  /**
   * Zwei Entwürfe, der erste aktiv und mit Von. Der zweite entsteht vor dem Senden, damit beide
   * Reiter von Anfang an stehen.
   */
  async function zweiEntwuerfe() {
    await screen.findByPlaceholderText(/Inhalt/);
    await weitererEntwurf();
    const [ersterTab, zweiterTab] = screen.getAllByRole('tab');
    await userEvent.click(ersterTab);
    await screen.findByPlaceholderText(/Inhalt/);
    await setzeVon();
    return { ersterTab, zweiterTab };
  }

  it('LFH-117: ein Tabwechsel während des Sendens hebt die Sperre nicht auf — kein zweites Absenden', async () => {
    const upload = haengenderUpload();
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined);
    renderMitProviders(<EtbEntwurfsTabs {...props({ erfassen })} />);
    const { ersterTab, zweiterTab } = await zweiEntwuerfe();
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Foto{Enter}');
    await screen.findByText('Lädt hoch (1/1) …');

    // Wegwechseln und zurück: die Schnellerfassung montiert neu, der Versand läuft noch.
    await userEvent.click(zweiterTab);
    await waitFor(() => expect(screen.queryByText('Lädt hoch (1/1) …')).toBeNull());
    await userEvent.click(ersterTab);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    expect(feld).toHaveValue('Foto');
    expect(feld).toHaveAttribute('readonly');
    expect(screen.getByText('Lädt hoch (1/1) …')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anhang' })).toBeDisabled();
    await userEvent.type(feld, ' mehr{Enter}');
    expect(feld).toHaveValue('Foto');

    await act(async () => upload.freigeben());
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    expect(erfassen.mock.calls[0][0]).toMatchObject({ inhalt: 'Foto', anhang_ids: [41] });
  });

  it('LFH-117: auch ohne Anhang sendet die Rückkehr in den Tab kein zweites Mal', async () => {
    const erfassen = vi
      .fn<(e: NeuerEintrag) => Promise<void>>()
      .mockImplementation(() => new Promise<void>(() => {}));
    renderMitProviders(<EtbEntwurfsTabs {...props({ erfassen })} />);
    const { ersterTab, zweiterTab } = await zweiEntwuerfe();
    const entwurfsId = aktiveEntwurfsId();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Meldung{Enter}');
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));

    await userEvent.click(zweiterTab);
    await waitFor(() => expect(aktiveEntwurfsId()).not.toBe(entwurfsId));
    await userEvent.click(ersterTab);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    expect(feld).toHaveAttribute('readonly');
    await userEvent.type(feld, '{Enter}');
    fireEvent.click(screen.getByRole('button', { name: /Erfassen$/ }));
    expect(erfassen).toHaveBeenCalledTimes(1);
    expect(erfassen.mock.calls[0][0].client_id).toBe(entwurfsId);
  });

  it('LFH-117: der sendende Entwurf lässt sich nicht schließen', async () => {
    const upload = haengenderUpload();
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    const { ersterTab, zweiterTab } = await zweiEntwuerfe();
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Foto{Enter}');
    await screen.findByText('Lädt hoch (1/1) …');

    const knoten = (tab: HTMLElement) => tab.closest('.ant-tabs-tab') as HTMLElement;
    expect(knoten(ersterTab).querySelector('.ant-tabs-tab-remove')).toBeNull();
    // Der andere Entwurf bleibt schließbar — gesperrt ist nur, was gerade sendet.
    expect(knoten(zweiterTab).querySelector('.ant-tabs-tab-remove')).not.toBeNull();

    await act(async () => upload.freigeben());
    // Gesendet und zu: ein Entwurf bleibt, das Band ist wieder ausgeblendet.
    await waitFor(() => expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('LFH-117: ein Upload-Fehler bleibt nach dem Tabwechsel mit Grund stehen', async () => {
    const upload = haengenderUpload();
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined);
    renderMitProviders(<EtbEntwurfsTabs {...props({ erfassen })} />);
    const { ersterTab, zweiterTab } = await zweiEntwuerfe();
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Foto{Enter}');
    await screen.findByText('Lädt hoch (1/1) …');
    await userEvent.click(zweiterTab);
    await waitFor(() => expect(screen.queryByText('Lädt hoch (1/1) …')).toBeNull());

    await act(async () => upload.scheitern());
    await userEvent.click(ersterTab);
    expect(
      await screen.findByText(/foto\.jpg konnte nicht hochgeladen werden/),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Inhalt/)).not.toHaveAttribute('readonly');
    expect(screen.getByRole('list', { name: 'Gewählte Anhänge' })).toHaveTextContent('foto.jpg');
    expect(erfassen).not.toHaveBeenCalled();
  });

  it('LFH-117: meldet an den Aufrufer, solange ein Entwurf sendet', async () => {
    const upload = haengenderUpload();
    const onSendetChange = vi.fn();
    renderMitProviders(<EtbEntwurfsTabs {...props({ onSendetChange })} />);
    await screen.findByPlaceholderText(/Inhalt/);
    await setzeVon();
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Foto{Enter}');
    await waitFor(() => expect(onSendetChange).toHaveBeenLastCalledWith(true));
    await act(async () => upload.freigeben());
    await waitFor(() => expect(onSendetChange).toHaveBeenLastCalledWith(false));
  });

  // LFH-748: der Sendezustand liegt in `EtbPage` und überlebt den Einsatzwechsel. Ein Entwurf
  // eines ANDEREN Einsatzes, der noch sendet, sperrt hier nichts.
  it('LFH-748: ein sendender Entwurf eines anderen Einsatzes meldet hier kein Senden', async () => {
    const onSendetChange = vi.fn();
    const versand = {
      je: {
        'entwurf-aus-einsatz-8': {
          sendet: true,
          fortschritt: null,
          hinweis: null,
          ablehnung: null,
        },
      },
      aendern: vi.fn(),
      umhaengen: vi.fn(),
    };
    renderMitProviders(<EtbEntwurfsTabs {...props({ onSendetChange, versand })} />);
    await screen.findByPlaceholderText(/Inhalt/);
    expect(onSendetChange).not.toHaveBeenCalledWith(true);
  });

  it('LFH-117: nach einem Erfolg geht der nächste Eintrag mit der id des NEUEN Entwurfs raus', async () => {
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined);
    renderMitProviders(<EtbEntwurfsTabs {...props({ erfassen })} />);
    await screen.findByPlaceholderText(/Inhalt/);
    const erste = aktiveEntwurfsId();
    // Mit „Werte behalten“ (Vorgabe in `props()`) trägt der Folgeentwurf das Von weiter.
    await setzeVon();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Eins{Enter}');
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(aktiveEntwurfsId()).not.toBe(erste));
    const zweite = aktiveEntwurfsId();
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Zwei{Enter}');
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(2));

    const [a, b] = erfassen.mock.calls.map((c) => c[0].client_id);
    expect(a).toBe(erste);
    expect(b).toBe(zweite);
    expect(b).not.toBe(a);
  });

  it('LFH-117: ein client_id-Konflikt (409) lässt Wortlaut und Dateien stehen und gibt dem Entwurf eine neue id', async () => {
    const konflikt =
      'client_id bereits für einen anderen Eintrag verwendet: dieser Wortlaut ist nicht erfasst.';
    const erfassen = vi
      .fn<(e: NeuerEintrag) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(409, konflikt))
      .mockResolvedValue(undefined);
    server.use(
      http.post('/api/einsaetze/7/etb/anhaenge', () =>
        HttpResponse.json(
          [
            {
              id: 41,
              einsatz_id: 7,
              dateiname: 'foto.jpg',
              mime: 'image/jpeg',
              groesse: 1,
              hochgeladen_von: 1,
              erstellt_at: '2026-09-25 10:00:00',
            },
          ],
          { status: 201 },
        ),
      ),
    );
    renderMitProviders(<EtbEntwurfsTabs {...props({ erfassen })} />);
    await screen.findByPlaceholderText(/Inhalt/);
    const alteId = aktiveEntwurfsId();
    await setzeVon();
    await userEvent.upload(dateiEingabe(), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Wortlaut aus Tab 2{Enter}');
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    expect(erfassen.mock.calls[0][0].client_id).toBe(alteId);

    // Der Hinweis steht AN der Erfassung, nicht nur im Toast.
    expect(await screen.findByText(new RegExp(konflikt.slice(0, 40)))).toBeInTheDocument();
    await waitFor(() => expect(aktiveEntwurfsId()).not.toBe(alteId));
    const neueId = aktiveEntwurfsId();
    expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1);
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Wortlaut aus Tab 2');
    expect(screen.getByRole('list', { name: 'Gewählte Anhänge' })).toHaveTextContent('foto.jpg');
    await waitFor(async () =>
      expect((await entwuerfeLaden(ich.id, 7)).map((e) => e.id)).toEqual([neueId]),
    );

    // Der nächste Versuch geht mit der NEUEN id raus und kann gelingen.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Erfassen$/ })).not.toHaveClass('ant-btn-loading'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Erfassen$/ }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(2));
    expect(erfassen.mock.calls[1][0].client_id).toBe(neueId);
  });

  it('LLH-1152: scheitert beim 409 das Entfernen der alten Fassung, bleibt die 409 der Grund an der Erfassung', async () => {
    const konflikt =
      'client_id bereits für einen anderen Eintrag verwendet: dieser Wortlaut ist nicht erfasst.';
    const erfassen = vi
      .fn<(e: NeuerEintrag) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(409, konflikt));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    renderMitProviders(<EtbEntwurfsTabs {...props({ erfassen })} />);
    await screen.findByPlaceholderText(/Inhalt/);
    const alteId = aktiveEntwurfsId();
    await setzeVon();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Wortlaut aus Tab 2');
    await waitFor(async () => expect(await entwuerfeLaden(ich.id, 7)).toHaveLength(1));
    // Echte Platte, nur die Löschtransaktion bricht ab (Plattenfehler beim Entfernen).
    const loeschen = IDBObjectStore.prototype.delete;
    const spion = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const anfrage = loeschen.apply(this, args);
      this.transaction.abort();
      return anfrage;
    });
    onTestFinished(() => spion.mockRestore());
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), '{Enter}');
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));

    expect(await screen.findByText(new RegExp(konflikt.slice(0, 40)))).toBeInTheDocument();
    expect(screen.queryByText(/AbortError|abort/i)).toBeNull();
    await waitFor(() => expect(aktiveEntwurfsId()).not.toBe(alteId));
    const neueId = aktiveEntwurfsId();
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Wortlaut aus Tab 2');
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ETB-Entwürfe'), expect.anything()),
    );
    spion.mockRestore();
    // Neuladen: der Vorlauf trägt das Entfernen der alten id nach, die neue Fassung steht.
    await waitFor(async () =>
      expect((await entwuerfeLaden(ich.id, 7)).map((e) => [e.id, e.inhalt])).toEqual([
        [neueId, 'Wortlaut aus Tab 2'],
      ]),
    );
  });
});

/**
 * Das × verwirft einen Entwurf endgültig (LFH-957): einen Papierkorb gibt es nicht, und einen
 * serverseitigen Rückweg auch nicht — also eine Rückfrage (`frontend/AGENTS.md`, LFH-363/LFH-343).
 * Entf auf dem Reiter läuft über denselben `onEdit` und damit durch dieselbe Rückfrage.
 *
 * Das × steht im Reiterband, und das gibt es erst ab dem zweiten Entwurf (Spec „Entwurfsreiter und
 * Vorschau nur bei Bedarf“). Die Fälle legen deshalb erst einen zweiten Entwurf an und verwerfen
 * ihn; ein einzelner Entwurf hat kein × (`ein Entwurf steht ohne Reiterband …`).
 */
describe('Entwurf verwerfen — Rückfrage (LFH-957)', () => {
  function dateiEingabe(): HTMLInputElement {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!el) throw new Error('Dateieingabe fehlt');
    return el;
  }

  function rueckfrage() {
    return screen.queryByRole('dialog', { name: 'Entwurf verwerfen?' });
  }

  /** Der zweite Entwurf, aktiv; der erste bleibt leer stehen. */
  async function zweiterEntwurf() {
    await screen.findByPlaceholderText(/Inhalt/);
    await weitererEntwurf();
    await waitFor(() =>
      expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true'),
    );
  }

  async function verwerfenKlicken(index = 1) {
    await userEvent.click(screen.getAllByRole('button', { name: 'Entwurf verwerfen' })[index]);
  }

  it('fragt bei einem Entwurf mit Text nach, „Behalten“ lässt ihn stehen', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await zweiterEntwurf();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Pegel Mühlbach 3,20 m');
    await verwerfenKlicken();
    const dialog = await screen.findByRole('dialog', { name: 'Entwurf verwerfen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Behalten' }));
    // antd schließt animiert; „zu“ heißt im jsdom: Ausblend-Zustand.
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Pegel Mühlbach 3,20 m');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    await waitFor(async () =>
      expect((await entwuerfeLaden(ich.id, 7)).map((e) => e.inhalt)).toEqual([
        'Pegel Mühlbach 3,20 m',
      ]),
    );
  });

  it('fragt auch bei einem Entwurf nach, der nur Dateien trägt', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await zweiterEntwurf();
    await userEvent.upload(dateiEingabe(), new File(['x'], 'lagefoto.jpg', { type: 'image/jpeg' }));
    await verwerfenKlicken();
    expect(await screen.findByRole('dialog', { name: 'Entwurf verwerfen?' })).toBeInTheDocument();
    expect(screen.getByText(/lagefoto\.jpg/)).toBeInTheDocument();
  });

  it('„Verwerfen“ entfernt Entwurf und Dateien', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await zweiterEntwurf();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Halb erfasst');
    await userEvent.upload(dateiEingabe(), new File(['x'], 'lagefoto.jpg', { type: 'image/jpeg' }));
    await verwerfenKlicken();
    const dialog = await screen.findByRole('dialog', { name: 'Entwurf verwerfen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verwerfen' }));
    // Der erste, leere Entwurf bleibt allein stehen, ohne Reiterband.
    await waitFor(() => expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1));
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('');
    expect(screen.queryByText(/lagefoto\.jpg/)).toBeNull();
    await waitFor(async () => expect(await entwuerfeLaden(ich.id, 7)).toHaveLength(0));
  });

  it('ein leerer Entwurf schließt ohne Rückfrage', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await zweiterEntwurf();
    await verwerfenKlicken();
    await waitFor(() => expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1));
    expect(rueckfrage()).toBeNull();
  });

  it('Entf auf dem Reiter läuft durch dieselbe Rückfrage', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await zweiterEntwurf();
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Nicht weg');
    const reiter = await screen.findByRole('tab', { name: /Nicht weg/ });
    act(() => reiter.focus());
    fireEvent.keyDown(reiter, { key: 'Delete', code: 'Delete' });
    expect(await screen.findByRole('dialog', { name: 'Entwurf verwerfen?' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: /Nicht weg/ })).toHaveLength(1);
  });

  it('LFH-1139: scheitert das Entfernen, schließt der Reiter und der Grund steht an der Leiste', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await zweiterEntwurf();
    vi.mocked(entwurfEntfernen).mockRejectedValueOnce(new Error('Speicher gesperrt'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await verwerfenKlicken();

    await waitFor(() => expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(1));
    const hinweis = (await screen.findByText(ENTFERNEN_GESCHEITERT)).closest('[role="alert"]');
    expect(hinweis).not.toBeNull();
    // Kein Toast (`frontend/AGENTS.md`, „Rückwege und Fehler“).
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    // Der Ort des Grundes kommt nie wieder: er lässt sich schließen.
    await userEvent.click(
      within(hinweis as HTMLElement).getByRole('button', { name: 'Hinweis schließen' }),
    );
    await waitFor(() => expect(screen.queryByText(ENTFERNEN_GESCHEITERT)).toBeNull());
    warn.mockRestore();
  });

  it('die Knöpfe tragen deutsche Namen, kein „Add tab“ und kein „remove“', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await zweiterEntwurf();
    expect(
      screen.getAllByRole('button', { name: 'Weiteren Entwurf anlegen' }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Entwurf verwerfen' })).toHaveLength(2);
    expect(screen.queryAllByRole('button', { name: 'Add tab' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'remove' })).toHaveLength(0);
  });
});

/**
 * Das × eines Entwurfstabs ist ein unbeschriftetes Bedienziel (LFH-724): antds Vorgabe maß
 * 15 × 24 px in jeder Stufe. Boden auf BEIDEN Achsen ist die kleine Steuerhöhe 24 / 48 / 72
 * (Literale); die gerenderte Größe misst `e2e/trefflaeche-pruefflaechen.spec.ts`.
 */
describe('Entwurfstab schließen — Trefffläche (LFH-724)', () => {
  for (const [controlHeightSM, boden] of [
    [24, 24],
    [48, 48],
    [72, 72],
  ] as const) {
    it(`kleine Steuerhöhe ${controlHeightSM}: das × misst mindestens ${boden} × ${boden} px`, () => {
      const stil = entfernenStil({ controlHeightSM });
      expect(stil.minWidth).toBe(boden);
      expect(stil.minHeight).toBe(boden);
    });
  }

  // Der Kartentab hat ein FESTES senkrechtes Polster aus `cardHeight` (antd `cardPadding`): ein
  // 72-px-Inhalt streckte ihn in handschuh von 90 auf rund 141 px und risse den Deckel der
  // ETB-Erfassungsleiste (`e2e/leisten-flaeche.spec.ts`). Der negative Rand nimmt die Fläche
  // aus dem Layout — Margin-Box-Höhe 0 —, die Trefffläche bleibt.
  it('ist für das Layout höhenneutral: der senkrechte Rand hebt die Höhe genau auf', () => {
    for (const controlHeightSM of [24, 48, 72]) {
      const stil = entfernenStil({ controlHeightSM });
      expect(stil.minHeight + 2 * stil.marginBlock, String(controlHeightSM)).toBe(0);
    }
  });
});

describe('Werte behalten übernimmt nur Ausdrückliches (kwc2yszv, Review E2)', () => {
  it('nach einer Lage aus der Vorgabe trägt eine folgende Meldung kein Von', async () => {
    const p = props();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.click(screen.getByRole('radio', { name: 'Lage' }));
    expect(feldWert('Von')).toBe('ELW 1');
    await userEvent.click(feld);
    await userEvent.paste('Lage ruhig');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue(''));
    // Der Folgeentwurf ist wieder eine Lage (Werte behalten); als Meldung gilt die Vorgabe neu.
    await userEvent.click(screen.getByRole('radio', { name: 'Meldung' }));
    expect(feldWert('Von')).toBe('');
    expect(feldWert('An')).toBe('ELW 1');
  });
});
