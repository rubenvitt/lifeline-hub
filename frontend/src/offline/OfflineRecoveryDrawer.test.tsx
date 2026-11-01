import { QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ladeVerpflegung } from '../api/verpflegung';
import { neuerQueryClient } from '../test/utils';
import { FELDKUECHE, stelle, verpflegungMitStellen } from '../test/verpflegungDaten';
import OfflineRecoveryDrawer from './OfflineRecoveryDrawer';
import { fruehereKopplungZaehlen, geraetKontoBestaetigt } from './fruehereKopplung';
import {
  OFFLINE_QUEUE_EVENT,
  abgelehntEntfernen,
  abgelehntLaden,
  abgelehntWiederholen,
  queueAblehnen,
  queueEinreihen,
  queueLaden,
  queueLegacyEinreihenFuerTests,
  queueLeerenFuerTests,
  queueNichtZugeordnetAlleVerwerfen,
  queueNichtZugeordnetZaehlen,
  schreibaktionAbgelehntVerwerfen,
  schreibaktionAblehnen,
  schreibaktionEinreihen,
  schreibaktionenLaden,
} from './queue';

// Nur Ausgaben an einer Stelle lesen die Verpflegung (LLH-1298).
vi.mock('../api/verpflegung', async (original) => ({
  ...(await original<typeof import('../api/verpflegung')>()),
  ladeVerpflegung: vi.fn(),
}));

// Echte Queue, nur die Aktionen des Drawers lassen sich je Test scheitern lassen.
vi.mock('./queue', async (original) => {
  const echt = await original<typeof import('./queue')>();
  return {
    ...echt,
    abgelehntLaden: vi.fn(echt.abgelehntLaden),
    abgelehntWiederholen: vi.fn(echt.abgelehntWiederholen),
    queueNichtZugeordnetAlleVerwerfen: vi.fn(echt.queueNichtZugeordnetAlleVerwerfen),
    schreibaktionAbgelehntVerwerfen: vi.fn(echt.schreibaktionAbgelehntVerwerfen),
  };
});

beforeEach(async () => {
  vi.mocked(ladeVerpflegung).mockReset();
  vi.mocked(abgelehntLaden).mockReset();
  vi.mocked(abgelehntWiederholen).mockReset();
  vi.mocked(queueNichtZugeordnetAlleVerwerfen).mockReset();
  vi.mocked(schreibaktionAbgelehntVerwerfen).mockReset();
  await queueLeerenFuerTests();
});

