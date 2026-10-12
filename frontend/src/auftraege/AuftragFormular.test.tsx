import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { mitVorgehenderGeraeteuhr } from '../test/vorgehendeUhr';
import AuftragFormular from './AuftragFormular';

// Katalog und Besetzung stehen fest, statt über das Netz zu kommen (LFH-549).
vi.mock('../fuehrung/useFunktionsVorschlaege', async () => ({
  useFunktionsVorschlaege: (await import('../test/fuehrungsfunktionen')).vorschlaegeFuer,
}));

/** Klappteil „Ausführung“: Mittel, Ziel, Weg, Zeit nach FwDV 100 (LLH-1091). */
const AUSFUEHRUNG = ['Mittel / Womit', 'Ziel / Ort', 'Weg', 'Zeit / Wann'];
/** Die Schemafelder unter „Weitere Angaben“ (dazu Richtung und Erteilzeit). */
const WEITERE = ['Lage', 'Absicht', 'Verbindung / Meldewege', 'Sicherheit / Besonderes'];
/** Alle acht Freitextfelder des Befehlsschemas. */
const SCHEMA = [...AUSFUEHRUNG, ...WEITERE];

function felderZaehlen(): number {
  return screen.getAllByRole('textbox').length + screen.getAllByRole('combobox').length;
}

/** Beschriftungen der Felder in Dokumentfolge. */
function labels(): string[] {
  return [...document.querySelectorAll('.ant-form-item-label label')].map(
    (l) => l.textContent ?? '',
  );
}

const openAusfuehrung = () => userEvent.click(screen.getByText(/^Ausführung:/));
const openWeitere = () => userEvent.click(screen.getByText('Weitere Angaben'));

function rendern(over: Partial<Parameters<typeof AuftragFormular>[0]> = {}) {
  return renderMitProviders(
    <AuftragFormular
      card={false}
      senden={false}
      abschnitte={[{ id: 1, name: 'Abschnitt Nord' }]}
      einheiten={[{ id: 2, name: 'LZ 1' }]}
      onAnlegen={vi.fn()}
      {...over}
    />,
  );
}

/** Richtung „extern“ samt Bezeichnung: der externe Adressat zählt als Empfänger. */
async function externMitBezeichnung() {
  await openWeitere();
  await userEvent.click(screen.getByLabelText('Richtung'));
  await userEvent.click(await screen.findByTitle('Extern'));
  await userEvent.type(screen.getByLabelText('Externe Bezeichnung'), 'Leitstelle Nord');
}

describe('AuftragFormular — Feldbudget (LFH-343 · C8, Befund H49)', () => {
  /**
   * „≤ 4" allein ist nicht widerlegbar (ohne `forceRender` rendert der Collapse erst beim
   * Aufklappen); erst das Paar — Zahl klein UND Aufklappen bringt die Felder — trägt.
   */
  it('zeigt im Ausgangszustand genau vier Felder in der Folge der FwDV 100', () => {
    rendern();
    expect(felderZaehlen()).toBe(4);
    expect(labels()).toEqual([
      'Empfänger',
      'Auftrag / Was',
      'Priorität',
      'Frist (Quittung/Vollzug)',
    ]);
    for (const feld of SCHEMA) expect(screen.queryByLabelText(feld)).toBeNull();
  });

  it('holt Mittel, Ziel, Weg und Zeit erst beim Aufklappen der Ausführung ins DOM', async () => {
    rendern();
    await openAusfuehrung();
    expect(felderZaehlen()).toBe(8);
    expect(labels().slice(4)).toEqual(AUSFUEHRUNG);
    for (const feld of WEITERE) expect(screen.queryByLabelText(feld)).toBeNull();
  });

  it('holt die weiteren Angaben samt Richtung und Erteilzeit erst beim Aufklappen ins DOM', async () => {
    rendern();
    await openWeitere();
    expect(felderZaehlen()).toBe(10);
    expect(labels().slice(4)).toEqual([...WEITERE, 'Richtung', 'Erteilt am (optional)']);
    for (const feld of AUSFUEHRUNG) expect(screen.queryByLabelText(feld)).toBeNull();
  });

  it('gibt dem Empfänger den ersten Fokus, auch vor einem vorbelegten Auftragstext', async () => {
    rendern({ initialText: 'Aus der Meldung' });
    await waitFor(() => expect(screen.getByLabelText('Empfänger')).toHaveFocus());
    expect(labels().slice(0, 2)).toEqual(['Empfänger', 'Auftrag / Was']);
  });

  /**
   * Der Empfänger ist PFLICHT und darf nicht hinter den Collapse: strukturierte Ziele und freie
   * Funktionstexte laufen durch EIN Feld.
   */
  it('nimmt freie Funktionstexte über dasselbe Feld wie die strukturierten Ziele', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen });

    const empfaenger = screen.getByLabelText('Empfänger');
    await userEvent.type(empfaenger, 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        auftrag_text: 'Erkunden',
        empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'S3' }],
      }),
    );
  });

  it('erkennt einen gewählten Abschnitt als strukturiertes Ziel', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen });

    await userEvent.click(screen.getByLabelText('Empfänger'));
    await userEvent.click(await screen.findByTitle('Abschnitt Nord'));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    // Der Präfix `abschnitt:` unterscheidet die beiden Sorten im selben Feld.
    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        empfaenger: [{ empfaenger_typ: 'abschnitt', abschnitt_id: 1 }],
      }),
    );
  });
});

