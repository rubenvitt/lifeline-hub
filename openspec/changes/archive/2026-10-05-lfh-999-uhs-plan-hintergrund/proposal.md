# Proposal

## Why

Das Platz-Layout einer Unfallhilfsstelle („Grundriss“ im Code) liegt auf einer leeren Fläche.
In einer Halle oder einem Zelt wissen Helfende dann nicht, wo „Platz 7“ steht: Der Plan des
Gebäudes liegt nur als Datei im Reiter „Dateien“ und lässt sich nicht unter die Plätze legen.

LFH-758 hat den Plan bewusst zum normalen UHS-Anhang gemacht, und jeder Abruf eines
UHS-Anhangs schreibt eine Zeile ins Lese-Audit. Ein Hintergrund, der bei jedem Öffnen des
Grundrisses lädt, würde das Protokoll mit Ansichts-Abrufen füllen. Dann sähe die
Einsatzleitung dort nicht mehr, wer eine Datei wirklich geöffnet hat.

## What Changes

- **Ein Plan je UHS mit eigenen Bytes.** Eine UHS kann genau einen Plan als Hintergrundbild
  tragen. Er liegt in einer eigenen Tabelle, wie die Bild-Hintergründe der Lagekarte, und ist
  kein Anhang. Seine Anzeige schreibt weder ein Lese-Audit noch einen ETB-Eintrag.
- **Zwei Wege zum Plan**, beide im Bearbeiten-Modus des Grundrisses:
  - **Bild hochladen:** PNG, JPEG oder WebP, höchstens 25 MiB. Der Virenscan läuft vor dem
    Speichern, und Metadaten wie GPS-Daten werden vor dem Speichern entfernt.
  - **Aus „Dateien“ übernehmen:** Ein Bild-Anhang dieser UHS wird als Plan kopiert. Die
    Übernahme ist ein Abruf der Datei und schreibt genau **eine** Zeile ins Lese-Audit. Danach
    sind Anhang und Plan unabhängig voneinander.
- **Nachweis im ETB:** „UHS BHP 50: Plan hinterlegt“ und „UHS BHP 50: Plan entfernt“, ohne
  Dateinamen. Ändern sich nur Lage oder Darstellung, entsteht kein Eintrag. Das gilt schon
  heute fürs Verschieben von Plätzen.
- **Lage zum Raster:** Der Plan hat einen Versatz und eine Breite in den Koordinaten der
  Platzfläche, die Höhe folgt aus dem Seitenverhältnis. „An Plätze einpassen“ legt den Plan
  über alle Plätze. Die Werte rasten auf 10 px ein, den Randabstand des Platzrasters.
- **Darstellung für den Nachtbetrieb:** Helligkeit und Kontrast sind einstellbar. Im dunklen
  Thema wird der Plan zusätzlich umgekehrt, sodass ein weißer Plan nicht blendet. Das lässt
  sich je Plan abschalten, etwa für ein Luftbild.
- **Plätze bleiben bedienbar:** Der Plan liegt unter allen Platzkarten und nimmt keine Klicks,
  Tipps oder Züge an. Die Platzkarten behalten ihren deckenden Grund, ihre Größe und die
  Bedienform der Dichtestufen 30, 48 und 72 px.
- **Rechte:** Setzen, Ändern und Entfernen braucht Schreibrecht auf das Modul
  Unfallhilfsstellen und die Erlaubnis, Plätze zu bearbeiten. Das UHS-Tablet sieht den Plan,
  ändert ihn aber nicht. Sehen darf ihn jeder mit Lesezugriff auf das Modul, auch
  Beobachter und an einer stornierten UHS. Eine stornierte UHS lehnt Schreiben mit 409 ab.
- **Schwärzung** löscht den Plan samt Bytes. Das Platz-Layout bleibt stehen.

## Capabilities

### New Capabilities
- `uhs-plan`: Ein Plan als Hintergrundbild unter dem Platz-Layout einer UHS: hinterlegen
  (Upload oder Übernahme aus den UHS-Anhängen), Lage und Darstellung, Anzeige ohne Lese-Audit,
  Rechte und Schwärzung.

### Modified Capabilities
<!-- keine: `uhs-grundriss` (Bedienform der Platzkarte) und `uhs-anhaenge` (Lese-Audit je
     Abruf) gelten unverändert; die Übernahme ist ein Abruf im Sinne von `uhs-anhaenge`. -->

## Impact

- **Backend:** neue Migration (Tabelle `uhs_plan`), neues Modul `src/uhs/plan.rs` mit Repo,
  Routendatei `src/routes/uhs_plan.rs`, Router-Block in `src/app.rs`. Dazu kommen Feld `plan`
  am DTO `UhsDetail` und Typ-Codegen, die Schwärzungsregel sowie die Einträge in den
  Routenlisten der Geräteansichten (`src/geraet/mod.rs`).
- **Frontend:** `pages/uhs/Grundriss.tsx` (Bildebene, Flächengröße), neues Bedienfeld „Plan“
  im Bearbeiten-Modus, `api/einsatzUhs.ts`.
- **Keine** Änderung an UHS-Anhängen, am Lese-Audit, an der Lagekarte und am Platzraster des
  Servers.