describe('OfflineRecoveryDrawer: nicht attribuierbare Legacy-Daten', () => {
  it('zeigt nur den anonymen Zähler und verwirft alle Alt-Daten erst nach Bestätigung', async () => {
    await queueLegacyEinreihenFuerTests(73, {
      typ: 'meldung',
      inhalt: 'Geheimer Inhalt aus früherer Sitzung',
      client_id: 'legacy-geheim-1',
    });
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    // Einzahl richtig, Klartext statt „attribuierbar“ (LFH-944); der Inhalt bleibt verborgen.
    expect(
      await screen.findByText('1 Offline-Aktion · Inhalt nicht einsehbar, nicht übernehmbar'),
    ).toBeInTheDocument();
    expect(screen.getByText('Alte Offline-Daten ohne Zuordnung')).toBeInTheDocument();
    expect(screen.queryByText(/Geheimer Inhalt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/legacy-geheim-1/)).not.toBeInTheDocument();
    expect(screen.queryByText('#73')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mir zuordnen/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Alle alten Offline-Daten verwerfen' }));
    expect(
      await screen.findByText('Alle alten Offline-Daten ohne Zuordnung endgültig verwerfen?'),
    ).toBeInTheDocument();
    expect(await queueNichtZugeordnetZaehlen()).toBe(1);

    await user.click(
      screen.getByRole('button', {
        name: 'Alle alten Offline-Daten endgültig verwerfen',
      }),
    );

    await waitFor(async () => expect(await queueNichtZugeordnetZaehlen()).toBe(0));
  });
});

describe('OfflineRecoveryDrawer: Einträge früherer Kopplung (LLH-1331)', () => {
  const geraet = {
    kopplung_id: 3,
    einsatz_id: 7,
    ansicht: 'uhs-tablet' as const,
    stelle_id: 2,
    uhs_id: 2,
    stelle: 'UHS Nord',
    bezeichnung: 'Tablet 1',
    laeuft_ab_at: '2026-11-01 18:00:00',
  };

  async function vorbereiten() {
    await geraetKontoBestaetigt(41, geraet);
    await schreibaktionEinreihen(41, 7, {
      art: 'notiz',
      person_id: 10,
      bezeichnung: 'R-012',
      daten: { text: 'Geheime Notiz', client_id: 'n-1' },
    });
    // Neue Kopplung an einer anderen UHS: keine Übernahme.
    await geraetKontoBestaetigt(42, { ...geraet, kopplung_id: 4, stelle_id: 5, uhs_id: 5 });
  }

  it('zeigt am Gerät die Anzahl ohne Inhalt und verwirft erst nach Rückfrage', async () => {
    await vorbereiten();
    const user = userEvent.setup();
    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={42} geraet />
      </App>,
    );
    expect(await screen.findByText('Aus früherer Kopplung')).toBeInTheDocument();
    expect(screen.getByText('1 Eintrag · nicht übertragbar')).toBeInTheDocument();
    expect(screen.queryByText(/Geheime Notiz/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(
      await screen.findByText('Einträge früherer Kopplung endgültig verwerfen?'),
    ).toBeInTheDocument();
    expect(await fruehereKopplungZaehlen(42)).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Endgültig verwerfen' }));
    await waitFor(async () => expect(await fruehereKopplungZaehlen(42)).toBe(0));
  });

  it('zeigt einer Person keine Einträge von Gerätekonten', async () => {
    await vorbereiten();
    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={42} />
      </App>,
    );
    await waitFor(() =>
      expect(screen.queryByText('Aus früherer Kopplung')).not.toBeInTheDocument(),
    );
  });
});

describe('OfflineRecoveryDrawer: abgelehnte Betreuungsmeldungen (LFH-675)', () => {
  it('benennt Art und Objekt und zeigt Grund und vollständigen Inhalt', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'stand',
      bezirk_id: 3,
      bezeichnung: 'Uferstraße 12–40',
      daten: {
        evakuiert: 200,
        erhebung: 'gezaehlt',
        zeitpunkt_at: '2026-09-24 10:00:00',
        client_id: 'stand-abgelehnt',
      },
    });
    await schreibaktionEinreihen(11, 7, {
      art: 'belegung',
      stelle_id: 4,
      bezeichnung: 'Turnhalle Ost',
      daten: { belegt: 37, client_id: 'beleg-abgelehnt' },
    });
    const [stand, belegung] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, stand, 'Evakuierungsbezirk ‚Uferstraße 12–40‘ ist storniert');
    await schreibaktionAblehnen(11, belegung, 'Betreuungsstelle ist geschlossen');

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(
      await screen.findByText('Abgelehnte Standmeldung: Uferstraße 12–40'),
    ).toBeInTheDocument();
    expect(screen.getByText('Abgelehnte Belegungsmeldung: Turnhalle Ost')).toBeInTheDocument();
    expect(screen.getByText(/ist storniert/)).toBeInTheDocument();
    expect(screen.getByText(/"client_id": "stand-abgelehnt"/)).toBeInTheDocument();
    expect(screen.getByText(/"belegt": 37/)).toBeInTheDocument();
  });
});