describe('AuftragFormular — Funktionskatalog (LFH-549)', () => {
  it('macht aus der Wahl „S3 – Einsatz“ einen Katalogempfänger', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen, einsatzId: 7 });

    await userEvent.click(screen.getByLabelText('Empfänger'));
    await userEvent.click(await screen.findByTitle('S3 – Einsatz'));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({ empfaenger: [{ empfaenger_typ: 'funktion', funktion: 's3' }] }),
    );
  });

  it('zeigt die Besetzung im Vorschlag', async () => {
    rendern({ einsatzId: 7 });
    await userEvent.click(screen.getByLabelText('Empfänger'));
    expect(await screen.findByTitle('S2 – Lage (Müller)')).toBeInTheDocument();
  });

  it('lässt getipptes „S3“ + Enter Freitext bleiben, auch mit Katalog', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen, einsatzId: 7 });

    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'S3' }],
      }),
    );
  });

  it('bietet „Fachberater: <Tipptext>“ als ausdrückliche Wahl an', async () => {
    const onAnlegen = vi.fn();
    rendern({ onAnlegen, einsatzId: 7 });

    await userEvent.type(screen.getByLabelText('Empfänger'), 'THW');
    await userEvent.click(await screen.findByTitle('Fachberater: THW'));
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Beraten');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        empfaenger: [{ empfaenger_typ: 'funktion', funktion: 'fachberater', funktion_text: 'THW' }],
      }),
    );
  });
});

/** LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. */
describe('AuftragFormular — Frist und Erteilung in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('„erteilt am“ zeigt jetzt in Berlin, eine Frist 13:00 geht als 11:00 UTC hinaus', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'));
    try {
      const onAnlegen = vi.fn();
      renderMitProviders(
        <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
          <AuftragFormular
            card={false}
            senden={false}
            abschnitte={[{ id: 1, name: 'Abschnitt Nord' }]}
            einheiten={[{ id: 2, name: 'LZ 1' }]}
            onAnlegen={onAnlegen}
          />
        </AnzeigeKonventionenProvider>,
      );
      await openWeitere();
      expect(await screen.findByRole('textbox', { name: 'Erteilt am (optional)' })).toHaveValue(
        '2026-09-24 10:00',
      );
      await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
      await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
      const frist = screen.getByRole('textbox', { name: 'Frist (Quittung/Vollzug)' });
      await userEvent.click(frist);
      await userEvent.type(frist, '2026-09-24 13:00');
      await userEvent.keyboard('{Enter}');
      await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
      expect(onAnlegen).toHaveBeenCalledWith(
        expect.objectContaining({
          frist_at: '2026-09-24 11:00:00',
          erteilt_at: '2026-09-24 08:00:00',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AuftragFormular — Eingabegrenzen (LFH-937)', () => {
  it('zeigt den Zähler am Auftragstext erst ab 80 % und kürzt eingefügten Text nie', () => {
    rendern();
    const text = screen.getByLabelText('Auftrag / Was');
    fireEvent.change(text, { target: { value: 'a'.repeat(7_999) } });
    expect(screen.queryByText(/\/ 10\.000/)).toBeNull();
    fireEvent.change(text, { target: { value: 'a'.repeat(8_000) } });
    expect(screen.getByText('8.000 / 10.000')).toBeInTheDocument();
    fireEvent.change(text, { target: { value: 'a'.repeat(10_003) } });
    expect(text).toHaveValue('a'.repeat(10_003));
    expect(screen.getByText('10.003 / 10.000 · zu lang')).toBeInTheDocument();
  });

  it('ein zu langer initialText bleibt beim Löschen eines Zeichens vollständig', () => {
    const start = `${'m'.repeat(10_000)}ENDE`;
    rendern({ initialText: start });
    const text = screen.getByLabelText('Auftrag / Was');
    fireEvent.change(text, { target: { value: start.slice(1) } });
    expect(text).toHaveValue(start.slice(1));
  });

  it('kürzt einen zu langen initialText nicht still: Senden scheitert, bis gekürzt ist', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen, initialText: 'm'.repeat(10_001) });
    const text = screen.getByLabelText('Auftrag / Was');
    expect(text).toHaveValue('m'.repeat(10_001));
    expect(screen.getByText('10.001 / 10.000 · zu lang')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    expect(
      await screen.findByText('Auftragstext darf höchstens 10.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onAnlegen).not.toHaveBeenCalled();

    fireEvent.change(text, { target: { value: 'Erkunden' } });
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
  });

  it('lehnt einen freien Empfänger über 200 Zeichen ab', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    fireEvent.change(screen.getByLabelText('Empfänger'), {
      target: { value: `${'f'.repeat(201)},` },
    });
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    expect(
      await screen.findByText('Ein Empfänger darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onAnlegen).not.toHaveBeenCalled();
  });

  it('nimmt höchstens 50 Empfänger an, auch beim Einfügen einer langen Liste', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    const liste = Array.from({ length: 51 }, (_, i) => `Stelle ${i + 1}`).join(',');
    fireEvent.change(screen.getByLabelText('Empfänger'), { target: { value: `${liste},` } });
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen.mock.calls[0][0].empfaenger).toHaveLength(50);
  });

  it('begrenzt die Extern-Bezeichnung nativ auf 200 Zeichen', async () => {
    rendern();
    await openWeitere();
    await userEvent.click(screen.getByLabelText('Richtung'));
    await userEvent.click(await screen.findByTitle('Extern'));
    expect(screen.getByLabelText('Externe Bezeichnung')).toHaveAttribute('maxlength', '200');
  });

  it('zählt die acht Befehlsfelder ab 80 %; über 2 000 Zeichen bleiben sie stehen und sperren', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    await openAusfuehrung();
    await openWeitere();
    fireEvent.change(screen.getByLabelText('Lage'), { target: { value: 'l'.repeat(1_600) } });
    expect(screen.getByText('1.600 / 2.000')).toBeInTheDocument();
    for (const feld of SCHEMA) {
      const el = screen.getByLabelText(feld);
      expect(el).not.toHaveAttribute('maxlength');
      fireEvent.change(el, { target: { value: 's'.repeat(2_001) } });
      expect(el).toHaveValue('s'.repeat(2_001));
    }
    expect(screen.getAllByText('2.001 / 2.000 · zu lang')).toHaveLength(8);
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    expect(
      await screen.findByText('Absicht darf höchstens 2.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Sicherheit darf höchstens 2.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(screen.getByText('Weg darf höchstens 2.000 Zeichen lang sein')).toBeInTheDocument();
    expect(screen.getByText('Ziel/Ort darf höchstens 2.000 Zeichen lang sein')).toBeInTheDocument();
    expect(onAnlegen).not.toHaveBeenCalled();
  });

  it('extern: 50 Tags plus externer Adressat sind 51 Empfänger und werden abgelehnt', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    const liste = Array.from({ length: 50 }, (_, i) => `Stelle ${i + 1}`).join(',');
    fireEvent.change(screen.getByLabelText('Empfänger'), { target: { value: `${liste},` } });
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await externMitBezeichnung();
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    expect(await screen.findByText('Höchstens 50 Empfänger je Auftrag')).toBeInTheDocument();
    expect(onAnlegen).not.toHaveBeenCalled();
  });

  it('extern: 49 Tags plus externer Adressat gehen als 50 Empfänger hinaus', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    const liste = Array.from({ length: 49 }, (_, i) => `Stelle ${i + 1}`).join(',');
    fireEvent.change(screen.getByLabelText('Empfänger'), { target: { value: `${liste},` } });
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await externMitBezeichnung();
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen.mock.calls[0][0].empfaenger).toHaveLength(50);
  });
});

