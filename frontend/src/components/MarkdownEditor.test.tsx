import { render, screen } from '@testing-library/react';
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

  it('split-Layout rendert die Vorschau live (formatiert, kein Rohtext)', () => {
    const { container } = render(
      <MarkdownEditor
        unterEbene={3}
        value="Lage **kritisch**"
        onChange={() => {}}
        layout="split"
      />,
    );
    // Vorschau ist im split-Layout dauerhaft sichtbar.
    expect(container.querySelector('.markdown strong')).toHaveTextContent('kritisch');
  });

  it('tabs-Layout zeigt zunächst das Textfeld, die Vorschau erst nach Umschalten', async () => {
    const { container } = render(
      <MarkdownEditor unterEbene={3} value={'- a\n- b'} onChange={() => {}} layout="tabs" />,
    );
    // Vor dem Umschalten: keine gerenderte Markdown-Vorschau.
    expect(container.querySelector('.markdown')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /vorschau/i }));
    expect(container.querySelectorAll('.markdown li')).toHaveLength(2);
  });

  it('zeigt bei leerem Inhalt einen dezenten Vorschau-Hinweis statt eines leeren Kastens', () => {
    render(<MarkdownEditor unterEbene={3} value="" onChange={() => {}} layout="split" />);
    expect(screen.getByText(/vorschau/i)).toBeInTheDocument();
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
    expect(container.querySelector('.markdown strong')).toHaveTextContent('fett');
  });

  it('spiegelt fortlaufende Eingabe in der split-Vorschau (gesteuert von außen)', async () => {
    function Wrapper() {
      const [v, setV] = useState('');
      return <MarkdownEditor unterEbene={3} value={v} onChange={setV} layout="split" />;
    }
    const { container } = render(<Wrapper />);
    await userEvent.type(screen.getByRole('textbox'), '# Titel');
    // `#` rendert unter `unterEbene` 3 als h4, mit der Quellstufe als Klasse (`Markdown.tsx`).
    expect(container.querySelector('.markdown .md-h1')).toHaveTextContent('Titel');
  });
});

describe('MarkdownEditor – toggle-Variante', () => {
  it('zeigt Eingabe; Vorschau-Toggle blendet formatierten Markdown ein', async () => {
    function Wrap() {
      return (
        <MarkdownEditor
          unterEbene={3}
          layout="toggle"
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
   * Die Voraussetzung der Druckregeln aus `pages/lageberichtPrint.css` (LFH-350/M86),
   * hier als DOM-Messung statt als Annahme: das `split`-Layout wickelt sein Textfeld in
   * `.markdown-editor__eingabe`, das `toggle`-Layout NICHT. Eine Druckregel auf
   * `.markdown-editor__eingabe` kann einen Toggle-Abschnitt deshalb nicht leer drucken —
   * und eine Regel auf `textarea` braucht eine gerenderte Fassung daneben (offene Vorschau
   * oder `druckfassung`, siehe unten).
   * Fällt diese Behauptung, ist die Begründung der Druckregeln hinfällig.
   */
  it('wickelt sein Textfeld NICHT in die Eingabespalte (anders als split)', () => {
    const { container: zu } = renderMitProviders(
      <MarkdownEditor unterEbene={3} layout="toggle" value="**fett**" onChange={() => {}} />,
    );
    expect(zu.querySelectorAll('.markdown-editor--toggle textarea')).toHaveLength(1);
    expect(zu.querySelector('.markdown-editor__eingabe')).toBeNull();
    // Und bei geschlossener Vorschau ist das Textfeld der einzige Träger des Textes.
    expect(zu.querySelector('.markdown-editor__vorschau')).toBeNull();

    const { container: gespalten } = renderMitProviders(
      <MarkdownEditor unterEbene={3} layout="split" value="**fett**" onChange={() => {}} />,
    );
    expect(gespalten.querySelectorAll('.markdown-editor__eingabe textarea')).toHaveLength(1);
    expect(gespalten.querySelector('.markdown-editor__vorschau')).not.toBeNull();
  });

  /**
   * Druckfassung (LFH-71, Review Welle B): bei geschlossener Vorschau trug im Toggle-Layout
   * nur das Textfeld den Abschnitt — auf Papier kam die `<textarea>` mit ihrer
   * Bildschirmhöhe, Markdown als Rohtext, langer Text abgeschnitten. Mit `druckfassung`
   * steht daneben eine gerenderte Fassung, die nur der Druck zeigt (`lageberichtPrint.css`).
   * Genau EINE gerenderte Fassung im Baum: ist die Vorschau offen, trägt sie den Text.
   */
  it('rendert mit `druckfassung` bei geschlossener Vorschau eine gerenderte Druckfassung', async () => {
    const { container } = renderMitProviders(
      <MarkdownEditor
        unterEbene={1}
        layout="toggle"
        druckfassung
        value={'**fett**\n\nENDE'}
        onChange={() => {}}
      />,
    );
    const druck = container.querySelector('.markdown-editor__druck');
    expect(druck, 'keine Druckfassung').not.toBeNull();
    expect(druck!.querySelector('.markdown strong')).toHaveTextContent('fett');
    expect(druck!.querySelector('.markdown p:last-child')).toHaveTextContent('ENDE');

    await userEvent.click(screen.getByRole('button', { name: /vorschau/i }));
    expect(container.querySelector('.markdown-editor__druck')).toBeNull();
    expect(container.querySelectorAll('.markdown strong')).toHaveLength(1);
  });

  it('setzt einen leeren Abschnitt in der Druckfassung als „—" wie der Lesezweig', () => {
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={1} layout="toggle" druckfassung value="  " onChange={() => {}} />,
    );
    expect(container.querySelector('.markdown-editor__druck')).toHaveTextContent(/^—$/);
  });

  it('rendert ohne `druckfassung` keine Druckfassung (ETB-Schnellerfassung: Tipp-Pfad)', () => {
    const { container } = renderMitProviders(
      <MarkdownEditor unterEbene={1} layout="toggle" value="**fett**" onChange={() => {}} />,
    );
    expect(container.querySelector('.markdown-editor__druck')).toBeNull();
  });

  it('reicht onKeyDown durch', async () => {
    const onKeyDown = vi.fn();
    renderMitProviders(
      <MarkdownEditor
        unterEbene={3}
        layout="toggle"
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
