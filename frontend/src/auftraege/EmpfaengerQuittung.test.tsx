import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import EmpfaengerQuittung, { type QuittungsZeile } from './EmpfaengerQuittung';

const zeilen: QuittungsZeile[] = [
  { id: 1, name: 'EA Süd', zugaenglich: 'EA Süd', quittiertAt: '2026-06-02 10:05:00' },
  { id: 2, name: 'S3 Einsatz', zugaenglich: 'S3 Einsatz', quittiertAt: null },
];

function rendern(props: Partial<Parameters<typeof EmpfaengerQuittung>[0]> = {}) {
  const onQuittieren = vi.fn();
  render(
    <AntApp>
      <EmpfaengerQuittung zeilen={zeilen} darfQuittieren onQuittieren={onQuittieren} {...props} />
    </AntApp>,
  );
  return onQuittieren;
}

describe('EmpfaengerQuittung (LLH-1173)', () => {
  it('zählt aus den Zeilen und zeigt Quittierte mit ✓, Offene mit Knopf', () => {
    rendern();
    expect(screen.getByText('2 Empfänger · 1/2 quittiert')).toBeInTheDocument();
    expect(screen.getByText('EA Süd ✓')).toBeInTheDocument();
    expect(screen.getByText('Quittung offen:')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Empfang für S3 Einsatz quittieren' }),
    ).toBeInTheDocument();
  });

  it('ohne Rückfrage quittiert ein Klick direkt', async () => {
    const onQuittieren = rendern();
    await userEvent.click(
      screen.getByRole('button', { name: 'Empfang für S3 Einsatz quittieren' }),
    );
    expect(onQuittieren).toHaveBeenCalledWith(2);
  });

  it('mit Rückfrage erst nach der Bestätigung', async () => {
    const onQuittieren = rendern({
      rueckfrage: { title: 'Empfang/Kenntnis quittieren?', okText: 'Empfang quittieren' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Empfang für S3 Einsatz quittieren' }),
    );
    expect(onQuittieren).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
    expect(onQuittieren).toHaveBeenCalledWith(2);
  });

  it('ohne Recht stehen die offenen Namen ohne Knopf', () => {
    rendern({ darfQuittieren: false });
    expect(screen.getByText('S3 Einsatz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quittieren/ })).not.toBeInTheDocument();
  });

  it('der Zählstand des Servers geht vor', () => {
    rendern({ stand: { anzahl: 5, quittiert: 4 } });
    expect(screen.getByText('5 Empfänger · 4/5 quittiert')).toBeInTheDocument();
  });
});
