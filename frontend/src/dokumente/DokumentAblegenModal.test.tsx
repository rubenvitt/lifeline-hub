import { http, HttpResponse } from 'msw';
import { fireEvent, isInaccessible, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import DokumentAblegenModal from './DokumentAblegenModal';

vi.mock('../api/dokumente', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../api/dokumente')>();
  return { ...echt, legeDokumentAb: vi.fn() };
});
import { DOKUMENT_MAX_GROESSE, legeDokumentAb } from '../api/dokumente';

const legeAb = vi.mocked(legeDokumentAb);

let etbAbrufe = 0;

beforeEach(() => {
  etbAbrufe = 0;
  legeAb.mockReset();
  server.use(
    http.get('/api/einsaetze/1/abschnitte', () =>
      HttpResponse.json([{ id: 3, einsatz_id: 1, name: 'EA Nord' }]),
    ),
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 4, einsatz_id: 1, name: 'Florian 1' }]),
    ),
    http.get('/api/einsaetze/1/etb', () => {
      etbAbrufe += 1;
      return HttpResponse.json([{ id: 9, einsatz_id: 1, lfd_nr: 12, inhalt: 'Lage erkundet' }]);
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

/** Der Dialog, NACHDEM sein Anfangsfokus sitzt. Die Hülle fokussiert „Datei wählen“ per
 *  `requestAnimationFrame`; tippte ein Test vorher, zog der nachlaufende Fokus die Tasten aus
 *  dem Titelfeld ab — unter Last blieb „Titel“ leer und die Dateiwahl belegte ihn mit dem
 *  Dateinamen (in der CI von PR #158 rot, lokal 2 von 4 vollen Läufen). */
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
    // Erst den Einstiegsfokus abwarten (LFH-373, in der CI zweimal rot): der Dialog setzt ihn
    // per `requestAnimationFrame` auf „Datei wählen". Auf einem langsamen Runner feuerte das
    // MITTEN im Tippen, die restlichen Zeichen gingen an den Knopf, der Titel blieb leer — und
    // die Dateiwahl füllte ihn dann zu Recht mit dem Dateinamen.
    const knopf = within(d).getByRole('button', { name: /Datei wählen/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(knopf));
    await userEvent.type(within(d).getByRole('textbox', { name: 'Titel' }), 'Eigener Titel');
    await userEvent.upload(dateiInput(d), pdf());
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Eigener Titel');
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
    await fuellePflicht(d, pdfMitGroesse(DOKUMENT_MAX_GROESSE + 1));
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
    await fuellePflicht(d, pdfMitGroesse(DOKUMENT_MAX_GROESSE));
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    expect(within(d).queryByText('Datei ist zu groß (25 MiB erlaubt)')).not.toBeInTheDocument();
  });

  it('fokussiert beim Öffnen „Datei wählen" statt des verborgenen Datei-Inputs', async () => {
    // Belegt die Verdrahtung. Dass der Knopf im echten Browser fokussierbar ist und das
    // `<input type="file">` nicht, misst erst das e2e (Task 5) — jsdom rechnet kein display.
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
