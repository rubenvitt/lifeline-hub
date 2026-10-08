/**
 * Die Module der Anwendung, wie sie Modulmenü und Sprungpalette zeigen.
 *
 * KOPIE aus `frontend/src/einsatz/modulRegistry.ts` (Stand 08.10.2026): Name (`label`) und
 * zweite Zeile (`beschreibung`) wörtlich, Reihenfolge wie dort, nur Module mit Status
 * `fertig`, ohne „Einstellungen“. Ein neues oder umbenanntes Modul zieht hier nach
 * (website/AGENTS.md).
 */

export interface Modul {
  name: string;
  beschreibung: string;
}

export interface Bereich {
  name: string;
  module: Modul[];
}

export const bereiche: Bereich[] = [
  {
    name: 'Führung',
    module: [
      { name: 'Überblick', beschreibung: 'Kennzahlen, Fristen, Entscheidungen' },
      { name: 'Einsatzdaten', beschreibung: 'Bezeichnung, Stichwort, Zeiten, Leitung' },
      { name: 'Einsatzabschnitte', beschreibung: 'Abschnitte und ihre Einheiten' },
      { name: 'Aufträge/Befehle', beschreibung: 'Aufträge, Befehle, Quittungen' },
      { name: 'Stab', beschreibung: 'S1–S6, Lagebesprechung' },
      { name: 'Dokumente', beschreibung: 'Lagepläne, Formulare, Fotos' },
    ],
  },
  {
    name: 'Kräfte & Mittel',
    module: [
      { name: 'Meldebild', beschreibung: 'Status, Stärke, Gliederung' },
      { name: 'Einheiten', beschreibung: 'Führer, Mannschaft, Fahrzeug' },
      { name: 'Personal', beschreibung: 'Einsatzkräfte, Ad-hoc-Kräfte' },
      { name: 'Fahrzeuge', beschreibung: 'Disponierte Fahrzeuge' },
      { name: 'Material', beschreibung: 'Material, Verbrauchsgüter' },
      { name: 'Verpflegung', beschreibung: 'Portionen, Sonderkost, Ausgabe' },
      { name: 'Bereitstellungsräume', beschreibung: 'Bereitgestellte Einheiten und Fahrzeuge' },
      { name: 'Ablösung', beschreibung: 'Schichten, fällige Ablösungen' },
    ],
  },
  {
    name: 'Erfassung',
    module: [
      { name: 'ETB', beschreibung: 'Einsatztagebuch' },
      { name: 'Betroffene', beschreibung: 'Vermisste, Betroffene, Patienten' },
      { name: 'Unfallhilfsstellen', beschreibung: 'Behandlungsplätze, Belegung, Material' },
      { name: 'Betreuung', beschreibung: 'Evakuierung, Betreuungsstellen' },
      { name: 'Tiere', beschreibung: 'Betroffene Tiere' },
      { name: 'Schäden', beschreibung: 'Sach-, Infrastruktur-, Umweltschäden' },
    ],
  },
  {
    name: 'Lage',
    module: [
      { name: 'Lagebild', beschreibung: 'Lage in Zahlen, Meldungsstrom' },
      { name: 'Lagekarte', beschreibung: 'Einsatzort, Objekte, Gefahrengebiete' },
      { name: 'Lageberichte', beschreibung: 'Gegliederte Lageberichte' },
      { name: 'Gefahren', beschreibung: 'Gefahrenmatrix, Warnstufen' },
      { name: 'Wetter & Pegel', beschreibung: 'Pegel, DWD-Warnungen, Vorhersage' },
      { name: 'Lagemeldungen', beschreibung: 'An die Lage übergebene Meldungen' },
    ],
  },
  {
    name: 'Kommunikation',
    module: [
      { name: 'Chat', beschreibung: 'Nachrichten im Einsatz' },
      { name: 'Erinnerungen', beschreibung: 'Termine, Fristen' },
      { name: 'Meldungen (eingehend)', beschreibung: 'Eingang, Bearbeitung' },
      { name: 'Nachforderung', beschreibung: 'Kräfte und Mittel, Leitstelle' },
    ],
  },
];

export const modulAnzahl = bereiche.reduce((summe, b) => summe + b.module.length, 0);
