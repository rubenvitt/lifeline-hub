import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import LiveStatusBanner from './LiveStatusBanner';

function melde(status: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));
  });
}

describe('LiveStatusBanner (F14/LFH-263)', () => {
  it('zeigt bei open nichts an', () => {
    const { container } = render(<LiveStatusBanner />);
    melde('open');
    expect(container).toBeEmptyDOMElement();
  });

  it('zeigt einen Fehler-Banner bei lost', () => {
    render(<LiveStatusBanner />);
    melde('lost');
    expect(screen.getByText(/unterbrochen/i)).toBeInTheDocument();
  });

  it('zeigt bei connecting einen Hinweis und blendet ihn bei open wieder aus', () => {
    render(<LiveStatusBanner />);
    melde('connecting');
    expect(screen.getByText(/wiederhergestellt/i)).toBeInTheDocument();
    melde('open');
    expect(screen.queryByText(/wiederhergestellt/i)).not.toBeInTheDocument();
  });
});
