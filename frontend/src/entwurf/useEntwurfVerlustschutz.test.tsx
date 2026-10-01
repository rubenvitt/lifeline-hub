import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { useState } from 'react';
import FormularEingehaengt from '../components/FormularEingehaengt';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { AUTOSAVE_MS, useEntwurfVerlustschutz } from './useEntwurfVerlustschutz';

interface Daten {
  titel: string;
}

interface TraegerProps {
  daten: Daten;
  speichern: (w: Daten) => Promise<unknown>;
  istEntwurf?: boolean;
}

/**
 * Minimaler Träger: ein Feld, ein Serverstand, den der Test von außen nachschiebt.
 *
 * Der Knopf liegt AUSSERHALB des `<Form>` und ruft `form.submit()` wie in beiden Seiten; im
 * Formular löste sein Fokusverlust einen Blur-Autosave aus, den es in der Seite nicht gibt. Ein
 * Klick nimmt dem FELD zuerst den Fokus (Blur-Autosave), dann kommt `form.submit()` — die
 * Zähler im Bild prüfen „genau eine Quittung" ohne Mock-Zugriff.
 */
function Traeger({ daten, speichern, istEntwurf = true }: TraegerProps) {
  const [form] = Form.useForm<Daten>();
  const [quittungen, setQuittungen] = useState(0);
  const [ablehnungen, setAblehnungen] = useState(0);
  const schutz = useEntwurfVerlustschutz<Daten, Daten>({
    daten,
    istEntwurf,
    form,
    werteAus: (d) => ({ titel: d.titel }),
    speichern,
  });
  return (
    <>
      <Form
        form={form}
        onValuesChange={schutz.markiereGeaendert}
        onBlur={schutz.autosaveJetzt}
        onFinish={(w) => {
          void schutz.speichereJetzt(w).then(
            () => setQuittungen((n) => n + 1),
            () => setAblehnungen((n) => n + 1),
          );
        }}
      >
        <Form.Item label="Titel" name="titel">
          <Input />
        </Form.Item>
        <FormularEingehaengt onWechsel={schutz.formularEingehaengt} />
      </Form>
      <button type="button" onClick={() => form.submit()}>
        Entwurf speichern
      </button>
      <output>{schutz.ungespeichert ? 'offen' : 'sauber'}</output>
      <p>quittungen {quittungen}</p>
      <p>ablehnungen {ablehnungen}</p>
      {schutz.speichertGerade && <p>speichert</p>}
      {schutz.zuletztGespeichert && <p>zuletzt gespeichert {schutz.zuletztGespeichert}</p>}
      {schutz.speicherFehler != null && <p>Grund: {(schutz.speicherFehler as Error).message}</p>}
    </>
  );
}

function Huelle({
  speichern = () => Promise.resolve(),
  istEntwurf,
}: {
  speichern?: (w: Daten) => Promise<unknown>;
  istEntwurf?: boolean;
}) {
  const [daten, setDaten] = useState<Daten>({ titel: 'Server 1' });
  return (
    <>
      <Traeger daten={daten} speichern={speichern} istEntwurf={istEntwurf} />
      <button type="button" onClick={() => setDaten({ titel: 'Server 2' })}>
        fremd
      </button>
    </>
  );
}

const speichernKnopf = () => screen.getByRole('button', { name: 'Entwurf speichern' });

/**
 * Die reine Mechanik ohne Server und Router, damit ein Fehler im Hook auf den Hook zeigt; das
 * Zusammenspiel prüfen die Seitentests.
 */
