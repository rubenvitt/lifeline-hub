import { screen, within } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KONVENTIONEN, formatZeitKurz } from '../anzeige/format';
import type { ModulFreigaben } from '../api/types';
import { freigabenFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import LagebesprechungZeile from './LagebesprechungZeile';

dayjs.extend(utc);

const JETZT = new Date('2026-09-13T10:00:00Z');
const wireAb = (minuten: number) =>
  dayjs(JETZT).add(minuten, 'minute').utc().format('YYYY-MM-DD HH:mm:ss');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
});
afterEach(() => vi.useRealTimers());

function zeige(termin: string | null, freigaben: ModulFreigaben | undefined = freigabenFixture()) {
  renderMitProviders(<LagebesprechungZeile einsatzId={1} termin={termin} freigaben={freigaben} />);
  return screen.getByRole('group', { name: 'Nächste Lagebesprechung' });
}

describe('LagebesprechungZeile (LLH-1111)', () => {
  it('zeigt Termin und Zustand und springt in das Modul Lagebesprechung', () => {
    const zeile = zeige(wireAb(25));
    expect(zeile).toHaveTextContent(formatZeitKurz(wireAb(25), DEFAULT_KONVENTIONEN));
    expect(within(zeile).getByText('in 25 min')).toBeInTheDocument();
    expect(within(zeile).getByRole('link', { name: 'Zur Lagebesprechung' })).toHaveAttribute(
      'href',
      '/einsaetze/1/lagebesprechung',
    );
  });

  it('ein verstrichener Termin heißt „seit 5 min überfällig“', () => {
    const zeile = zeige(wireAb(-5));
    expect(within(zeile).getByText('seit 5 min überfällig')).toBeInTheDocument();
  });

  it('ohne Termin steht „kein Termin“, der Sprung bleibt', () => {
    const zeile = zeige(null);
    expect(within(zeile).getByText('kein Termin')).toBeInTheDocument();
    expect(within(zeile).getByRole('link', { name: 'Zur Lagebesprechung' })).toBeInTheDocument();
  });

  it('ohne Zugriff auf die Lagebesprechung: Termin ja, Sprung gesperrt mit Grund', () => {
    const zeile = zeige(
      wireAb(25),
      freigabenFixture({ lagebesprechung: { sichtbar: true, zugriff: false } }),
    );
    expect(within(zeile).getByText('in 25 min')).toBeInTheDocument();
    expect(
      within(zeile).getByRole('button', { name: 'Zur Lagebesprechung (Keine Berechtigung)' }),
    ).toBeDisabled();
    expect(within(zeile).queryByRole('link')).toBeNull();
  });

  it('eine gesperrte Stab-Freigabe sperrt den Sprung nicht — es gilt nur die eigene', () => {
    const zeile = zeige(
      wireAb(25),
      freigabenFixture({ stab: { sichtbar: false, zugriff: false } }),
    );
    expect(within(zeile).getByRole('link', { name: 'Zur Lagebesprechung' })).toBeInTheDocument();
  });
});
