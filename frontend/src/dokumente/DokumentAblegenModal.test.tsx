import { http, HttpResponse } from 'msw';
import { act, fireEvent, isInaccessible, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { ApiError, AusgangUnbekannt, NetzFehler, type UploadFortschritt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import DokumentAblegenModal from './DokumentAblegenModal';

vi.mock('../api/dokumente', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../api/dokumente')>();
  return { ...echt, legeDokumentAb: vi.fn() };
});
import { legeDokumentAb } from '../api/dokumente';
import { UPLOAD_MAX_GROESSE } from '../api/upload';
import * as queue from '../offline/queue';

const legeAb = vi.mocked(legeDokumentAb);

let etbAbrufe = 0;
/** Query-Strings aller ETB-Abrufe, in Reihenfolge. */
let etbAnfragen: URLSearchParams[] = [];

interface EtbStub {
  id: number;
  einsatz_id: number;
  lfd_nr: number;
  inhalt: string;
}
const eintrag = (id: number, lfd_nr: number, inhalt: string): EtbStub => ({
  id,
  einsatz_id: 1,
  lfd_nr,
  inhalt,
});
/** Das jüngste Fenster, das der Dialog ohne Suchbegriff bekommt. */
let etbFenster: EtbStub[] = [];
/** Der ganze Bestand — auch was außerhalb des Fensters liegt; Suche und Nummer greifen hierauf. */
let etbBestand: EtbStub[] = [];
let abschnitte = [{ id: 3, einsatz_id: 1, name: 'EA Nord' }];
/** Suchbegriffe, auf die der Server mit 400 antwortet. */
let scheitertBei: string[] = [];

/** Wie `fts_query` in `src/etb/repo.rs`: jedes Wort ist eine Phrase, gefunden werden nur GANZE
 *  Wörter (unicode61, kein Präfix-`*`). Ein Teilstring-Mock verdeckte, dass „Deich" am Server
 *  „Deichbruch" nicht trifft. */
function ftsTrifft(inhalt: string, q: string) {
  const woerter = inhalt.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => woerter.includes(t));
}

beforeEach(() => {
  etbAbrufe = 0;
  etbAnfragen = [];
  etbFenster = [eintrag(9, 12, 'Lage erkundet')];
  etbBestand = [...etbFenster, eintrag(5, 3, 'Deichbruch gemeldet'), eintrag(7, 412, 'Pumpe 2')];
  abschnitte = [{ id: 3, einsatz_id: 1, name: 'EA Nord' }];
  scheitertBei = [];
  legeAb.mockReset();
  server.use(
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json(abschnitte)),
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 4, einsatz_id: 1, name: 'Florian 1' }]),
    ),
    // Ahmt den Server nach: `q` sucht ganze Wörter im Inhalt, `before_lfd_nr` + `limit` schneidet
    // am Cursor.
    http.get('/api/einsaetze/1/etb', ({ request }) => {
      etbAbrufe += 1;
      const qs = new URL(request.url).searchParams;
      etbAnfragen.push(qs);
      const q = qs.get('q');
      const vor = qs.get('before_lfd_nr');
      const limit = Number(qs.get('limit') ?? 50);
      if (q && scheitertBei.includes(q))
        return HttpResponse.json({ fehler: 'kaputt' }, { status: 400 });
      let treffer = q || vor ? [...etbBestand] : [...etbFenster];
      if (q) treffer = treffer.filter((e) => ftsTrifft(e.inhalt, q));
      if (vor) treffer = treffer.filter((e) => e.lfd_nr < Number(vor));
      treffer.sort((a, b) => b.lfd_nr - a.lfd_nr);
      return HttpResponse.json(treffer.slice(0, limit));
    }),
  );
});
afterEach(() => vi.clearAllMocks());

/** Hält `offen` wie die Seite: ein Knopf öffnet, `onSchliessen` schließt. */
function Rahmen() {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <button onClick={() => setOffen(true)}>Öffnen</button>
      <DokumentAblegenModal einsatzId={1} offen={offen} onSchliessen={() => setOffen(false)} />
    </>
  );
}

function rendere() {
  return renderMitProviders(<Rahmen />);
}

/** Labels der Optionen in der offenen Liste, in Anzeige-Reihenfolge. */
function optionsLabels() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
    ),
  ].map((o) => o.textContent);
}

async function oeffneBezugsliste(d: HTMLElement) {
  await oeffneBezug(d);
  await userEvent.click(within(d).getByRole('combobox', { name: 'Bezug' }));
  await vi.waitFor(() => expect(optionsLabels()).toContain('ETB 12 · Lage erkundet'));
}