describe('useEntwurfVerlustschutz', () => {
  it('überschreibt ein berührtes Formular NICHT mit einem fremden Serverstand', async () => {
    render(<Huelle />);
    const feld = screen.getByLabelText('Titel');
    expect(feld).toHaveValue('Server 1');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Meine Fassung');
    // `fireEvent`, nicht `userEvent`: ein echter Klick blurrte das Feld, der Autosave räumte den
    // Merker, und der Test prüfte den Riegel gar nicht.
    fireEvent.click(screen.getByText('fremd'));
    expect(screen.getByLabelText('Titel')).toHaveValue('Meine Fassung');
    expect(screen.getByText('offen')).toBeInTheDocument();
  });

  it('übernimmt den Serverstand, solange nichts berührt wurde (Gegenaussage)', async () => {
    // Ein Riegel, der IMMER hält, machte die Seite still veraltet.
    render(<Huelle />);
    fireEvent.click(screen.getByText('fremd'));
    expect(screen.getByLabelText('Titel')).toHaveValue('Server 2');
    expect(screen.getByText('sauber')).toBeInTheDocument();
  });

  it('speichert beim Verlassen eines Feldes und räumt den Merker', async () => {
    const speichern = vi.fn().mockResolvedValue(undefined);
    render(<Huelle speichern={speichern} />);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    expect(speichern).not.toHaveBeenCalled();
    await userEvent.tab();
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    expect(speichern).toHaveBeenCalledWith({ titel: 'Server 1x' });
    expect(await screen.findByText('sauber')).toBeInTheDocument();
    expect(screen.getByText(/zuletzt gespeichert \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('lässt den Merker stehen, wenn während des laufenden Autosave weitergetippt wurde', async () => {
    // Verlustfenster: der PATCH trägt S1, im Formular steht S2 — eine Quittung für S1 darf nicht
    // „alles gespeichert" bedeuten.
    let aufloesen: () => void = () => {};
    const speichern = vi.fn(
      () =>
        new Promise<void>((r) => {
          aufloesen = r;
        }),
    );
    render(<Huelle speichern={speichern} />);
    const feld = screen.getByLabelText('Titel');
    await userEvent.type(feld, 'a');
    await userEvent.tab(); // Autosave startet, Promise hängt
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    await userEvent.type(feld, 'b'); // S2 entsteht, während S1 unterwegs ist
    await act(async () => {
      aufloesen();
    });
    expect(screen.getByText('offen')).toBeInTheDocument();
    // Der Zeitstempel sagt trotzdem, dass ETWAS gesichert wurde.
    expect(screen.getByText(/zuletzt gespeichert/)).toBeInTheDocument();
  });

  it('hält den Grund eines gescheiterten Autosave als Zustand und lässt den Merker stehen', async () => {
    // Sichtbar muss das WARUM sein, nicht nur „ungespeicherte Änderungen".
    const speichern = vi.fn().mockRejectedValue(new Error('503 Dienst nicht erreichbar'));
    render(<Huelle speichern={speichern} />);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    await userEvent.tab();
    expect(await screen.findByText('Grund: 503 Dienst nicht erreichbar')).toBeInTheDocument();
    expect(screen.getByText('offen')).toBeInTheDocument();
  });

  it('räumt den Speicherfehler beim nächsten GELUNGENEN Speichern (Gegenaussage)', async () => {
    // Ein Fehlerzustand, der nie fällt, wäre so falsch wie einer, der zu früh geht.
    const speichern = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(undefined);
    render(<Huelle speichern={speichern} />);
    const feld = screen.getByLabelText('Titel');
    await userEvent.type(feld, 'a');
    await userEvent.tab();
    expect(await screen.findByText('Grund: 503')).toBeInTheDocument();

    await userEvent.click(feld);
    await userEvent.type(feld, 'b');
    await userEvent.tab();
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/^Grund:/)).not.toBeInTheDocument());
  });

  it('lässt den Grund während des nächsten Versuchs stehen, statt ihn blinken zu lassen', async () => {
    // Anders als bei react-querys `pending`: hier wiederholt eine 30-s-Frist von selbst. Beim Start
    // zu räumen ließe den Alert bei stehendem 503 im Takt verschwinden und wiederkommen.
    let haengenAufloesen: () => void = () => {};
    const speichern = vi
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            haengenAufloesen = r;
          }),
      );
    render(<Huelle speichern={speichern} />);
    const feld = screen.getByLabelText('Titel');
    await userEvent.type(feld, 'a');
    await userEvent.tab();
    expect(await screen.findByText('Grund: 503')).toBeInTheDocument();

    await userEvent.click(feld);
    await userEvent.type(feld, 'b');
    await userEvent.tab();
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(2));
    // Der zweite Versuch ist unterwegs und noch nicht gelungen.
    expect(screen.getByText('Grund: 503')).toBeInTheDocument();
    await act(async () => {
      haengenAufloesen();
    });
    await waitFor(() => expect(screen.queryByText(/^Grund:/)).not.toBeInTheDocument());
  });

  it('räumt den Grund auch, wenn während des gelungenen Speicherns weitergetippt wurde', async () => {
    // Die Quittung hat ZWEI Zweige, nur der unveränderte quittiert vollständig; gespeichert hat der
    // Server aber in beiden — räumte nur einer, bliebe ein veralteter Grund stehen.
    let haengenAufloesen: () => void = () => {};
    const speichern = vi
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            haengenAufloesen = r;
          }),
      );
    render(<Huelle speichern={speichern} />);
    const feld = screen.getByLabelText('Titel');
    await userEvent.type(feld, 'a');
    await userEvent.tab();
    expect(await screen.findByText('Grund: 503')).toBeInTheDocument();

    await userEvent.click(feld);
    await userEvent.type(feld, 'b');
    await userEvent.tab();
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(2));
    await userEvent.type(feld, 'c'); // S2 entsteht, während S1 unterwegs ist
    await act(async () => {
      haengenAufloesen();
    });
    await waitFor(() => expect(screen.queryByText(/^Grund:/)).not.toBeInTheDocument());
    // Der Merker bleibt trotzdem stehen — das Verlustfenster ist unverändert zugehalten.
    expect(screen.getByText('offen')).toBeInTheDocument();
  });

  it('behandelt einen abgebrochenen Auftrag NICHT als Speicherfehler', async () => {
    // `BefehlDetailPage` bricht die Speicherfolge beim Verlassen mit `AbortError` ab — kein Zustand,
    // den jemand lesen soll.
    const speichern = vi.fn().mockRejectedValue(new DOMException('Editor verlassen', 'AbortError'));
    render(<Huelle speichern={speichern} />);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    await userEvent.tab();
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText(/^Grund:/)).not.toBeInTheDocument();
  });

  it('legt den Grund eines gescheiterten EXPLIZITEN Speicherns in denselben Zustand', async () => {
    // Knopf und Freigabe-Vorlauf laufen durch `speichereJetzt` und melden in DENSELBEN Zustand wie
    // der Autosave; die Seite zeigt nicht zwei Fehlerquellen.
    const speichern = vi.fn().mockRejectedValue(new Error('422 Titel fehlt'));
    render(<Huelle speichern={speichern} />);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    await userEvent.click(speichernKnopf());
    expect(await screen.findByText('Grund: 422 Titel fehlt')).toBeInTheDocument();
    // Die Ablehnung geht ZUSÄTZLICH an den Aufrufer — er lässt den Freigabe-Dialog offen.
    expect(screen.getByText('ablehnungen 1')).toBeInTheDocument();
    expect(screen.getByText('quittungen 0')).toBeInTheDocument();
    expect(screen.getByText('offen')).toBeInTheDocument();
  });

  it('schickt beim Klick auf „Entwurf speichern" EINEN PATCH, nicht zwei (LFH-495)', async () => {
    // Ein Klick ist zwei Ereignisse: Blur (Autosave) und Submit — beide mit demselben Inhalt.
    const speichern = vi.fn().mockResolvedValue(undefined);
    render(<Huelle speichern={speichern} />);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    await userEvent.click(speichernKnopf());
    expect(await screen.findByText('quittungen 1')).toBeInTheDocument();
    expect(speichern).toHaveBeenCalledTimes(1);
    expect(screen.getByText('sauber')).toBeInTheDocument();
  });

  it('hängt das explizite Speichern an einen LAUFENDEN Autosave an, statt zu doppeln', async () => {
    // Unabhängig davon, wie jsdom Blur und Klick anordnet: der Autosave hängt noch, wenn der
    // explizite Pfad losgeht — kein zweiter PATCH, aber trotzdem eine Quittung.
    let aufloesen: () => void = () => {};
    const speichern = vi.fn(
      () =>
        new Promise<void>((r) => {
          aufloesen = r;
        }),
    );
    render(<Huelle speichern={speichern} />);
    const feld = screen.getByLabelText('Titel');
    await userEvent.type(feld, 'a');
    await userEvent.tab(); // Blur-Autosave startet, das Promise hängt
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    expect(screen.getByText('speichert')).toBeInTheDocument();

    await userEvent.click(speichernKnopf());
    await act(async () => {});
    expect(speichern).toHaveBeenCalledTimes(1);
    expect(screen.getByText('quittungen 0')).toBeInTheDocument(); // noch nicht zurück

    await act(async () => {
      aufloesen();
    });
    expect(screen.getByText('quittungen 1')).toBeInTheDocument();
    expect(screen.getByText('sauber')).toBeInTheDocument();
    expect(screen.queryByText('speichert')).not.toBeInTheDocument();
  });

  it('schickt einen EIGENEN PATCH, wenn seit dem laufenden Speichern getippt wurde (Gegenaussage)', async () => {
    // Ein Anhängen bei UNGLEICHEM Stand wäre eine Quittung über S1, während S2 im Formular steht;
    // ohne diese Hälfte wäre ein immer anhängender Riegel vom richtigen nicht zu unterscheiden.
    let aufloesen: () => void = () => {};
    const speichern = vi.fn(
      () =>
        new Promise<void>((r) => {
          aufloesen = r;
        }),
    );
    render(<Huelle speichern={speichern} />);
    const feld = screen.getByLabelText('Titel');
    await userEvent.type(feld, 'a');
    await userEvent.tab();
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));

    await userEvent.type(feld, 'b'); // S2 entsteht, während S1 unterwegs ist
    await userEvent.click(speichernKnopf());
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(2));
    expect(speichern).toHaveBeenLastCalledWith({ titel: 'Server 1ab' });
    await act(async () => {
      aufloesen();
    });
  });

  it('gibt den Riegel nur an den Auftrag zurück, der ihn HÄLT', async () => {
    // Bei ungleichem Stand laufen zwei Speicherungen gleichzeitig. Kommt die ERSTE zurück, darf sie
    // den Riegel nicht öffnen, sonst schickte der nächste Blur einen dritten PATCH neben die zweite.
    const aufloeser: Array<() => void> = [];
    const speichern = vi.fn(
      () =>
        new Promise<void>((r) => {
          aufloeser.push(r);
        }),
    );
    render(<Huelle speichern={speichern} />);
    const feld = screen.getByLabelText('Titel');

    await userEvent.type(feld, 'a');
    await userEvent.tab(); // Auftrag 1 (Stand 1) hängt
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));

    await userEvent.type(feld, 'b'); // Stand 2 — der Klick bekommt einen eigenen PATCH
    await userEvent.click(speichernKnopf());
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(2));

    // Auftrag 1 kommt zurück, Auftrag 2 hält den Riegel noch.
    await act(async () => {
      aufloeser[0]();
    });
    expect(screen.getByText('speichert')).toBeInTheDocument();

    // Ein Blur mit UNVERÄNDERTEM Stand: Auftrag 2 trägt den Inhalt schon — es sei denn, Auftrag 1
    // hätte den Riegel geöffnet.
    await userEvent.click(feld);
    await userEvent.tab();
    await act(async () => {});
    expect(speichern).toHaveBeenCalledTimes(2);

    await act(async () => {
      aufloeser[1]();
    });
  });

  it('speichert nach Ablauf der 30-s-Frist, auch ohne das Feld zu verlassen', async () => {
    // Ein `setInterval`, das nie abläuft (instabile Effekt-Deps), wäre sonst von einem laufenden
    // nicht zu unterscheiden.
    vi.useFakeTimers();
    try {
      const speichern = vi.fn().mockResolvedValue(undefined);
      render(<Huelle speichern={speichern} />);
      // `userEvent.type` kommt unter Fake-Timern nicht voran: getippt wird über `fireEvent.change`,
      // gewartet über `advanceTimersByTime`.
      fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'S1' } });
      expect(speichern).not.toHaveBeenCalled();
      // Die FRIST ist die Aussage, nicht „irgendwann": eine Millisekunde davor noch nichts.
      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_MS - 1);
      });
      expect(speichern).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(speichern).toHaveBeenCalledTimes(1);
      expect(speichern).toHaveBeenCalledWith({ titel: 'S1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lässt die Uhr am FREIGEGEBENEN Stand stehen (Gegenaussage zur Frist)', async () => {
    // `istEntwurf: false` — ein freigegebener Bericht ist unveränderlich, ein PATCH im 30-s-Takt
    // wäre ein Schreibversuch auf eine abgeschlossene Unterlage.
    vi.useFakeTimers();
    try {
      const speichern = vi.fn().mockResolvedValue(undefined);
      render(<Huelle speichern={speichern} istEntwurf={false} />);
      fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'S1' } });
      act(() => {
        vi.advanceTimersByTime(AUTOSAVE_MS * 3);
      });
      expect(speichern).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('speichert nichts, wenn nichts berührt wurde — auch nicht beim Verlassen', async () => {
    const speichern = vi.fn().mockResolvedValue(undefined);
    render(<Huelle speichern={speichern} />);
    await userEvent.click(screen.getByLabelText('Titel'));
    await userEvent.tab();
    await act(async () => {});
    expect(speichern).not.toHaveBeenCalled();
  });

  it('warnt beim Reload nur mit offener Fassung', async () => {
    render(<Huelle />);
    let ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(false);

    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });
});

/** LFH-692 (Spec `zeiteingabe`, „Zeit in Texten“): die Speicherzeit steht in der Anzeigezone. */
describe('useEntwurfVerlustschutz — „zuletzt gespeichert“ in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('Browser UTC, Anzeigezone Berlin: 10:32 UTC erscheint als 12:32', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-14T10:32:00Z'));
    try {
      render(
        <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
          <Huelle />
        </AnzeigeKonventionenProvider>,
      );
      await userEvent.type(screen.getByLabelText('Titel'), 'x');
      await userEvent.tab();
      expect(await screen.findByText('zuletzt gespeichert 12:32')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
