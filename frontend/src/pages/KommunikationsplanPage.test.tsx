import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router';
import { renderMitProviders, setzeOnline } from '../test/utils';
import KommunikationsplanPage from './KommunikationsplanPage';
import { ladeEinsatz, ladeFuehrungsstelle, ladeModulFreigaben } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { ladeStab } from '../api/stab';
import { ladeFuehrungsfunktionen } from '../api/fuehrungsfunktionen';
import {
  aendereVerbindung,
  entferneKommunikationsStelle,
  entferneVerbindung,
  ladeKommunikationsplan,
  legeKommunikationsStelleAn,
  legeKommunikationsStelleEinzelnAn,
  legeVerbindungAn,
} from '../api/kommunikationsplan';
import { fetchExterneStellen } from '../api/externeStellen';
import { ApiError } from '../api/client';
import { ladeFernmeldeskizze } from '../api/fernmeldeskizze';
import { freigabenFixture } from '../test/fixtures';
import type {
  Einheit,
  EinsatzAnzeige,
  Einsatzabschnitt,
  ExterneStelle,
  Fernmeldeskizze,
  FuehrungsfunktionEintrag,
  KommunikationsStelle,
  SkizzenVerbindung,
  Sprechgruppe,
  Stab,
} from '../api/types';

vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeFuehrungsstelle: vi.fn(),
  ladeModulFreigaben: vi.fn(),
}));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../api/stab', () => ({ ladeStab: vi.fn() }));
vi.mock('../api/fuehrungsfunktionen', () => ({ ladeFuehrungsfunktionen: vi.fn() }));
vi.mock('../api/fernmeldeskizze', () => ({ ladeFernmeldeskizze: vi.fn() }));
vi.mock('../api/externeStellen', () => ({ fetchExterneStellen: vi.fn() }));
vi.mock('../api/kommunikationsplan', () => ({
  ladeKommunikationsplan: vi.fn(),
  legeKommunikationsStelleAn: vi.fn(),
  legeKommunikationsStelleEinzelnAn: vi.fn(),
  benenneKommunikationsStelleUm: vi.fn(),
  entferneKommunikationsStelle: vi.fn(),
  legeVerbindungAn: vi.fn(),
  aendereVerbindung: vi.fn(),
  entferneVerbindung: vi.fn(),
}));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

const S2: KommunikationsStelle = {
  id: 1,
  stellenart: 'funktion',
  funktion: 's2',
  funktion_label: 'S2 Lage',
  verbindungen: [{ id: 11, mittel: 'mobil', wert: '0170 1234567', hinweis: 'nur tagsüber' }],
  sprechgruppen: [],
};
const POLIZEI: KommunikationsStelle = {
  id: 2,
  stellenart: 'behoerde',
  bezeichnung: 'Polizei PI Nord',
  verbindungen: [
    { id: 21, mittel: 'festnetz', wert: '0421 110' },
    { id: 22, mittel: 'fax', wert: '0421 111' },
  ],
  sprechgruppen: [],
};
const ILS: KommunikationsStelle = {
  id: 3,
  stellenart: 'leitstelle',
  bezeichnung: 'ILS Nord',
  verbindungen: [{ id: 31, mittel: 'festnetz', wert: '0421 112' }],
  sprechgruppen: [],
};

const TMO_SL_AS: Sprechgruppe = {
  id: 31,
  bezeichnung: 'SL AS',
  betriebsart: 'TMO',
  aktiv: true,
  einsatz_lokal: false,
  sortier: 1,
};

/** Die Daten der Fernmeldeskizze (LFH-893): hier zählen nur ihre Verbindungen. */
function skizze(verbindungen: SkizzenVerbindung[] = []): Fernmeldeskizze {
  return {
    lage: [],
    komponenten: [],
    verbindungen,
    bereiche: [],
    schriftfeld: {
      herausgeber: null,
      vs_vermerk: 'keiner',
      gueltig_ab: null,
      gez_name: null,
      gez_at: null,
    },
    stand: null,
  };
}

/** Eine Datenverbindung der Skizze von der Führungsstelle zur Stelle `stelleId`. */
function datenverbindung(stelleId: number): SkizzenVerbindung {
  return {
    id: 90 + stelleId,
    von: { art: 'fuehrungsstelle', id: null },
    nach: { art: 'stelle', id: stelleId },
    art: 'daten',
    medium: 'leitung',
    status: 'bestehend',
    verkehr: null,
    hinweis: null,
  };
}

