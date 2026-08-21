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

  it('serialisiert Quittierungen und zeigt nur am Ziel den Ladezustand', () => {
    const empfaenger = auftrag().empfaenger[0];
    const zweiEmpfaenger = auftrag({
      empfaenger_anzahl: 2,
      empfaenger: [
        empfaenger,
        { ...empfaenger, id: 2, snap_anzeige: 'EA Süd' },
      ],
    });
    renderMitProviders(
      <AuftragListe
        auftraege={[zweiEmpfaenger]}
        einsatzId={7}
        darfSchreiben
        quittierungLaeuft
        quittierungZiel={{ auftragId: 1, empfaengerId: 1 }}
        onQuittieren={() => undefined}
      />,
    );

    const ziel = screen.getByRole('button', { name: 'Empfang für EA Nord quittieren' });
    const anderesZiel = screen.getByRole('button', { name: 'Empfang für EA Süd quittieren' });
    expect(ziel).toBeDisabled();
    expect(ziel).toHaveClass('ant-btn-loading');
    expect(anderesZiel).toBeDisabled();
    expect(anderesZiel).not.toHaveClass('ant-btn-loading');
  });
});

describe('AuftragListe — Leerzustand (LFH-331 · B3)', () => {
  /**
   * Der Wortlaut bleibt byte-gleich; getauscht wird der Knoten. Deshalb steht die
   * Text-Zusicherung neben der Knoten-Zusicherung: allein wäre sie vor dem Umbau
   * genauso grün gewesen und belegte nichts.
   *
   * Keine Primäraktion: die Liste ist rein darstellend — die Erteilung liegt auf der
   * Seite darüber, nicht in dieser Komponente.
   */
  it('zeigt den Leertext über das Leer-Primitiv, ohne antds Leer-Element', () => {
    const { container } = renderMitProviders(<AuftragListe auftraege={[]} einsatzId={7} />);
    expect(screen.getByText('Keine Aufträge')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

/**
 * Befund H47 (LFH-343 · C8), zweite Hälfte: `AUFTRAG_STATUS.offen` ist derselbe
 * Fall wie `MELDUNG_STATUS.neu` — ein Auftrag, den noch niemand angefasst hat,
 * trug dasselbe graue Etikett wie einer in Bearbeitung.
 */
describe('AuftragKarte — Eingangszustand', () => {
  it('hebt den offenen Auftrag ab, den in Bearbeitung nicht', () => {
    const { container } = renderMitProviders(
      <AuftragListe auftraege={[auftrag({ bearbeitungsstatus: 'offen' })]} einsatzId={7} />,
    );
    expect(container.querySelector('.ant-card')).toHaveAttribute('data-unbearbeitet', 'true');
    expect(screen.getByText('Offen').closest('.ant-tag')).toHaveClass('ant-tag-warning');
  });

  it('lässt „In Bearbeitung" neutral', () => {
    const { container } = renderMitProviders(
      <AuftragListe auftraege={[auftrag({ bearbeitungsstatus: 'in_arbeit' })]} einsatzId={7} />,
    );
    expect(container.querySelector('.ant-card')).not.toHaveAttribute('data-unbearbeitet');
    expect(screen.getByText('In Bearbeitung').closest('.ant-tag')).not.toHaveClass('ant-tag-warning');
  });

  it('lässt Überfällig den Rand gewinnen, behält aber das Etikett', () => {
    const { container } = renderMitProviders(
      <AuftragListe
        auftraege={[auftrag({ bearbeitungsstatus: 'offen', ist_ueberfaellig: true })]}
        einsatzId={7}
      />,
    );
    const karte = container.querySelector('.ant-card')!;
    expect(karte).toHaveAttribute('data-ueberfaellig', 'true');
    expect(karte).not.toHaveAttribute('data-unbearbeitet');
    expect(screen.getByText('Offen').closest('.ant-tag')).toHaveClass('ant-tag-warning');
  });
});
