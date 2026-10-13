import type { Auftrag, AuftragEmpfaenger } from '../api/types';

/** Testdaten der Auftragsdruck-Tests (Change `ianaw5k1-auftrag-drucken`); nur für Tests. */

export const druckEmpfaenger = (
  id: number,
  name: string,
  quittiert_at: string | null,
  over: Partial<AuftragEmpfaenger> = {},
): AuftragEmpfaenger =>
  ({
    id,
    auftrag_id: 31,
    empfaenger_typ: 'abschnitt',
    abschnitt_id: id,
    snap_anzeige: name,
    quittiert_at,
    quittiert_von_id: quittiert_at ? 1 : null,
    ...over,
  }) as AuftragEmpfaenger;

/** Interner Auftrag #4 an zwei Empfänger, „Dringend“, ohne Frist, mit Mittel, Weg und Absicht. */
export const druckAuftrag = (over: Partial<Auftrag> = {}): Auftrag =>
  ({
    id: 31,
    einsatz_id: 5,
    lfd_nr: 4,
    auftrag_text: 'Wasserversorgung von Hydrant H12 aufbauen',
    absicht: 'Löschwasser für Abschnitt 2',
    lage: null,
    ort: null,
    zeit: null,
    weg: 'über B 3, Abfahrt Nord',
    mittel: '2× B-Schlauch',
    verbindung: null,
    sicherheit: null,
    prioritaet: 'dringend',
    richtung: 'intern',
    frist_at: null,
    erteilt_at: '2026-06-11 08:13:00',
    in_arbeit_at: null,
    vollzugsmeldung: null,
    abgenommen_at: null,
    abgenommen_von_id: null,
    aufgehoben_at: null,
    aufgehoben_von_name: null,
    aufhebungsgrund: null,
    etb_anordnung_id: 5,
    quell_etb_eintrag_id: null,
    erstellt_von_id: 1,
    erstellt_at: '2026-06-11 08:14:00',
    vollzug_status: 'offen',
    vollzogen_at: null,
    vollzogen_von_id: null,
    empfaenger_anzahl: 2,
    quittiert_anzahl: 1,
    ist_ueberfaellig: false,
    bearbeitungsstatus: 'offen',
    berichtigbar: false,
    empfaenger: [
      druckEmpfaenger(1, '2. Zug', '2026-06-11 08:15:00'),
      druckEmpfaenger(2, 'Logistiktrupp', null),
    ],
    ...over,
  }) as Auftrag;