/** LFH-1031: „erteilt am“ ist nach der Serveruhr vorbelegt, eine Eingabe bleibt. */
describe('AuftragFormular — Gerät mit 5 min Vorlauf (LFH-1031)', () => {
  mitProzessZone('UTC');
  const SERVER = Date.parse('2026-10-04T10:00:00Z');
  mitVorgehenderGeraeteuhr(SERVER);

  async function erteilen(onAnlegen: ReturnType<typeof vi.fn>) {
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    return (onAnlegen.mock.calls[0][0] as { erteilt_at?: string }).erteilt_at;
  }

  it('der aufgeklappte, unberührte Vorschlag sendet die Serverzeit', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    // Zugeklappt geht kein Wert hinaus, dann setzt der Server die Erteilzeit selbst.
    await openWeitere();
    expect(await erteilen(onAnlegen)).toBe('2026-10-04 10:00:00');
  });

  it('eine eingetragene Zeit bleibt unverändert', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    await openWeitere();
    const feld = screen.getByRole('textbox', { name: 'Erteilt am (optional)' });
    await userEvent.click(feld);
    await userEvent.clear(feld);
    await userEvent.type(feld, '2026-10-04 09:30');
    await userEvent.keyboard('{Enter}');
    expect(await erteilen(onAnlegen)).toBe('2026-10-04 09:30:00');
  });
});

/**
 * Der Pflicht-Empfänger ist eine Prüfung ohne Server: sie steht als Regel am Feld, nicht als
 * Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
 */
describe('AuftragFormular — Pflicht-Empfänger am Feld (LFH-1077)', () => {
  it('ohne Empfänger steht der Grund am Feld, und nichts geht hinaus', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    const grund = await screen.findByText('Mindestens ein Empfänger ist erforderlich');
    expect(grund.closest('.ant-form-item')).toContainElement(screen.getByLabelText('Empfänger'));
    expect(onAnlegen).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(screen.getByLabelText('Auftrag / Was')).toHaveValue('Erkunden');
  });

  it('meldet sich nicht, bevor abgesendet wurde, auch nicht beim Umschalten der Richtung', async () => {
    rendern();
    await openWeitere();
    await userEvent.click(screen.getByLabelText('Richtung'));
    await userEvent.click(await screen.findByTitle('Extern'));
    await userEvent.type(screen.getByLabelText('Externe Bezeichnung'), 'L');
    await userEvent.clear(screen.getByLabelText('Externe Bezeichnung'));
    await userEvent.click(screen.getByLabelText('Richtung'));
    await userEvent.click(await screen.findByTitle('Intern'));

    // Die Prüfung läuft asynchron: erst eine Runde abwarten, dann das Fehlen feststellen.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Mindestens ein Empfänger ist erforderlich')).toBeNull();
  });

  it('ein externer Adressat mit Bezeichnung räumt den Grund und genügt als Empfänger', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await screen.findByText('Mindestens ein Empfänger ist erforderlich');

    // Die Regel hängt an Richtung und Bezeichnung (`dependencies`), nicht nur am Feld selbst.
    await externMitBezeichnung();
    await waitFor(() =>
      expect(screen.queryByText('Mindestens ein Empfänger ist erforderlich')).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen.mock.calls[0][0].empfaenger).toEqual([
      {
        empfaenger_typ: 'extern',
        extern_kategorie: 'leitstelle',
        extern_bezeichnung: 'Leitstelle Nord',
      },
    ]);
  });
});

