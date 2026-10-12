import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Auftrag } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import AuftragDruckBlatt from './AuftragDruckBlatt';
import { druckAuftrag, druckEmpfaenger } from './auftragDruckTestdaten';

function renderBlatt(auftrag: Auftrag) {
  return render(
    <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
      <AuftragDruckBlatt auftrag={auftrag} />
    </AnzeigeKonventionenProvider>,
  );
}

/** Die Etikett-Wert-Paare unter einem Titel, in Dokumentfolge. */
function teil(titel: string): [string, string][] {
  const kopf = screen.getByRole('heading', { level: 3, name: titel });
  const raster = kopf.closest('[data-lfh="titelblock"]')!.parentElement!;
  return within(raster)
    .getAllByRole('term')
    .map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']);
}

describe('Auftragsblatt (LLH-1171, Spec `druck-dokumente`)', () => {
  it('trägt die Teile Auftrag, Quittung und Bearbeitung, je Titel mit erster Zeile im Titelblock', () => {
    renderBlatt(druckAuftrag());
    const titel = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titel).toEqual(['Auftrag', 'Quittung', 'Bearbeitung']);
    for (const t of titel) {
      const block = screen.getByRole('heading', { level: 3, name: t! }).closest('[data-lfh]');
      expect(block).toHaveAttribute('data-lfh', 'titelblock');
      // Die erste Zeile steht mit im Block, sonst bliebe der Titel in Firefox allein stehen.
      expect(within(block as HTMLElement).getAllByRole('term')).toHaveLength(1);
    }
  });

  it('Teil „Auftrag“ in der Feldfolge des Kerns', () => {
    renderBlatt(druckAuftrag());
    expect(teil('Auftrag').map(([e]) => e)).toEqual([
      'Empfänger',
      'Auftrag',
      'Priorität',
      'Mittel',
      'Weg',
      'Absicht',
      'Richtung',
      'Erteilt am',
    ]);
  });

  it('abgenommener Auftrag: beide Quittungen mit Zeitpunkt, Bearbeitung mit Vollzug und Abnahme', () => {
    renderBlatt(
      druckAuftrag({
        bearbeitungsstatus: 'abgenommen',
        vollzug_status: 'vollzogen',
        in_arbeit_at: '2026-06-11 08:20:00',
        vollzogen_at: '2026-06-11 09:00:00',
        vollzugsmeldung: 'Leitung steht',
        abgenommen_at: '2026-06-11 09:05:00',
        empfaenger: [
          druckEmpfaenger(1, '2. Zug', '2026-06-11 08:15:00'),
          druckEmpfaenger(2, 'Logistiktrupp', '2026-06-11 08:16:00'),
        ],
      }),
    );
    const quittung = teil('Quittung');
    expect(quittung.map(([e]) => e)).toEqual(['2. Zug', 'Logistiktrupp']);
    expect(quittung[0][1]).toMatch(/^111015/);
    expect(quittung[1][1]).toMatch(/^111016/);

    const bearbeitung = teil('Bearbeitung');
    expect(bearbeitung.map(([e]) => e)).toEqual([
      'Phase',
      'In Bearbeitung seit',
      'Vollzogen am',
      'Vollzugsvermerk',
      'Abgenommen am',
    ]);
    expect(bearbeitung[0][1]).toBe('Abgenommen');
    expect(bearbeitung[2][1]).toMatch(/^111100/);
    expect(bearbeitung[3][1]).toBe('Leitung steht');
    expect(bearbeitung[4][1]).toMatch(/^111105/);
  });

  it('offener Auftrag ohne Quittung: „nicht quittiert“, Bearbeitung nur die Phase', () => {
    renderBlatt(druckAuftrag({ empfaenger: [druckEmpfaenger(1, '2. Zug', null)] }));
    expect(teil('Quittung')).toEqual([['2. Zug', 'nicht quittiert']]);
    expect(teil('Bearbeitung')).toEqual([['Phase', 'Offen']]);
  });

  it('aufgehobener Auftrag: Zeitpunkt, Person und Grund der Aufhebung', () => {
    renderBlatt(
      druckAuftrag({
        bearbeitungsstatus: 'aufgehoben',
        aufgehoben_at: '2026-06-11 08:30:00',
        aufgehoben_von_name: 'Erika Muster',
        aufhebungsgrund: 'Lage hat sich erledigt',
      }),
    );
    const bearbeitung = teil('Bearbeitung');
    expect(bearbeitung.map(([e]) => e)).toEqual([
      'Phase',
      'Aufgehoben am',
      'Aufgehoben von',
      'Grund',
    ]);
    expect(bearbeitung[0][1]).toBe('Aufgehoben');
    expect(bearbeitung[1][1]).toMatch(/^111030/);
    expect(bearbeitung[2][1]).toBe('Erika Muster');
    expect(bearbeitung[3][1]).toBe('Lage hat sich erledigt');
  });

  it('Empfänger mit Besetzung stehen in der Quittung wie im Detail', () => {
    renderBlatt(
      druckAuftrag({
        empfaenger: [
          druckEmpfaenger(1, 'S4', null, {
            aktuelle_besetzung: { zustand: 'personal', name: 'Meier' },
          }),
        ],
      }),
    );
    expect(teil('Quittung')).toEqual([['S4 · Meier', 'nicht quittiert']]);
  });
});
