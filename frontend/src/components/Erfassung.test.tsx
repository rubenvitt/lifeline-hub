import { Form, Input } from 'antd';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createRef, type ReactElement, type Ref } from 'react';
import {
  ErfassungsFormular,
  ErfassungsModal,
  serienKuerzel,
  type ErfassungsFormularSteuerung,
} from './Erfassung';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';

function renderMitProviders(
  ui: ReactElement,
  options?: Parameters<typeof renderMitBasisProviders>[1],
) {
  const ergebnis = renderMitBasisProviders(
    <CommandPaletteProvider>{ui}</CommandPaletteProvider>,
    options,
  );
  const basisRerender = ergebnis.rerender;
  return {
    ...ergebnis,
    rerender: (naechstesUi: ReactElement) =>
      basisRerender(<CommandPaletteProvider>{naechstesUi}</CommandPaletteProvider>),
  };
}

interface Werte {
  ort: string;
  melder: string;
  notiz: string;
}

/**
 * Zwei Textfelder plus eine Textarea — die Textarea steht am Ende, weil genau
 * sie NICHT an der Formularübermittlung teilnimmt (dort bleibt Enter ein
 * Zeilenumbruch). „Letztes Eingabefeld" meint deshalb `Melder`.
 */
function Harness(props: {
  onErfassen: (w: Werte) => Promise<unknown>;
  onFertig?: () => void;
  onAbbrechen?: () => void;
  serie?: boolean;
  uebernahme?: (keyof Werte)[];
  steuerungRef?: Ref<ErfassungsFormularSteuerung>;
  onErfasst?: (werte: Werte) => void | Promise<void>;
}) {
  const [form] = Form.useForm<Werte>();
  return (
    <ErfassungsFormular<Werte>
      form={form}
      onErfassen={props.onErfassen}
      onFertig={props.onFertig ?? (() => {})}
      onAbbrechen={props.onAbbrechen}
      serie={props.serie}
      uebernahme={props.uebernahme}
      steuerungRef={props.steuerungRef}
      onErfasst={props.onErfasst}
    >
      <Form.Item label="Ort" name="ort">
        <Input />
      </Form.Item>
      <Form.Item label="Melder" name="melder">
        <Input />
      </Form.Item>
      <Form.Item label="Notiz" name="notiz">
        <Input.TextArea rows={2} />
      </Form.Item>
    </ErfassungsFormular>
  );
}

/** Wie {@link Harness}, aber mit einem Pflichtfeld — für die Prüfungs-Fälle. */
function PflichtHarness(props: {
  onErfassen: (w: Werte) => Promise<unknown>;
  onFertig: () => void;
}) {
  const [form] = Form.useForm<Werte>();
  return (
    <ErfassungsFormular<Werte>
      form={form}
      onErfassen={props.onErfassen}
      onFertig={props.onFertig}
      serie
    >
      <Form.Item label="Ort" name="ort" rules={[{ required: true, message: 'Ort ist Pflicht' }]}>
        <Input />
      </Form.Item>
    </ErfassungsFormular>
  );
}

describe('ErfassungsFormular — Fokus', () => {
  it('setzt den Fokus beim Öffnen auf das erste Feld', async () => {
    renderMitProviders(<Harness onErfassen={vi.fn().mockResolvedValue(undefined)} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ort')));
  });
});

describe('ErfassungsFormular — Enter sendet ab', () => {
  it('Enter im letzten Eingabefeld schickt das Formular ab', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<Harness onErfassen={onErfassen} />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Brücke');
    await nutzer.type(screen.getByLabelText('Melder'), 'Löschzug 1{Enter}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0]).toMatchObject({ ort: 'Brücke', melder: 'Löschzug 1' });
  });

  it('Enter in der Textarea sendet NICHT ab, sondern bricht um', async () => {
    // Der Beleg für Zusicherung 1: die eingebaute Übermittlung übergeht
    // mehrzeilige Felder. Ohne diesen Fall wäre „Enter sendet" die Behauptung,
    // Enter sende ÜBERALL — und ein Notizfeld wäre unbenutzbar.
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<Harness onErfassen={onErfassen} />);
    const nutzer = userEvent.setup();

    // Erst den Mount-Fokus abwarten, dann tippen. Käme der Fokus dazwischen,
    // spränge der Cursor mitten im Wortlaut ins erste Feld — genau der Fehler,
    // den dieser Fall in der vollen Suite einmal aufgedeckt hat.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ort')));
    await nutzer.type(screen.getByLabelText('Notiz'), 'Zeile 1{Enter}Zeile 2');

    expect(onErfassen).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Notiz')).toHaveValue('Zeile 1\nZeile 2');
  });
});

