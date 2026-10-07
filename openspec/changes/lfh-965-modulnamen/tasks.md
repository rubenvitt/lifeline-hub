## 1. Registry

- [ ] 1.1 `modulName(key)` mit Vitest; Labels „Lagebild“ und „Betroffene“
- [ ] 1.2 Beschreibungen kürzen (Anhang), JSDoc neu, Wächter-Eintrag `einsatz/modulRegistry.ts` entfernen
- [ ] 1.3 Lagemeldungen mit `IconPapierflieger`

## 2. Seitentitel

- [ ] 2.1 Alle Registry-Seiten setzen `titel` und letzten Pfadeintrag über `modulName`
- [ ] 2.2 ETB, Lagebild (Zeit in `meta`), Gefahren, Lagemeldungen, Nachforderung folgen dem Menü
- [ ] 2.3 Tests an die neuen Wörter anpassen (nur wo der Modulname gemeint ist)

## 3. Beschreibung sichtbar

- [ ] 3.1 `ModulListe`: zweite Zeile, `title`, `aria-describedby`, mit Vitest
- [ ] 3.2 Sprungpalette: `nebenzeile` am `Befehl`, Modulbefehle setzen sie, `optionsZeile` zeigt sie, mit Vitest

## 4. Lagemeldungen leer

- [ ] 4.1 `SeitenLeer` mit „Zu den Meldungen“ auf `meldungenPfad`, ohne Hinweis, mit Vitest

## 5. Nachweis und Abschluss

- [ ] 5.1 Vitest: `EinsatzAllgemein`-Platzhalter folgt `redirectZiel()` (Überblick fertig und nicht)
- [ ] 5.2 e2e: `orientierung.spec.ts` prüft h1 = Label je Modul; `modulnamen.spec.ts` Drawer 390/820 als Beobachter, Palette
- [ ] 5.3 Regel in `frontend/AGENTS.md`, Modulstruktur
- [ ] 5.4 Gates: tsc, Lint, Prettier, Vitest komplett, `check-all.sh --nur schnell`, betroffene e2e

## Anhang: Beschreibungen

| Modul | heute | neu |
|---|---|---|
| Überblick | Führungsüberblick des Einsatzes — Startseite des Einsatz-Workspace. | Kennzahlen, Fristen, Entscheidungen |
| Einsatzdaten | Stammdaten des Einsatzes: Bezeichnung, Stichwort, Zeiten, Leitung. | Bezeichnung, Stichwort, Zeiten, Leitung |
| Einsatzabschnitte | Gliederung des Einsatzes in Abschnitte und Zuordnung von Einheiten. | Abschnitte und ihre Einheiten |
| Aufträge/Befehle | Aufträge und Befehle mit Quittierung. | Aufträge, Befehle, Quittungen |
| Stab | Führungsorganisation (S1–S6) und Lagebesprechungen der Einsatzleitung | S1–S6, Lagebesprechung |
| Dokumente | Abgelegte Dateien des Einsatzes: Lagepläne, Befehle, Formulare, Fotos. | Lagepläne, Formulare, Fotos |
| Meldebild | Meldebild der eingesetzten Kräfte: Status, Stärke und Gliederung. | Status, Stärke, Gliederung |
| Einheiten | Taktische Einheiten: Führer, Mannschaft, Fahrzeug, Abschnittszuordnung. | Führer, Mannschaft, Fahrzeug |
| Personal | Im Einsatz aktive Personen aus dem Stammdaten-Pool plus Ad-hoc-Kräfte. | Einsatzkräfte, Ad-hoc-Kräfte |
| Fahrzeuge | Disponierte Fahrzeuge des Einsatzes. | Disponierte Fahrzeuge |
| Material | Material und Verbrauchsgüter im Einsatz. | Material, Verbrauchsgüter |
| Verpflegung | Zeitfenster mit Bedarf und Ausgabe von Essensportionen, Sonderkost, Unterdeckung. | Portionen, Sonderkost, Ausgabe |
| Bereitstellungsräume | Bereitstellungsräume: bereitgestellte Einheiten und Fahrzeuge. | Bereitgestellte Einheiten und Fahrzeuge |
| Ablösung | Schichten der Einheiten: Rhythmus, fällige Ablösungen, Vollzug. | Schichten, fällige Ablösungen |
| ETB | Einsatztagebuch. | Einsatztagebuch |
| Betroffene | Ein Personenstamm mit Status-Lebenszyklus (vermisst → betroffen → Patient → verstorben). | Vermisste, Betroffene, Patienten |
| Unfallhilfsstellen | Behandlungs-/Sammelstellen als Örtlichkeiten mit Plätzen, Belegung und Material. | Behandlungsplätze, Belegung, Material |
| Betreuung | Evakuierungsbezirke mit Stand „evakuiert“ und Betreuungsstellen mit Belegung. | Evakuierung, Betreuungsstellen |
| Tiere | Betroffene Tiere, getrennt vom Personenstamm. | Betroffene Tiere |
| Schäden | Sach-/Infrastruktur-/Umweltschäden mit Bearbeitungs-Workflow. | Sach-, Infrastruktur-, Umweltschäden |
| Lagebild | Verdichtete Lageübersicht des Einsatzes. | Lage in Zahlen, Meldungsstrom |
| Lagekarte | Karte der verortbaren Objekte: Einsatzort, Unfallhilfsstellen, Schäden — verorten per Klick. | Einsatzort, Objekte, Gefahrengebiete |
| Lageberichte | Strukturierte Lageberichte. | Gegliederte Lageberichte |
| Gefahren | Gefahrenmatrix (Gefahrentyp × Schutzobjekt → Warnstufe) und Verknüpfung der Gefahrengebiete. | Gefahrenmatrix, Warnstufen |
| Wetter & Pegel | Maßgebliche Pegel mit 24-h-Verlauf, DWD-Warnungen und Vorhersage für den Einsatzort. | Pegel, DWD-Warnungen, Vorhersage |
| Lagemeldungen | Lagerelevante Meldungen, die an die Lage übergeben wurden. | An die Lage übergebene Meldungen |
| Chat | Einsatzinterner Chat (pro Einsatz, nicht einsatzübergreifend). | Nachrichten im Einsatz |
| Erinnerungen | Terminierte Erinnerungen. | Termine, Fristen |
| Meldungen (eingehend) | Eingehende Meldungen zur Bearbeitung. | Eingang, Bearbeitung |
| Nachforderung | Nachforderung von Kräften/Mitteln bei Leitstelle/Nachbar-EA/übergeordneter Führung mit Status-Workflow. | Kräfte und Mittel, Leitstelle |
| Einstellungen | Einsatzbezogene Einstellungen. | Module, Darstellung, Einstieg |
