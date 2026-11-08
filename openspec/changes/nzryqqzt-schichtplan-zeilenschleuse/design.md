## Context

- **Raster heute:** `SchichtplanRaster` bekommt `zeilen` und `bloecke` vom Aufrufer und rendert
  sie, wie sie kommen. Im Einsatz baut `schichtplanZeilen.ts:baueZeilen` die Zeilen aus Einheiten,
  UHS und den Abschnitten der Ablösung (live über `einheit`, `uhs`, `abloesung`), in der Vorplanung
  `planung/planungZeilen.ts:planungZeilen` aus den Posten der Planung (live über den Org-Strom).
  Auf dem Handy rendert `SchichtplanListe` dieselben Zeilen. Beide Aufrufer
  (`SchichtplanAnsicht.tsx`, `planung/PlanungSchichtplan.tsx`) wählen über `istSchmal` zwischen
  Liste und Raster.
- **Gemessen (LLH-1595):** Ein fremder Block springt nicht. Ein Posten, der vor anderen
  einsortiert wird, oder eine Umsortierung schiebt die Zeilen darunter um eine Zeilenhöhe
  (39 px bei 1366 px, kompakt).
- **Vorhandene Schleuse:** `components/useZuflussSchleuse.ts` (LFH-1020, aus der `Datensicht`
  herausgelöst, auch in `ListeDetail`). `useZuflussSteuerung` hält den Stand (`offen` / `neu` /
  `gefroren` mit `folge`, `gruppeVon`, `gerippe`), `useZuflussSchleuse` schließt bei Fokus,
  Zeigerbewegung (kein Touch) und `halten` und öffnet erst, wenn keine Bedingung mehr gilt.
  `flachZufluss` lässt entfallene Schlüssel sofort fallen; für das Raster reicht das nicht.
- **Eigene Änderungen an Posten** entstehen nicht in der Ansicht des Rasters: Einheiten und UHS
  ändern andere Module, Posten der Planung der Reiter „Posten“. Im Raster ändert man nur Blöcke.
- **Abgestimmt am 08.11.2026** (Zunder LLH-1604): entfallene Posten als leere Zeile halten,
  Banner im Wortlaut des Rasters, e2e mit eigenem Seed.

## Goals / Non-Goals

**Goals:**

- Nichts unter dem Zeiger verschiebt sich durch Änderungen anderer, weder im Raster noch in der
  Handy-Liste, im Einsatz wie in der Vorplanung.
- Eine Schleuse, keine zweite Logik: die Bedingungen kommen aus `useZuflussSchleuse`.
- Blöcke bleiben live; wer den Plan liest, sieht neue Besetzungen sofort.

**Non-Goals:**

- Keine Schleuse für Blöcke, keine für die Personen-Seitenleiste (`SchichtplanPersonen`).
- Kein Server-, Wire- oder Codegen-Anteil.
- Kein Hinweis außerhalb des Banners (kein Ton, kein Eingangsband, kein Zähler).

## Decisions

### D1 Dieselbe Schleuse, das Gerippe trägt die gezeigten Zeilen

`useZuflussSteuerung<RasterZeile>` und `useZuflussSchleuse` mit `schluessel = z.schluessel`,
`gruppeVon = z.gruppe ?? ''` und `mitGerippe: true`. Das `gerippe` hält die beim Einfrieren
gezeigten Zeilen; aus ihm kommen Titel und Gruppe einer entfallenen Zeile. Ein „anzeigen“ ruft
`nachBenutzeraktion` (Stand `neu`), der Layout-Effekt der Schleuse friert die frische Folge ein.

*Verworfen:* eine eigene Schleuse im Raster. Fokus-, Zeiger- und Portal-Regeln der
`useZuflussSchleuse` sind erprobt (LFH-1020, LLH-1130); eine Kopie liefe auseinander.

### D2 Reine Ableitung `schleuseZeilen`

Neu in `abloesung/schichtplan/zeilenSchleuse.ts`:
`schleuseZeilen(gefroren, frisch) → { zeilen, wartend: { neu, entfallen, umsortiert } }`.

- `zeilen`: je Schlüssel der eingefrorenen `folge` die frische Zeile (frischer Titel,
  **eingefrorene** Gruppe); fehlt sie, die Zeile aus dem `gerippe` mit `entfallen: true`.
- `neu`: frische Schlüssel, die nicht in der `folge` stehen.
- `entfallen`: Schlüssel der `folge`, die frisch fehlen.
- `umsortiert`: die gemeinsamen Schlüssel stehen frisch in anderer relativer Folge, oder einer
  steht frisch unter einer anderen Gruppe. Ein neuer oder entfallener Posten allein ist **keine**
  Umsortierung.