const ABSCHNITTE: Einsatzabschnitt[] = [
  {
    id: 1,
    einsatz_id: 1,
    name: 'Abschnitt Nord',
    sortier: 1,
    sprechgruppen: [],
    verbindungen: [{ id: 41, mittel: 'festnetz', wert: '0421 500', hinweis: null }],
  },
];

const EINHEITEN = [
  {
    id: 10,
    einsatz_id: 1,
    name: '1. Zug',
    funkrufname: 'Florian 1/10',
    verbindungen: [{ id: 42, mittel: 'mobil', wert: '0160 222', hinweis: null }],
    sortier: 1,
    unangemeldet: false,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    status: { quelle: 'ohne', verteilung: [] },
  },
] as Einheit[];

const STAB = {
  besetzung: [
    {
      sachgebiet: 's2',
      besetzung_art: 'personal',
      name: 'Erika Muster',
      personal_noch_disponiert: true,
      gesetzt_at: '2026-10-01T10:00:00',
      gesetzt_von_id: 1,
    },
  ],
} as Stab;

function funktion(
  f: FuehrungsfunktionEintrag['funktion'],
  label: string,
  kuerzel: string | null,
  bezeichnung_pflicht = false,
): FuehrungsfunktionEintrag {
  return {
    funktion: f,
    label,
    standard_label: label,
    kuerzel,
    bezeichnung_pflicht,
    art: 'sachgebiet',
  } as FuehrungsfunktionEintrag;
}

const KATALOG = [
  funktion('el', 'Einsatzleitung', 'EL'),
  funktion('s2', 'Lage', 'S2'),
  funktion('s4', 'Versorgung', 'S4'),
  funktion('fachberater', 'Fachberater', null, true),
];

beforeEach(() => {
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  vi.mocked(listeAbschnitte).mockResolvedValue(ABSCHNITTE);
  vi.mocked(listeEinheiten).mockResolvedValue(EINHEITEN);
  vi.mocked(ladeStab).mockResolvedValue(STAB);
  vi.mocked(ladeFuehrungsfunktionen).mockResolvedValue(KATALOG);
  vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, POLIZEI]);
  vi.mocked(ladeFernmeldeskizze).mockResolvedValue(skizze());
  vi.mocked(fetchExterneStellen).mockResolvedValue([]);
  vi.mocked(ladeFuehrungsstelle).mockResolvedValue({
    art: 'mobil',
    sprechgruppen: [],
    verbindungen: [],
    fahrzeug_ids: [],
  });
  for (const f of [
    legeKommunikationsStelleAn,
    legeKommunikationsStelleEinzelnAn,
    entferneKommunikationsStelle,
    legeVerbindungAn,
    aendereVerbindung,
    entferneVerbindung,
  ]) {
    vi.mocked(f).mockReset();
  }
});

afterEach(() => setzeOnline(true));

function setup() {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/fernmeldewesen/kommunikationsplan"
        element={<KommunikationsplanPage />}
      />
    </Routes>,
    { route: '/einsaetze/1/fernmeldewesen/kommunikationsplan' },
  );
}

const tabelle = () => screen.getByRole('region', { name: 'Kommunikationsplan' });
const zeile = (container: HTMLElement, key: string) =>
  container.querySelector(`tr[data-row-key="${key}"]`) as HTMLElement;

