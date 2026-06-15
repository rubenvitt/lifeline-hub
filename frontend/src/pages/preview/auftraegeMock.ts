import type { Auftrag, AuftragEmpfaenger } from '../../api/types';

/** Realistische, bewusst „unordentliche" Mock-Aufträge für die Design-Vorschau
 *  (langer Text, viele Empfänger, überfällige Sofort-Sache, alle Phasen). */

let empfId = 1;
function emp(snap: string, quittiert: boolean): AuftragEmpfaenger {
  return {
    id: empfId++, auftrag_id: 0, empfaenger_typ: 'einheit',
    abschnitt_id: null, einheit_id: 1, person_id: null, fahrzeug_id: null,
    funktion_text: null, extern_kategorie: null, extern_bezeichnung: null,
    snap_anzeige: snap, quittiert_at: quittiert ? '2026-06-16 09:12:00' : null,
    quittiert_von_id: quittiert ? 2 : null,
  };
}

let id = 1;
function bau(a: Partial<Auftrag> & { auftrag_text: string; bearbeitungsstatus: Auftrag['bearbeitungsstatus'] }): Auftrag {
  return {
    id: id++, einsatz_id: 1,
    absicht: null, lage: null, ort: null, zeit: null, mittel: null, verbindung: null, sicherheit: null,
    prioritaet: 'normal', richtung: 'intern', frist_at: null, erteilt_at: '2026-06-16 08:00:00',
    in_arbeit_at: null, vollzugsmeldung: null, abgenommen_at: null, abgenommen_von_id: null,
    etb_anordnung_id: 101, erstellt_von_id: 1, erstellt_at: '2026-06-16 08:00:00',
    vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
    empfaenger_anzahl: 0, quittiert_anzahl: 0, ist_ueberfaellig: false,
    quell_etb_eintrag_id: null, empfaenger: [], ...a,
  };
}

export const MOCK_AUFTRAEGE: Auftrag[] = [
  bau({
    auftrag_text: 'Menschenrettung 2. OG Rückgebäude — Drehleiter in Stellung bringen, Atemschutz-Trupp vor, Riegelstellung zur Nachbarbebauung halten und laufend Lage an die EL melden.',
    absicht: 'Verhindern, dass das Feuer auf das Nachbargebäude übergreift; eingeschlossene Personen aus dem 2. OG retten.',
    ort: 'Hauptstraße 14, Rückgebäude', zeit: 'sofort', mittel: 'DLK 23, 2 AGT-Trupps',
    verbindung: 'Kanal 2 / Florian 1', sicherheit: 'Einsturzgefahr Treppenhaus',
    prioritaet: 'sofort', frist_at: '2026-06-16 09:30:00', ist_ueberfaellig: true,
    bearbeitungsstatus: 'offen', vollzug_status: 'offen',
    empfaenger_anzahl: 6, quittiert_anzahl: 2,
    empfaenger: [
      emp('1. Zug / LZ Mitte', true), emp('LF 20/1', true), emp('DLK 23/1', false),
      emp('RTW 1', false), emp('Funktion: Sicherheitstrupp', false), emp('ELW 1', false),
    ],
  }),
  bau({
    auftrag_text: 'Wasserversorgung über offenes Gewässer aufbauen (B-Leitung Saugstelle Mühlbach → Verteiler EA Nord).',
    prioritaet: 'dringend', frist_at: '2026-06-16 11:00:00', in_arbeit_at: '2026-06-16 09:05:00',
    bearbeitungsstatus: 'in_arbeit', vollzug_status: 'in_arbeit',
    empfaenger_anzahl: 2, quittiert_anzahl: 2,
    empfaenger: [emp('2. Zug / LZ Süd', true), emp('TLF 16/25', true)],
  }),
  bau({
    auftrag_text: 'Abschnitt Verkehrsabsicherung B27 übernehmen, Umleitung einrichten.',
    richtung: 'extern', prioritaet: 'normal', bearbeitungsstatus: 'in_arbeit', vollzug_status: 'in_arbeit',
    empfaenger_anzahl: 1, quittiert_anzahl: 0,
    empfaenger: [emp('Polizei (extern: Leitstelle)', false)],
  }),
  bau({
    auftrag_text: 'Erkundung Gefahrgut-Austritt Halle 3 durch Messtrupp, Stoffidentifikation melden.',
    prioritaet: 'dringend', bearbeitungsstatus: 'vollzogen', vollzug_status: 'vollzogen',
    vollzogen_at: '2026-06-16 09:40:00', vollzugsmeldung: 'Stoff identifiziert: Salzsäure 30 %, kein Personenschaden. Bereich abgesperrt.',
    frist_at: '2026-06-16 10:00:00', quell_etb_eintrag_id: 88,
    empfaenger_anzahl: 1, quittiert_anzahl: 1, empfaenger: [emp('Messtrupp GW-Mess', true)],
  }),
  bau({
    auftrag_text: 'Bereitstellungsraum am Festplatz einrichten und Kräfte-Sammelstelle betreiben.',
    prioritaet: 'normal', bearbeitungsstatus: 'abgenommen', vollzug_status: 'vollzogen',
    vollzogen_at: '2026-06-16 08:50:00', abgenommen_at: '2026-06-16 09:02:00', abgenommen_von_id: 1,
    vollzugsmeldung: 'BR-Raum steht, 4 Einheiten gesammelt.',
    empfaenger_anzahl: 2, quittiert_anzahl: 2, empfaenger: [emp('Abschnitt Logistik', true), emp('GW-L2', true)],
  }),
];

export const MOCK_ABSCHNITTE = [
  { id: 1, name: 'EA Nord' }, { id: 2, name: 'EA Süd' }, { id: 3, name: 'Abschnitt Logistik' },
];
export const MOCK_EINHEITEN = [
  { id: 1, name: 'LZ Mitte' }, { id: 2, name: 'LZ Süd' }, { id: 3, name: 'GW-Mess' },
];