Daneben `schleusenText(wartend)`: „1 neuer Posten“ / „n neue Posten“, „1 Posten entfallen“ /
„n Posten entfallen“, „Reihenfolge geändert“, verbunden mit „ · “; ohne Wartendes `null`.

### D3 Wann die Schleuse hält

Fokus und Zeiger wie in der Datensicht. Dazu `halten`, wenn

- ein Zug im Raster läuft: neuer Rückruf `onZug?: (laeuft: boolean) => void` am Raster. Der Zug
  läuft über Zeiger-Ereignisse am Dokument und darf das Raster verlassen; ohne `halten` taute die
  Schleuse beim Verlassen mitten im Zug.
- eine Person aus der Seitenleiste gezogen wird (`gezogen != null` beim Aufrufer).
- ein Dialog des Schichtplans offen ist (`dialog != null` beim Aufrufer). Er liegt im Portal; der
  Fokus wandert dorthin, und nach dem Schließen kehrt er auf den Block zurück.

### D4 Die entfallene Zeile

`RasterZeile` bekommt `entfallen?: boolean`. `raster.ts:pruefeZug` antwortet für eine solche
Zeile `keine-zeile` (Schatten „kein Posten“), das Raster startet in ihr kein Aufziehen. Der Titel
steht gedämpft (`rollen.gedaempft`) mit „(entfallen)“; die Liste zeigt dieselbe Zeile mit „—“. Die
Zeile hat keine Blöcke: ein Posten mit Blöcken entfällt im Einsatz nicht (`baueZeilen` hält ihn,
solange er Blöcke trägt), in der Planung gehen die Blöcke mit dem Posten.

### D5 Die Hülle `SchichtplanSchleuse`

Neu `abloesung/schichtplan/SchichtplanSchleuse.tsx`, eine Hülle mit Render-Funktion:
`<SchichtplanSchleuse zeilen halten>{(zeilen) => <SchichtplanRaster zeilen={zeilen} … />}</…>`.
Sie trägt den Wurzelknoten und die Handler der Schleuse und das Banner. Das Banner ist das
`Sammelbanner` aus `components/instrument` als Überlagerung mit Nullhöhe, `position: sticky` unter
dem Rahmen (Muster `ErfassungsAnhaenge`, LFH-952); es nimmt keinen Platz im Fluss. Nach
„anzeigen“ geht der Fokus auf die Hülle (`tabIndex={-1}`, zugänglicher Name „Schichtplan“), statt
mit dem verschwundenen Knopf auf `<body>` zu fallen.

Die Hülle umfasst nur Raster bzw. Liste, nicht die Personen-Seitenleiste und nicht die
Werkzeugzeile. Die Dialoge des Schichtplans bekommen weiter die frischen Zeilen: sie zeigen die
Wahl des Postens, nicht die Lage unter dem Zeiger.

*Verworfen:* die Schleuse in Raster und Liste je einzeln. Beide sind fachneutrale Bausteine;
zwei Einbauten wären zwei Stellen für dieselbe Regel.

### D6 Eigene Änderungen

Keine Sonderbehandlung. Eigene Änderungen an Posten entstehen außerhalb des Rasters (Context).
Der einzige Fall im Raster: wer im Einsatz den letzten Block einer aufgelösten Einheit löscht,
lässt ihre Zeile entfallen; sie bleibt als „(entfallen)“ stehen, bis die Schleuse öffnet oder
jemand „anzeigen“ wählt. Das ist gewollt: auch eine eigene Löschung soll unter dem Zeiger nichts
nachrücken lassen.

## Risks / Trade-offs

- **Blöcke eines wartenden Postens sind unsichtbar**, bis jemand „anzeigen“ wählt → das Banner
  nennt den Posten; der Hinweis ist dieselbe Abwägung wie in der Datensicht.
- **Lang gehaltene Schleuse** (Zeiger ruht über dem Raster) → das Banner bleibt stehen, bis der
  Zeiger das Raster verlässt oder jemand „anzeigen“ wählt; kein Zeitgeber.
- **LLH-1595 ändert dieselben Dateien** (Zielabstand in Raster und Liste) → kleine, getrennte
  Stellen; beim späteren Merge zusammenführen, den e2e-Seed auf `planung-kern.ts` umstellen.

## Migration Plan

Keine: reiner Client, keine gespeicherten Daten.
