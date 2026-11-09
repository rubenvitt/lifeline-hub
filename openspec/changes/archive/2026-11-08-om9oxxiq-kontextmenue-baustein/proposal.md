## Why

Rechtsklick öffnet in Lifeline Hub fast überall das Browsermenü. Ein eigenes Kontextmenü haben nur
die Lagekarte (LFH-776) und die Fernmeldeskizze. Wer am Fükw-Rechner mit der Maus arbeitet, sucht
die Aktionen einer Zeile deshalb am ⋮-Knopf, statt sie dort zu öffnen, wo der Zeiger schon steht.
Ruben wünscht ein Kontextmenü in der ganzen App (LLH-1590, 08.11.2026). Diese Change legt den
gemeinsamen Baustein und bindet die `Datensicht` und die Skizze an. Die übrigen Stellen folgen in
LLH-1597 bis LLH-1601.

Zunder: https://zunder.rubeen.dev/#/aufgabe/om9oxxiqya03cqfo3ytdpoq0 (LLH-1596, Eltern LLH-1590)

## What Changes

- **Kontextmenü eines Datensatzes:** Rechtsklick, langer Druck (Touch) und die Tasten
  Kontextmenü bzw. Umschalt+F10 öffnen ein Menü mit den Aktionen des Datensatzes. Darin steht
  oben die sichtbare Primäraktion, danach die Einträge des ⋮-Menüs, Unumkehrbares rot hinter einem
  Trenner. Die Einträge kommen aus derselben Quelle wie das ⋮-Menü, es gibt keine zweite Liste
  (abgestimmt mit Ruben am 08.11.2026).
- **Das Browsermenü bleibt**, wo es gebraucht wird: auf einem Link, in einem Eingabefeld, auf
  markiertem Text und an Datensätzen ohne Aktion.
- **Gemeinsamer Baustein** in `frontend/src/components/`: die Auslöse-Mechanik (Rechtsklick,
  langer Druck mit Bewegungsschwelle, Tasten), der Riegel gegen die Nachklicks nach einem langen
  Druck (bisher nur Lagekarte) und die Menü-Schale am Punkt (bisher `PunktankerMenue` der
  Lagekarte). Mit dem Baustein entsteht ein Wächter, der weitere eigene `onContextMenu`-Mechaniken
  verhindert.
- **`Datensicht`:** Zeilen im Tabellenzweig und Karten im Kartenzweig bekommen das Kontextmenü aus
  `karte.aktion` und `karte.weitere`. Das trifft heute Material, Fahrzeuge, Personen, Dokumente,
  Presse und Zugangsprotokoll.
- **Fernmeldeskizze:** Langer Druck und Tastenauslöser kommen aus dem Baustein statt aus eigenem
  Code. Einträge und Verhalten der Skizze bleiben gleich. Die Lagekarte bleibt beim
  maplibre-Ereignis `contextmenu` und nutzt nur den verschobenen Riegel.
- **Nicht in dieser Change:** ETB-Zeitachse und Meta-Chips (LLH-1597), Chat und Karten mit
  eigenem ⋮-Menü (LLH-1598), Tabellen außerhalb der `Datensicht` (LLH-1599), Schichtplan-Raster
  (LLH-1600), Gliederung (LLH-1601), Detailköpfe (bewusst ohne Kontextmenü).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `datensatz-aktionsmenue`: Die gebündelten Aktionen eines Datensatzes sind zusätzlich über ein
  Kontextmenü erreichbar (Rechtsklick, langer Druck, Tastatur). Es zeigt Primäraktion und
  ⋮-Einträge aus einer Quelle und lässt auf Link, Eingabefeld und markiertem Text das Browsermenü
  stehen.

Die Skizze (`stab-fernmeldeskizze-bearbeitung`) und die Lagekarte (`lagekarte-kontextmenue`)
ändern ihr Verhalten nicht; ihre Specs bleiben unberührt.

## Impact

- Frontend:
  - neu `components/useKontextMenue.ts` (Auslöser), `components/KontextMenue.tsx` (Datensatz-Hülle);
  - verschoben aus `pages/lagekarte/`: `PunktankerMenue.tsx` und `nachklickRiegel.ts` nach
    `components/`;
  - geändert: `components/Datensicht.tsx`, `stab/skizze/SkizzenFlaeche.tsx`,
    `stab/skizze/bedienung.ts`, `stab/FernmeldeskizzeBild.tsx`, `pages/lagekarte/Kartenflaeche.tsx`,
    `pages/lagekarte/FlaechenwahlMenue.tsx` (nur Importpfade);
  - neuer Wächter `components/kontextMenue.guard.test.ts`.
- Regeln: `frontend/AGENTS.md`, Abschnitt zu den Datensatz-Aktionen; `pages/lagekarte/AGENTS.md`
  (Pfad der Schale und des Riegels).
- Doku: Anwenderkapitel zur Bedienung von Listen (`docs/anwender/`), soweit es Aktionen an Zeilen
  beschreibt.
- Kein Backend, keine Migration, kein Vertrag.