describe('ErfassungsFormular — Serienmodus', () => {
  it('„Speichern und nächste" hält offen, leert die Felder, zählt und fokussiert zurück', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(<Harness onErfassen={onErfassen} onFertig={onFertig} serie />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onFertig).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Ort')).toHaveValue(''));
    expect(screen.getByText('Erfasst: 1')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ort')));
  });

  it('der Primär-Knopf meldet stattdessen fertig', async () => {
    const onFertig = vi.fn();
    renderMitProviders(
      <Harness onErfassen={vi.fn().mockResolvedValue(undefined)} onFertig={onFertig} serie />,
    );
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Brücke');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
  });

  it('eine gescheiterte Prüfung färbt das nächste reguläre Absenden nicht zum Serienlauf', async () => {
    // Der zweite Review-Fund: die Serien-Marke wird im Klick gesetzt und nur in
    // `onFinish` verbraucht. Scheitert die Prüfung, läuft `onFinish` nie — ohne
    // `onFinishFailed` bliebe die Marke stehen, und der nächste „Erfassen"-Klick
    // meldete kein `onFertig`. Die Person drückt dann ein zweites Mal und legt den
    // Datensatz doppelt an; genau diese Folge prüft der letzte Aufruf mit.
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(<PflichtHarness onErfassen={onErfassen} onFertig={onFertig} />);
    const nutzer = userEvent.setup();

    // Leeres Pflichtfeld: die Prüfung scheitert, gespeichert wird nichts.
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(screen.getByText('Ort ist Pflicht')).toBeInTheDocument());
    expect(onErfassen).not.toHaveBeenCalled();

    await nutzer.type(screen.getByLabelText('Ort'), 'Brücke');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
  });

  it('ohne Serienmodus gibt es „Speichern und nächste" gar nicht', () => {
    renderMitProviders(<Harness onErfassen={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).not.toBeInTheDocument();
  });
});

