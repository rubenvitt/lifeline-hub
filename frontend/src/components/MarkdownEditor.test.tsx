import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Form } from 'antd';
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
    // Externes setFieldsValue (wie BausteinPicker) muss in der Komponente ankommen.
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
