import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Calendar, ConfigProvider } from 'antd';
import deDE from 'antd/locale/de_DE';
import dayjs from 'dayjs';
import './dayjsSprache';

describe('dayjs-Sprache für antds Kalender', () => {
  it('die Woche beginnt am Montag', () => {
    render(
      <ConfigProvider locale={deDE}>
        <Calendar fullscreen={false} value={dayjs('2026-10-17')} />
      </ConfigProvider>,
    );
    const kopf = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(kopf[0]).toBe('Mo');
    expect(kopf[6]).toBe('So');
  });

  it('die globale dayjs-Sprache bleibt unverändert', () => {
    expect(dayjs.locale()).toBe('en');
  });
});
