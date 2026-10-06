import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from 'antd';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { istZuLang, zaehlerText, zeichenGrenze, zeichenRegel, zeichenZahl } from './zeichenGrenze';

/** Kontrolliertes Feld wie unter `Form.Item`: der Zähler sieht immer den aktuellen Wert. */
function Feld({ max, start = '' }: { max: number; start?: string }) {
  const [wert, setWert] = useState(start);
  return (
    <Input.TextArea
      aria-label="Text"
      value={wert}
      onChange={(e) => setWert(e.target.value)}
      count={zeichenGrenze(max)}
    />
  );
}

function zaehler(container: HTMLElement): string {
  return container.querySelector('.ant-input-data-count')?.textContent ?? '';
}

describe('zeichenZahl / istZuLang', () => {
  it('zählt Unicode-Skalarwerte wie der Server: ein Emoji ist ein Zeichen', () => {
    expect('😀'.length).toBe(2);
    expect(zeichenZahl('😀')).toBe(1);
    expect(zeichenZahl('ä'.repeat(200))).toBe(200);
  });

  it('misst wie der Server nach dem Trimmen; genau max ist erlaubt', () => {
    expect(istZuLang('a'.repeat(10), 10)).toBe(false);
    expect(istZuLang('a'.repeat(11), 10)).toBe(true);
    expect(istZuLang(`  ${'a'.repeat(10)}\n`, 10)).toBe(false);
    expect(istZuLang('😀'.repeat(10), 10)).toBe(false);
  });
});

describe('zaehlerText', () => {
  it('bleibt unter 80 % der Grenze leer', () => {
    expect(zaehlerText(6_399, 8_000)).toBeNull();
    expect(zaehlerText(0, 8_000)).toBeNull();
  });

  it('zeigt ab 80 % „n / max“ deutsch gruppiert', () => {
    expect(zaehlerText(6_400, 8_000)).toBe('6.400 / 8.000');
    expect(zaehlerText(8_000, 8_000)).toBe('8.000 / 8.000');
  });

  it('nennt eine Überlänge auch in Worten, nicht nur in Farbe', () => {
    expect(zaehlerText(10_312, 10_000)).toBe('10.312 / 10.000 · zu lang');
  });
});

describe('zeichenGrenze an einem antd-Feld', () => {
  it('zeigt unter 80 % keinen Zähler', () => {
    const { container } = render(<Feld max={10} />);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'a'.repeat(7) } });
    expect(zaehler(container)).toBe('');
  });

  it('zeigt ab 80 % „n / max“ in Mono mit tabular-nums', () => {
    const { container } = render(<Feld max={10} />);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'a'.repeat(8) } });
    expect(zaehler(container)).toBe('8 / 10');
    const marke = container.querySelector('.ant-input-data-count [data-lfh="zeichen-zaehler"]');
    expect(marke).not.toBeNull();
    expect((marke as HTMLElement).style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('schneidet eine Eingabe an der Grenze ab', () => {
    render(<Feld max={10} />);
    const feld = screen.getByLabelText('Text');
    fireEvent.change(feld, { target: { value: 'a'.repeat(12) } });
    expect(feld).toHaveValue('a'.repeat(10));
  });

  it('schneidet nach Zeichen, nicht nach UTF-16-Einheiten (Emoji zählt einfach)', () => {
    const { container } = render(<Feld max={10} />);
    const feld = screen.getByLabelText('Text');
    fireEvent.change(feld, { target: { value: '😀'.repeat(12) } });
    expect(feld).toHaveValue('😀'.repeat(10));
    expect(zaehler(container)).toBe('10 / 10');
  });

  it('kürzt einen vorbelegten Wert über der Grenze nicht still, sondern zeigt die Überlänge', () => {
    const { container } = render(<Feld max={10} start={'a'.repeat(12)} />);
    expect(screen.getByLabelText('Text')).toHaveValue('a'.repeat(12));
    expect(zaehler(container)).toBe('12 / 10 · zu lang');
  });
});

describe('zeichenRegel', () => {
  it('lehnt einen Wert über der Grenze mit dem Wortlaut des Servers ab', async () => {
    const regel = zeichenRegel(10, 'Text');
    const pruefe = (wert: unknown) => regel.validator({}, wert);
    await expect(pruefe('a'.repeat(10))).resolves.toBeUndefined();
    await expect(pruefe(undefined)).resolves.toBeUndefined();
    await expect(pruefe('a'.repeat(11))).rejects.toThrow(
      'Text darf höchstens 10 Zeichen lang sein',
    );
  });
});
