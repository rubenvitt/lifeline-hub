# Design LFH-965

## D1 Ein Name je Modul

- Quelle ist `label` in `einsatz/modulRegistry.ts`. Neu: `modulName(key: ModulKey): string`.
- Umbenannt werden zwei Labels: `lage-dashboard` „Dashboard“ → „Lagebild“, `personen`
  „Personen“ → „Betroffene“. Schlüssel und Routen bleiben.
- Jede Seite eines Registry-Moduls setzt `titel={modulName(…)}` und den letzten Pfadeintrag
  ebenso. Das betrifft die rund 30 Seiten mit `EinsatzSeite` und die Lagekarte. Die Strings
  sind fast überall schon gleich, der Umbau macht die Regel prüfbar statt zufällig.
- h1-Änderungen: ETB „Einsatztagebuch“ → „ETB“; Lagebild „Lagebild 01.10. 23:30“ → „Lagebild“,
  die Zeit steht in `meta`; Pfad „Lage-Dashboard“ → „Lagebild“; Gefahren „Gefahrenmatrix“ →
  „Gefahren“; Lagemeldungen „Lagerelevante Meldungen“ → „Lagemeldungen“; Nachforderung
  „Nachforderung Kräfte/Mittel“ → „Nachforderung“. Betroffene hat das h1 schon.
- Ausnahmen, die bleiben: Detailseiten tragen den Namen des Datensatzes („Person 12“, UHS- und
  BR-Name), ihr Pfad nennt das Modul. Das Dashboard-Paneel „Gefahrenmatrix“ und der Knopf
  „Gefahrenmatrix bearbeiten“ meinen die Matrix selbst, nicht das Modul. Die Region der
  Zeitachse behält den zugänglichen Namen „Einsatztagebuch“ (Langform für Vorlesehilfen).
- Meldebild: `label` und h1 sind schon „Meldebild“; die Ausnahme ist nur der Schlüssel
  `kraefteuebersicht`.
- Sprungmarken heißen „Patienten, springt zu Betroffene“: der Zielname kommt aus dem Label.

## D2 Beschreibungen

- JSDoc: „Kurzbeschreibung aus wenigen Fachwörtern; zweite Zeile im Modulmenü und in der
  Sprungpalette. Kein Satz, keine Bedienung, keine Technik.“
- Die 31 Texte werden gekürzt (Liste in `tasks.md`, Anhang). Beispiel: „Ein Personenstamm mit
  Status-Lebenszyklus (vermisst → betroffen → Patient → verstorben)“ → „Vermisste, Betroffene,
  Patienten“. ETB → „Einsatztagebuch“. Der Erklärtext-Wächter verliert damit den Eintrag
  `einsatz/modulRegistry.ts` („verorten per Klick“).
- `ModulListe` (Panel ab `lg`, Drawer darunter): Name und Beschreibung untereinander in der
  Spalte, die heute den Namen trägt. Die Beschreibung 12 px gedämpft, eine Zeile, Auslassung,
  voller Wortlaut im `title`. Zähler und Symbole rechts bleiben mittig. Die Zeile bleibt in jeder
  Stufe ≥ `controlHeight` und wächst in `kompakt` um die zweite Zeile.
- Sprungpalette: `Befehl` bekommt `nebenzeile?: string` (DARSTELLUNG wie `kontext`). Modulbefehle
  setzen sie aus der Beschreibung; `optionsZeile` stellt sie unter den Namen und hängt sie an
  `aria-describedby`. Die Beschreibung bleibt zusätzlich Schlagwort.
- Der zugängliche Name der Menüzeile bleibt der Modulname (plus Zähler); die Beschreibung kommt
  über `aria-describedby`, damit „Klick auf ETB“ in Tests und Vorlesehilfen gleich bleibt.

## D3 Leerer Lagemeldungen-Zustand

- `SeitenLeer titel="Noch keine Lagemeldungen" aktion={{ label: 'Zu den Meldungen', pfad:
  meldungenPfad(einsatzId) }}`, ohne `hinweis`. Der bisherige Kommentar („ein Knopf führte zur
  Voraussetzung“) wird ersetzt: die Regel aus LFH-1078 will im Leerzustand einen Weg statt einer
  Anleitung, und der Weg zur Lagemeldung beginnt bei den Meldungen.
- Das Typwort „LAGE“ im ETB bleibt; mit dem eindeutigen h1 „Lagemeldungen“ und dem Weg aus dem
  Leerzustand braucht es keinen Zusatzsatz.

## D4 Symbol

- Lagemeldungen: `IconPapierflieger` (übergeben) statt `IconPosteingang`; „Meldungen
  (eingehend)“ behält den Posteingang.

## D5 Nachweis

- e2e `orientierung.spec.ts` besucht schon jedes Modul der Registry: dort zusätzlich h1 = Label
  (Ausnahme: Direkteinstieg-Module, die auf einen Datensatz springen). Das ersetzt den im Ticket
  genannten Vitest über alle Seiten, der 31 Seiten mit ihren Abfragen in jsdom nachbauen müsste.
- e2e `modulnamen.spec.ts`: Drawer bei 390 und 820 px als Beobachter, Kategorie per Klick öffnen,
  Beschreibung sichtbar, kein waagrechter Überlauf; Sprungpalette zeigt die Beschreibung unter
  dem Modul.
- Vitest: `modulName`, `ModulListe` und Palette rendern die Beschreibung, Lagemeldungen-Leerzustand
  verlinkt `meldungenPfad`, `EinsatzAllgemein`-Platzhalter folgt `redirectZiel()` (Überblick
  fertig und nicht fertig).

## Risiken

- Viele Tests suchen „Einsatztagebuch“, „Personen“ oder „Dashboard“ (rund 70 Zeilen). Nicht jede
  Stelle ist ein Modulname; angepasst wird nur, was den Namen meint.
- Höhere Menüzeilen in `kompakt`: das Panel wird länger. Gemessen wird bei 1366 × 768, ob die
  Kategorie mit den meisten Modulen (Kräfte, 8) noch ohne Rollen passt.
