import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App as AntApp } from 'antd';
import MeldungFormular from './MeldungFormular';

function renderFormular(onAnlegen = vi.fn()) {
  render(
    <AntApp>
      <MeldungFormular senden={false} onAnlegen={onAnlegen} />
    </AntApp>,
  );
  return onAnlegen;
}

describe('MeldungFormular', () => {
  it('Fast-Path-Button belegt Sofortmeldung + Bestätigungspflicht vor', async () => {
    const onAnlegen = renderFormular();
    await userEvent.click(screen.getByRole('button', { name: /Sofortmeldung/ }));
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'MANV');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      meldungsart: 'sofortmeldung', prioritaet: 'sofort', bestaetigung_pflicht: true,
    }));
  });

  it('reicht das Frist-Override in Minuten durch', async () => {
    const onAnlegen = renderFormular();
    // Bestätigungspflicht aktivieren, dann Frist-Override setzen.
    await userEvent.click(screen.getByRole('switch', { name: 'Bestätigung erforderlich' }));
    await userEvent.type(screen.getByLabelText('Bestätigungsfrist in Minuten'), '30');
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'MANV');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      bestaetigung_pflicht: true, bestaetigung_frist_min: 30,
    }));
  });

  it('sendet ohne Pflicht keine Frist', async () => {
    const onAnlegen = renderFormular();
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'Lage ruhig');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      bestaetigung_pflicht: false, bestaetigung_frist_min: undefined,
    }));
  });
});
