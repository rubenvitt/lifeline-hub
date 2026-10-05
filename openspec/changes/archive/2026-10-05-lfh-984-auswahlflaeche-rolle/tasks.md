# Tasks

## 1. Rolle `auswahlFlaeche` und globales Token (gerechnet)

- [x] 1.1 `frontend/src/theme/auswahlKontrast.test.ts` anlegen (Muster `hinweisKontrast.test.ts`/`bedienKontrast.test.ts`, Böden als Literale, `kontrast`/`lab` aus `test/farbmass`). Je Modus mit dem AUFGELÖSTEN Token (`theme.getDesignToken` mit `antdToken(farben)` und `antdAlgorithmus(dunkel)`): `controlItemBgActive` und `controlItemBgActiveHover` sind wertgleich mit `farben.auswahlFlaeche`; `text`, `text2`, `gedaempft`, `schwach`, `bedienText` darauf ≥ 7 (Tag) bzw. ≥ 5 (Nacht); `steuerRahmen` ≥ 3; ΔE ≥ 7 gegen `flaeche2` und `flaeche` in Ruhe und mit der Zeigerspur `controlItemBgHover` darüber (Alpha gegen den Grund gemischt) (design.md E1, E3). Prüfen: Der Test läuft vor 1.2 ROT (Rolle fehlt, Tag `#b9c1c4`)
- [x] 1.2 Rolle `auswahlFlaeche` in `Farbrollen` (Doku-Kommentar: Fläche einer gewählten Option, eines gewählten Eintrags oder Knotens), Tag `#dbe7f5`, Nacht `#08172b`; `rollen.css` `--lfh-auswahl-flaeche` in beiden Blöcken, Zuordnung in `rollen.guard.test.ts`. `antdToken` setzt `colorPrimaryBg` und `colorPrimaryBgHover` auf die Rolle, mit Begründung am Wert (antds Ableitung, Messwerte, E3). Kontrast-Kommentare über `farbenHell`/`farbenDunkel` fortschreiben. Die Zusicherung in `statusFarben.test.ts`, `colorPrimaryBg` bleibe antds Ableitung, auf `colorBgBase` allein zurückführen. Prüfen: 1.1 grün; `tokens.test.ts`, `rollen.guard.test.ts`, `gate5.guard.test.ts`, `statusFarben.test.ts`, `statusVertrag.guard.test.ts`, `cssFarbquelle.guard.test.ts`, `bedienKontrast.test.ts`, `hinweisKontrast.test.ts` grün

- [x] 1.3 Fokus-Halo (design.md E5, Befund aus dem Review): `auswahlKontrast.test.ts` sichert zu, dass `controlOutline` aufgelöst `bedien` mit Deckkraft 0,25 ist; `antdToken` setzt es ausdrücklich. Dazu prüft der Test `colorPrimaryBg`/`colorPrimaryBgHover` selbst, nicht nur die Aliase. Prüfen: Test vor der Änderung ROT (Tag `rgba(15,95,188,0.15)`, Nacht `rgba(0,29,69,0.46)`), danach grün; `fokusring-kontrast.spec.ts` grün

## 2. Schrift des gewählten Dropdown-Eintrags (gerechnet)

- [x] 2.1 In `auswahlKontrast.test.ts`: `antdKomponenten(farben, 'kompakt').Dropdown.colorPrimary` gegen `auswahlFlaeche` ≥ 7 (Tag) bzw. ≥ 5 (Nacht); fehlt das Token, ist das ein Befund, kein Rückfall auf `bedien` (design.md E2). Prüfen: Test vor 2.2 ROT (`Komponenten-Token colorPrimary fehlt`)
- [x] 2.2 `antdKomponenten`: `Dropdown.colorPrimary = farben.bedienText`, Kommentar am `Dropdown` fortschreiben (gewählter Eintrag und gewähltes Untermenü sind Text; Verweis auf LFH-984). Prüfen: 2.1 grün, `gefahrKontrast.test.ts` grün

## 3. Eigene Leser der Fläche

