import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Form } from 'antd';
import { renderMitProviders } from '../test/utils';
import MarkdownEditor from './MarkdownEditor';

describe('MarkdownEditor', () => {
  it('zeigt den value im Schreib-Textfeld an', () => {
    render(<MarkdownEditor value="## Lage" onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('## Lage');
  });

  it('meldet Eingaben über onChange als reinen String', async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    expect(onChange).toHaveBeenLastCalledWith('x');
  });

  it('split-Layout rendert die Vorschau live (formatiert, kein Rohtext)', () => {
    const { container } = render(
      <MarkdownEditor value="Lage **kritisch**" onChange={() => {}} layout="split" />,
    );
    // Vorschau ist im split-Layout dauerhaft sichtbar.
    expect(container.querySelector('.markdown strong')).toHaveTextContent('kritisch');
  });

  it('tabs-Layout zeigt zunächst das Textfeld, die Vorschau erst nach Umschalten', async () => {
    const { container } = render(
      <MarkdownEditor value={'- a\n- b'} onChange={() => {}} layout="tabs" />,
    );
    // Vor dem Umschalten: keine gerenderte Markdown-Vorschau.
    expect(container.querySelector('.markdown')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /vorschau/i }));
    expect(container.querySelectorAll('.markdown li')).toHaveLength(2);
  });

  it('zeigt bei leerem Inhalt einen dezenten Vorschau-Hinweis statt eines leeren Kastens', () => {
    render(<MarkdownEditor value="" onChange={() => {}} layout="split" />);
    expect(screen.getByText(/vorschau/i)).toBeInTheDocument();
  });

  it('reicht placeholder an das Textfeld durch', () => {
    render(<MarkdownEditor value="" onChange={() => {}} placeholder="Inhalt …" />);
    expect(screen.getByPlaceholderText('Inhalt …')).toBeInTheDocument();
  });

  it('funktioniert als antd Form.Item-Child (controlled value/onChange)', async () => {
    function Wrapper() {
      const [form] = Form.useForm();
      return (
        <Form form={form} initialValues={{ inhalt: '' }}>
          <Form.Item name="inhalt">
            <MarkdownEditor />
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
      return <MarkdownEditor value={v} onChange={setV} layout="split" />;
    }
    const { container } = render(<Wrapper />);
    await userEvent.type(screen.getByRole('textbox'), '# Titel');
    expect(container.querySelector('.markdown h1')).toHaveTextContent('Titel');
  });
});

describe('MarkdownEditor – toggle-Variante', () => {
  it('zeigt Eingabe; Vorschau-Toggle blendet formatierten Markdown ein', async () => {
    function Wrap() {
      return <MarkdownEditor layout="toggle" variante="kompakt" placeholder="Inhalt …" value="**fett**" onChange={() => {}} />;
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
   * und eine Regel auf `textarea` müsste an `:has(.markdown-editor__vorschau)` hängen.
   * Fällt diese Behauptung, ist die Begründung der Druckregeln hinfällig.
   */
  it('wickelt sein Textfeld NICHT in die Eingabespalte (anders als split)', () => {
    const { container: zu } = renderMitProviders(
      <MarkdownEditor layout="toggle" value="**fett**" onChange={() => {}} />,
    );
    expect(zu.querySelectorAll('.markdown-editor--toggle textarea')).toHaveLength(1);
    expect(zu.querySelector('.markdown-editor__eingabe')).toBeNull();
    // Und bei geschlossener Vorschau ist das Textfeld der einzige Träger des Textes.
    expect(zu.querySelector('.markdown-editor__vorschau')).toBeNull();

    const { container: gespalten } = renderMitProviders(
      <MarkdownEditor layout="split" value="**fett**" onChange={() => {}} />,
    );
    expect(gespalten.querySelectorAll('.markdown-editor__eingabe textarea')).toHaveLength(1);
    expect(gespalten.querySelector('.markdown-editor__vorschau')).not.toBeNull();
  });

  it('reicht onKeyDown durch', async () => {
    const onKeyDown = vi.fn();
    renderMitProviders(
      <MarkdownEditor layout="toggle" placeholder="Inhalt …" value="" onChange={() => {}} onKeyDown={onKeyDown} />,
    );
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), '/');
    expect(onKeyDown).toHaveBeenCalled();
  });
});