describe('KommunikationsplanPage — Anzeige', () => {
  it('zeigt Gruppen, Stellen, Besetzung und Verbindungen mit wählbarer Nummer', async () => {
    const { container } = setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fernmeldewesen' }),
    ).toBeInTheDocument();
    await screen.findByText('Polizei PI Nord');
    for (const titel of ['Einsatzleitung und Stab', 'Abschnitte', 'Einheiten', 'Externe Stellen']) {
      expect(within(tabelle()).getByText(titel)).toBeInTheDocument();
    }
    const s2 = zeile(container, 'st-1');
    expect(within(s2).getByText('S2 Lage')).toBeInTheDocument();
    expect(within(s2).getByText('Erika Muster')).toBeInTheDocument();
    expect(within(s2).getByRole('link', { name: '0170 1234567' })).toHaveAttribute(
      'href',
      'tel:01701234567',
    );
    expect(within(s2).getByText('nur tagsüber')).toBeInTheDocument();
    const polizei = zeile(container, 'st-2');
    expect(within(polizei).getByText('Behörde')).toBeInTheDocument();
    // Fax ist keine Wählverbindung: Text, kein Verweis.
    expect(within(polizei).getByText('0421 111').closest('a')).toBeNull();
  });

  it('führt abgeleitete Zeilen zu ihrem Datensatz und bietet dort keine Aktion an', async () => {
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    expect(within(tabelle()).getByRole('link', { name: /Abschnitt Nord/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzabschnitte?abschnitt=1',
    );
    const zug = zeile(container, 'eh-10');
    expect(within(zug).getByRole('link', { name: /1\. Zug/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/10',
    );
    expect(within(zug).queryByRole('button')).toBeNull();
  });

  // LFH-1148: die eigene Führungsstelle steht wie im Funkplan, gepflegt wird auf Einsatzdaten.
  it('zeigt die erfasste Führungsstelle als erste Zeile mit Verbindung und Weg zu Einsatzdaten', async () => {
    vi.mocked(ladeFuehrungsstelle).mockResolvedValue({
      art: 'mobil',
      rufname: 'Florian Bremen 11/1',
      sprechgruppen: [],
      verbindungen: [{ id: 51, mittel: 'festnetz', wert: '0421 999', hinweis: null }],
      fahrzeug_ids: [],
    });
    const { container } = setup();
    const fs = await waitFor(() => {
      const z = zeile(container, 'fs');
      expect(z).not.toBeNull();
      return z;
    });
    expect(within(fs).getByRole('link', { name: /Führungsstelle/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzdaten',
    );
    expect(
      within(fs).getByText('Florian Bremen 11/1 · Einsatzleiter nicht erfasst'),
    ).toBeInTheDocument();
    expect(within(fs).getByRole('link', { name: '0421 999' })).toHaveAttribute(
      'href',
      'tel:0421999',
    );
    expect(within(fs).queryByRole('button')).toBeNull();
    // Erste Zeile der Gruppe, vor den Funktionen.
    const schluessel = [...container.querySelectorAll('tr[data-row-key]')].map((z) =>
      z.getAttribute('data-row-key'),
    );
    expect(schluessel.indexOf('fs')).toBe(schluessel.indexOf('gruppe-stab') + 1);
  });

  // LLH-1168: der Einsatzleiter im Nebentext der Zeile, am Schirm und im Druck.
  it('nennt den Einsatzleiter an der Führungsstelle, auch im Druck', async () => {
    vi.mocked(ladeFuehrungsstelle).mockResolvedValue({
      art: 'mobil',
      rufname: 'Florian Kreis 10-1',
      sprechgruppen: [],
      verbindungen: [],
      fahrzeug_ids: [],
      einsatzleiter: {
        art: 'personal',
        name: 'Anna Schulz',
        personal_id: 17,
        personal_noch_disponiert: true,
        seit: '2026-10-12 12:30:00',
      },
    });
    const { container } = setup();
    const text = 'Florian Kreis 10-1 · Einsatzleiter Anna Schulz';
    const fs = await waitFor(() => {
      const z = zeile(container, 'fs');
      expect(z).not.toBeNull();
      return z!;
    });
    expect(within(fs).getByText(text)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(within(zeile(container, 'fs')!).getByText(text)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
  });

  it('zeigt keine Zeile für eine nicht erfasste Führungsstelle', async () => {
    let geladen = false;
    vi.mocked(ladeFuehrungsstelle).mockImplementation(async () => {
      geladen = true;
      return { art: 'mobil', rufname: '  ', sprechgruppen: [], verbindungen: [], fahrzeug_ids: [] };
    });
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    // Erst prüfen, wenn die Führungsstelle geladen ist; vorher stünde ohnehin keine Zeile.
    await waitFor(() => expect(geladen).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(zeile(container, 'fs')).toBeNull();
  });

  it('nennt die Lücke „Leitstelle“, solange keine Leitstelle eine Verbindung trägt', async () => {
    setup();
    expect(await screen.findByText('Leitstelle: keine Verbindung erfasst')).toBeInTheDocument();
  });

  it('ohne Lücke, sobald die Leitstelle eine Verbindung trägt', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, ILS]);
    setup();
    await screen.findByText('ILS Nord');
    expect(screen.queryByText('Leitstelle: keine Verbindung erfasst')).toBeNull();
  });

  it('behauptet ohne geladene Stellen keine Lücke, sondern nennt den Grund', async () => {
    vi.mocked(ladeKommunikationsplan).mockRejectedValue(new ApiError(500, 'kaputt'));
    setup();
    await screen.findByText('Abschnitt Nord');
    const luecken = screen.getByRole('region', { name: 'Lücken' });
    expect(within(luecken).getByText('nicht geladen')).toBeInTheDocument();
    expect(screen.queryByText('Leitstelle: keine Verbindung erfasst')).toBeNull();
  });

  it('bietet keine Übernahme in den Lagebericht an', async () => {
    setup();
    await screen.findByText('Polizei PI Nord');
    expect(screen.queryByRole('button', { name: /Lagebericht/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Drucken/ })).toBeInTheDocument();
  });

  it('nennt im Druckkopf die Dokumentart', async () => {
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    expect(container.querySelector('[data-lfh="druckkopf"]')?.textContent).toContain(
      'Kommunikationsplan',
    );
  });
});

describe('KommunikationsplanPage — Fernmeldeskizze (LFH-893)', () => {
  const ilsOhne: KommunikationsStelle = { ...ILS, verbindungen: [] };

  it('zeigt die Kanäle einer externen Stelle als Nebentext, geplante mit dem Wort', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([
      S2,
      { ...ILS, sprechgruppen: [{ sprechgruppe: TMO_SL_AS, status: 'geplant' }] },
    ]);
    const { container } = setup();
    await screen.findByText('ILS Nord');
    expect(within(zeile(container, 'st-3')).getByText('TMO SL AS (geplant)')).toBeInTheDocument();
    expect(within(zeile(container, 'st-1')).queryByText(/TMO/)).toBeNull();
  });

  it('Leitstelle nur über Funk: kein Hinweis', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([
      S2,
      { ...ilsOhne, sprechgruppen: [{ sprechgruppe: TMO_SL_AS, status: 'bestehend' }] },
    ]);
    setup();
    await screen.findByText('ILS Nord');
    await waitFor(() => expect(ladeFernmeldeskizze).toHaveBeenCalled());
    expect(screen.queryByText('Leitstelle: keine Verbindung erfasst')).toBeNull();
  });

  it('Leitstelle nur in der Skizze verbunden: kein Hinweis', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, ilsOhne]);
    vi.mocked(ladeFernmeldeskizze).mockResolvedValue(skizze([datenverbindung(3)]));
    setup();
    await screen.findByText('ILS Nord');
    await waitFor(() => expect(ladeFernmeldeskizze).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Lücken' })).toBeNull();
    expect(screen.queryByText('Leitstelle: keine Verbindung erfasst')).toBeNull();
  });

  it('Leitstelle ganz ohne Verbindung: der Hinweis steht, sobald die Skizze geladen ist', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, ilsOhne]);
    setup();
    expect(await screen.findByText('Leitstelle: keine Verbindung erfasst')).toBeInTheDocument();
  });

  it('Skizze nicht geladen und sonst keine Verbindung: „—“ mit Grund statt Hinweis', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, ilsOhne]);
    vi.mocked(ladeFernmeldeskizze).mockRejectedValue(new ApiError(500, 'kaputt'));
    setup();
    const luecken = await screen.findByRole('region', { name: 'Lücken' });
    expect(within(luecken).getByText('Fernmeldeskizze nicht geladen')).toBeInTheDocument();
    expect(screen.queryByText('Leitstelle: keine Verbindung erfasst')).toBeNull();
  });

  it('Skizze nicht geladen, Leitstelle per Telefon verbunden: kein Hinweis', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, ILS]);
    vi.mocked(ladeFernmeldeskizze).mockRejectedValue(new ApiError(500, 'kaputt'));
    setup();
    await screen.findByText('ILS Nord');
    await waitFor(() => expect(ladeFernmeldeskizze).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Lücken' })).toBeNull();
  });

  it('nennt beim Entfernen der Leitstelle eine Sprechgruppe und eine Skizzen-Verbindung', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([
      S2,
      { ...ilsOhne, sprechgruppen: [{ sprechgruppe: TMO_SL_AS, status: 'bestehend' }] },
    ]);
    vi.mocked(ladeFernmeldeskizze).mockResolvedValue(skizze([datenverbindung(3)]));
    vi.mocked(entferneKommunikationsStelle).mockResolvedValue([S2]);
    const { container } = setup();
    await screen.findByText('ILS Nord');
    await waitFor(() => expect(ladeFernmeldeskizze).toHaveBeenCalledTimes(1));
    await userEvent.click(
      within(zeile(container, 'st-3')).getByRole('button', {
        name: 'Weitere Aktionen zu ILS Nord',
      }),
    );
    await userEvent.click(await screen.findByText('Stelle entfernen'));
    const rueckfrage = await screen.findByRole('dialog');
    expect(
      within(rueckfrage).getByText(/1 Sprechgruppe und 1 Skizzen-Verbindung/),
    ).toBeInTheDocument();
    expect(entferneKommunikationsStelle).not.toHaveBeenCalled();
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(entferneKommunikationsStelle).toHaveBeenCalledWith(1, 3));
    // Der Server räumt die Skizzen-Verbindung mit: die Skizzendaten werden neu geholt.
    await waitFor(() => expect(ladeFernmeldeskizze).toHaveBeenCalledTimes(2));
  });

  it('fragt nach, wenn die Skizze nicht geladen ist, auch ohne Verbindungen', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, ilsOhne]);
    vi.mocked(ladeFernmeldeskizze).mockRejectedValue(new ApiError(500, 'kaputt'));
    const { container } = setup();
    await screen.findByText('ILS Nord');
    await screen.findByText('Fernmeldeskizze nicht geladen');
    await userEvent.click(
      within(zeile(container, 'st-3')).getByRole('button', {
        name: 'Weitere Aktionen zu ILS Nord',
      }),
    );
    await userEvent.click(await screen.findByText('Stelle entfernen'));
    const rueckfrage = await screen.findByRole('dialog');
    expect(
      within(rueckfrage).getByText(/Verbindungen in der Fernmeldeskizze \(nicht geladen\)/),
    ).toBeInTheDocument();
    expect(entferneKommunikationsStelle).not.toHaveBeenCalled();
  });
});

