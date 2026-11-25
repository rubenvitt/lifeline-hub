import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { erzeugeQueryClient } from '../api/queryClient';
import PersonVorschau from './PersonVorschau';
import type { PersonDetail } from '../api/types';

const detail = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  aktuelle_sichtung: 'sk1',
  aktuelle_sichtung_at: '2026-05-27 09:10:00',
  zustand: 'Verdacht auf Hüftfraktur',
  aufenthalt: {
    uhs_id: 3,
    uhs_bezeichnung: 'Turnhalle',
    platz_id: 7,
    platz_bezeichnung: 'Behandlungsplatz 2',
    seit: '2026-05-27 09:20:00',
  },
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

/**
 * Die Vorschau ist der gemeinsame Inhalt von Drawer und Palette; geprüft wird, was an BEIDEN
 * Orten stehen muss.
 */
describe('PersonVorschau', () => {
  it('zeigt oben die Patientenfragen, darunter Personendaten und Verlauf (LLH-1137)', async () => {
    server.use(http.get('/api/incidents/1/persons/10', () => HttpResponse.json(detail)));
    const { container } = renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
    const kopf = await screen.findByRole('region', { name: 'Patientenkopf' });
    // Sichtung, Zustand / Verdacht und Aufenthalt aus dem Patientenkopf in der Lesefassung.
    expect(within(kopf).getByText(/SK I · akut/)).toBeInTheDocument();
    expect(within(kopf).getByText('Verdacht auf Hüftfraktur')).toBeInTheDocument();
    expect(kopf.querySelector('[data-lfh="aufenthalt"]')?.textContent).toMatch(
      /^Turnhalle · Behandlungsplatz 2 · seit /,
    );
    expect(within(kopf).queryAllByRole('button')).toHaveLength(0);
    // Ein Vorsatz „SK: “ verdoppelte das Etikett (LFH-944).
    expect(screen.queryByText(/SK: /)).not.toBeInTheDocument();
    expect(screen.getByText('Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Brücke')).toBeInTheDocument();
    expect(screen.getByText(/^Verlauf/)).toBeInTheDocument();
    // Datenraster statt Descriptions, leere Angaben in EINER Zeile.
    expect(container.querySelector('.ant-descriptions')).toBeNull();
    expect(container.querySelector('[data-lfh="ohne-angabe"]')?.textContent).toBe(
      'Ohne Angabe: Geburtsdatum, Herkunft / Adresse, Melder / Kontakt, Notiz',
    );
    expect(screen.queryByText('—')).toBeNull();
  });

  it('zeigt Geburtsdatum als TT.MM.JJJJ und das Geschlecht als Wort (LLH-1103)', async () => {
    server.use(
      http.get('/api/incidents/1/persons/10', () =>
        HttpResponse.json({ ...detail, geburtsdatum: '1980-07-14' }),
      ),
    );
    renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
    expect(await screen.findByText('14.07.1980')).toBeInTheDocument();
    expect(screen.getByText('männlich')).toBeInTheDocument();
    expect(screen.queryByText('maennlich')).toBeNull();
  });

  it('zeigt das Körperschema nur lesend: Figur und Liste, kein Markieren (LLH-1120)', async () => {
    server.use(
      http.get('/api/incidents/1/persons/10', () =>
        HttpResponse.json({
          ...detail,
          verletzungen: [
            {
              id: 1,
              einsatz_id: 1,
              person_id: 10,
              ansicht: 'vorn',
              region: 'unterarm_l',
              art: 'fraktur_verdacht',
              x: 0.7,
              y: 0.45,
              zeitpunkt_at: '2026-05-27 09:15:00',
              erfasst_at: '2026-05-27 09:15:00',
              erfasst_von: 1,
            },
          ],
        }),
      ),
    );
    renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
    const kopf = await screen.findByRole('region', { name: 'Patientenkopf' });
    expect(within(kopf).getByRole('list', { name: 'Verletzungen' })).toHaveTextContent(
      '1 Unterarm links, vorn · Fraktur-Verdacht',
    );
    expect(kopf.querySelectorAll('[data-lfh="koerperfigur"]')).toHaveLength(2);
    expect(kopf.querySelectorAll('[data-lfh="stern"]')).toHaveLength(1);
    expect(within(kopf).queryByRole('button', { name: 'Verletzung markieren' })).toBeNull();
    expect(kopf.querySelector('[data-lfh="koerperzone"]')).toBeNull();
  });

  it('nennt einen Ladefehler, statt leer zu bleiben', async () => {
    server.use(
      http.get('/api/incidents/1/persons/10', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
  });

  // Jeder Detail-GET schreibt eine Zeile ins Zugriffsprotokoll (LLH-1984, wie LLH-1832 an der
  // Detailseite): ein Neuladen ohne neue Öffnung wäre ein Zugriff, den niemand getan hat.
  it('Fokuswechsel ruft das Detail nicht neu ab (Zugriffsprotokoll)', async () => {
    let detailAbrufe = 0;
    server.use(
      http.get('/api/incidents/1/persons/10', () => {
        detailAbrufe += 1;
        return HttpResponse.json(detail);
      }),
    );
    renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
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

  it('wiederholt einen gescheiterten Detailabruf nicht von selbst (Zugriffsprotokoll)', async () => {
    let detailAbrufe = 0;
    server.use(
      http.get('/api/incidents/1/persons/10', () => {
        detailAbrufe += 1;
        return HttpResponse.error();
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Produktionsvorgaben: sie wiederholen einen Leitungsfehler sonst zweimal.
      renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />, {
        client: erzeugeQueryClient(),
      });
      await waitFor(() => expect(detailAbrufe).toBe(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(detailAbrufe).toBe(1);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
  });
});
