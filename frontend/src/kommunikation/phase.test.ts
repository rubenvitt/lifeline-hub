import { describe, it, expect } from 'vitest';
import {
  PHASE_META,
  PRIO_META,
  AUFTRAG_STATUS,
  MELDUNG_STATUS,
  NACHFORDERUNG_STATUS,
  ERINNERUNG_STATUS,
  BEFEHL_STATUS,
  LAGEBERICHT_STATUS,
  istAbgeschlossen,
  type KommPhase,
} from './phase';

describe('PHASE_META', () => {
  it('hat die vier Phasen mit festen Farben', () => {
    expect(PHASE_META.offen).toEqual({ color: 'default', label: 'Offen' });
    expect(PHASE_META.in_arbeit).toEqual({ color: 'processing', label: 'In Arbeit' });
    expect(PHASE_META.abgeschlossen).toEqual({ color: 'success', label: 'Abgeschlossen' });
    expect(PHASE_META.ausnahme).toEqual({ color: 'error', label: 'Ausnahme' });
  });
});

describe('PRIO_META', () => {
  it('mappt die drei Prioritäten', () => {
    expect(PRIO_META.sofort).toEqual({ color: 'red', label: 'Sofort' });
    expect(PRIO_META.dringend).toEqual({ color: 'orange', label: 'Dringend' });
    expect(PRIO_META.normal).toEqual({ color: 'default', label: 'Normal' });
  });
});

describe('Status-Deskriptoren', () => {
  it('AUFTRAG mappt jeden Bearbeitungsstatus auf Phase + Fachlabel', () => {
    expect(AUFTRAG_STATUS.offen).toEqual({ label: 'Offen', phase: 'offen', unbearbeitet: true });
    expect(AUFTRAG_STATUS.in_arbeit).toEqual({ label: 'In Bearbeitung', phase: 'in_arbeit' });
    expect(AUFTRAG_STATUS.vollzogen).toEqual({ label: 'Vollzogen', phase: 'abgeschlossen' });
    expect(AUFTRAG_STATUS.abgenommen).toEqual({ label: 'Abgenommen', phase: 'abgeschlossen' });
  });

  it('MELDUNG mappt neu/gesichtet→offen, in_bearbeitung→in_arbeit, erledigt→abgeschlossen', () => {
    expect(MELDUNG_STATUS.neu).toEqual({ label: 'Neu', phase: 'offen', unbearbeitet: true });
    expect(MELDUNG_STATUS.gesichtet).toEqual({ label: 'Gesichtet', phase: 'offen' });
    expect(MELDUNG_STATUS.in_bearbeitung).toEqual({ label: 'In Bearbeitung', phase: 'in_arbeit' });
    expect(MELDUNG_STATUS.erledigt).toEqual({ label: 'Erledigt', phase: 'abgeschlossen' });
  });

  it('markiert genau die unbearbeiteten Eingangszustände, nicht jede offene Phase', () => {
    // Der Kern von H47: „neu" und „gesichtet" tragen DIESELBE Phase und sahen
    // deshalb identisch aus — zwei graue Tags, drei Buchstaben Unterschied.
    expect(MELDUNG_STATUS.neu.unbearbeitet).toBe(true);
    expect(AUFTRAG_STATUS.offen.unbearbeitet).toBe(true);
    expect(MELDUNG_STATUS.gesichtet.unbearbeitet).toBeUndefined();
    expect(MELDUNG_STATUS.gesichtet.phase).toBe('offen');

    // Und die Marke hängt NICHT an der Phase: Entwurf, offene Erinnerung und
    // angeforderte Nachforderung liegen ebenfalls auf `offen`. Eine fünfte
    // KommPhase hätte sie alle stillschweigend zu „neu" umklassifiziert — das ist
    // der Grund, warum der Träger ein Flag am Deskriptor ist.
    expect(BEFEHL_STATUS.entwurf.unbearbeitet).toBeUndefined();
    expect(LAGEBERICHT_STATUS.entwurf.unbearbeitet).toBeUndefined();
    expect(ERINNERUNG_STATUS.offen.unbearbeitet).toBeUndefined();
    expect(NACHFORDERUNG_STATUS.angefordert.unbearbeitet).toBeUndefined();
  });

  it('NACHFORDERUNG mappt abgelehnt auf die Ausnahme-Phase', () => {
    expect(NACHFORDERUNG_STATUS.angefordert).toEqual({ label: 'Angefordert', phase: 'offen' });
    expect(NACHFORDERUNG_STATUS.zugesagt).toEqual({ label: 'Zugesagt', phase: 'in_arbeit' });
    expect(NACHFORDERUNG_STATUS.unterwegs).toEqual({ label: 'Unterwegs', phase: 'in_arbeit' });
    expect(NACHFORDERUNG_STATUS.eingetroffen).toEqual({ label: 'Eingetroffen', phase: 'abgeschlossen' });
    expect(NACHFORDERUNG_STATUS.abgelehnt).toEqual({ label: 'Abgelehnt', phase: 'ausnahme' });
  });

  it('ERINNERUNG mappt offen/erledigt/quittiert', () => {
    expect(ERINNERUNG_STATUS.offen).toEqual({ label: 'Offen', phase: 'offen' });
    expect(ERINNERUNG_STATUS.erledigt).toEqual({ label: 'Erledigt', phase: 'abgeschlossen' });
    expect(ERINNERUNG_STATUS.quittiert).toEqual({ label: 'Quittiert', phase: 'abgeschlossen' });
  });

  it('BEFEHL/LAGEBERICHT mappen entwurf→offen, freigegeben→abgeschlossen', () => {
    expect(BEFEHL_STATUS.entwurf).toEqual({ label: 'Entwurf', phase: 'offen' });
    expect(BEFEHL_STATUS.freigegeben).toEqual({ label: 'Freigegeben', phase: 'abgeschlossen' });
    // Eine Achse, zwei Module: `BefehlStatus` und `LageberichtStatus` sind beide
    // 'entwurf' | 'freigegeben' (api/types.generated.ts). Zwei divergierende Maps wären
    // ein Fehler, den nur diese Zeile sieht.
    expect(LAGEBERICHT_STATUS).toEqual(BEFEHL_STATUS);
  });

  it('reproduziert die Bestandsfarben der beiden Listen', () => {
    // Vor LFH-330/B2 gaben BefehlListe und LageberichtePage `green` für freigegeben und
    // `default` sonst. Diese Zeilen pinnen „kein sichtbarer Farbwechsel gegen vorher"
    // gegen PHASE_META, statt es zu behaupten — es gibt keinen
    // Vollständigkeits-Guard über die Deskriptor-Menge.
    expect(PHASE_META[BEFEHL_STATUS.entwurf.phase].color).toBe('default');
    expect(PHASE_META[BEFEHL_STATUS.freigegeben.phase].color).toBe('success');
  });
});

describe('istAbgeschlossen', () => {
  it('ist true für abgeschlossen und ausnahme', () => {
    expect(istAbgeschlossen('abgeschlossen')).toBe(true);
    expect(istAbgeschlossen('ausnahme')).toBe(true);
  });
  it('ist false für offen und in_arbeit', () => {
    expect(istAbgeschlossen('offen')).toBe(false);
    expect(istAbgeschlossen('in_arbeit')).toBe(false);
  });
  it('deckt alle Phasen ab (kein vergessener Zweig)', () => {
    const alle: KommPhase[] = ['offen', 'in_arbeit', 'abgeschlossen', 'ausnahme'];
    expect(alle.filter(istAbgeschlossen)).toEqual(['abgeschlossen', 'ausnahme']);
  });
});
