import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { listeAuftraege } from '../api/auftraege';
import { ladeFuehrungsstelle } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeMeldungen } from '../api/meldungen';
import { ladeModulZaehler } from '../api/modulZaehler';
import { ladeFernmeldeskizze } from '../api/fernmeldeskizze';
import { ladeKommunikationsplan } from '../api/kommunikationsplan';
import { listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import type {
  Fernmeldeskizze,
  KommunikationsStelle,
  Sprechgruppe,
  Auftrag,
  Einheit,
  Einsatzabschnitt,
  Fuehrungsstelle,
  Meldung,
  ModulZaehler,
} from '../api/types';
import { funkplanLuecken, funkplanLueckenZeilen } from '../stab/funkplan';
import { freigabenFixture } from '../test/fixtures';
import { FUEHRUNGSPROBLEME_QUELLE } from './fuehrungsproblemeUebernahme';

vi.mock('../api/auftraege', () => ({ listeAuftraege: vi.fn() }));
vi.mock('../api/meldungen', () => ({ listeMeldungen: vi.fn() }));
vi.mock('../api/modulZaehler', () => ({ ladeModulZaehler: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../api/sprechgruppen', () => ({ listeEinsatzSprechgruppen: vi.fn() }));
vi.mock('../api/einsaetze', () => ({ ladeFuehrungsstelle: vi.fn() }));
vi.mock('../api/kommunikationsplan', () => ({ ladeKommunikationsplan: vi.fn() }));
vi.mock('../api/fernmeldeskizze', () => ({ ladeFernmeldeskizze: vi.fn() }));

const ZAEHLER = {
  auftraege: { offen: 3, in_arbeit: 1, ueberfaellig: 2 },
  meldungen: { offen: 4, ungesehen: 3, bestaetigung_ueberfaellig: 1 },
} as unknown as ModulZaehler;

/** Freitext mit Namen Dritter: darf nie im Lagevortrag landen. */
const FREITEXT = ['Familie Müller', 'Herr Schmidt', 'Hauptstraße 5', 'Erika Muster'];

const AUFTRAEGE = [
  {
    id: 1,
    lfd_nr: 15,
    bearbeitungsstatus: 'offen',
    ist_ueberfaellig: true,
    frist_at: '2026-10-04 11:30:00',
    auftrag_text: 'Familie Müller evakuieren',
    lage: 'Hauptstraße 5',
  },
  {
    id: 2,
    lfd_nr: 12,
    bearbeitungsstatus: 'in_arbeit',
    ist_ueberfaellig: true,
    frist_at: '2026-10-04 11:00:00',
    auftrag_text: 'Rückmeldung an Herr Schmidt',
  },
  // Überfällig, aber erledigt: zählt der Server nicht, also auch die Liste nicht.
  {
    id: 3,
    lfd_nr: 9,
    bearbeitungsstatus: 'erledigt',
    ist_ueberfaellig: true,
    frist_at: '2026-10-04 10:00:00',
    auftrag_text: 'x',
  },
  {
    id: 4,
    lfd_nr: 20,
    bearbeitungsstatus: 'offen',
    ist_ueberfaellig: false,
    frist_at: '2026-10-04 18:00:00',
    auftrag_text: 'y',
  },
] as unknown as Auftrag[];

const MELDUNGEN = [
  {
    id: 1,
    lfd_nr: 7,
    meldungsart: 'sofortmeldung',
    bestaetigung_pflicht: true,
    ist_bestaetigt: false,
    ist_ueberfaellig: true,
    eskaliert: false,
    bestaetigung_frist_at: '2026-10-04 11:20:00',
    inhalt: 'Anruf von Herr Schmidt',
    absender: 'Erika Muster',
  },
  {
    id: 2,
    lfd_nr: 8,
    meldungsart: 'lagemeldung',
    bestaetigung_pflicht: false,
    ist_bestaetigt: false,
    ist_ueberfaellig: false,
    eskaliert: false,
    inhalt: 'Familie Müller',
  },
] as unknown as Meldung[];

const ABSCHNITTE = [
  { id: 1, ueber_abschnitt_id: null, name: 'EA Nord', sortier: 1, sprechgruppen: [] },
] as unknown as Einsatzabschnitt[];
const EINHEITEN = [
  {
    id: 10,
    abschnitt_id: 1,
    ueber_einheit_id: null,
    name: 'ELW 1',
    sortier: 1,
    sprechgruppen: [],
    erreichbarkeit: '0171 1',
  },
] as unknown as Einheit[];
const FUEHRUNGSSTELLE = {
  rufname: 'Florian Kreis 1',
  kommunikationsmittel: null,
  erreichbarkeit: null,
  sprechgruppen: [],
} as unknown as Fuehrungsstelle;

const dtg = (iso: string) => `DTG(${iso})`;

function erzeuge(freigaben = freigabenFixture(), qc = new QueryClient()) {
  return FUEHRUNGSPROBLEME_QUELLE.erzeuge({ qc, einsatzId: 1, freigaben, dtg });
}

beforeEach(() => {
  vi.mocked(ladeModulZaehler).mockReset().mockResolvedValue(ZAEHLER);
  vi.mocked(listeAuftraege).mockReset().mockResolvedValue(AUFTRAEGE);
  vi.mocked(listeMeldungen).mockReset().mockResolvedValue(MELDUNGEN);
  vi.mocked(listeAbschnitte).mockReset().mockResolvedValue(ABSCHNITTE);
  vi.mocked(listeEinheiten).mockReset().mockResolvedValue(EINHEITEN);
  vi.mocked(listeEinsatzSprechgruppen).mockReset().mockResolvedValue([]);
  vi.mocked(ladeFuehrungsstelle).mockReset().mockResolvedValue(FUEHRUNGSSTELLE);
  vi.mocked(ladeKommunikationsplan).mockReset().mockResolvedValue([]);
  vi.mocked(ladeFernmeldeskizze)
    .mockReset()
    .mockResolvedValue({ komponenten: [] } as unknown as Fernmeldeskizze);
});

describe('Besondere (Führungs-)Probleme (LFH-871)', () => {
  it('beginnt mit dem Stand', async () => {
    expect((await erzeuge()).startsWith('**Stand:** DTG(')).toBe(true);
  });

  it('nennt die Zahl überfälliger Aufträge wie die Vorbereitung und listet genau diese', async () => {
    const text = await erzeuge();
    expect(text).toContain(
      '**Aufträge**\n' +
        '- 2 überfällig\n' +
        '  - Nr. 12 · Frist DTG(2026-10-04 11:00:00)\n' +
        '  - Nr. 15 · Frist DTG(2026-10-04 11:30:00)\n',
    );
    expect(text).not.toContain('Nr. 9 ');
    expect(text).not.toContain('Nr. 20 ');
  });

  it('nennt Meldungen mit überfälliger Bestätigung mit Art und Frist und die neuen', async () => {
    const text = await erzeuge();
    expect(text).toContain(
      '**Meldungen**\n' +
        '- 1 mit überfälliger Bestätigung\n' +
        '  - Nr. 7 · Sofortmeldung · Frist DTG(2026-10-04 11:20:00)\n' +
        '- 3 neu, noch nicht gesichtet\n',
    );
  });

  it('nimmt die Funkplan-Lücken im Wortlaut des Funkplans, nur mit Befund', async () => {
    const text = await erzeuge();
    const quellen = {
      abschnitte: { zustand: 'daten' as const, daten: ABSCHNITTE },
      einheiten: { zustand: 'daten' as const, daten: EINHEITEN },
      sprechgruppen: { zustand: 'daten' as const, daten: [] },
      fuehrungsstelle: { zustand: 'daten' as const, daten: FUEHRUNGSSTELLE },
    };
    const zeilen = funkplanLueckenZeilen(funkplanLuecken(quellen), quellen, { nurBefund: true });
    expect(zeilen).toContain('- Einheiten ohne Sprechgruppe: 1 (ELW 1)');
    expect(text).toContain(`**Funkplan**\n${zeilen.join('\n')}`);
    expect(text).not.toContain('Einheiten ohne Erreichbarkeit');
  });

  it('sagt „keine“, wo nichts vorliegt', async () => {
    vi.mocked(ladeModulZaehler).mockResolvedValue({
      auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
      meldungen: { offen: 0, ungesehen: 0, bestaetigung_ueberfaellig: 0 },
    } as unknown as ModulZaehler);
    vi.mocked(listeAuftraege).mockResolvedValue([]);
    vi.mocked(listeMeldungen).mockResolvedValue([]);
    vi.mocked(listeAbschnitte).mockResolvedValue([
      { ...ABSCHNITTE[0], sprechgruppen: [{ id: 1, bezeichnung: 'TMO 1', betriebsart: 'TMO' }] },
    ] as unknown as Einsatzabschnitt[]);
    vi.mocked(listeEinheiten).mockResolvedValue([]);
    vi.mocked(ladeFuehrungsstelle).mockResolvedValue({
      ...FUEHRUNGSSTELLE,
      sprechgruppen: [{ id: 1, bezeichnung: 'TMO 1', betriebsart: 'TMO' }],
    } as unknown as Fuehrungsstelle);
    const text = await erzeuge();
    expect(text).toContain('**Aufträge**\n- keiner überfällig\n');
    expect(text).toContain(
      '**Meldungen**\n- keine mit überfälliger Bestätigung\n- keine neu, noch nicht gesichtet\n',
    );
    expect(text).toContain('**Funkplan**\n- keine Lücken');
  });

  // LFH-893 (Review O2): dieselben Träger wie das Paneel des Funkplans, sonst zählte die Übernahme
  // eine Sprechgruppe an einer externen Stelle oder Komponente als „ohne Zuordnung“.
  it('zählt Sprechgruppen an externen Stellen und Komponenten wie der Funkplan', async () => {
    const lokal = (id: number, bezeichnung: string) =>
      ({ id, bezeichnung, betriebsart: 'TMO', einsatz_lokal: true }) as unknown as Sprechgruppe;
    vi.mocked(listeEinsatzSprechgruppen).mockResolvedValue([
      lokal(41, 'TMO SL AS'),
      lokal(42, 'TMO Strom'),
      lokal(43, 'TMO frei'),
    ]);
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([
      {
        id: 5,
        stellenart: 'leitstelle',
        sprechgruppen: [{ sprechgruppe: { id: 41 }, status: 'bestehend' }],
      },
    ] as unknown as KommunikationsStelle[]);
    vi.mocked(ladeFernmeldeskizze).mockResolvedValue({
      komponenten: [{ id: 7, sprechgruppen: [{ id: 42 }] }],
    } as unknown as Fernmeldeskizze);
    const text = await erzeuge();
    expect(text).toContain('Einsatzlokale Sprechgruppen ohne Zuordnung: 1 (TMO frei)');
  });

  it('übernimmt keinen Freitext aus Aufträgen und Meldungen', async () => {
    const text = await erzeuge();
    for (const f of FREITEXT) expect(text).not.toContain(f);
  });

  it('fragt gesperrte Module nicht an und nennt sie „— (nicht freigegeben)“, nie 0', async () => {
    const text = await erzeuge(
      freigabenFixture({ auftraege: { zugriff: false }, stab: { sichtbar: false } }),
    );
    expect(listeAuftraege).not.toHaveBeenCalled();
    expect(listeAbschnitte).not.toHaveBeenCalled();
    expect(listeEinsatzSprechgruppen).not.toHaveBeenCalled();
    expect(text).toContain('**Aufträge**\n- — (nicht freigegeben)\n');
    expect(text).toContain('**Funkplan**\n- — (nicht freigegeben)');
    expect(text).toContain('- 1 mit überfälliger Bestätigung');
  });

  it('nennt einen gescheiterten Zähler „— (nicht geladen)“', async () => {
    vi.mocked(ladeModulZaehler).mockRejectedValue(new Error('500'));
    const text = await erzeuge();
    expect(text).toContain('**Aufträge**\n- — (nicht geladen)\n');
    expect(text).toContain('**Meldungen**\n- — (nicht geladen)\n');
  });

  describe('verfuegbar', () => {
    it('ist frei, sobald eine Quelle frei ist', () => {
      expect(
        FUEHRUNGSPROBLEME_QUELLE.verfuegbar(
          freigabenFixture({ auftraege: { zugriff: false }, meldungen: { zugriff: false } }),
        ),
      ).toEqual({ frei: true });
    });

    it('nennt die fehlenden Freigaben, wenn keine Quelle frei ist', () => {
      expect(
        FUEHRUNGSPROBLEME_QUELLE.verfuegbar(
          freigabenFixture({
            auftraege: { zugriff: false },
            meldungen: { zugriff: false },
            stab: { sichtbar: false },
          }),
        ),
      ).toEqual({ frei: false, grund: 'Aufträge, Meldungen und Stab nicht freigegeben' });
    });
  });
});