/** Schließt die Liste wie die Maus: Klick in ein anderes Feld. Zu ist sie am `aria-expanded`
 *  der Combobox — jsdom beendet die Schließbewegung des Portals nicht, der alte Inhalt bliebe im
 *  DOM stehen. */
async function schliesseBezugsliste(d: HTMLElement) {
  await userEvent.click(within(d).getByRole('textbox', { name: 'Titel' }));
  const feld = within(d).getByRole('combobox', { name: 'Bezug' });
  await vi.waitFor(() => expect(feld).toHaveAttribute('aria-expanded', 'false'));
}

/** Ein Takt für React: der Query-Cache meldet seine Beobachter gebündelt per `setTimeout`. Ohne
 *  ihn prüfte ein „nichts eingeschoben" den Stand VOR dem Neuzeichnen und wäre trivial grün. */
const neuGezeichnet = () => act(() => new Promise((r) => setTimeout(r, 20)));

/**
 * Der Dialog, NACHDEM sein Anfangsfokus sitzt. Die Hülle setzt ihn im Mount-Effekt
 * (`components/Erfassung.tsx`); hinge er an einem Frame, verlöre ein vorher tippender Test die
 * Tasten an den Fokuswechsel (LFH-672, Gegenprobe „Anfangsfokus hängt an keinem Frame“).
 */
async function dialog() {
  const d = (await screen.findAllByRole('dialog'))[0];
  const knopf = within(d).getByRole('button', { name: /Datei wählen/ });
  await vi.waitFor(() => expect(document.activeElement).toBe(knopf));
  return d;
}

function dateiInput(d: HTMLElement) {
  return d.querySelector<HTMLInputElement>('input[type="file"]')!;
}

/** antd-Dropdown-Option im Portal anhand des Anzeige-Labels treffen. */
async function waehleOption(label: string) {
  const option = (await screen.findAllByText(label)).find((el) =>
    el.closest('.ant-select-item-option'),
  );
  expect(option).toBeTruthy();
  await userEvent.click(option!);
}

async function oeffneBezug(d: HTMLElement) {
  const schalter = within(d).getByRole('button', { name: /Bezug \(optional\)/ });
  if (schalter.getAttribute('aria-expanded') === 'false') await userEvent.click(schalter);
  await within(d).findByRole('combobox', { name: 'Bezug' });
}

/** Wie `SchaedenPage.test.tsx`: jsdom beendet die Schließbewegung nicht von selbst. */
async function warteBisDialogWeg() {
  await vi.waitFor(() => {
    const modal = document.querySelector<HTMLElement>('.ant-modal');
    if (modal) {
      fireEvent.transitionEnd(modal);
      fireEvent.animationEnd(modal);
    }
    expect(screen.queryByRole('textbox', { name: 'Titel' })).not.toBeInTheDocument();
  });
}

async function fuellePflicht(d: HTMLElement, datei: File, titel?: string) {
  await userEvent.upload(dateiInput(d), datei);
  if (titel != null) {
    const feld = within(d).getByRole('textbox', { name: 'Titel' });
    await userEvent.clear(feld);
    await userEvent.type(feld, titel);
  }
  await userEvent.click(within(d).getByRole('combobox', { name: 'Kategorie' }));
  await waehleOption('Lagekarte/Plan');
}

const pdf = () => new File(['%PDF'], 'Lageplan Nord.pdf', { type: 'application/pdf' });