describe('ErfassungsFormular — Wertübernahme', () => {
  it('steht beim Öffnen auf AUS', () => {
    renderMitProviders(
      <Harness onErfassen={vi.fn().mockResolvedValue(undefined)} serie uebernahme={['ort']} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  it('behält die Übernahmefelder über ein Serien-Speichern hinweg, sobald er AN ist', async () => {
    renderMitProviders(
      <Harness onErfassen={vi.fn().mockResolvedValue(undefined)} serie uebernahme={['ort']} />,
    );
    const nutzer = userEvent.setup();

    await nutzer.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.type(screen.getByLabelText('Melder'), 'RTW 1');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Melder')).toHaveValue(''));
    expect(screen.getByLabelText('Ort')).toHaveValue('Sammelstelle');
  });

  it('leert ohne Zutun auch das Übernahmefeld — der Schalter ist die Ausnahme, nicht die Regel', async () => {
    renderMitProviders(
      <Harness onErfassen={vi.fn().mockResolvedValue(undefined)} serie uebernahme={['ort']} />,
    );
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Ort')).toHaveValue(''));
  });

  it('zeigt „Werte behalten" nur, wenn es Übernahmefelder gibt', () => {
    renderMitProviders(<Harness onErfassen={vi.fn().mockResolvedValue(undefined)} serie />);
    expect(screen.queryByRole('checkbox', { name: 'Werte behalten' })).not.toBeInTheDocument();
  });
});

describe('ErfassungsFormular — Tastenkürzel für den Serienlauf', () => {
  it('Strg/⌘ + S löst den normalen Submit aus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(<Harness onErfassen={onErfassen} onFertig={onFertig} serie />);

    const ort = screen.getByLabelText('Ort');
    await waitFor(() => expect(document.activeElement).toBe(ort));
    await userEvent.type(ort, 'Sammelstelle');
    const ereignis = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(ort, ereignis);

    expect(ereignis.defaultPrevented).toBe(true);
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onFertig).toHaveBeenCalledTimes(1);
  });

  it('Strg/⌘ + Enter speichert und hält offen', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(<Harness onErfassen={onErfassen} onFertig={onFertig} serie />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    // Der Serienlauf schliesst NICHT — sonst wäre es der Primär-Knopf mit
    // Umweg über die Tastatur.
    expect(onFertig).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Ort')).toHaveValue(''));
  });

  it('lokales Strg/⌘ + Enter verhindert den globalen Normal-Submit und sendet nur einmal', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(<Harness onErfassen={onErfassen} onFertig={onFertig} serie />);

    const ort = screen.getByLabelText('Ort');
    await waitFor(() => expect(document.activeElement).toBe(ort));
    await userEvent.type(ort, 'Sammelstelle');
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(ort, ereignis);

    expect(ereignis.defaultPrevented).toBe(true);
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen).toHaveBeenCalledTimes(1);
    expect(onFertig).not.toHaveBeenCalled();
  });

  it('ignoriert die Wiederholung des lokalen Serien-Kürzels vollständig', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<Harness onErfassen={onErfassen} serie />);

    const ort = screen.getByLabelText('Ort');
    await waitFor(() => expect(document.activeElement).toBe(ort));
    await userEvent.type(ort, 'Sammelstelle');
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(ort, ereignis);

    expect(ereignis.defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('ignoriert das lokale Serien-Kürzel während einer IME-Komposition', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<Harness onErfassen={onErfassen} serie />);
    const ort = screen.getByLabelText('Ort');
    await waitFor(() => expect(document.activeElement).toBe(ort));
    await userEvent.type(ort, 'Sammelstelle');
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });

    fireEvent(ort, ereignis);

    expect(ereignis.defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('ignoriert Speichern und nächste mit Shift oder Alt', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<Harness onErfassen={onErfassen} serie />);
    const ort = screen.getByLabelText('Ort');
    await waitFor(() => expect(document.activeElement).toBe(ort));
    await userEvent.type(ort, 'Sammelstelle');
    const shiftEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const altEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });

    fireEvent(ort, shiftEnter);
    fireEvent(ort, altEnter);

    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(altEnter.defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('nimmt auch die Meta-Taste (⌘ auf dem Mac)', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<Harness onErfassen={onErfassen} serie />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
  });

  it('sendet bei gehaltener Taste nicht doppelt', async () => {
    // Die Zusage bleibt offen, bis der Test sie einlöst — genau das Fenster, in
    // dem eine Tastenwiederholung ein zweites Mal absenden würde. Der Knopf ist
    // in diesem Fenster `loading` und damit klicktaub; die Tastatur ist es nicht.
    let einloesen: () => void = () => {};
    const onErfassen = vi.fn(
      () =>
        new Promise<void>((res) => {
          einloesen = res;
        }),
    );
    renderMitProviders(<Harness onErfassen={onErfassen} serie />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    await nutzer.keyboard('{Control>}{Enter}{/Control}');

    expect(onErfassen).toHaveBeenCalledTimes(1);
    einloesen();
    await waitFor(() => expect(screen.getByLabelText('Ort')).toHaveValue(''));
  });

  it('zeigt das Kürzel, ohne den zugänglichen Namen des Knopfes zu verändern', () => {
    // Der sichtbare Zusatz steht `aria-hidden` IM Knopf. Wäre er es nicht, hiesse der
    // Knopf „Speichern und nächste Strg + ↵" — und die rund zehn Aufrufstellen, die ihn
    // über genau diesen Namen suchen, fänden ihn nicht mehr. `toHaveAccessibleName`
    // prüft exakt und ist damit strenger als die `getByRole`-Abfrage, die ihn findet.
    renderMitProviders(<Harness onErfassen={vi.fn().mockResolvedValue(undefined)} serie />);
    const knopf = screen.getByRole('button', { name: 'Speichern und nächste' });
    expect(knopf).toHaveAccessibleName('Speichern und nächste');
    // …und das Kürzel steht trotzdem sichtbar drin.
    expect(knopf).toHaveTextContent('Strg + ↵');
  });

  it('beschriftet das Kürzel nach der Plattform', () => {
    // jsdom ist kein Mac, deshalb über die reine Funktion — sonst bliebe der Zweig,
    // den der Nutzer auf dem Mac tatsächlich sieht, ungeprüft.
    expect(serienKuerzel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('⌘ ↵');
    expect(serienKuerzel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Strg + ↵');
  });

  it('sendet ohne Serienmodus regulär und setzt keine Serien-Marke', async () => {
    // Ohne lokalen Serienhandler erreicht Strg/⌘ + Enter die Registry und ist ein
    // normaler Submit. Entscheidend bleibt: Es darf keine Serien-Marke gesetzt werden.
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(<Harness onErfassen={onErfassen} onFertig={onFertig} />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
  });
});

describe('ErfassungsFormular — Ablehnung und Abbruch', () => {
  it('meldet akzeptierte Werte vor dem Fertig-Callback', async () => {
    const reihenfolge: string[] = [];
    const onErfasst = vi.fn((werte: Werte) => {
      reihenfolge.push(`akzeptiert:${werte.ort}`);
    });
    renderMitProviders(
      <Harness
        onErfassen={vi.fn(async () => {
          reihenfolge.push('gespeichert');
        })}
        onErfasst={onErfasst}
        onFertig={() => {
          reihenfolge.push('fertig');
        }}
      />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Brücke');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() =>
      expect(reihenfolge).toEqual(['gespeichert', 'akzeptiert:Brücke', 'fertig']),
    );
  });

  it('meldet akzeptierte Werte auch im erfolgreichen Serienlauf', async () => {
    const onErfasst = vi.fn();
    const onFertig = vi.fn();
    renderMitProviders(
      <Harness
        onErfassen={vi.fn().mockResolvedValue(undefined)}
        onErfasst={onErfasst}
        onFertig={onFertig}
        serie
      />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() =>
      expect(onErfasst).toHaveBeenCalledWith(expect.objectContaining({ ort: 'Sammelstelle' })),
    );
    expect(onFertig).not.toHaveBeenCalled();
  });

  it('schließt nach einem synchron werfenden Akzeptanz-Hook trotzdem erfolgreich ab', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(
      <Harness
        onErfassen={onErfassen}
        onErfasst={() => {
          throw new Error('lokaler Hook gescheitert');
        }}
        onFertig={onFertig}
      />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Brücke');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
    expect(onErfassen).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Ort')).toHaveValue('');
  });

  it('wartet einen ablehnenden Akzeptanz-Hook ab und schließt danach genau einmal', async () => {
    let hookAblehnen!: (grund: Error) => void;
    const hookAntwort = new Promise<void>((_resolve, reject) => {
      hookAblehnen = reject;
    });
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onErfasst = vi.fn(() => hookAntwort);
    const onFertig = vi.fn();
    renderMitProviders(
      <Harness onErfassen={onErfassen} onErfasst={onErfasst} onFertig={onFertig} />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Brücke');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(onErfasst).toHaveBeenCalledTimes(1));
    const fertigVorHookEnde = onFertig.mock.calls.length;
    await act(async () => {
      hookAblehnen(new Error('lokaler Hook abgelehnt'));
      await hookAntwort.catch(() => undefined);
    });

    expect(fertigVorHookEnde).toBe(0);
    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
    expect(onErfassen).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Ort')).toHaveValue('');
  });

  it('blockiert einen zweiten Submit, solange der Akzeptanz-Hook läuft', async () => {
    let hookFreigeben!: () => void;
    const hookAntwort = new Promise<void>((resolve) => {
      hookFreigeben = resolve;
    });
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onErfasst = vi.fn(() => hookAntwort);
    const onFertig = vi.fn();
    renderMitProviders(
      <Harness onErfassen={onErfassen} onErfasst={onErfasst} onFertig={onFertig} />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Brücke');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(onErfasst).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));

    expect(onErfassen).toHaveBeenCalledTimes(1);
    await act(async () => {
      hookFreigeben();
      await hookAntwort;
    });
    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
    expect(onErfassen).toHaveBeenCalledTimes(1);
  });

  it('räumt den Serienlauf auch nach einem werfenden Akzeptanz-Hook auf', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(
      <Harness
        onErfassen={onErfassen}
        onErfasst={() => {
          throw new Error('Serien-Hook gescheitert');
        }}
        onFertig={onFertig}
        serie
      />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByText('Erfasst: 1')).toBeInTheDocument());
    expect(onErfassen).toHaveBeenCalledTimes(1);
    expect(onFertig).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Ort')).toHaveValue('');
  });

  it('führt nach Abbruch während des Akzeptanz-Hooks keinen späten Abschluss aus', async () => {
    let hookFreigeben!: () => void;
    const hookAntwort = new Promise<void>((resolve) => {
      hookFreigeben = resolve;
    });
    const steuerung = createRef<ErfassungsFormularSteuerung>();
    const onAbbrechen = vi.fn();
    const onFertig = vi.fn();
    const onErfasst = vi.fn(() => hookAntwort);
    renderMitProviders(
      <Harness
        onErfassen={vi.fn().mockResolvedValue(undefined)}
        onErfasst={onErfasst}
        onFertig={onFertig}
        onAbbrechen={onAbbrechen}
        steuerungRef={steuerung}
      />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Brücke');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(onErfasst).toHaveBeenCalledTimes(1));
    expect(onFertig).not.toHaveBeenCalled();
    await act(async () => {
      steuerung.current?.abbrechen();
    });
    await act(async () => {
      hookFreigeben();
      await hookAntwort;
    });

    expect(onAbbrechen).toHaveBeenCalledTimes(1);
    expect(onFertig).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Ort')).toHaveValue('');
  });

  it('lässt den Wortlaut stehen, wenn das Speichern abgelehnt wird', async () => {
    // Der teuerste Einzelfehler der Bestandsmasken: dort läuft `resetFields()`
    // synchron neben `mutate()`, der Text ist also auch bei einem 422 weg.
    const onErfassen = vi.fn().mockRejectedValue(new Error('abgelehnt'));
    const onFertig = vi.fn();
    renderMitProviders(<Harness onErfassen={onErfassen} onFertig={onFertig} />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Brücke');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onFertig).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Ort')).toHaveValue('Brücke');
  });

  it('leert die Felder auch beim Abbrechen', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <Harness onErfassen={vi.fn().mockResolvedValue(undefined)} onAbbrechen={onAbbrechen} />,
    );
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Brücke');
    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onAbbrechen).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Ort')).toHaveValue('');
  });

  it('führt einen äußeren Drawer-Abbruch über denselben Reset-Pfad', async () => {
    const onAbbrechen = vi.fn();
    const steuerung = createRef<ErfassungsFormularSteuerung>();
    renderMitProviders(
      <Harness
        onErfassen={vi.fn().mockResolvedValue(undefined)}
        onAbbrechen={onAbbrechen}
        steuerungRef={steuerung}
      />,
    );

    await userEvent.type(screen.getByLabelText('Ort'), 'Brücke');
    await act(async () => {
      steuerung.current?.abbrechen();
    });

    expect(onAbbrechen).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Ort')).toHaveValue('');
  });
});