describe('OfflineRecoveryDrawer: ETB-Eintrag mit weggeräumten Anhängen (LFH-746)', () => {
  async function abgelehnterEtbEintrag(anhangIds?: number[]): Promise<void> {
    await queueEinreihen(11, 7, {
      typ: 'meldung',
      inhalt: 'Lagefoto Brücke',
      client_id: 'etb-mit-foto',
      ...(anhangIds ? { anhang_ids: anhangIds } : {}),
    });
    const [pending] = await queueLaden(11, 7);
    await queueAblehnen(11, pending, 'Anhang unbekannt oder nicht mehr vorhanden');
  }

  it('nennt die fehlenden Dateien und sendet erst nach Rückfrage nur den Text', async () => {
    await abgelehnterEtbEintrag([41, 42]);
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(await screen.findByText('Abgelehnter ETB-Eintrag')).toBeInTheDocument();
    expect(screen.getByText('2 Dateien')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ohne Anhänge senden' }));
    expect(await screen.findByText('Ohne Anhänge senden?')).toBeInTheDocument();
    expect(
      screen.getByText('2 Dateien fehlen dann, nachreichen nur per Berichtigung.'),
    ).toBeInTheDocument();
    // Vor der Bestätigung bleibt alles, wie es ist.
    expect(await abgelehntLaden(11, 7)).toHaveLength(1);
    expect(await queueLaden(11, 7)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Nur den Text senden' }));

    await waitFor(async () => expect(await queueLaden(11, 7)).toHaveLength(1));
    expect(await abgelehntLaden(11, 7)).toHaveLength(0);
    const [zurueck] = await queueLaden(11, 7);
    expect(zurueck.eintrag).toEqual({
      typ: 'meldung',
      inhalt: 'Lagefoto Brücke',
      client_id: 'etb-mit-foto',
    });
  });

  it('bietet das Senden ohne Anhänge nur an, wenn der Eintrag welche trägt', async () => {
    await abgelehnterEtbEintrag();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(await screen.findByText('Abgelehnter ETB-Eintrag')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ohne Anhänge senden' })).not.toBeInTheDocument();
    expect(screen.queryByText('Anhänge')).not.toBeInTheDocument();
  });
});

describe('OfflineRecoveryDrawer: abgelehnte Verpflegungsausgaben (LFH-688)', () => {
  it('benennt das Zeitfenster und zeigt Grund und vollständigen Inhalt', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'ausgabe',
      zeitfenster_id: 9,
      bezeichnung: 'Mittag',
      daten: { menge: 120, zeitpunkt_at: '2026-09-24 09:40:00', client_id: 'ausgabe-abgelehnt' },
    });
    const [ausgabe] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, ausgabe, 'Nicht gefunden');

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(await screen.findByText('Abgelehnte Verpflegungsausgabe: Mittag')).toBeInTheDocument();
    expect(screen.getByText(/Nicht gefunden/)).toBeInTheDocument();
    expect(screen.getByText(/"client_id": "ausgabe-abgelehnt"/)).toBeInTheDocument();
    expect(screen.getByText(/"menge": 120/)).toBeInTheDocument();
  });

  /** Ausgabe an `stelleId`, wegen aufgelöster Stelle abgelehnt; der Drawer mit Query-Client. */
  async function abgelehnteAusgabeAnStelle(stelleId: number) {
    await schreibaktionEinreihen(11, 7, {
      art: 'ausgabe',
      zeitfenster_id: 9,
      bezeichnung: 'Mittag',
      daten: { menge: 15, verpflegungsstelle_id: stelleId, client_id: 'ausgabe-stelle' },
    });
    const [ausgabe] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, ausgabe, 'Die Verpflegungsstelle ist aufgelöst');
    render(
      <QueryClientProvider client={neuerQueryClient()}>
        <App>
          <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
        </App>
      </QueryClientProvider>,
    );
  }

  const stellenZeile = () =>
    screen.getByText('Stelle', { selector: '.ant-descriptions-item-label' }).closest('tr')!;

  it('nennt die aufgelöste Stelle mit Namen statt Kennung (LLH-1298)', async () => {
    const verpflegung = verpflegungMitStellen();
    verpflegung.stellen = verpflegung.stellen.map((s) =>
      s.id === FELDKUECHE ? { ...s, status: 'aufgeloest' as const } : s,
    );
    vi.mocked(ladeVerpflegung).mockResolvedValue(verpflegung);

    await abgelehnteAusgabeAnStelle(FELDKUECHE);

    expect(
      await screen.findByText('Abgelehnte Verpflegungsausgabe: Mittag · Feldküche BR Sportplatz'),
    ).toBeInTheDocument();
    expect(within(stellenZeile()).getByText('Feldküche BR Sportplatz')).toBeInTheDocument();
    expect(ladeVerpflegung).toHaveBeenCalledWith(7);
    // Der vollständige Inhalt bleibt, wie er gesendet wird.
    expect(screen.getByText(/"verpflegungsstelle_id": 21/)).toBeInTheDocument();
  });

  it('eine Kennung, die die Verpflegung nicht führt, heißt „unbekannte Stelle“', async () => {
    vi.mocked(ladeVerpflegung).mockResolvedValue({
      ...verpflegungMitStellen(),
      stellen: [stelle({ id: 99, bezeichnung: 'Andere Stelle' })],
    });

    await abgelehnteAusgabeAnStelle(FELDKUECHE);

    expect(
      await screen.findByText('Abgelehnte Verpflegungsausgabe: Mittag · unbekannte Stelle'),
    ).toBeInTheDocument();
    expect(within(stellenZeile()).getByText('unbekannte Stelle')).toBeInTheDocument();
  });

  it('lädt die Verpflegung nicht, heißt die Stelle „unbekannte Stelle“', async () => {
    vi.mocked(ladeVerpflegung).mockRejectedValue(new Error('Netzwerkfehler'));

    await abgelehnteAusgabeAnStelle(FELDKUECHE);

    expect(
      await screen.findByText('Abgelehnte Verpflegungsausgabe: Mittag · unbekannte Stelle'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('eine Ausgabe ohne Stelle liest die Verpflegung nicht', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'ausgabe',
      zeitfenster_id: 9,
      bezeichnung: 'Mittag',
      daten: { menge: 5, client_id: 'ausgabe-ohne-stelle' },
    });
    const [ausgabe] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, ausgabe, 'Nicht gefunden');

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(await screen.findByText('Abgelehnte Verpflegungsausgabe: Mittag')).toBeInTheDocument();
    expect(screen.queryByText('Stelle', { selector: '.ant-descriptions-item-label' })).toBeNull();
    expect(ladeVerpflegung).not.toHaveBeenCalled();
  });
});