- [x] 3.1 Die Kommentare an den eigenen Lesern auf die Rolle umstellen: `pages/gefahren/GefahrenPage.tsx` (der Kommentar „leitet antd … ab — hält in beiden Modi“ ist falsch geworden), `pages/lagekarte/Sidebar.tsx`, `pages/uhs/Grundriss.tsx` (Drop-Ziel), `etb/SlashMenu.tsx`. Sie lesen weiter das Token, keine eigene Farbe. Prüfen: `grep -rn "colorPrimaryBg\|controlItemBgActive" frontend/src --include=*.tsx` zeigt nur Token-Leser, keine Literale; betroffene Unit-Tests der vier Dateien grün

## 4. Browser-Nachweis

- [x] 4.1 `frontend/e2e/auswahl-kontrast.spec.ts`, Tag und Nacht, mit `kontrast-kern.ts`: Statuswahl öffnen (eine Stelle mit `StatusWahl`, z. B. Auftrag oder Einheit aus den Seed-Daten), die Schrift des gewählten Eintrags gegen seine Fläche messen, in Ruhe und unter dem Zeiger (Tag ≥ 7, Nacht ≥ 5), dazu die Zusicherung, dass der Grund die Farbe von `auswahlFlaeche` des Modus hat (als Literal im Spec, kein Import aus dem Produkt). Prüfen: Spec grün in light und dark. Mutationsprobe: `colorPrimaryBg` aus `antdToken` entfernt → Messung rot
  **Ergebnis:** grün in light und dark (Chromium). Mutationsprobe `colorPrimaryBg`/`colorPrimaryBgHover` entfernt: rot, Statuswahl am Tag 5,20 gegen antds `#b9c1c4`, in allen vier Fällen fällt die Flächenzusicherung
- [x] 4.2 Im selben Spec eine Auswahlliste (`Select`) mit gewählter Option öffnen und deren Schrift gegen die Fläche messen, Tag und Nacht. Prüfen: Spec grün. Mutationsprobe: `Dropdown.colorPrimary` entfernt → Statuswahl am Tag rot (6,83)
  **Ergebnis:** gemessen an „Realeinsatz“ ruhend (Zeiger auf „Übung“) und aktiv der Einsatzart im Dialog „Neuer Einsatz“, grün in light und dark. Mutationsprobe `Dropdown.colorPrimary` entfernt: genau die Statuswahl am Tag rot, 6,83. Nach dem Review sichert der Spec Ruhe und Zeiger als Vorbedingung zu; Mutationsprobe nur `colorPrimaryBgHover` entfernt: alle vier Zeigermessungen rot (Statuswahl Tag 3,97, Nacht 4,60)

## 5. Regel und Gesamtlauf

- [x] 5.1 `frontend/AGENTS.md`, Farbachsen: neuer Eintrag nach „Hinweisflächen sind Statusflächen“. Die Auswahlfläche (gewählte Option, Eintrag, Knoten) ist die Rolle `auswahlFlaeche`, global über `colorPrimaryBg`/`colorPrimaryBgHover` in `antdToken` (LFH-984, Spec `farbrollen-kontrast`), nie je Stelle; der gewählte Dropdown-Eintrag schreibt in `bedienText`. Nachweis `theme/auswahlKontrast.test.ts`, `e2e/auswahl-kontrast.spec.ts`. Prüfen: Prettier über `frontend/` grün
- [x] 5.2 Übrige Kontrast-Specs gegen die neuen Tokens laufen lassen (`hinweis-`, `hellmodus-`, `gefahr-`, `primaerknopf-`, `fokusring-`, `betroffene-kontrast.spec.ts`). Prüfen: Specs grün (Chromium)
  **Ergebnis:** 29 Tests grün (Auswahl, Hinweis, Hellmodus, Gefahr, Primärknopf, Fokusring, Betroffene; Chromium)
- [x] 5.3 `./scripts/check-all.sh` grün (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt). Prüfen: Ausgabe ohne roten Schritt
  **Ergebnis lokal (Cloud-Sitzung, mise nachinstalliert):** Bündel `frontend`: 719 von 720 Dateien grün, 10 373 Tests; rot waren nur die zwei Halo-Fälle aus 1.3, deren Test während des Laufs vor der Umsetzung entstand (TDD-Rotphase). Nachlauf der Theme- und Seitentests danach grün (37 Dateien, 913 Tests). Bündel `schnell` nach dem Archiv, Bündel `rust` nicht gefahren (kein Backend-Code berührt), e2e lokal die Kontrast-Specs (Chromium). Voller Lauf: CI des PRs
