/**
 * Die Module der Anwendung, wie sie Modulmenü und Sprungpalette zeigen.
 *
 * KOPIE aus `frontend/src/einsatz/modulRegistry.ts`: Bereich (`Kategorie.label`), Name
 * (`label`) und zweite Zeile (`beschreibung`) wörtlich, Reihenfolge wie dort, nur Module mit
 * Status `fertig`, ohne die Kategorie „Einstellungen“ am Fuß der Rail. Ein neues oder
 * umbenanntes Modul zieht hier nach (website/AGENTS.md); der Wächter
 * `frontend/src/einsatz/websiteModule.guard.test.ts` schlägt an, sobald beide auseinanderlaufen.
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
      { name: 'Lagebesprechung', beschreibung: 'Termin, Vorbereitung, Entschluss' },
      { name: 'Stab', beschreibung: 'S1–S6, Besetzung' },
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
      { name: 'Nachforderungen', beschreibung: 'Anforderung, Zusage, Eintreffen' },
      { name: 'Ablösung', beschreibung: 'Schichten, fällige Ablösungen' },
    ],
  },
  {
    name: 'Erfassung',
    module: [
      { name: 'ETB', beschreibung: 'Einsatztagebuch' },
      { name: 'Betroffene', beschreibung: 'Vermisste, Betroffene, Patienten' },
      { name: 'Unfallhilfsstellen', beschreibung: 'Behandlungsplätze, Belegung, Material' },
      { name: 'Evakuierung', beschreibung: 'Räumungsbezirke, Stand evakuiert' },
      { name: 'Betreuung', beschreibung: 'Betreuungsstellen, Unterbringung' },
      { name: 'Tiere', beschreibung: 'Betroffene Tiere' },
      { name: 'Schäden', beschreibung: 'Sach-, Infrastruktur-, Umweltschäden' },
    ],
  },
  {
    name: 'Lage',
    module: [
      { name: 'Lagebild', beschreibung: 'Lage in Zahlen, jüngste ETB-Einträge' },
      { name: 'Lagekarte', beschreibung: 'Einsatzort, Objekte, Gefahrengebiete' },
      { name: 'Lageberichte', beschreibung: 'Gegliederte Lageberichte' },
      { name: 'Gefahren', beschreibung: 'Gefahrenmatrix, Warnstufen' },
      { name: 'Wetter & Pegel', beschreibung: 'Pegel, DWD-Warnungen, Vorhersage' },
      { name: 'Lagemeldungen', beschreibung: 'Lagerelevante Meldungen' },
    ],
  },
  {
    name: 'Kommunikation',
    module: [
      { name: 'Chat', beschreibung: 'Nachrichten im Einsatz' },
      { name: 'Erinnerungen', beschreibung: 'Termine, Fristen' },
      { name: 'Meldungen', beschreibung: 'Eingang, Ausgang, Bearbeitung' },
      { name: 'Fernmeldewesen', beschreibung: 'Funkplan, Skizze, Kommunikationsplan' },
    ],
  },
];

export const modulAnzahl = bereiche.reduce((summe, b) => summe + b.module.length, 0);