describe('OfflineRecoveryDrawer: abgelehntes Eintreffen am Bereitstellungsraum (LLH-1075 Teil III)', () => {
  it('nennt Kraft und Raum, zeigt den Grund und reiht mit derselben client_id erneut ein', async () => {
    const aktion = {
      art: 'eintreffen' as const,
      br_id: 4,
      bezeichnung: 'BR Sportplatz',
      name: 'FL-MUS 1-44-1',
      daten: {
        unangemeldet: { fahrzeuge: [{ funkrufname: 'FL-MUS 1-44-1' }] },
        client_id: 'eintreffen-abgelehnt',
        zeitpunkt_at: '2026-10-16 12:12:00',
      },
    };
    await schreibaktionEinreihen(11, 7, aktion);
    const [eintreffen] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, eintreffen, 'Bereitstellungsraum ist nicht aktiv');

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(
      await screen.findByText('Abgelehntes Eintreffen: FL-MUS 1-44-1 · BR Sportplatz'),
    ).toBeInTheDocument();
    expect(screen.getByText('Bereitstellungsraum ist nicht aktiv')).toBeInTheDocument();
    expect(screen.getByText(/"client_id": "eintreffen-abgelehnt"/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }));
    await waitFor(async () =>
      expect((await schreibaktionenLaden(11, 7)).map((z) => z.aktion)).toEqual([aktion]),
    );
  });
});

