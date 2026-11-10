import { screen } from '@testing-library/react';
import { Collapse, Modal } from 'antd';
import { Select } from '../components/Select';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from './utils';

/**
 * Wächter für `eindeutigeIds.ts` (LLH-1625): Steht ein Collapse oder ein Auswahlfeld vor einem
 * Dialog, findet die Suche über den Namen den Dialog. Mit `useId` → `'test-id'` zeigte
 * `aria-labelledby` auf den Collapse-Inhalt.
 */
describe('eindeutige antd-Kennungen unter Vitest', () => {
  it('findet den Dialog über seinen Namen neben Collapse und Auswahlfeld', async () => {
    renderMitProviders(
      <>
        <Collapse
          defaultActiveKey={['a']}
          items={[{ key: 'a', label: 'Abschnitt', children: 'Inhalt' }]}
        />
        <Select aria-label="Auswahl" options={[{ value: 1, label: 'Eins' }]} />
        <Modal open title="Rückfrage">
          Text
        </Modal>
      </>,
    );

    expect(await screen.findByRole('dialog', { name: 'Rückfrage' })).toHaveTextContent('Text');
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids).not.toContain('test-id');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
