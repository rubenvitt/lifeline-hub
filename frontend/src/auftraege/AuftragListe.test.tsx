import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Auftrag } from '../api/types';
import { renderMitProviders } from '../test/utils';
import AuftragListe from './AuftragListe';

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 1, einsatz_id: 7, auftrag_text: 'Deich sichern', absicht: null, lage: null, ort: null,
  zeit: null, mittel: null, verbindung: null, sicherheit: null, prioritaet: 'normal', richtung: 'intern',
  frist_at: null, erteilt_at: '2026-06-11 09:00:00', in_arbeit_at: null, vollzugsmeldung: null,
  abgenommen_at: null, abgenommen_von_id: null, etb_anordnung_id: 5, quell_etb_eintrag_id: null, erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00', vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
  empfaenger_anzahl: 1, quittiert_anzahl: 0, ist_ueberfaellig: false, bearbeitungsstatus: 'offen',
  empfaenger: [{ id: 1, auftrag_id: 1, empfaenger_typ: 'funktion', abschnitt_id: null, einheit_id: null, person_id: null, fahrzeug_id: null, funktion_text: 'EA Nord', extern_kategorie: null, extern_bezeichnung: null, snap_anzeige: 'EA Nord', quittiert_at: null, quittiert_von_id: null }],
  ...over,
});

describe('AuftragListe — ETB-Backlink (LFH-112)', () => {
  it('zeigt den Rückverweis auf den Quell-ETB-Eintrag, wenn quell_etb_eintrag_id gesetzt ist', () => {
    renderMitProviders(
      <AuftragListe auftraege={[auftrag({ quell_etb_eintrag_id: 99 })]} einsatzId={7} />,
    );
    const link = screen.getByRole('link', { name: /ETB-Eintrag/ });
    // Deeplink auf den konkreten Quell-Eintrag (LFH-25).
    expect(link).toHaveAttribute('href', '/einsaetze/7/etb?eintrag=99');
  });

  it('zeigt keinen Backlink ohne quell_etb_eintrag_id', () => {
    renderMitProviders(<AuftragListe auftraege={[auftrag()]} einsatzId={7} />);
    expect(screen.queryByRole('link', { name: /ETB-Eintrag/ })).not.toBeInTheDocument();
  });
});