describe('OfflineRecoveryDrawer: abgelehnte Einträge einer Person (LLH-1138, design.md D8)', () => {
  it.each([
    ['sichtung', { kategorie: 'sk1', notiz: null }, 'Abgelehnte Sichtung: R-012'],
    ['verbleib', { art: 'transport' }, 'Abgelehnter Verbleib: R-012'],
    ['notiz', { text: 'Infusion läuft' }, 'Abgelehnte Verlaufsnotiz: R-012'],
    [
      'transport',
      { prioritaet: 'dringlich', art: null, fachrichtung: null },
      'Abgelehnter Transport: R-012',
    ],
    ['massnahme', { art: 'zugang' }, 'Abgelehnte Maßnahme: R-012'],
    [
      'verletzung',
      { ansicht: 'vorn', region: 'kopf', art: 'wunde_blutung' },
      'Abgelehnte Verletzung: R-012',
    ],
  ] as const)(
    '%s: nennt Art und Person, der Grund bleibt bis zum Verwerfen',
    async (art, daten, titel) => {
      const aktion = {
        art,
        person_id: 10,
        bezeichnung: 'R-012',
        daten: { ...daten, client_id: `${art}-abgelehnt`, zeitpunkt_at: '2026-10-18 14:10:00' },
      } as Parameters<typeof schreibaktionEinreihen>[2];
      await schreibaktionEinreihen(11, 7, aktion);
      const [zeile] = await schreibaktionenLaden(11, 7);
      await schreibaktionAblehnen(11, zeile, 'Stornierte Person kann nicht gesichtet werden');
      vi.mocked(schreibaktionAbgelehntVerwerfen).mockImplementation(
        (await vi.importActual<typeof import('./queue')>('./queue'))
          .schreibaktionAbgelehntVerwerfen,
      );

      const { rerender } = render(
        <App>
          <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
        </App>,
      );
      const karte = (await screen.findByText(titel)).closest('.ant-card') as HTMLElement;
      expect(
        within(karte).getByText('Stornierte Person kann nicht gesichtet werden'),
      ).toBeInTheDocument();
      expect(
        within(karte).getByText(new RegExp(`"client_id": "${art}-abgelehnt"`)),
      ).toBeInTheDocument();

      // Wieder geöffnet steht der Grund noch da: er geht erst mit dem Verwerfen.
      rerender(
        <App>
          <OfflineRecoveryDrawer open={false} onClose={vi.fn()} benutzerId={11} />
        </App>,
      );
      rerender(
        <App>
          <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
        </App>,
      );
      const wieder = (await screen.findByText(titel)).closest('.ant-card') as HTMLElement;
      expect(
        within(wieder).getByText('Stornierte Person kann nicht gesichtet werden'),
      ).toBeInTheDocument();
      await userEvent.click(within(wieder).getByRole('button', { name: /Verwerfen/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Endgültig verwerfen' }));
      await waitFor(() => expect(screen.queryByText(titel)).not.toBeInTheDocument());
    },
  );
});

function zurueckgehalten<T>() {
  let erfuellen!: (wert: T) => void;
  let ablehnen!: (grund: unknown) => void;
  const versprechen = new Promise<T>((ja, nein) => {
    erfuellen = ja;
    ablehnen = nein;
  });
  return { versprechen, erfuellen, ablehnen };
}

const toasts = () => document.querySelectorAll('.ant-message-notice').length;
const fehlerToasts = () => document.querySelectorAll('.ant-message-error').length;

/** Karte eines abgelehnten ETB-Eintrags über seinen Inhalt; der Titel ist bei allen gleich. */
async function etbKarte(inhalt: string): Promise<HTMLElement> {
  const text = await screen.findByText(new RegExp(`"inhalt": "${inhalt}"`));
  return text.closest('.ant-card') as HTMLElement;
}

async function zweiAbgelehnteEtbEintraege(): Promise<void> {
  await queueEinreihen(11, 7, { typ: 'meldung', inhalt: 'Erster', client_id: 'etb-1' });
  await queueEinreihen(11, 7, { typ: 'meldung', inhalt: 'Zweiter', client_id: 'etb-2' });
  const [erster, zweiter] = await queueLaden(11, 7);
  await queueAblehnen(11, erster, 'Einsatz abgeschlossen');
  await queueAblehnen(11, zweiter, 'Einsatz abgeschlossen');
}

describe('OfflineRecoveryDrawer: Fehler am Ort (LFH-1077)', () => {
  it('nennt eine gescheiterte Aktion an ihrer Karte, nebenläufig je Karte, ohne Toast', async () => {
    await zweiAbgelehnteEtbEintraege();
    const erster = zurueckgehalten<boolean>();
    const zweiter = zurueckgehalten<boolean>();
    const dritter = zurueckgehalten<boolean>();
    vi.mocked(abgelehntWiederholen)
      .mockImplementationOnce(() => erster.versprechen)
      .mockImplementationOnce(() => zweiter.versprechen)
      .mockImplementationOnce(() => dritter.versprechen);
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    let karteA = await etbKarte('Erster');
    let karteB = await etbKarte('Zweiter');
    await user.click(within(karteA).getByRole('button', { name: /Erneut versuchen/ }));
    await user.click(within(karteB).getByRole('button', { name: /Erneut versuchen/ }));

    // A scheitert, während B noch läuft: der Grund steht nur an A.
    await act(async () => erster.ablehnen(new Error('IndexedDB weg')));
    expect(await within(karteA).findByText('Nicht ausgeführt')).toBeInTheDocument();
    expect(karteA.querySelector('[data-fehler]')).not.toBeNull();
    expect(karteB.querySelector('[data-fehler]')).toBeNull();

    // B meldet, sein Eintrag ist weg: die Liste lädt neu (hier steht er noch), A behält den Grund.
    await act(async () => zweiter.erfuellen(false));
    await waitFor(() => expect(document.querySelector('.ant-skeleton')).toBeNull());
    karteA = await etbKarte('Erster');
    karteB = await etbKarte('Zweiter');
    expect(await within(karteB).findByText('Eintrag nicht mehr vorhanden')).toBeInTheDocument();
    expect(within(karteA).getByText('Nicht ausgeführt')).toBeInTheDocument();
    expect(toasts()).toBe(0);

    // Erneutes Absenden räumt den Grund schon, solange die Antwort aussteht.
    await user.click(within(karteA).getByRole('button', { name: /Erneut versuchen/ }));
    await waitFor(() => expect(karteA.querySelector('[data-fehler]')).toBeNull());
    expect(within(karteB).getByText('Eintrag nicht mehr vorhanden')).toBeInTheDocument();
    await act(async () => dritter.erfuellen(true));
    expect(fehlerToasts()).toBe(0);
  });

  it('nennt ein gescheitertes Verwerfen an der Karte der Schreibaktion', async () => {
    await schreibaktionEinreihen(11, 7, {
      art: 'belegung',
      stelle_id: 4,
      bezeichnung: 'Turnhalle Ost',
      daten: { belegt: 37, client_id: 'beleg-abgelehnt' },
    });
    const [belegung] = await schreibaktionenLaden(11, 7);
    await schreibaktionAblehnen(11, belegung, 'Betreuungsstelle ist geschlossen');
    vi.mocked(schreibaktionAbgelehntVerwerfen).mockRejectedValueOnce(new Error('Quota'));
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    const karte = (await screen.findByText('Abgelehnte Belegungsmeldung: Turnhalle Ost')).closest(
      '.ant-card',
    ) as HTMLElement;
    await user.click(within(karte).getByRole('button', { name: 'Verwerfen' }));
    await user.click(await screen.findByRole('button', { name: 'Endgültig verwerfen' }));

    expect(await within(karte).findByText('Nicht ausgeführt')).toBeInTheDocument();
    expect(toasts()).toBe(0);
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(0);
  });

  it('nennt ein gescheitertes Verwerfen der Alt-Daten an deren Hinweis', async () => {
    await queueLegacyEinreihenFuerTests(73, {
      typ: 'meldung',
      inhalt: 'Alt',
      client_id: 'legacy-1',
    });
    vi.mocked(queueNichtZugeordnetAlleVerwerfen).mockRejectedValueOnce(new Error('Quota'));
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Alle alten Offline-Daten verwerfen' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Alle alten Offline-Daten endgültig verwerfen' }),
    );

    const hinweis = screen.getByText('Alte Offline-Daten ohne Zuordnung').closest('.ant-alert');
    expect(await within(hinweis as HTMLElement).findByText('Nicht ausgeführt')).toBeInTheDocument();
    expect(toasts()).toBe(0);
  });

  it('nennt den Grund über der Liste, wenn die Karte danach verschwunden ist', async () => {
    await zweiAbgelehnteEtbEintraege();
    vi.mocked(abgelehntWiederholen).mockImplementationOnce(async (benutzerId, id) => {
      await abgelehntEntfernen(benutzerId, id);
      throw new Error('Schreiben abgebrochen');
    });
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    const karteA = await etbKarte('Erster');
    await user.click(within(karteA).getByRole('button', { name: /Erneut versuchen/ }));

    await waitFor(() => expect(screen.queryByText(/"inhalt": "Erster"/)).not.toBeInTheDocument());
    const hinweis = await screen.findByRole('alert');
    expect(hinweis).toHaveTextContent('Abgelehnter ETB-Eintrag · Nicht ausgeführt');
    expect((await etbKarte('Zweiter')).querySelector('[data-fehler]')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('Eintrag in einem anderen Tab schon verworfen: Liste neu geladen, Grund über der Liste', async () => {
    await zweiAbgelehnteEtbEintraege();
    vi.mocked(abgelehntWiederholen).mockImplementationOnce(async (benutzerId, id) => {
      // Ein anderer Tab hat den Eintrag verworfen: das Fenster-Ereignis erreicht diesen Tab nicht.
      const still = vi.spyOn(window, 'dispatchEvent').mockReturnValue(true);
      try {
        await abgelehntEntfernen(benutzerId, id);
      } finally {
        still.mockRestore();
      }
      return false;
    });
    const user = userEvent.setup();

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    const karteA = await etbKarte('Erster');
    await user.click(within(karteA).getByRole('button', { name: /Erneut versuchen/ }));

    await waitFor(() => expect(screen.queryByText(/"inhalt": "Erster"/)).not.toBeInTheDocument());
    const hinweis = await screen.findByRole('alert');
    expect(hinweis).toHaveTextContent('Abgelehnter ETB-Eintrag · Eintrag nicht mehr vorhanden');
    expect((await etbKarte('Zweiter')).querySelector('[data-fehler]')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('räumt Gründe beim Wiederöffnen und meldet nach einem Einsatzwechsel nicht mehr', async () => {
    await zweiAbgelehnteEtbEintraege();
    vi.mocked(abgelehntWiederholen).mockRejectedValueOnce(new Error('IndexedDB weg'));
    const spaet = zurueckgehalten<boolean>();
    vi.mocked(abgelehntWiederholen)
      .mockImplementationOnce(() => spaet.versprechen)
      .mockRejectedValueOnce(new Error('IndexedDB weg'));
    const user = userEvent.setup();
    const drawer = (open: boolean, einsatzId?: number) => (
      <App>
        <OfflineRecoveryDrawer
          open={open}
          onClose={vi.fn()}
          benutzerId={11}
          einsatzId={einsatzId}
        />
      </App>
    );

    const { rerender } = render(drawer(true, 7));
    let karteA = await etbKarte('Erster');
    await user.click(within(karteA).getByRole('button', { name: /Erneut versuchen/ }));
    expect(await within(karteA).findByText('Nicht ausgeführt')).toBeInTheDocument();

    rerender(drawer(false, 7));
    rerender(drawer(true, 7));
    // Erst nach dem Laden prüfen: während des Ladens zeigt der Drawer gar keine Karten.
    await waitFor(() => expect(document.querySelector('.ant-skeleton')).toBeNull());
    expect(screen.getAllByText(/"inhalt": "Erster"/)).toHaveLength(1);
    expect(document.querySelector('[data-fehler]')).toBeNull();

    // Der Einsatzwechsel räumt den Grund an B; A, erst danach gescheitert, meldet nicht neu.
    karteA = await etbKarte('Erster');
    const karteB = await etbKarte('Zweiter');
    await user.click(within(karteA).getByRole('button', { name: /Erneut versuchen/ }));
    await user.click(within(karteB).getByRole('button', { name: /Erneut versuchen/ }));
    expect(await within(karteB).findByText('Nicht ausgeführt')).toBeInTheDocument();
    rerender(drawer(true, undefined));
    await waitFor(() => expect(document.querySelector('[data-fehler]')).toBeNull());
    expect(await etbKarte('Erster')).toBeInTheDocument();
    await act(async () => spaet.ablehnen(new Error('IndexedDB weg')));
    expect(document.querySelector('[data-fehler]')).toBeNull();
    expect(toasts()).toBe(0);
  });

  it('nennt einen Ladefehler im Drawer und räumt ihn beim nächsten Laden', async () => {
    vi.mocked(abgelehntLaden).mockRejectedValueOnce(new Error('IndexedDB gesperrt'));

    render(
      <App>
        <OfflineRecoveryDrawer open onClose={vi.fn()} benutzerId={11} />
      </App>,
    );

    expect(await screen.findByText('Nicht geladen')).toBeInTheDocument();
    expect(screen.getByText('Offline-Daten konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine wiederherzustellenden Offline-Aktionen')).toBeNull();
    expect(toasts()).toBe(0);

    await act(async () => {
      window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
    });
    await waitFor(() => expect(screen.queryByText('Nicht geladen')).toBeNull());
    expect(
      await screen.findByText('Keine wiederherzustellenden Offline-Aktionen'),
    ).toBeInTheDocument();
  });
});
