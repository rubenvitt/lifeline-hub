import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { VerpflegungZeitfenster, ZeitfensterPatch } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { OffeneBearbeitungProvider } from '../components/offeneBearbeitung';
import { freigabenFixture } from '../test/fixtures';
import { mitProzessZone } from '../test/prozessZone';
import { optionenVon, oeffne, waehle } from '../test/auswahlListe';
import { renderMitProviders } from '../test/utils';
import {
  FELDKUECHE,
  TURNHALLE,
  ausgabe,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import type { Bedarfsvorschlag, BedarfsvorschlagArgs } from './useBedarfsvorschlag';
import { uhrzeitenText, zeitfensterKennung } from './verpflegungText';

dayjs.extend(utc);

/**
 * „Bedarf bearbeiten“ in der Zeitfensterkarte statt im Modal (LLH-1139; Spec
 * `kraefte-verpflegung`, „Zeitfenster ändern und löschen“, und `formularseiten`, „Eine offene
 * Bearbeitung je Ansicht“). Geprüft über die Karte, wie die Person sie bedient.
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - Patch gegen den LIVE-Stand statt gegen den Stand beim Öffnen: rot in „ein Live-Stand während
 *   der Bearbeitung“.
 * - Sperrgrund an der zweiten Karte entfernt (`gesperrt` nicht durchgereicht): rot in „zweite
 *   Karte gesperrt“.
 */

const vorschlag = vi.hoisted(() => ({
  aufrufe: [] as BedarfsvorschlagArgs[],
  liefere: (() => ({
    kraefte: { wert: null, hinweis: null },
    betreute: { wert: null, hinweis: null },
  })) as (a: BedarfsvorschlagArgs) => Bedarfsvorschlag,
}));
vi.mock('./useBedarfsvorschlag', () => ({
  useBedarfsvorschlag: (a: BedarfsvorschlagArgs) => {
    vorschlag.aufrufe.push(a);
    return vorschlag.liefere(a);
  },
}));

const { default: ZeitfensterKarte } = await import('./ZeitfensterKarte');

const LAUFEND = dayjs('2026-09-24T10:30:00Z');
const FREIGABEN = freigabenFixture();
const K_HINWEIS = 'Vorschlag: Personal im Einsatz, Stand 09:58';
/** Stand eines nie geänderten Zeitfensters: die Anlage (CAS-Basis, LLH-1414). */
const ANLAGE = zeitfenster().angelegt_at;

beforeEach(() => {
  vorschlag.aufrufe = [];
  vorschlag.liefere = () => ({
    kraefte: { wert: null, hinweis: null },
    betreute: { wert: null, hinweis: null },
  });
});

/** Gedeckt, damit nur zwei Aktionen als Knöpfe stehen (kein Menü). */
function gedeckt(over: Partial<VerpflegungZeitfenster> = {}) {
  return zeitfenster({
    ausgegeben: { gesamt: 250, sonderkost: { ...zeitfenster().bedarf.sonderkost } },
    fehlmenge: { gesamt: 0, sonderkost: { ...zeitfenster().fehlmenge.sonderkost } },
    ...over,
  });
}

function zeigeKarte(
  zf: VerpflegungZeitfenster = gedeckt(),
  onBedarfSpeichern = vi.fn<
    (z: VerpflegungZeitfenster, p: ZeitfensterPatch, b: string | undefined) => Promise<unknown>
  >(async () => undefined),
  stellen = [] as ReturnType<typeof stelle>[],
) {
  const onBedarfNeuLaden = vi.fn();
  const karte = (z: VerpflegungZeitfenster) => (
    <ZeitfensterKarte
      zeitfenster={z}
      jetzt={LAUFEND}
      darfSchreiben
      nachforderungenFrei
      onAusgabeNachtragen={vi.fn()}
      onBedarfSpeichern={onBedarfSpeichern}
      onBedarfNeuLaden={onBedarfNeuLaden}
      freigaben={FREIGABEN}
      stellen={stellen}
    />
  );
  const r = renderMitProviders(karte(zf), { datenRouter: true });
  return {
    onBedarfSpeichern,
    onBedarfNeuLaden,
    neu: (z: VerpflegungZeitfenster) => r.rerender(karte(z)),
  };
}

const kennung = zeitfensterKennung(zeitfenster());
const oeffneBearbeiten = () =>
  userEvent.click(screen.getByRole('button', { name: `Bedarf bearbeiten zu ${kennung}` }));

describe('Zeitfensterkarte · Bedarf bearbeiten in der Ansicht', () => {
  it('schaltet die Karte selbst um, kein Dialog; Kopf bleibt, Kennzahlen und Aktionen weichen', async () => {
    zeigeKarte();
    await oeffneBearbeiten();
    const formular = await screen.findByRole('form', { name: 'Mittag bearbeiten' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('article')).toContainElement(formular);
    expect(within(formular).getByLabelText('Bezeichnung')).toHaveValue('Mittag');
    expect(within(formular).getByLabelText('Einsatzkräfte (EP)')).toHaveValue('180');
    expect(within(formular).getByLabelText('Betreute (EP)')).toHaveValue('70');
    expect(within(formular).getByLabelText('Weitere Personen (EP)')).toHaveValue('0');
    expect(within(formular).getByLabelText('davon vegan')).toHaveValue('3');
    // Kopf bleibt, Kennzahlenband und Aktionszeile sind weg.
    expect(screen.getByText('Mittag', { selector: 'strong, span' })).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="kennzahl"]')).toBeNull();
    expect(document.querySelector('[data-lfh="verpflegung-aktionen"]')).toBeNull();
    await waitFor(() => expect(within(formular).getByLabelText('Bezeichnung')).toHaveFocus());
  });

  it('Betreute 70 → 90 schickt genau diesen Schlüssel und zeigt danach wieder die Karte', async () => {
    const { onBedarfSpeichern } = zeigeKarte();
    await oeffneBearbeiten();
    const betreute = await screen.findByLabelText('Betreute (EP)');
    await userEvent.clear(betreute);
    await userEvent.type(betreute, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onBedarfSpeichern).toHaveBeenCalledWith(
        expect.anything(),
        { bedarf_betreute: 90 },
        ANLAGE,
      ),
    );
    expect(
      await screen.findByRole('button', { name: `Bedarf bearbeiten zu ${kennung}` }),
    ).toBeVisible();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('unverändert wird nichts gesendet, die Karte schließt', async () => {
    const { onBedarfSpeichern } = zeigeKarte();
    await oeffneBearbeiten();
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(onBedarfSpeichern).not.toHaveBeenCalled();
  });

  it('Escape bricht ab, der Fokus steht wieder auf „Bedarf bearbeiten“', async () => {
    const { onBedarfSpeichern } = zeigeKarte();
    await oeffneBearbeiten();
    await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'essen');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('form')).toBeNull();
    expect(onBedarfSpeichern).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `Bedarf bearbeiten zu ${kennung}` })).toHaveFocus(),
    );
  });

  it('eine Ablehnung (422) steht an der Karte, die Eingabe bleibt', async () => {
    const { onBedarfSpeichern } = zeigeKarte();
    onBedarfSpeichern.mockRejectedValueOnce(
      new ApiError(422, 'Sonderkost übersteigt den Gesamtbedarf'),
    );
    await oeffneBearbeiten();
    const vegan = await screen.findByLabelText('davon vegan');
    await userEvent.clear(vegan);
    await userEvent.type(vegan, '400');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    // Der Fehltext blendet per antd-Motion ein (erst Höhe 0, Deckkraft 0): auf das Ende warten.
    await waitFor(() =>
      expect(screen.getByText('Sonderkost übersteigt den Gesamtbedarf')).toBeVisible(),
    );
    expect(screen.getByLabelText('davon vegan')).toHaveValue('400');
    expect(onBedarfSpeichern).toHaveBeenCalledWith(
      expect.anything(),
      { sonderkost: { vegan: 400 } },
      ANLAGE,
    );
  });

  it('ein leeres Pflichtfeld zeigt den Grund unter der Zelle und sendet nichts', async () => {
    const { onBedarfSpeichern } = zeigeKarte();
    await oeffneBearbeiten();
    await userEvent.clear(await screen.findByLabelText('Einsatzkräfte (EP)'));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    // Der Fehltext blendet per antd-Motion ein (erst Höhe 0, Deckkraft 0): auf das Ende warten.
    await waitFor(() =>
      expect(screen.getByText('Bitte eine Anzahl angeben — 0, wenn niemand')).toBeVisible(),
    );
    expect(onBedarfSpeichern).not.toHaveBeenCalled();
  });

  it('zeigt den Vorschlag als Hilfe und überschreibt den gespeicherten Bedarf nicht', async () => {
    vorschlag.liefere = () => ({
      kraefte: { wert: 186, hinweis: K_HINWEIS },
      betreute: { wert: 90, hinweis: 'Vorschlag: in Betreuung zum Beginn' },
    });
    zeigeKarte();
    await oeffneBearbeiten();
    expect(await screen.findByText(`Aktuell 186 — ${K_HINWEIS}`)).toBeVisible();
    expect(screen.getByText('Aktuell 90 — Vorschlag: in Betreuung zum Beginn')).toBeVisible();
    expect(screen.getByLabelText('Einsatzkräfte (EP)')).toHaveValue('180');
    expect(screen.getByLabelText('Betreute (EP)')).toHaveValue('70');
    // Der Beginn geht schon im ersten Render als Wire in den Hook (kein „jetzt“).
    expect(vorschlag.aufrufe.map((x) => x.vonAt)).not.toContain(undefined);
    expect(vorschlag.aufrufe[vorschlag.aufrufe.length - 1].vonAt).toBe('2026-09-24 10:00:00');
  });

  it('ein Live-Stand während der Bearbeitung ändert weder die Eingaben noch die Vergleichsbasis', async () => {
    const { onBedarfSpeichern, neu } = zeigeKarte();
    await oeffneBearbeiten();
    const betreute = await screen.findByLabelText('Betreute (EP)');
    neu(gedeckt({ bedarf: { ...zeitfenster().bedarf, kraefte: 200, gesamt: 270 } }));
    expect(screen.getByLabelText('Einsatzkräfte (EP)')).toHaveValue('180');
    await userEvent.clear(betreute);
    await userEvent.type(betreute, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    // Nur die eigene Änderung: die fremden 200 Kräfte werden nicht mit 180 überschrieben.
    await waitFor(() =>
      expect(onBedarfSpeichern).toHaveBeenCalledWith(
        expect.anything(),
        { bedarf_betreute: 90 },
        ANLAGE,
      ),
    );
  });
  it('ein zwischenzeitlich geändertes Zeitfenster fragt nach; übernehmen schickt ohne Basis', async () => {
    // LLH-1414: die Basis ist der Stand beim Öffnen, hier eine frühere Änderung.
    const stand = '2026-09-24 08:15:00';
    const { onBedarfSpeichern } = zeigeKarte(gedeckt({ geaendert_at: stand }));
    onBedarfSpeichern.mockRejectedValueOnce(
      new ApiError(409, 'Das Zeitfenster wurde zwischenzeitlich geändert. Bitte neu laden.'),
    );
    await oeffneBearbeiten();
    const betreute = await screen.findByLabelText('Betreute (EP)');
    await userEvent.clear(betreute);
    await userEvent.type(betreute, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const rueckfrage = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    expect(onBedarfSpeichern).toHaveBeenLastCalledWith(
      expect.anything(),
      { bedarf_betreute: 90 },
      stand,
    );
    await userEvent.click(
      within(rueckfrage).getByRole('button', { name: 'Meine Änderung übernehmen' }),
    );
    await waitFor(() =>
      expect(onBedarfSpeichern).toHaveBeenLastCalledWith(
        expect.anything(),
        { bedarf_betreute: 90 },
        undefined,
      ),
    );
    expect(onBedarfSpeichern).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('„Verwerfen und neu laden“ nach dem 409 lädt neu und schließt die Bearbeitung', async () => {
    const { onBedarfSpeichern, onBedarfNeuLaden } = zeigeKarte();
    onBedarfSpeichern.mockRejectedValueOnce(new ApiError(409, 'zwischenzeitlich geändert'));
    await oeffneBearbeiten();
    const betreute = await screen.findByLabelText('Betreute (EP)');
    await userEvent.clear(betreute);
    await userEvent.type(betreute, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const rueckfrage = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    await userEvent.click(
      within(rueckfrage).getByRole('button', { name: 'Verwerfen und neu laden' }),
    );
    expect(onBedarfNeuLaden).toHaveBeenCalledTimes(1);
    expect(onBedarfSpeichern).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });
});

describe('Zeitfensterkarte · eine offene Bearbeitung je Seite', () => {
  it('zweite Karte gesperrt, mit Grund; nach dem Abbrechen wieder frei', async () => {
    const abend = gedeckt({ id: 2, bezeichnung: 'Abend' });
    const karte = (z: VerpflegungZeitfenster) => (
      <ZeitfensterKarte
        key={z.id}
        zeitfenster={z}
        jetzt={LAUFEND}
        darfSchreiben
        nachforderungenFrei
        onAusgabeNachtragen={vi.fn()}
        onBedarfSpeichern={async () => undefined}
        freigaben={FREIGABEN}
      />
    );
    renderMitProviders(
      <OffeneBearbeitungProvider>
        {karte(gedeckt())}
        {karte(abend)}
      </OffeneBearbeitungProvider>,
      { datenRouter: true },
    );
    await oeffneBearbeiten();
    await screen.findByRole('form', { name: 'Mittag bearbeiten' });
    const zweite = screen.getByRole('button', {
      name: `Bedarf bearbeiten zu ${zeitfensterKennung(abend)}`,
    });
    expect(zweite).toBeDisabled();
    expect(zweite).toHaveAccessibleDescription('Erst „Mittag“ speichern oder abbrechen');
    expect(screen.getByText('Erst „Mittag“ speichern oder abbrechen')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(
      screen.getByRole('button', { name: `Bedarf bearbeiten zu ${zeitfensterKennung(abend)}` }),
    ).toBeEnabled();
  });

  it('im Menü steht „Bedarf bearbeiten“ gesperrt', async () => {
    // Unterdeckung: drei Aktionen, alle im Menü.
    const abend = zeitfenster({ id: 2, bezeichnung: 'Abend', ausgaben: [ausgabe({ id: 21 })] });
    renderMitProviders(
      <OffeneBearbeitungProvider>
        <ZeitfensterKarte
          zeitfenster={gedeckt()}
          jetzt={LAUFEND}
          darfSchreiben
          nachforderungenFrei
          onAusgabeNachtragen={vi.fn()}
          onBedarfSpeichern={async () => undefined}
        />
        <ZeitfensterKarte
          zeitfenster={abend}
          jetzt={LAUFEND}
          darfSchreiben
          nachforderungenFrei
          onAusgabeNachtragen={vi.fn()}
          onNachfordern={vi.fn()}
          onBedarfSpeichern={async () => undefined}
        />
      </OffeneBearbeitungProvider>,
      { datenRouter: true },
    );
    await oeffneBearbeiten();
    await screen.findByRole('form', { name: 'Mittag bearbeiten' });
    expect(screen.getByText('Erst „Mittag“ speichern oder abbrechen')).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: `Aktionen zu Zeitfenster ${zeitfensterKennung(abend)}` }),
    );
    const eintrag = await screen.findByRole('menuitem', { name: 'Bedarf bearbeiten' });
    expect(eintrag).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Zeitfensterkarte · Zeitzone beim Bearbeiten (LFH-692)', () => {
  mitProzessZone('UTC');
  const BERLIN = { zeitzone: 'Europe/Berlin' };

  function zeigeBerlin() {
    const onBedarfSpeichern = vi.fn(async () => undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <ZeitfensterKarte
          zeitfenster={gedeckt()}
          jetzt={LAUFEND}
          darfSchreiben
          nachforderungenFrei
          onAusgabeNachtragen={vi.fn()}
          onBedarfSpeichern={onBedarfSpeichern}
          freigaben={FREIGABEN}
        />
      </AnzeigeKonventionenProvider>,
      { datenRouter: true },
    );
    return { onBedarfSpeichern };
  }

  it('zeigt dieselben Uhrzeiten wie die Karte', async () => {
    zeigeBerlin();
    await userEvent.click(screen.getByRole('button', { name: /^Bedarf bearbeiten zu / }));
    expect(uhrzeitenText(zeitfenster(), BERLIN)).toBe('1200–1330');
    expect(await screen.findByRole('textbox', { name: 'Beginn' })).toHaveValue('241200sep26');
    expect(screen.getByRole('textbox', { name: 'Ende' })).toHaveValue('241330sep26');
  });

  it('nur geänderter Bedarf schickt keinen Zeitraum', async () => {
    const { onBedarfSpeichern } = zeigeBerlin();
    await userEvent.click(screen.getByRole('button', { name: /^Bedarf bearbeiten zu / }));
    const betreute = await screen.findByLabelText('Betreute (EP)');
    await userEvent.clear(betreute);
    await userEvent.type(betreute, '90');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onBedarfSpeichern).toHaveBeenCalledWith(
        expect.anything(),
        { bedarf_betreute: 90 },
        ANLAGE,
      ),
    );
  });
});

describe('Zeitfensterkarte · Stellen und Art beim Bearbeiten (LLH-1040, D13)', () => {
  const STELLEN = [
    ...verpflegungMitStellen().stellen,
    stelle({ id: 30, bezeichnung: 'Ausgabe Schule', status: 'aufgeloest' }),
    stelle({ id: 31, bezeichnung: 'Ausgabe Halle Süd', status: 'aufgeloest' }),
  ];

  async function leere(feld: string) {
    const auswahl = screen.getByRole('combobox', { name: feld }).closest('.ant-select')!;
    const kreuz = auswahl.querySelector<HTMLElement>('.ant-select-clear');
    expect(kreuz).not.toBeNull();
    await userEvent.click(kreuz!);
  }

  it('eine schon zugeordnete aufgelöste Stelle bleibt wählbar, andere aufgelöste nicht', async () => {
    zeigeKarte(
      gedeckt({ stelle_ids: [TURNHALLE, 30], verpflegungsart: 'kalt' }),
      undefined,
      STELLEN,
    );
    await oeffneBearbeiten();
    await screen.findByRole('form');
    await oeffne('Stellen');
    const optionen = optionenVon('Stellen');
    expect(optionen).toContain('Ausgabe Schule (aufgelöst)');
    expect(optionen).not.toContain('Ausgabe Halle Süd (aufgelöst)');
    expect(optionenVon('Stellen', '-selected')).toEqual([
      'Ausgabe Turnhalle Nord',
      'Ausgabe Schule (aufgelöst)',
    ]);
  });

  it('Leeren der Art schickt `null`, eine abgewählte Stelle die neue Zuordnung', async () => {
    const { onBedarfSpeichern } = zeigeKarte(
      gedeckt({ stelle_ids: [TURNHALLE, FELDKUECHE], verpflegungsart: 'warm' }),
      undefined,
      STELLEN,
    );
    await oeffneBearbeiten();
    await screen.findByRole('form');
    await leere('Art');
    await waehle('Stellen', 'Feldküche BR Sportplatz');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onBedarfSpeichern).toHaveBeenCalledWith(
        expect.anything(),
        { verpflegungsart: null, stelle_ids: [TURNHALLE] },
        ANLAGE,
      ),
    );
  });

  it('ohne Stellen im Einsatz gibt es kein Feld „Stellen“', async () => {
    zeigeKarte();
    await oeffneBearbeiten();
    await screen.findByRole('form');
    expect(screen.queryByRole('combobox', { name: 'Stellen' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Art' })).toBeInTheDocument();
  });
});
