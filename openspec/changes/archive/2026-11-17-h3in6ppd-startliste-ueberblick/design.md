# Design

## Context

Motivation: proposal.md. Stand im Code (17.11.2026, `pages/fuehrung/UeberblickPage.tsx`):

- Der Überblick lädt schon Einsatz (`EinsatzAnzeige` mit `einsatzort`, `einsatzort_lat/_lon`,
  `einsatzleiter`), Abschnitte, Einheiten und Personal. Das ETB fragt er nur mit
  `typ: 'entscheidung'` ab.
- Der Körper wartet auf Einsatz und Modulzähler (LFH-629), die Paneelreihen auf die Gliederung
  (`gliederungLaedt`, LLH-1481); so springt nichts.
- Leeraktion „Abschnitt anlegen“ ruft `einsatzabschnittePfad(einsatzId)` ohne `neu: true`, obwohl
  der Deeplink `?neu=1` kennt.
- `einsatzdatenPfad` kennt nur `paneel: 'fuehrung'` (Instanz-Führung); das Rollen zum Paneel samt
  Aufräumen des Parameters folgt dem Muster „apply-then-clean“ (LLH-1850).
- Baukasten-Regel (`frontend/AGENTS.md`): jedes Paneel geht durch `DashboardPaneel`; ein neuer
  Paneeltyp nur als Baustein in `components/instrument/` (dann mit Design-System-Pflichten).

## Goals / Non-Goals

**Goals:**

- Die Startliste ist ein abgeleiteter Zustand ohne Server und ohne neuen Baustein.
- Sie erscheint ohne Layoutsprung und verschwindet von selbst.

**Non-Goals:**

- Ausblenden für alle Bildschirme (Server, Migration) — verworfen am 17.11.2026.
- Punkte je Einsatzart oder einzeln überspringen.
- Hinweis auf der Lagekarte bei fehlendem Einsatzort (Folgeaufgabe).
- Gemeinsamer Kern mit den offenen Punkten des Abschlusses (LLH-1814): beide fragen
  verschiedene Dinge (Anfang gegen Ende); ein geteilter Kern wäre Kopplung ohne gemeinsame Regel.

## Decisions

### D1 — Reiner Kern `pages/fuehrung/startliste.ts`

`startliste(quellen): StartPunkt[]` nimmt Einsatz, Abschnitte, Einheiten, Personal, die jüngste
Lagefeststellung und die Modulfreigaben (jeweils als `{zustand: 'daten'|'laedt'|'fehler'|
'gesperrt', …}`) und gibt je Punkt `{schluessel, zustand: 'erledigt'|'offen'|'gesperrt'|
'unbekannt', wert?, zusatz?, grund?, ziel?}` zurück. Dazu `startlisteOffen(punkte)`: wahr, wenn
mindestens ein Punkt `offen` oder `unbekannt` ist. Unit-Tests decken jede Regel aus der Spec ab.

| Punkt | erledigt, wenn | Modul für Sperre | Ziel |
| --- | --- | --- | --- |
| Einsatzort | `einsatzort` nicht leer; Zusatz „nicht verortet“ ohne `lat/lon` | `einsatzdaten` | `einsatzdatenPfad(id, {paneel: 'einsatzort'})` |
| Einsatzleiter | `einsatzleiter` vorhanden | `einsatzdaten` | `einsatzdatenPfad(id, {paneel: 'fuehrungsstelle'})` |
| Einsatzabschnitte | ≥ 1 Abschnitt | `einsatzabschnitte` | `einsatzabschnittePfad(id, {neu: true})` |
| Kräfte | ≥ 1 Einheit oder ≥ 1 Einsatzkraft | `einheiten` (Ziel) | `einheitenPfad(id)` |
| Erste Lagefeststellung | ETB-Eintrag `typ: 'lage'` vorhanden | `etb` | `etbPfad(id, {neu: true})` |

Die Modulschlüssel prüft die Umsetzung gegen `modulAusPfad`/die Modulliste; ist das Modul eines
Punkts nicht frei, ist er `gesperrt` mit dem Grund aus der vorhandenen Sperrlogik.

Der Wert beim Einsatzleiter kommt aus dem vorhandenen Anzeigehelfer (`einsatz/einsatzleiter.ts`),
damit Name und Funktion so heißen wie auf den Einsatzdaten.

### D2 — Darstellung als `ListenPaneel`, eigene Reihe unter der Alarmzeile

