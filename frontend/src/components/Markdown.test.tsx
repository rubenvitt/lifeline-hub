import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Markdown from './Markdown';

describe('Markdown', () => {
  it('rendert eine Überschrift als heading-Element', () => {
    render(<Markdown>{'# Lageüberblick'}</Markdown>);
    expect(screen.getByRole('heading', { name: 'Lageüberblick' })).toBeInTheDocument();
  });

  it('rendert eine Liste als list items', () => {
    render(<Markdown>{'- Punkt A\n- Punkt B'}</Markdown>);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Punkt A');
  });

  it('rendert Fettung als <strong>', () => {
    const { container } = render(<Markdown>{'Lage ist **kritisch**'}</Markdown>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong).toHaveTextContent('kritisch');
  });

  it('rendert GFM-Durchstreichung (remark-gfm aktiv)', () => {
    const { container } = render(<Markdown>{'~~veraltet~~'}</Markdown>);
    expect(container.querySelector('del')).toHaveTextContent('veraltet');
  });

  // --- XSS / Akzeptanzkriterium „kein ungefiltertes HTML" ---

  it('rendert rohes HTML NICHT als Markup, sondern als Text', () => {
    const { container } = render(<Markdown>{'<script>alert(1)</script>Hallo'}</Markdown>);
    // Kein <script>-Element darf in den DOM gelangen.
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('alert(1)');
  });

  it('rendert <img onerror=…> nicht als HTML-Element', () => {
    const { container } = render(
      <Markdown>{'<img src=x onerror="alert(1)">'}</Markdown>,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('sanitisiert javascript:-Links (kein gefährliches href)', () => {
    const { container } = render(<Markdown>{'[klick](javascript:alert(1))'}</Markdown>);
    const link = container.querySelector('a');
    // react-markdown defused unsichere Schemata per Default — href darf kein javascript: sein.
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
  });

  // --- Varianten für die zwei Einsatzkontexte ---

  it('trägt die kompakt-Variante als CSS-Klasse (für ETB-Tabellenzellen)', () => {
    const { container } = render(<Markdown variante="kompakt">{'Text'}</Markdown>);
    expect(container.querySelector('.markdown--kompakt')).not.toBeNull();
  });

  it('nutzt die dokument-Variante als Default (für Lagebericht)', () => {
    const { container } = render(<Markdown>{'Text'}</Markdown>);
    expect(container.querySelector('.markdown--dokument')).not.toBeNull();
  });

  it('rendert leeren Inhalt ohne Absturz', () => {
    const { container } = render(<Markdown>{''}</Markdown>);
    expect(container.querySelector('.markdown')).not.toBeNull();
  });
});