/** LLH-1091: der Weg geht mit hinaus, Ziel und Absicht sind getrennte Angaben. */
describe('AuftragFormular — Schema nach FwDV 100 (LLH-1091)', () => {
  it('sendet Mittel, Ziel, Weg und Zeit getrimmt unter ihren Wire-Namen', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Deich sichern');
    await openAusfuehrung();
    await userEvent.type(screen.getByLabelText('Mittel / Womit'), 'Sandsäcke');
    await userEvent.type(screen.getByLabelText('Ziel / Ort'), 'Deich km 3');
    await userEvent.type(screen.getByLabelText('Weg'), ' über B 3 ');
    await userEvent.type(screen.getByLabelText('Zeit / Wann'), 'sofort');
    await openWeitere();
    await userEvent.type(screen.getByLabelText('Absicht'), 'Überflutung verhindern');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        mittel: 'Sandsäcke',
        ort: 'Deich km 3',
        weg: 'über B 3',
        zeit: 'sofort',
        absicht: 'Überflutung verhindern',
      }),
    );
  });

  it('ein leerer Weg geht nicht hinaus', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await openAusfuehrung();
    await userEvent.type(screen.getByLabelText('Weg'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen.mock.calls[0][0].weg).toBeUndefined();
  });

  /** Ein Fehler hinter einem geschlossenen Kopf sperrte das Senden lautlos (design.md D4). */
  it('öffnet einen geschlossenen Klappteil, wenn die Prüfung darin scheitert', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen });
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await openAusfuehrung();
    fireEvent.change(screen.getByLabelText('Weg'), { target: { value: 'w'.repeat(2_001) } });
    await openAusfuehrung();
    const kopf = screen.getByText(/^Ausführung:/).closest('.ant-collapse-header');
    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'false'));

    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'true'));
    // jsdom spielt die Aufklapp-Bewegung nicht ab (Höhe 0); belegt wird der offene Klappteil.
    const grund = await screen.findByText('Weg darf höchstens 2.000 Zeichen lang sein');
    expect(grund.closest('.ant-collapse-item')).toHaveClass('ant-collapse-item-active');
    expect(onAnlegen).not.toHaveBeenCalled();
  });

  it('ein Fehler nur im Empfänger öffnet keinen Klappteil', async () => {
    rendern();
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await screen.findByText('Mindestens ein Empfänger ist erforderlich');
    for (const kopf of document.querySelectorAll('.ant-collapse-header')) {
      expect(kopf).toHaveAttribute('aria-expanded', 'false');
    }
  });

  /**
   * „Werte behalten“ übernimmt die Richtung: ein zugeklappter Kopf, der „Extern“ verschwiege,
   * schickte Folgeaufträge still nach außen (Erfassungs-Norm: der Kopf nennt die Abweichung).
   */
  it('nennt eine Richtung „Extern“ im Kopf der weiteren Angaben', async () => {
    rendern();
    expect(screen.getByText('Weitere Angaben')).toBeInTheDocument();
    await openWeitere();
    await userEvent.click(screen.getByLabelText('Richtung'));
    await userEvent.click(await screen.findByTitle('Extern'));
    expect(screen.getByText('Weitere Angaben · Richtung: Extern')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Richtung'));
    await userEvent.click(await screen.findByTitle('Intern'));
    expect(screen.getByText('Weitere Angaben')).toBeInTheDocument();
  });

  it('gibt dem Empfänger nach „Speichern und nächste“ wieder den Fokus', async () => {
    const onAnlegen = vi.fn().mockResolvedValue(undefined);
    rendern({ onAnlegen, serie: true });
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S3{Enter}');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: /Speichern und nächste/ }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Auftrag / Was')).toHaveValue(''));
    await waitFor(() => expect(screen.getByLabelText('Empfänger')).toHaveFocus());
  });
});
