import { Form, Input } from 'antd';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErfassungsFormular, ErfassungsModal, serienKuerzel } from './Erfassung';
import { renderMitProviders } from '../test/utils';

interface Werte { ort: string; melder: string; notiz: string }

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
    >
      <Form.Item label="Ort" name="ort"><Input /></Form.Item>
      <Form.Item label="Melder" name="melder"><Input /></Form.Item>
      <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
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
    renderMitProviders(
      <PflichtHarness onErfassen={onErfassen} onFertig={onFertig} />,
    );
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
    const onErfassen = vi.fn(() => new Promise<void>((res) => { einloesen = res; }));
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

  it('ist ohne Serienmodus wirkungslos', async () => {
    // Nicht nur „speichert nichts": das Kürzel darf ohne Serien-Knopf auch keine
    // Serien-Marke setzen. Stünde sie, nähme das nächste reguläre Enter still den
    // Serien-Zweig — gespeichert, Felder leer, Dialog offen, und wer dann erneut
    // drückt, legt den Datensatz doppelt an.
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onFertig = vi.fn();
    renderMitProviders(<Harness onErfassen={onErfassen} onFertig={onFertig} />);
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Ort'), 'Sammelstelle');
    await nutzer.keyboard('{Control>}{Enter}{/Control}');
    expect(onErfassen).not.toHaveBeenCalled();

    await nutzer.keyboard('{Enter}');
    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
  });
});

describe('ErfassungsFormular — Ablehnung und Abbruch', () => {
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
});

describe('ErfassungsModal', () => {
  function ModalHarness(props: { offen: boolean; onErfassen: (w: Werte) => Promise<unknown> }) {
    const [form] = Form.useForm<Werte>();
    return (
      <ErfassungsModal<Werte>
        offen={props.offen}
        titel="Person erfassen"
        form={form}
        onErfassen={props.onErfassen}
        onFertig={() => {}}
        onAbbrechen={() => {}}
      >
        <Form.Item label="Ort" name="ort"><Input /></Form.Item>
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
