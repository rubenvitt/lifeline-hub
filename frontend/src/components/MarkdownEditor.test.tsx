import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Form } from 'antd';
import { renderMitProviders } from '../test/utils';
import MarkdownEditor from './MarkdownEditor';

describe('MarkdownEditor', () => {
  it('zeigt den value im Schreib-Textfeld an', () => {
    render(<MarkdownEditor unterEbene={3} value="## Lage" onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('## Lage');
  });

  it('meldet Eingaben über onChange als reinen String', async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor unterEbene={3} value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    expect(onChange).toHaveBeenLastCalledWith('x');
  });

  it('zeigt bei leerem Inhalt einen dezenten Vorschau-Hinweis statt eines leeren Kastens', async () => {
    render(<MarkdownEditor unterEbene={3} value="" onChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    expect(screen.getByText('Noch nichts zu zeigen.')).toBeInTheDocument();
  });

  it('reicht placeholder an das Textfeld durch', () => {
    render(<MarkdownEditor unterEbene={3} value="" onChange={() => {}} placeholder="Inhalt …" />);
    expect(screen.getByPlaceholderText('Inhalt …')).toBeInTheDocument();
  });

  it('funktioniert als antd Form.Item-Child (controlled value/onChange)', async () => {
    function Wrapper() {
      const [form] = Form.useForm();
      return (
        <Form form={form} initialValues={{ inhalt: '' }}>
          <Form.Item name="inhalt">
            <MarkdownEditor unterEbene={3} />
          </Form.Item>
          <button type="button" onClick={() => form.setFieldsValue({ inhalt: '**fett**' })}>
            baustein
          </button>
        </Form>
      );
    }
    const { container } = render(<Wrapper />);
    // Extern gesetztes value (z.B. Baustein-Einsetzen via Form) muss in der Komponente ankommen.
    await userEvent.click(screen.getByText('baustein'));
    expect(screen.getByRole('textbox')).toHaveValue('**fett**');
    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    expect(container.querySelector('.markdown strong')).toHaveTextContent('fett');
  });

  it('spiegelt fortlaufende Eingabe in der offenen Vorschau (gesteuert von außen)', async () => {
    function Wrapper() {
      const [v, setV] = useState('');
      return <MarkdownEditor unterEbene={3} value={v} onChange={setV} />;
    }
    const { container } = render(<Wrapper />);
    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    await userEvent.type(screen.getByRole('textbox'), '# Titel');
    // `#` rendert unter `unterEbene` 3 als h4, mit der Quellstufe als Klasse (`Markdown.tsx`).
    expect(container.querySelector('.markdown .md-h1')).toHaveTextContent('Titel');
  });
});

describe('MarkdownEditor – Vorschau-Umschalter', () => {
  it('zeigt Eingabe; Vorschau-Toggle blendet formatierten Markdown ein', async () => {
    function Wrap() {
      return (
        <MarkdownEditor
          unterEbene={3}
          variante="kompakt"
          placeholder="Inhalt …"
          value="**fett**"
          onChange={() => {}}
        />
      );
    }
    const { container } = renderMitProviders(<Wrap />);
    expect(container.querySelector('.markdown strong')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    expect(container.querySelector('.markdown strong')).toHaveTextContent('fett');
  });

  /**
   * Die Voraussetzung der Druckregeln aus `entwurf/dokumentEntwurf.css` (LFH-350/M86), als
   * DOM-Messung: das Textfeld steht in `.markdown-editor`, und bei geschlossener Vorschau
   * ist es der einzige Träger des Textes. Eine Regel auf `textarea` braucht deshalb eine
   * gerenderte Fassung daneben (offene Vorschau oder `druckfassung`). Fällt diese Behauptung, ist
   * die Begründung der Druckregeln hinfällig.
   */
  it('trägt bei geschlossener Vorschau den Text allein im Textfeld', () => {
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={3} value="**fett**" onChange={() => {}} />,
    );
    expect(container.querySelectorAll('.markdown-editor textarea')).toHaveLength(1);
    expect(container.querySelector('.markdown-editor__vorschau')).toBeNull();
    expect(container.querySelector('.markdown')).toBeNull();
  });

  /**
   * Druckfassung (LFH-71): bei geschlossener Vorschau trüge nur das Textfeld den
   * Abschnitt — auf Papier eine `<textarea>` mit abgeschnittenem Rohtext. Mit `druckfassung`
   * steht daneben eine gerenderte Fassung, die nur der Druck zeigt. Genau EINE gerenderte Fassung
   * im Baum: ist die Vorschau offen, trägt sie den Text.
   */
  it('rendert mit `druckfassung` bei geschlossener Vorschau eine gerenderte Druckfassung', async () => {
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={1} druckfassung value={'**fett**\n\nENDE'} onChange={() => {}} />,
    );
    const druck = container.querySelector('.markdown-editor__druck');
    expect(druck, 'keine Druckfassung').not.toBeNull();
    // Nur Papier: am Bildschirm `display: none` per CSS, für den Zugänglichkeitsbaum `aria-hidden`
    // — auch ohne geladenes CSS (jsdom). Sonst stünden die Überschriften ein zweites Mal im
    // Vorlesebaum.
    expect(druck).toHaveAttribute('aria-hidden', 'true');
    expect(druck!.querySelector('.markdown strong')).toHaveTextContent('fett');
    expect(druck!.querySelector('.markdown p:last-child')).toHaveTextContent('ENDE');

    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    expect(container.querySelector('.markdown-editor__druck')).toBeNull();
    expect(container.querySelectorAll('.markdown strong')).toHaveLength(1);
  });

  it('setzt einen leeren Abschnitt in der Druckfassung als „—" wie der Lesezweig', () => {
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={1} druckfassung value="  " onChange={() => {}} />,
    );
    expect(container.querySelector('.markdown-editor__druck')).toHaveTextContent(/^—$/);
  });

  /**
   * LFH-1008: der Kopf des Einbauorts (Abschnittskopf des Entwurfs) liegt außerhalb der gerenderten
   * Fassung und stünde in Firefox allein am Seitenende. Auf Papier trägt der Titel der Fassung
   * den Abschnitt, im selben Titelblock wie der erste Absatz; am Bildschirm ist er verborgen.
   */
  it('setzt `druckTitel` in den Titelblock der Druckfassung und der Vorschau', async () => {
    const { container } = renderMitProviders(
      <MarkdownEditor
        unterEbene={1}
        druckfassung
        druckTitel="Eigene Lage"
        value={'Erster Absatz\n\nZweiter'}
        onChange={() => {}}
      />,
    );
    const block = container.querySelector('.markdown-editor__druck [data-lfh="titelblock"]');
    expect(block, 'kein Titelblock in der Druckfassung').not.toBeNull();
    expect(block!.querySelector('.markdown-editor__titel')).toHaveTextContent('Eigene Lage');
    expect(block!.querySelector('p')).toHaveTextContent('Erster Absatz');

    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    const vorschau = container.querySelector('.markdown-editor__vorschau [data-lfh="titelblock"]');
    expect(vorschau!.querySelector('.markdown-editor__titel')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(vorschau!.querySelector('p')).toHaveTextContent('Erster Absatz');
  });

  it('hält `druckTitel` auch bei leerem Abschnitt beim „—"', () => {
    const { container } = renderMitProviders(
      <MarkdownEditor
        unterEbene={1}
        druckfassung
        druckTitel="Medienlage"
        value=""
        onChange={() => {}}
      />,
    );
    const block = container.querySelector('.markdown-editor__druck [data-lfh="titelblock"]');
    expect(block).toHaveTextContent(/^Medienlage—$/);
  });

  // Der Hilfetext im Abschnittskopf des Entwurfs beschreibt das Feld (LLH-1074).
  it('reicht `aria-describedby` an das Textfeld durch', () => {
    renderMitProviders(
      <>
        <span id="hilfe">a. Eigene Absicht</span>
        <MarkdownEditor
          unterEbene={3}
          umschalterAussen
          aria-describedby="hilfe"
          value=""
          onChange={() => {}}
        />
      </>,
    );
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('a. Eigene Absicht');
  });

  it('rendert ohne `druckTitel` keinen Titel', () => {
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={1} druckfassung value="Text" onChange={() => {}} />,
    );
    expect(container.querySelector('.markdown-editor__titel')).toBeNull();
  });

  // `readOnly` (LFH-117) sperrt nur das Textfeld; die Druckfassung (LFH-22) bleibt dieselbe.
  it('rendert die Druckfassung im readOnly-Zustand unverändert', () => {
    const wert = '**fett**\n\nENDE';
    const frei = renderMitProviders(
      <MarkdownEditor unterEbene={1} druckfassung value={wert} onChange={() => {}} />,
    );
    const erwartet = frei.container.querySelector('.markdown-editor__druck')!.innerHTML;
    frei.unmount();
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={1} druckfassung readOnly value={wert} onChange={() => {}} />,
    );
    expect(container.querySelector('.markdown-editor__druck')!.innerHTML).toBe(erwartet);
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox')).toHaveValue(wert);
  });

  it('rendert ohne `druckfassung` keine Druckfassung (ETB-Schnellerfassung: Tipp-Pfad)', () => {
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={1} value="**fett**" onChange={() => {}} />,
    );
    expect(container.querySelector('.markdown-editor__druck')).toBeNull();
  });

  /**
   * LFH-373: der Aufrufer darf den Umschalter selbst führen (ETB-Erfassung: „Vorschau" neben
   * „Erfassen" statt auf eigener Zeile). Ohne die Eigenschaft gilt der Test darüber.
   */
  it('mit umschalterAussen: kein eigener Knopf, die Vorschau folgt vorschauOffen', () => {
    const { container, rerender } = renderMitProviders(
      <MarkdownEditor
        unterEbene={3}
        value="**fett**"
        onChange={() => {}}
        umschalterAussen
        vorschauOffen={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /vorschau/i })).toBeNull();
    expect(container.querySelector('.markdown strong')).toBeNull();
    rerender(
      <MarkdownEditor
        unterEbene={3}
        value="**fett**"
        onChange={() => {}}
        umschalterAussen
        vorschauOffen
      />,
    );
    expect(container.querySelector('.markdown strong')).toHaveTextContent('fett');
  });

  it('reicht onKeyDown durch', async () => {
    const onKeyDown = vi.fn();
    renderMitProviders(
      <MarkdownEditor
        unterEbene={3}
        placeholder="Inhalt …"
        value=""
        onChange={() => {}}
        onKeyDown={onKeyDown}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), '/');
    expect(onKeyDown).toHaveBeenCalled();
  });
});