describe('ErfassungsModal', () => {
  function ModalHarness(props: {
    offen: boolean;
    onErfassen: (w: Werte) => Promise<unknown>;
    onErfasst?: (w: Werte) => void;
    onFertig?: () => void;
    onAbbrechen?: () => void;
  }) {
    const [form] = Form.useForm<Werte>();
    return (
      <ErfassungsModal<Werte>
        offen={props.offen}
        titel="Person erfassen"
        form={form}
        onErfassen={props.onErfassen}
        onFertig={props.onFertig ?? (() => {})}
        onAbbrechen={props.onAbbrechen ?? (() => {})}
        onErfasst={props.onErfasst}
      >
        <Form.Item label="Ort" name="ort">
          <Input />
        </Form.Item>
      </ErfassungsModal>
    );
  }

  it('fokussiert beim Öffnen das erste Feld und sendet per Enter', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<ModalHarness offen onErfassen={onErfassen} />);
    const nutzer = userEvent.setup();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ort')));
    await nutzer.type(screen.getByLabelText('Ort'), 'Brücke{Enter}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
  });

  it('leert die Felder auch über Escape und das Schliesskreuz, nicht nur über den Knopf', async () => {
    // Der Fehler, den der Review gefunden hat: `onCancel` roh durchgereicht deckte
    // nur den Abbrechen-KNOPF ab. `destroyOnHidden` rettet das nicht — es hängt die
    // Kinder ab, aber der Speicher von rc-field-form überlebt und gewinnt beim
    // nächsten Öffnen gegen `initialValues`. Beide Wege einzeln, weil sie im Modal
    // an verschiedenen Stellen hängen.
    for (const weg of ['escape', 'kreuz'] as const) {
      const { unmount } = renderMitProviders(
        <ModalHarness offen onErfassen={vi.fn().mockResolvedValue(undefined)} />,
      );
      const nutzer = userEvent.setup();
      await nutzer.type(screen.getByLabelText('Ort'), 'Brücke');

      if (weg === 'escape') await nutzer.keyboard('{Escape}');
      else await nutzer.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));

      await waitFor(() => expect(screen.getByLabelText('Ort')).toHaveValue(''));
      unmount();
    }
  });

  it('Escape läuft genau einmal über die Registry und verwirft die Eingabe', async () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <ModalHarness
        offen
        onErfassen={vi.fn().mockResolvedValue(undefined)}
        onAbbrechen={onAbbrechen}
      />,
    );

    const ort = screen.getByLabelText('Ort');
    await waitFor(() => expect(document.activeElement).toBe(ort));
    await userEvent.type(ort, 'Brücke');
    const ereignis = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(ort, ereignis);

    expect(ereignis.defaultPrevented).toBe(true);
    expect(onAbbrechen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText('Ort')).toHaveValue(''));
  });

  it('verwirft einen laufenden Abschluss über Kreuz und Maskenklick', async () => {
    for (const weg of ['kreuz', 'maske'] as const) {
      let antwortFreigeben!: () => void;
      const antwort = new Promise<void>((resolve) => {
        antwortFreigeben = resolve;
      });
      const onAbbrechen = vi.fn();
      const onFertig = vi.fn();
      const onErfasst = vi.fn();
      const onErfassen = vi.fn(() => antwort);
      const { unmount } = renderMitProviders(
        <ModalHarness
          offen
          onErfassen={onErfassen}
          onErfasst={onErfasst}
          onFertig={onFertig}
          onAbbrechen={onAbbrechen}
        />,
      );

      await userEvent.type(screen.getByLabelText('Ort'), 'Brücke');
      await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
      await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
      if (weg === 'kreuz') {
        await userEvent.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));
      } else {
        const maske = document.querySelector<HTMLElement>('.ant-modal-wrap');
        expect(maske).not.toBeNull();
        await userEvent.click(maske!);
      }
      await act(async () => {
        antwortFreigeben();
        await antwort;
      });

      expect(onAbbrechen).toHaveBeenCalledTimes(1);
      expect(onErfasst).not.toHaveBeenCalled();
      expect(onFertig).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('trägt keine eigene antd-Fusszeile — der Absende-Knopf liegt im Formular', () => {
    // Zusicherung 1: läge der Knopf in `footer`, stünde er als DOM-Geschwister
    // ausserhalb des `<form>` und Enter wäre wieder tot.
    const { container } = renderMitProviders(
      <ModalHarness offen onErfassen={vi.fn().mockResolvedValue(undefined)} />,
    );
    expect(container.ownerDocument.querySelector('.ant-modal-footer')).toBeNull();
    const knopf = screen.getByRole('button', { name: 'Erfassen' });
    expect(knopf.closest('form')).not.toBeNull();
  });
});