describe('KommunikationsplanPage — Sperre des Fernmeldewesens', () => {
  it('zeigt nichts, solange die Freigabe offen ist, und fragt den Plan nicht an', async () => {
    vi.mocked(ladeModulFreigaben).mockReturnValue(new Promise(() => {}));
    const { container } = setup();
    await waitFor(() => expect(ladeEinsatz).toHaveBeenCalled());
    expect(container.querySelector('.ant-table')).toBeNull();
    expect(ladeKommunikationsplan).not.toHaveBeenCalled();
  });

  it('zeigt bei Fehler der Freigabe einen Fehler mit Wiederholen', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new ApiError(500, 'kaputt'));
    setup();
    expect(
      await screen.findByText(/Freigabe des Moduls Fernmeldewesen nicht ermittelbar/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Erneut/ })).toBeInTheDocument();
    expect(ladeKommunikationsplan).not.toHaveBeenCalled();
  });

  it('ist nicht erreichbar, wenn das Fernmeldewesen ausgeblendet ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ fernmeldewesen: { sichtbar: false } }),
    );
    setup();
    expect(await screen.findByText(/Modul Fernmeldewesen nicht freigegeben/)).toBeInTheDocument();
    expect(ladeKommunikationsplan).not.toHaveBeenCalled();
  });

  // LLH-1180, design.md D8: der Stab ist nur noch die Quelle der Besetzung.
  it('ohne Stab: Verbindungen und Schreiben bleiben, die Besetzung steht als „—“ mit Grund', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false, zugriff: false } }),
    );
    const { container } = setup();
    expect(await screen.findByText('0170 1234567')).toBeInTheDocument();
    const s2 = zeile(container, 'st-1');
    expect(within(s2).getByTitle('Stab nicht freigegeben')).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Stelle hinzufügen' })).toBeEnabled();
    expect(ladeStab).not.toHaveBeenCalled();
  });
});