describe('MarkdownEditor — Zeichengrenze (LFH-937)', () => {
  function Gesteuert({ zaehlerAussen = false }: { zaehlerAussen?: boolean }) {
    const [wert, setWert] = useState('');
    return (
      <MarkdownEditor
        unterEbene={3}
        value={wert}
        onChange={setWert}
        maxLength={10}
        zaehlerAussen={zaehlerAussen}
      />
    );
  }

  it('reicht die Grenze an das Textfeld: Zähler ab 80 %, Überlänge ohne Kürzen', () => {
    render(<Gesteuert />);
    const feld = screen.getByRole('textbox');
    fireEvent.change(feld, { target: { value: 'a'.repeat(8) } });
    expect(screen.getByText('8 / 10')).toBeInTheDocument();
    fireEvent.change(feld, { target: { value: 'a'.repeat(12) } });
    expect(feld).toHaveValue('a'.repeat(12));
    expect(screen.getByText('12 / 10 · zu lang')).toBeInTheDocument();
  });

  it('mit zaehlerAussen zählt das Feld nicht selbst, markiert die Überlänge aber', () => {
    const { container } = render(<Gesteuert zaehlerAussen />);
    const feld = screen.getByRole('textbox');
    fireEvent.change(feld, { target: { value: 'a'.repeat(12) } });
    expect(feld).toHaveValue('a'.repeat(12));
    expect(screen.queryByText(/\/ 10/)).toBeNull();
    expect(container.querySelector('.ant-input-out-of-range')).not.toBeNull();
  });
});
