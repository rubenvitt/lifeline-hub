import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EtbFilterWerte } from '../api/etb';
import EtbFilterleiste from './EtbFilterleiste';

describe('EtbFilterleiste', () => {
  it('meldet einen Suchbegriff an onChange', async () => {
    const onChange = vi.fn<(w: EtbFilterWerte) => void>();
    render(<EtbFilterleiste onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('Volltextsuche'), 'pumpe');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: 'pumpe' })));
  });
});