describe('KommunikationsplanPage — Schreibrecht und Netz', () => {
  it('Beobachter: keine Aktionsspalte, kein „Stelle hinzufügen“', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' });
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    expect(screen.queryByRole('button', { name: 'Stelle hinzufügen' })).toBeNull();
    const kopf = [...container.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
    expect(kopf).not.toContain('Aktionen');
  });

  it('ohne Netz: Daten sichtbar, Knöpfe gesperrt', async () => {
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    setzeOnline(false);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stelle hinzufügen' })).toBeDisabled(),
    );
    expect(
      within(zeile(container, 'st-2')).getByRole('button', {
        name: 'Verbindung zu Polizei PI Nord hinzufügen',
      }),
    ).toBeDisabled();
    expect(screen.getByText('0421 110')).toBeInTheDocument();
  });
});

describe('KommunikationsplanPage — Besetzung ohne Netz', () => {
  it('sagt „nicht geladen“ statt ewig „lädt“, wenn die Besetzung ohne Netz fehlt', async () => {
    vi.mocked(ladeStab).mockReturnValue(new Promise(() => {}));
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    expect(within(zeile(container, 'st-1')).getByText('Besetzung lädt')).toBeInTheDocument();
    setzeOnline(false);
    expect(
      await within(zeile(container, 'st-1')).findByText('Besetzung nicht geladen'),
    ).toBeInTheDocument();
  });
});