describe('DokumentAblegenModal', () => {
  it('Feldbudget: drei sichtbare Felder, der Bezug zählt erst aufgeklappt', async () => {
    rendere();
    const d = await dialog();
    const sichtbareFelder = () =>
      [...d.querySelectorAll<HTMLElement>('.ant-form-item')].filter((f) => !isInaccessible(f));
    expect(sichtbareFelder()).toHaveLength(3);
    // forceRender: der Bezug steht im DOM, nur verborgen — sonst wäre „3" trivial.
    expect(d.querySelectorAll('.ant-form-item')).toHaveLength(4);

    await oeffneBezug(d);
    expect(sichtbareFelder().length).toBeGreaterThan(3);
  });

  it('lädt das Tagebuch erst, wenn der Bezug aufgeklappt wird', async () => {
    rendere();
    const d = await dialog();
    await within(d).findByRole('combobox', { name: 'Kategorie' });
    expect(etbAbrufe).toBe(0);
    await oeffneBezug(d);
    await vi.waitFor(() => expect(etbAbrufe).toBe(1));
  });

  it('füllt einen leeren Titel mit dem Dateinamen ohne Endung', async () => {
    rendere();
    const d = await dialog();
    await userEvent.upload(dateiInput(d), pdf());
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Lageplan Nord');
  });

  it('überschreibt einen schon getippten Titel NICHT', async () => {
    rendere();
    const d = await dialog();
    const titel = within(d).getByRole('textbox', { name: 'Titel' });
    await userEvent.type(titel, 'Eigener Titel');
    // Vorbedingung: der getippte Titel steht im Feld. Fehlt er, liegt es am Tippen (Fokus), nicht
    // an der Titel-Übernahme — der CI-Befund aus LFH-672 sah sonst aus wie ein Überschreiben.
    expect(titel).toHaveValue('Eigener Titel');
    await userEvent.upload(dateiInput(d), pdf());
    expect(titel).toHaveValue('Eigener Titel');
  });

  it('Anfangsfokus hängt an keinem Frame: sofortiges Tippen bleibt im Titel (LFH-672)', async () => {
    // Bis zum 26.09.2026 fokussierte `DateiFeld` „Datei wählen“ per `requestAnimationFrame`. Unter
    // Last kam der Frame erst, als schon getippt wurde, und zog den Fokus aus dem Titel — das
    // Getippte ging verloren. Hier kommt KEIN Frame, bis getippt ist: sitzt der Fokus trotzdem
    // und bleibt der Titel stehen, hängt er an keinem.
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    try {
      rendere();
      const d = (await screen.findAllByRole('dialog'))[0];
      expect(document.activeElement).toBe(within(d).getByRole('button', { name: /Datei wählen/ }));

      const titel = within(d).getByRole('textbox', { name: 'Titel' });
      await userEvent.type(titel, 'Eigener Titel');
      act(() => frames.splice(0).forEach((cb) => cb(performance.now())));

      expect(document.activeElement).toBe(titel);
      expect(titel).toHaveValue('Eigener Titel');
    } finally {
      raf.mockRestore();
    }
  });

  it('legt ohne Bezug ab und schickt kein bezug-Feld', async () => {
    legeAb.mockResolvedValue({} as never);
    rendere();
    const d = await dialog();
    const datei = pdf();
    await fuellePflicht(d, datei);
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    const [einsatzId, eingabe] = legeAb.mock.calls[0];
    expect(einsatzId).toBe(1);
    expect(eingabe).toEqual({ datei, titel: 'Lageplan Nord', kategorie: 'lagekarte_plan' });
    expect(eingabe).not.toHaveProperty('bezug');
  });

  it('trennt einen gewählten Abschnitt am Präfix in den Bezug', async () => {
    legeAb.mockResolvedValue({} as never);
    rendere();
    const d = await dialog();
    await fuellePflicht(d, pdf());
    await oeffneBezug(d);
    await userEvent.click(within(d).getByRole('combobox', { name: 'Bezug' }));
    await waehleOption('EA Nord');
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    expect(legeAb.mock.calls[0][1].bezug).toEqual({ typ: 'abschnitt', id: 3 });
  });

  it('bietet ETB-Einträge mit laufender Nummer als Bezug an', async () => {
    legeAb.mockResolvedValue({} as never);
    rendere();
    const d = await dialog();
    await fuellePflicht(d, pdf());
    await oeffneBezug(d);
    await userEvent.click(within(d).getByRole('combobox', { name: 'Bezug' }));
    await waehleOption('ETB 12 · Lage erkundet');
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    expect(legeAb.mock.calls[0][1].bezug).toEqual({ typ: 'etb_eintrag', id: 9 });
  });

  describe('Bezugswahl ohne Sprung (LFH-655)', () => {
    it('friert die offene Liste ein: ein neuer ETB-Eintrag erscheint erst nach dem Schließen', async () => {
      const { client } = rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const vorher = optionsLabels();

      etbFenster = [eintrag(10, 13, 'Neue Meldung'), ...etbFenster];
      etbBestand = [...etbFenster, ...etbBestand];
      const abrufeVorher = etbAbrufe;
      await client.invalidateQueries({ queryKey: einsatzKeys.etb(1) });
      expect(etbAbrufe).toBeGreaterThan(abrufeVorher);
      // Der Cache trägt den neuen Eintrag schon — die Liste darf ihn trotzdem nicht einschieben.
      await vi.waitFor(() =>
        expect(
          client
            .getQueriesData<EtbStub[]>({ queryKey: einsatzKeys.etb(1) })
            .some(([, daten]) => daten?.some((e) => e.lfd_nr === 13)),
        ).toBe(true),
      );
      await neuGezeichnet();
      expect(optionsLabels()).toEqual(vorher);

      await schliesseBezugsliste(d);
      await userEvent.click(within(d).getByRole('combobox', { name: 'Bezug' }));
      await vi.waitFor(() => expect(optionsLabels()).toContain('ETB 13 · Neue Meldung'));
    });

    it('ein neuer Abschnitt verschiebt die offene Liste nicht', async () => {
      const { client } = rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const vorher = optionsLabels();

      abschnitte = [...abschnitte, { id: 8, einsatz_id: 1, name: 'EA Süd' }];
      await client.invalidateQueries({ queryKey: einsatzKeys.abschnitte(1) });
      await vi.waitFor(() =>
        expect(
          client.getQueryData<{ name: string }[]>(einsatzKeys.abschnitte(1))?.map((a) => a.name),
        ).toContain('EA Süd'),
      );
      await neuGezeichnet();
      expect(optionsLabels()).toEqual(vorher);
    });

    it('sucht ETB-Einträge am Server, auch jenseits des jüngsten Fensters', async () => {
      legeAb.mockResolvedValue({} as never);
      rendere();
      const d = await dialog();
      await fuellePflicht(d, pdf());
      await oeffneBezugsliste(d);
      expect(optionsLabels()).not.toContain('ETB 3 · Deichbruch gemeldet');

      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'Deichbruch');
      await vi.waitFor(() =>
        expect(etbAnfragen.some((qs) => qs.get('q') === 'Deichbruch')).toBe(true),
      );
      await waehleOption('ETB 3 · Deichbruch gemeldet');
      await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

      await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
      expect(legeAb.mock.calls[0][1].bezug).toEqual({ typ: 'etb_eintrag', id: 5 });
    });

    it('zeigt den gewählten Eintrag weiter mit seinem Label, wenn die Suche zurückfällt', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'Deichbruch');
      await waehleOption('ETB 3 · Deichbruch gemeldet');

      // Nach der Wahl gilt wieder das jüngste Fenster — der Eintrag steht dort nicht. Erst nach
      // der Entprellfrist ist die Suche wirklich zurückgefallen; vorher stünde die Option noch da.
      const feld = within(d).getByRole('combobox', { name: 'Bezug' });
      await vi.waitFor(() => expect(feld).toHaveAttribute('aria-expanded', 'false'));
      await act(() => new Promise((r) => setTimeout(r, 400)));
      await vi.waitFor(() =>
        expect(feld.closest('.ant-select-content')).toHaveTextContent(
          /^ETB 3 · Deichbruch gemeldet$/,
        ),
      );
    });

    it('zeigt Server-Treffer, auch wenn der Begriff nicht im gekürzten Label steht', async () => {
      etbBestand = [...etbBestand, eintrag(6, 4, `Lagemeldung ${'x'.repeat(60)} Sandsäcke`)];
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'Sandsäcke');
      await vi.waitFor(() =>
        expect(optionsLabels()).toEqual([expect.stringMatching(/^ETB 4 · Lagemeldung x+…$/)]),
      );
    });

    it('findet Wortanfänge im jüngsten Fenster, die die Volltextsuche nicht trifft', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'erkund');
      await vi.waitFor(() => expect(etbAnfragen.some((qs) => qs.get('q') === 'erkund')).toBe(true));
      await neuGezeichnet();
      expect(optionsLabels()).toEqual(['ETB 12 · Lage erkundet']);
    });

    it('Enter vor der Server-Antwort wählt keinen Eintrag, der nicht passt', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const feld = within(d).getByRole('combobox', { name: 'Bezug' });
      await userEvent.type(feld, 'Deichbruch');
      // rc-select liest das legacy `keyCode`/`which`, das `userEvent` nicht setzt.
      fireEvent.keyDown(feld, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
      fireEvent.keyUp(feld, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
      await act(() => new Promise((r) => setTimeout(r, 400)));
      expect(feld.closest('.ant-select-content')).not.toHaveTextContent('ETB 12');
    });

    it('schnelles Wiederöffnen zeigt das jüngste Fenster und baut sich danach nicht um', async () => {
      const { client } = rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const feld = within(d).getByRole('combobox', { name: 'Bezug' });
      await userEvent.type(feld, 'Deichbruch');
      await vi.waitFor(() => expect(optionsLabels()).toContain('ETB 3 · Deichbruch gemeldet'));

      await schliesseBezugsliste(d);
      await userEvent.click(feld);
      await vi.waitFor(() => expect(feld).toHaveAttribute('aria-expanded', 'true'));
      const sofort = optionsLabels();
      expect(sofort).toContain('ETB 12 · Lage erkundet');
      expect(sofort).not.toContain('ETB 3 · Deichbruch gemeldet');
      // Ein Live-Eintrag in der offenen Liste: liefe das Leeren der Suche entprellt nach, nähme
      // der Stand danach ein neues Bild — samt diesem Eintrag, unter dem Cursor.
      etbFenster = [eintrag(10, 13, 'Neue Meldung'), ...etbFenster];
      await client.invalidateQueries({ queryKey: einsatzKeys.etb(1) });
      await act(() => new Promise((r) => setTimeout(r, 450)));
      expect(optionsLabels()).toEqual(sofort);
    });

    it('Treffer eines früheren Begriffs gelten nicht für den weitergetippten', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const feld = within(d).getByRole('combobox', { name: 'Bezug' });
      await userEvent.type(feld, 'Deichbruch');
      await vi.waitFor(() => expect(optionsLabels()).toContain('ETB 3 · Deichbruch gemeldet'));
      // Innerhalb der Entprellfrist: die Antwort für „Deichbruch Pumpe" steht noch aus.
      await userEvent.type(feld, ' Pumpe');
      expect(optionsLabels()).not.toContain('ETB 3 · Deichbruch gemeldet');
    });

    it('eine gescheiterte Suche lässt keine alten Treffer stehen', async () => {
      scheitertBei = ['Lage'];
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const feld = within(d).getByRole('combobox', { name: 'Bezug' });
      await userEvent.type(feld, 'Deichbruch');
      await vi.waitFor(() => expect(optionsLabels()).toContain('ETB 3 · Deichbruch gemeldet'));

      await userEvent.clear(feld);
      await userEvent.type(feld, 'Lage');
      await vi.waitFor(() => expect(etbAnfragen.some((qs) => qs.get('q') === 'Lage')).toBe(true));
      await neuGezeichnet();
      // Ohne Server-Antwort bleibt der Filter über das jüngste Fenster — nie die Treffer von vorhin.
      expect(optionsLabels()).toEqual(['ETB 12 · Lage erkundet']);
    });

    it('friert auch ein, wenn eine Quelle verweigert wird (403 ohne Modulrecht)', async () => {
      server.use(
        http.get('/api/einsaetze/1/einheiten', () =>
          HttpResponse.json({ fehler: 'kein Zugriff' }, { status: 403 }),
        ),
      );
      const { client } = rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const vorher = optionsLabels();

      etbFenster = [eintrag(10, 13, 'Neue Meldung'), ...etbFenster];
      await client.invalidateQueries({ queryKey: einsatzKeys.etb(1) });
      await vi.waitFor(() =>
        expect(
          client
            .getQueriesData<EtbStub[]>({ queryKey: einsatzKeys.etb(1) })
            .some(([, daten]) => daten?.some((e) => e.lfd_nr === 13)),
        ).toBe(true),
      );
      await neuGezeichnet();
      expect(optionsLabels()).toEqual(vorher);
    });

    it('findet einen ETB-Eintrag über seine laufende Nummer', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'ETB 412');
      await vi.waitFor(() => expect(optionsLabels()).toEqual(['ETB 412 · Pumpe 2']));
    });

    it('filtert Abschnitte und Einheiten am Client mit', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'Nord');
      await vi.waitFor(() => expect(optionsLabels()).toContain('EA Nord'));
      expect(optionsLabels()).not.toContain('Florian 1');
    });
  });

  it('ersetzt einen automatisch gesetzten Titel bei neuer Dateiwahl', async () => {
    rendere();
    const d = await dialog();
    await userEvent.upload(dateiInput(d), pdf());
    await userEvent.upload(
      dateiInput(d),
      new File(['x'], 'Befehl 3.docx', { type: 'application/octet-stream' }),
    );
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Befehl 3');
  });

  it('lässt einen getippten Titel auch bei zweiter Dateiwahl stehen', async () => {
    rendere();
    const d = await dialog();
    await userEvent.upload(dateiInput(d), pdf());
    const titel = within(d).getByRole('textbox', { name: 'Titel' });
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Mein Plan');
    await userEvent.upload(dateiInput(d), new File(['x'], 'Befehl 3.docx'));
    expect(titel).toHaveValue('Mein Plan');
  });

  it('das Entfernen der Datei füllt einen geleerten Titel NICHT wieder auf', async () => {
    // Ohne den `removed`-Riegel läse die Entfernen-Meldung wie eine Dateiwahl: der geleerte
    // Titel stünde danach wieder auf dem Namen der gerade entfernten Datei.
    rendere();
    const d = await dialog();
    await userEvent.upload(dateiInput(d), pdf());
    const titel = within(d).getByRole('textbox', { name: 'Titel' });
    await userEvent.clear(titel);
    await userEvent.click(within(d).getByRole('button', { name: /remove|entfernen/i }));
    expect(titel).toHaveValue('');
  });

  /** Eine Datei mit vorgetäuschter Größe — kein 25-MiB-Puffer im Test. antd liest `file.size`. */
  function pdfMitGroesse(groesse: number) {
    const datei = pdf();
    Object.defineProperty(datei, 'size', { value: groesse });
    return datei;
  }

  it('weist eine Datei über 25 MiB vor dem Hochladen ab', async () => {
    rendere();
    const d = await dialog();
    await fuellePflicht(d, pdfMitGroesse(UPLOAD_MAX_GROESSE + 1));
    // Vorbedingung: die Datei ist wirklich angekommen (Titel aus dem Dateinamen) — sonst wäre
    // „nicht abgeschickt" trivial wahr, weil schon die Pflichtregel griffe.
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Lageplan Nord');
    expect(await within(d).findByText('Datei ist zu groß (25 MiB erlaubt)')).toBeInTheDocument();

    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    await vi.waitFor(() =>
      expect(within(d).getAllByText('Datei ist zu groß (25 MiB erlaubt)')).toHaveLength(1),
    );
    expect(legeAb).not.toHaveBeenCalled();
  });

  it('lässt eine Datei von genau 25 MiB durch (der Server prüft mit „>")', async () => {
    legeAb.mockResolvedValue({} as never);
    rendere();
    const d = await dialog();
    await fuellePflicht(d, pdfMitGroesse(UPLOAD_MAX_GROESSE));
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    expect(within(d).queryByText('Datei ist zu groß (25 MiB erlaubt)')).not.toBeInTheDocument();
  });

  it('fokussiert beim Öffnen „Datei wählen" statt des verborgenen Datei-Inputs', async () => {
    // Belegt die Verdrahtung; die Fokussierbarkeit im echten Browser misst das e2e.
    rendere();
    const d = await dialog();
    const knopf = within(d).getByRole('button', { name: /Datei wählen/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(knopf));
  });

  it('lässt Titel und Datei bei Ablehnung stehen und zeigt den Fehler IM Dialog', async () => {
    legeAb.mockRejectedValue(new ApiError(400, 'Dateityp exe ist nicht erlaubt'));
    rendere();
    const d = await dialog();
    await fuellePflicht(d, pdf(), 'Mein Plan');
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    const alarm = await within(d).findByRole('alert');
    expect(alarm).toHaveTextContent('Dateityp exe ist nicht erlaubt');
    // Im Dialog, nicht bloß in der Toast-Warteschlange.
    expect(alarm.closest('.ant-message')).toBeNull();
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Mein Plan');
    expect(within(d).getByText('Lageplan Nord.pdf')).toBeInTheDocument();
  });

  it('schließt nach Erfolg und ist beim Wiederöffnen leer — Datei eingeschlossen', async () => {
    legeAb.mockResolvedValue({} as never);
    rendere();
    const d = await dialog();
    await fuellePflicht(d, pdf());
    await oeffneBezug(d);
    await userEvent.click(within(d).getByRole('combobox', { name: 'Bezug' }));
    await waehleOption('Florian 1');
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    await warteBisDialogWeg();

    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    const neu = await dialog();
    expect(within(neu).getByRole('textbox', { name: 'Titel' })).toHaveValue('');
    expect(within(neu).queryByText('Lageplan Nord.pdf')).not.toBeInTheDocument();
    expect(within(neu).queryByText('Lagekarte/Plan')).not.toBeInTheDocument();
    expect(within(neu).queryByText('Florian 1')).not.toBeInTheDocument();
  });

  it('Struktur statt Tastendruck: Absende-Knopf im <form>, keine Modal-Fußzeile', async () => {
    rendere();
    const d = await dialog();
    const knopf = within(d).getByRole('button', { name: 'Ablegen' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });
});

/**
 * LFH-654 (Prüfliste LFH-632, Zeile 2 · 3): Fortschritt, Prüfphase und eine Fehlermeldung, die
 * die Phase des Abbruchs nennt. `legeDokumentAb` ist gemockt; der Test steuert den Rückruf.
 */
describe('DokumentAblegenModal — Rückmeldung beim Ablegen (LFH-654)', () => {
  /** Startet eine Ablage, die erst auf `erfuellen`/`ablehnen` endet. */
  async function starteAblage() {
    let melde: ((f: UploadFortschritt) => void) | undefined;
    let erfuellen!: (wert: unknown) => void;
    let ablehnen!: (e: unknown) => void;
    legeAb.mockImplementation((_id, _eingabe, onFortschritt) => {
      melde = onFortschritt;
      return new Promise((res, rej) => {
        erfuellen = res as (wert: unknown) => void;
        ablehnen = rej;
      });
    });
    rendere();
    const d = await dialog();
    await fuellePflicht(d, pdf(), 'Mein Plan');
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    const fortschritt = (f: UploadFortschritt) => act(() => melde!(f));
    return { d, fortschritt, erfuellen, ablehnen };
  }

  it('zeigt den Balken sofort nach dem Absenden, noch vor dem ersten Byte-Ereignis', async () => {
    const { d } = await starteAblage();
    const balken = await within(d).findByRole('progressbar', { name: 'Wird hochgeladen' });
    expect(balken).not.toHaveAttribute('aria-valuenow');
  });

  it('zeigt den Anteil der übertragenen Bytes in Prozent und sperrt „Ablegen“', async () => {
    const { d, fortschritt } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 0.25 });
    const balken = await within(d).findByRole('progressbar', { name: 'Wird hochgeladen · 25 %' });
    expect(balken).toHaveAttribute('aria-valuenow', '25');
    expect(within(d).getByRole('button', { name: /Ablegen/ })).toHaveClass('ant-btn-loading');
  });

  it('geht nie zurück: ein kleinerer Stand nach 40 % bleibt bei 40 %', async () => {
    const { d, fortschritt } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 0.4 });
    fortschritt({ phase: 'senden', anteil: 0.3 });
    await within(d).findByRole('progressbar', { name: 'Wird hochgeladen · 40 %' });
    expect(within(d).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('zeigt ohne bekannte Gesamtgröße einen Balken ohne Zahl', async () => {
    const { d, fortschritt } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: null });
    const balken = await within(d).findByRole('progressbar', { name: 'Wird hochgeladen' });
    expect(balken).not.toHaveAttribute('aria-valuenow');
  });

  it('wechselt nach dem letzten Byte auf „Datei wird geprüft“ ohne Zahl', async () => {
    const { d, fortschritt } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 1 });
    fortschritt({ phase: 'pruefen' });
    const balken = await within(d).findByRole('progressbar', { name: 'Datei wird geprüft' });
    expect(balken).not.toHaveAttribute('aria-valuenow');
    expect(within(d).queryByText(/%/)).not.toBeInTheDocument();
    // Ein spätes `progress` nach der Prüfphase holt die Prozentzahl nicht zurück.
    fortschritt({ phase: 'senden', anteil: 1 });
    expect(within(d).getByRole('progressbar', { name: 'Datei wird geprüft' })).toBeInTheDocument();
  });

  it('die Ansage-Region spricht in 10-%-Schritten, nicht bei jedem Ereignis', async () => {
    const { d, fortschritt } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 0.21 });
    const region = await vi.waitFor(() => {
      const r = d.querySelector('[aria-live="polite"]');
      expect(r).toHaveTextContent('Wird hochgeladen · 20 %');
      return r!;
    });
    fortschritt({ phase: 'senden', anteil: 0.27 });
    expect(region).toHaveTextContent('Wird hochgeladen · 20 %');
  });

  it('räumt den Fortschritt nach Erfolg: beim Wiederöffnen steht keiner mehr', async () => {
    const { d, fortschritt, erfuellen } = await starteAblage();
    fortschritt({ phase: 'pruefen' });
    await within(d).findByRole('progressbar', { name: 'Datei wird geprüft' });
    await act(async () => erfuellen({}));
    await warteBisDialogWeg();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    const neu = await dialog();
    expect(within(neu).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(neu).queryByText('Datei wird geprüft')).not.toBeInTheDocument();
  });

  it('ein abgebrochener Lauf schreibt nicht in die Anzeige des nächsten', async () => {
    const melder: ((f: UploadFortschritt) => void)[] = [];
    legeAb.mockImplementation((_id, _eingabe, onFortschritt) => {
      melder.push(onFortschritt!);
      return new Promise(() => undefined);
    });
    rendere();
    let d = await dialog();
    await fuellePflicht(d, pdf(), 'Erster');
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    await userEvent.click(within(d).getByRole('button', { name: 'Abbrechen' }));
    await warteBisDialogWeg();

    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    d = await dialog();
    await fuellePflicht(d, pdf(), 'Zweiter');
    await userEvent.click(within(d).getByRole('button', { name: /Ablegen/ }));
    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(2));
    act(() => melder[1]({ phase: 'senden', anteil: 0.1 }));
    // Die alte Übertragung läuft serverseitig weiter und meldet noch.
    act(() => melder[0]({ phase: 'pruefen' }));
    expect(
      await within(d).findByRole('progressbar', { name: 'Wird hochgeladen · 10 %' }),
    ).toBeInTheDocument();
    expect(within(d).queryByRole('progressbar', { name: 'Datei wird geprüft' })).toBeNull();
  });

  it('der Abschluss eines abgebrochenen Laufs räumt die Anzeige des nächsten nicht', async () => {
    const melder: ((f: UploadFortschritt) => void)[] = [];
    const erfueller: ((wert: unknown) => void)[] = [];
    legeAb.mockImplementation((_id, _eingabe, onFortschritt) => {
      melder.push(onFortschritt!);
      return new Promise((res) => erfueller.push(res as (wert: unknown) => void));
    });
    rendere();
    let d = await dialog();
    await fuellePflicht(d, pdf(), 'Erster');
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    await userEvent.click(within(d).getByRole('button', { name: 'Abbrechen' }));
    await warteBisDialogWeg();

    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    d = await dialog();
    await fuellePflicht(d, pdf(), 'Zweiter');
    await userEvent.click(within(d).getByRole('button', { name: /Ablegen/ }));
    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(2));
    act(() => melder[1]({ phase: 'pruefen' }));
    await within(d).findByRole('progressbar', { name: 'Datei wird geprüft' });
    // Die alte Übertragung endet, während die neue noch geprüft wird.
    await act(async () => erfueller[0]({}));
    expect(within(d).getByRole('progressbar', { name: 'Datei wird geprüft' })).toBeInTheDocument();
  });

  it('Leitung reißt beim Senden ab: „nichts abgelegt“, Felder bleiben, kein Fortschritt', async () => {
    const { d, fortschritt, ablehnen } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 0.6 });
    await act(async () => ablehnen(new NetzFehler()));
    const alarm = await within(d).findByRole('alert');
    expect(alarm).toHaveTextContent('Nicht abgelegt');
    expect(alarm).toHaveTextContent('Keine Verbindung');
    expect(alarm).toHaveTextContent('NICHT abgeschickt');
    expect(within(d).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Mein Plan');
    expect(within(d).getByText('Lageplan Nord.pdf')).toBeInTheDocument();
    expect(within(d).getByText('Lagekarte/Plan')).toBeInTheDocument();
  });

  it('Antwort bleibt nach dem letzten Byte aus: „unklar, Liste prüfen“, nicht „nicht abgeschickt“', async () => {
    const { d, fortschritt, ablehnen } = await starteAblage();
    fortschritt({ phase: 'pruefen' });
    await act(async () => ablehnen(new AusgangUnbekannt()));
    const alarm = await within(d).findByRole('alert');
    expect(alarm).toHaveTextContent('Ablage unklar');
    expect(alarm).toHaveTextContent(/unklar/);
    expect(alarm).toHaveTextContent(/Liste prüfen/);
    expect(alarm).not.toHaveTextContent('NICHT abgeschickt');
    expect(alarm).not.toHaveTextContent('Nicht abgelegt');
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Mein Plan');
  });

  it('ohne Verbindung wird nichts vorgemerkt, und ein zweites „Ablegen“ sendet erneut', async () => {
    const einreihen = vi.spyOn(queue, 'schreibaktionEinreihen');
    const { d, ablehnen } = await starteAblage();
    await act(async () => ablehnen(new NetzFehler()));
    await within(d).findByRole('alert');
    expect(einreihen).not.toHaveBeenCalled();

    legeAb.mockResolvedValue({} as never);
    await userEvent.click(within(d).getByRole('button', { name: /Ablegen/ }));
    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(2));
    expect(legeAb.mock.calls[1][1]).toMatchObject({
      titel: 'Mein Plan',
      kategorie: 'lagekarte_plan',
    });
    expect(einreihen).not.toHaveBeenCalled();
  });
});
