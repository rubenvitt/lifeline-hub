import { http, HttpResponse } from 'msw';
import { act, screen } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonDetailDrawer from './PersonDetailDrawer';
import type { PersonDetail } from '../api/types';

const detail = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  aktuelle_sichtung: null,
  aktuelle_sichtung_at: null,
  zustand: null,
  aufenthalt: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
  transporte: [],
  massnahmen: [],
  verletzungen: [],
} as unknown as PersonDetail;

describe('PersonDetailDrawer', () => {
  // Titel und Vorschau lesen dasselbe Fach; jeder Detail-GET schreibt eine Zeile ins
  // Zugriffsprotokoll (LLH-1984). Ein Beobachter mit Fokus-Neuladen genügte für einen Abruf.
  it('Fokuswechsel ruft das Detail nicht neu ab (Zugriffsprotokoll)', async () => {
    let detailAbrufe = 0;
    server.use(
      http.get('/api/einsaetze/1/personen/10', () => {
        detailAbrufe += 1;
        return HttpResponse.json(detail);
      }),
    );
    renderMitProviders(<PersonDetailDrawer einsatzId={1} personId={10} onClose={() => {}} />);
    expect(await screen.findByText('Person R-001')).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Patientenkopf' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.advanceTimersByTime(60_000);
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
    expect(detailAbrufe).toBe(1);
  });
});