Das Paneel ist ein `ListenPaneel` (Titel „Einsatz starten“, `max` 5, kein „weitere“), jede Zeile
mit `listenZeileStil` als Link bei offenem Punkt, sonst als Text. Zustand je Punkt: Haken
(erledigt), leerer Kreis (offen), „—“ mit Grund (gesperrt), „—“ mit „nicht geladen“ und dem Knopf
„Erneut abrufen“ (unbekannt; er lädt nur die Quellen dieses Punkts, wie ein ausgefallener
`ListenAbschnitt`, weil das Paneel selbst immer `daten` zeigt und sein Fehlerzweig nie greift).
Ein Knopf „Ausblenden“ steht im Paneelkopf (über die vorhandene Kopf-Aktion von
`DashboardPaneel`; fehlt sie, kommt sie dort als Erweiterung des Bausteins hinzu, nicht als
eigener Baustein).

Platz: eine eigene `PaneelReihe` mit nur diesem Paneel zwischen Alarmzeile und Führungsstand. So
bleibt die Reihenfolge der übrigen Paneele unverändert, und wenn die Startliste fehlt, fehlt die
ganze Reihe. Die Baukasten-Regel in `frontend/AGENTS.md` bekommt dafür einen Satz.

*Alternative:* ein eigener Baustein `StartlistePaneel` mit Design-System-Karte. Mehr Aufwand
(Generator, Wächter, `/design`) für eine Liste, die `ListenPaneel` schon kann. Verworfen.

*Alternative:* die Punkte in die Leerzustände vorhandener Paneele verteilen. Einsatzort und
Einsatzleiter hätten keine Heimat, und die Alarmzeile („Was brennt“) zeigt Zustände, keine
Versäumnisse (ADR-0057). Verworfen.

### D3 — Laden ohne Sprung

Neue Abfrage `listeEtb(einsatzId, {typ: 'lage', limit: 1})` mit eigenem Query-Key nach der Regel
der Query-Keys, nur wenn das ETB frei ist. Die Seite rechnet `startlisteBereit`, wenn jede Quelle
der Startliste `daten`, `fehler` oder `gesperrt` ist, und nimmt das in die vorhandene Ladeschranke
der Paneelreihen (neben `gliederungLaedt`) auf. Live-Ereignisse invalidieren die Quellen wie bisher;
das Verschwinden ist dann ein Wegfall nach Handlung, kein Sprung beim Laden.

Nachtrag aus dem Review (17.11.2026):

- Die Schranke gilt nur beim ersten Aufbau der Seite je Einsatz. Startet eine Quelle erst mitten in
  der Sitzung (Schreibrecht kommt live dazu, Wiedereröffnen, neue Modulfreigabe), bleiben Band und
  Paneelreihen eingehängt; die Startliste hält bis zum Ende dieses Abrufs ihren letzten Stand
  (fehlte sie, fehlt sie weiter).
- Ein gescheiterter Neuabruf behält in TanStack v5 seine Daten. Sie gelten weiter
  (`startQuelle`: Daten vor Fehler, wie die Freigaben der Seite); `fehler`, also „unbekannt“, heißt
  nur: nie geladen. Sonst holte ein 502 die schon verschwundene Liste über dem Band zurück.

### D4 — Ausblenden je Browser

Schlüssel `startliste-ausgeblendet:<einsatzId>` über `lib/sichererSpeicher` (`sicherLesen`/
`sicherSchreiben`), eingetragen in `GERAETESPEICHER` (`offline/geraetRaeumung.ts`), damit
Geräteräumung und Abmelden ihn wegräumen. Erst den State setzen, dann schreiben (Browserspeicher-
Regel); scheitert das Schreiben, bleibt das Paneel bis zum Neuladen weg.

### D5 — Sprungaufträge auf die Einsatzdaten

`einsatzdatenPfad` erweitert `paneel` um `'einsatzort' | 'fuehrungsstelle'`. Die Einsatzdaten
rollen nach dem Muster LLH-1850 zum Paneel „Einsatzort“ bzw. „Eigene Führungsstelle“, setzen den
Fokus auf dessen Bearbeiten (falls vorhanden) und räumen den Parameter. Die Leeraktion im
Abschnittspaneel des Überblicks nimmt `neu: true`.

## Risks / Trade-offs

- [Kleiner Sanitätsdienst ohne Abschnitte: Liste bleibt stehen] → „Ausblenden“ je Browser;
  bewusst kein Server-Merkmal (Entscheidung 17.11.2026).
- [Zusätzliche ETB-Abfrage auf dem Überblick] → `limit: 1`, nur bei Schreibrecht und aktivem
  Einsatz, und nur solange die Startliste nicht ausgeblendet ist.
- [Dashboard-Regel wird um eine Reihe erweitert] → genau eine Reihe, nur dieses Paneel, Regeltext
  nennt sie ausdrücklich.