describe('KommunikationsplanPage — Führungsstelle ohne Netz', () => {
  it('sagt „nicht geladen“ statt die Führungsstelle wegzulassen', async () => {
    vi.mocked(ladeFuehrungsstelle).mockReturnValue(new Promise(() => {}));
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    expect(zeile(container, 'fs')).toBeNull();
    setzeOnline(false);
    await waitFor(() => expect(zeile(container, 'fs')).not.toBeNull());
    expect(within(zeile(container, 'fs')).getByText('nicht geladen')).toBeInTheDocument();
  });
});

describe('KommunikationsplanPage — Bearbeiten', () => {
  it('legt eine Leitstelle an und übernimmt die Antwort des Servers', async () => {
    vi.mocked(legeKommunikationsStelleAn).mockResolvedValue([S2, POLIZEI, ILS]);
    setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(screen.getByRole('button', { name: 'Stelle hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Art'));
    await userEvent.click(await screen.findByTitle('Leitstelle'));
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'ILS Nord');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(legeKommunikationsStelleAn).toHaveBeenCalledWith(1, {
        stellenart: 'leitstelle',
        bezeichnung: 'ILS Nord',
      }),
    );
    expect(await within(tabelle()).findByText('ILS Nord')).toBeInTheDocument();
    expect(ladeKommunikationsplan).toHaveBeenCalledTimes(1);
  });

  it('graut bei „Führungsfunktion“ vergebene Funktionen aus und verlangt beim Fachberater die Bezeichnung', async () => {
    setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(screen.getByRole('button', { name: 'Stelle hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    // Ohne Bezeichnungspflicht ist das Feld ausgeblendet, nicht leer.
    expect(within(dialog).queryByLabelText('Bezeichnung')).toBeNull();
    await userEvent.click(within(dialog).getByLabelText('Funktion'));
    const s2 = await screen.findByTitle('S2 – Lage');
    expect(s2.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled');
    await userEvent.click(await screen.findByTitle('Fachberater'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Bezeichnung angeben')).toBeInTheDocument();
    expect(legeKommunikationsStelleAn).not.toHaveBeenCalled();
  });

  it('zeigt einen abgelehnten Aufruf in der Maske', async () => {
    vi.mocked(legeKommunikationsStelleAn).mockRejectedValue(
      new ApiError(409, 'Diese Funktion steht schon im Kommunikationsplan'),
    );
    setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(screen.getByRole('button', { name: 'Stelle hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Funktion'));
    await userEvent.click(await screen.findByTitle('S4 – Versorgung'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(
      await within(dialog).findByText('Diese Funktion steht schon im Kommunikationsplan'),
    ).toBeInTheDocument();
  });

  it('legt Verbindungen im Serienmodus an', async () => {
    const mitFax: KommunikationsStelle = {
      ...POLIZEI,
      verbindungen: [...POLIZEI.verbindungen, { id: 23, mittel: 'email', wert: 'pi@x.de' }],
    };
    vi.mocked(legeVerbindungAn).mockResolvedValue([S2, mitFax]);
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(
      within(zeile(container, 'st-2')).getByRole('button', {
        name: 'Verbindung zu Polizei PI Nord hinzufügen',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Mittel'));
    await userEvent.click(await screen.findByTitle('E-Mail'));
    await userEvent.type(within(dialog).getByLabelText('Nummer/Adresse'), 'pi@x.de');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() =>
      expect(legeVerbindungAn).toHaveBeenCalledWith(1, 2, { mittel: 'email', wert: 'pi@x.de' }),
    );
    // Der Dialog bleibt offen und leer für die nächste Verbindung.
    expect(await within(dialog).findByText('Erfasst: 1')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Nummer/Adresse')).toHaveValue('');
  });

  it('bearbeitet eine Verbindung vorbelegt und schickt nur Geändertes', async () => {
    vi.mocked(aendereVerbindung).mockResolvedValue([S2, POLIZEI]);
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(
      within(zeile(container, 'st-2')).getByRole('button', {
        name: 'Weitere Aktionen zu Polizei PI Nord',
      }),
    );
    await userEvent.click(await screen.findByText('Festnetz 0421 110 bearbeiten'));
    const dialog = await screen.findByRole('dialog');
    const wert = within(dialog).getByLabelText('Nummer/Adresse');
    expect(wert).toHaveValue('0421 110');
    await userEvent.type(within(dialog).getByLabelText('Hinweis'), 'Lagedienst');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aendereVerbindung).toHaveBeenCalledWith(1, 21, { hinweis: 'Lagedienst' }),
    );
  });

  it('entfernt eine Verbindung ohne Rückfrage', async () => {
    vi.mocked(entferneVerbindung).mockResolvedValue([S2, POLIZEI]);
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(
      within(zeile(container, 'st-2')).getByRole('button', {
        name: 'Weitere Aktionen zu Polizei PI Nord',
      }),
    );
    await userEvent.click(await screen.findByText('Fax 0421 111 entfernen'));
    await waitFor(() => expect(entferneVerbindung).toHaveBeenCalledWith(1, 22));
  });

  it('fragt beim Entfernen einer Stelle mit zwei Verbindungen nach und nennt „2“', async () => {
    vi.mocked(entferneKommunikationsStelle).mockResolvedValue([S2]);
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(
      within(zeile(container, 'st-2')).getByRole('button', {
        name: 'Weitere Aktionen zu Polizei PI Nord',
      }),
    );
    await userEvent.click(await screen.findByText('Stelle entfernen'));
    const rueckfrage = await screen.findByRole('dialog');
    expect(within(rueckfrage).getByText(/2 Verbindungen/)).toBeInTheDocument();
    expect(entferneKommunikationsStelle).not.toHaveBeenCalled();
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(entferneKommunikationsStelle).toHaveBeenCalledWith(1, 2));
    await waitFor(() => expect(within(tabelle()).queryByText('Polizei PI Nord')).toBeNull());
  });

  it('entfernt eine Stelle ohne Verbindungen ohne Rückfrage', async () => {
    const leer: KommunikationsStelle = { ...ILS, verbindungen: [] };
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([S2, leer]);
    vi.mocked(entferneKommunikationsStelle).mockResolvedValue([S2]);
    const { container } = setup();
    await screen.findByText('ILS Nord');
    await userEvent.click(
      within(zeile(container, 'st-3')).getByRole('button', {
        name: 'Weitere Aktionen zu ILS Nord',
      }),
    );
    await userEvent.click(await screen.findByText('Stelle entfernen'));
    await waitFor(() => expect(entferneKommunikationsStelle).toHaveBeenCalledWith(1, 3));
  });
});

describe('KommunikationsplanPage — Katalog „Externe Stellen“ (LLH-1165)', () => {
  const KATALOG_STELLEN: ExterneStelle[] = [
    {
      id: 1,
      bezeichnung: 'ILS Nord',
      art: 'leitstelle',
      rufnummer: '0421 112',
      aktiv: true,
      zustaendig: true,
    },
    {
      id: 2,
      bezeichnung: 'PI Nord',
      art: 'polizei',
      rufnummer: '0421 110',
      funkrufname: 'Heros Nord',
      aktiv: true,
      zustaendig: false,
    },
    {
      id: 3,
      bezeichnung: 'DLRG Ortsgruppe',
      art: 'hilfsorganisation',
      aktiv: true,
      zustaendig: false,
    },
  ];
  const NEU: KommunikationsStelle = {
    id: 7,
    stellenart: 'behoerde',
    bezeichnung: 'PI Nord',
    verbindungen: [],
    sprechgruppen: [],
  };

  beforeEach(() => {
    vi.mocked(fetchExterneStellen).mockResolvedValue(KATALOG_STELLEN);
  });

  async function waehleArt(dialog: HTMLElement, art: string) {
    await userEvent.click(within(dialog).getByLabelText('Art'));
    await userEvent.click(await screen.findByTitle(art));
  }

  it('schlägt bei „Behörde“ die Polizei vor und übernimmt Bezeichnung und Rufnummer', async () => {
    vi.mocked(legeKommunikationsStelleEinzelnAn).mockResolvedValue(NEU);
    vi.mocked(legeVerbindungAn).mockResolvedValue([
      S2,
      POLIZEI,
      { ...NEU, verbindungen: [{ id: 71, mittel: 'festnetz', wert: '0421 110' }] },
    ]);
    const { container } = setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(screen.getByRole('button', { name: 'Stelle hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await waehleArt(dialog, 'Behörde');
    await userEvent.click(within(dialog).getByLabelText('Bezeichnung'));
    // Nur was als Behörde in den Plan kommt: keine Leitstelle, keine Hilfsorganisation.
    expect(screen.queryByTitle('ILS Nord · zuständig')).toBeNull();
    expect(screen.queryByTitle('DLRG Ortsgruppe')).toBeNull();
    await userEvent.click(await screen.findByTitle('PI Nord'));
    expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('PI Nord');
    expect(within(dialog).getByLabelText('Rufnummer')).toHaveValue('0421 110');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(legeVerbindungAn).toHaveBeenCalledWith(1, 7, { mittel: 'festnetz', wert: '0421 110' }),
    );
    expect(legeKommunikationsStelleEinzelnAn).toHaveBeenCalledWith(1, {
      stellenart: 'behoerde',
      bezeichnung: 'PI Nord',
    });
    expect(legeKommunikationsStelleAn).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(zeile(container, 'st-7')).getByRole('link', { name: '0421 110' })).toBeVisible();
  });

  it('lässt eine von Hand eingetragene Rufnummer bei der Wahl stehen', async () => {
    setup();
    await screen.findByText('Polizei PI Nord');
    await userEvent.click(screen.getByRole('button', { name: 'Stelle hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await waehleArt(dialog, 'Leitstelle');
    await userEvent.type(within(dialog).getByLabelText('Rufnummer'), '0421 999');
    await userEvent.click(within(dialog).getByLabelText('Bezeichnung'));
    await userEvent.click(await screen.findByTitle('ILS Nord · zuständig'));
    expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('ILS Nord');
    expect(within(dialog).getByLabelText('Rufnummer')).toHaveValue('0421 999');
  });

  it('bietet in der Lücke „Leitstelle“ die zuständige Leitstelle vorbelegt an', async () => {
    vi.mocked(legeKommunikationsStelleEinzelnAn).mockResolvedValue({
      ...NEU,
      id: 8,
      stellenart: 'leitstelle',
      bezeichnung: 'ILS Nord',
    });
    vi.mocked(legeVerbindungAn).mockResolvedValue([S2, POLIZEI, ILS]);
    setup();
    const luecke = await screen.findByRole('region', { name: 'Lücken' });
    await userEvent.click(
      await within(luecke).findByRole('button', { name: 'ILS Nord hinzufügen' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('ILS Nord');
    expect(within(dialog).getByLabelText('Rufnummer')).toHaveValue('0421 112');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(legeKommunikationsStelleEinzelnAn).toHaveBeenCalledWith(1, {
        stellenart: 'leitstelle',
        bezeichnung: 'ILS Nord',
      }),
    );
    expect(legeVerbindungAn).toHaveBeenCalledWith(1, 8, { mittel: 'festnetz', wert: '0421 112' });
    await waitFor(() =>
      expect(screen.queryByText('Leitstelle: keine Verbindung erfasst')).toBeNull(),
    );
  });

  it('bietet keine zweite Leitstelle an, wenn der Plan schon eine führt', async () => {
    vi.mocked(ladeKommunikationsplan).mockResolvedValue([
      S2,
      { ...ILS, bezeichnung: 'ILS Süd', verbindungen: [] },
    ]);
    setup();
    await screen.findByText('Leitstelle: keine Verbindung erfasst');
    await waitFor(() => expect(fetchExterneStellen).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'ILS Nord hinzufügen' })).toBeNull();
  });

  it('Beobachter: kein Vorschlag in der Lücke', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' });
    setup();
    await screen.findByText('Leitstelle: keine Verbindung erfasst');
    await waitFor(() => expect(fetchExterneStellen).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'ILS Nord hinzufügen' })).toBeNull();
  });

  it('scheitert nur die Rufnummer, schließt die Maske und nennt den Grund über dem Plan', async () => {
    vi.mocked(legeKommunikationsStelleEinzelnAn).mockResolvedValue(NEU);
    vi.mocked(legeVerbindungAn).mockRejectedValue(new ApiError(409, 'Einsatz ist abgeschlossen'));
    setup();
    await screen.findByText('Polizei PI Nord');
    expect(ladeKommunikationsplan).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Stelle hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await waehleArt(dialog, 'Behörde');
    await userEvent.click(within(dialog).getByLabelText('Bezeichnung'));
    await userEvent.click(await screen.findByTitle('PI Nord'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Rufnummer nicht übernommen')).toBeInTheDocument();
    expect(screen.getByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Die Stelle steht schon: der Plan wird neu geholt, statt die Maske ein zweites Mal anlegen zu lassen.
    await waitFor(() => expect(ladeKommunikationsplan).toHaveBeenCalledTimes(2));
  });
});
