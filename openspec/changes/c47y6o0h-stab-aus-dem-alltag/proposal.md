# Proposal

## Why

Der Stab ist nicht der Hauptnutzer der App, steht aber als Modul „Stab“ mit einem großen Raster S1–S6
mitten in der Kategorie Führung (Feedback Ruben, 24.10.2026, LLH-1450). Wer im Alltag einen ELW oder
eine Kleinlage führt, stolpert über eine Seite, die er nie braucht. Wer dagegen im Stab sitzt,
bekommt eine Übersicht aller sechs Sachgebiete, obwohl er nur eines bearbeitet. Die Presse hängt
als Unterseite am Stab, obwohl auch eine Einsatzleitung ohne Stab Presseanfragen beantwortet.

Der Stab bekommt deshalb eigene Zugänge abseits der täglichen Navigation, wie die UHS: je
Sachgebiet ein gekoppeltes Gerät und für den Stabsraum einen Großbildschirm. Die Presse wird ein
eigenes Modul.

## What Changes

**Teil A, Presse als Modul (LLH-1451)**
- Neues Einsatzmodul „Presse“ (Key `presse`, Kategorie Kommunikation, Beschreibung „Presse-Log,
  Mitteilungen, Infotelefon“). Es enthält Presse-Log, Pressemitteilungen, Medienlage und
  Informationstelefon und hat eine eigene Freigabe, unabhängig vom Stab.
- Neue Adressen `/einsaetze/:id/presse` (Reiter Presse · Informationstelefon),
  `…/presse/mitteilungen/:mitteilungId` und `…/presse/infotelefon`. Die alten Adressen unter
  `…/stab/presse…` und `…/stab/infotelefon` leiten dauerhaft um.
- Die API-Pfade unter `…/stab/medienkontakte`, `…/stab/pressemitteilungen` und
  `…/stab/infotelefon` bleiben gleich, gehören aber dem Modul Presse. Die Live-Ereignisse
  `presse` und `infotelefon` verteilen nach dessen Gate.
- Freigeben darf eine Pressemitteilung weiter nur die Einsatzleitung.
- Rolle und Sichtbarkeit übernimmt das Modul vom Stab, je Einsatz, je Organisation und je
  Einsatz-Vorlage. Niemand sieht danach mehr oder weniger als vorher.
- Die Medienlage-Übernahme im Lagevortrag und die Schnellaktion „Anruf erfassen“ prüfen die
  Freigabe der Presse.

**Teil B, der Stab verlässt die Navigation (LLH-1452)**
- **BREAKING (Bedienung):** Das Modul `stab` ist kein Navigationsziel mehr. Es fehlt in Icon-Rail,
  Modulmenü, Drawer, Sprungpalette, „Zuletzt besucht“ und in der Wahl der Startseite.
- Als Freigabe bleibt `stab` bestehen und in den Modul-Einstellungen schaltbar, mit der neuen
  Beschreibung „Besetzung, Fachzugänge, Stabsmonitor“. Die Freigabe steuert weiter alle Stab-Daten
  in anderen Modulen (Empfänger „S4 · Name“, Organigramm, Lagebericht, Kommunikationsplan,
  Fernmeldeskizze, Einsatzbericht).
- Besetzung S1–S6 und Checkliste Arbeitsaufnahme ziehen in ein neues Paneel „Stab“ auf der Seite
  Einsatzdaten, nach der eigenen Führungsstelle. Das Paneel fehlt ohne Stab-Freigabe.
- Die Stab-Seite entfällt mit ihrem Kachelraster. Die alte Adresse `/einsaetze/:id/stab` leitet auf
  die Einsatzdaten zum Paneel „Stab“. Eine gespeicherte Startseite `stab` gilt als nicht gesetzt.

**Teil C, Fachzugang je Sachgebiet (LLH-1453)**
- Neue Funktionsansicht `stab-sachgebiet` für gekoppelte Geräte. Beim Koppeln ist genau ein
  Sachgebiet S1–S6 Pflicht.
- Das Gerät hat volle Modulrechte (Rolle Führungspersonal) in den Werkzeugmodulen seines
  Sachgebiets:
  - S1: Personal, Einheiten, Bereitstellungsräume, Nachforderungen
  - S2: Lagekarte, Lagemeldungen, ETB
  - S3: Einsatzabschnitte, Aufträge, Meldungen
  - S4: Nachforderungen, Verpflegung, Material
  - S5: Presse
  - S6: Fernmeldewesen
- Alles andere lehnt der Server ab. Leitungsaktionen wie die Freigabe einer Pressemitteilung
  bleiben gesperrt.
- Eigene Hülle: Die Startseite zeigt das Sachgebiet mit Besetzung, Aufgabenzeile, Werkzeugen samt
  Zustandszahlen und dem nächsten Termin der Lagebesprechung. Die Werkzeuge öffnen die Seiten der
  Module in der Hülle.

**Teil D, Stabsmonitor (LLH-1454)**
- Neue Funktionsansicht `stabsmonitor`: ein ungebundener Großbildschirm für den Stabsraum, der nur
  liest und sich nicht bedienen lässt, nach dem Muster des Lagemonitors.
- Er zeigt S1–S6 mit wirksamem Label und Besetzung samt Namen der Funktionsträger, je Sachgebiet
  die Zustandszahlen seiner Werkzeuge und den nächsten Termin der Lagebesprechung, überfällig mit
  Wort hervorgehoben.
- Die Daten liefert ein verdichteter Endpunkt `GET …/stabsmonitor`. Namen von Betroffenen,
  Anrufern oder Medienkontakten liefert er nie.

## Capabilities

### New Capabilities

- `presse-modul`: das Modul Presse als Hülle. Dazu gehören:
  - die Freigabe samt Übernahme vom Stab
  - Modulseite, Reiter und Adressen samt Weiterleitung
  - die Zuordnung der bestehenden API-Pfade und die Live-Verteilung
  - die Abnehmer: Medienlage-Übernahme und Schnellaktion
- `stab-fachzugang`: die Funktionsansicht `stab-sachgebiet`. Dazu gehören:
  - Bindung an ein Sachgebiet
  - Schranke über die Werkzeugmodule
  - Hülle, Startseite des Sachgebiets und Zustandszahlen der Werkzeuge
- `stabsmonitor`: die Funktionsansicht `stabsmonitor`. Dazu gehören:
  - Kachelung S1–S6 und Inhalt
  - Datenschutz
  - Großbild-Regeln, Aktualisierung und Gerätemenü

### Modified Capabilities

- `stab-uebersicht`: Raster, Kachel-Besetzung, Werkzeuge und Zustandszahlen der Stab-Seite
  entfallen. Neu sind „Stab ohne eigenes Navigationsziel“ und die Besetzung im Paneel „Stab“ der
  Einsatzdaten.
- `stab-checkliste`: Die Fläche zieht von der Stabseite in das Paneel „Stab“ der Einsatzdaten.
- `einsatzdaten-bearbeitung`: Die Gliederung der Seite bekommt das Paneel „Stab“.
- `funktionsansichten`: Der Katalog kennt neun Ansichten und die Bindungsart Sachgebiet.
- `modul-freigabe`: Neu ist ein Modul ohne Navigationsziel. Das Szenario „Unterroute eines
  gesperrten Stabs“ wird zur Presse.
- `modul-sprungmarken`: Pressearbeit und Informationstelefon sind keine Stab-Marken mehr. Die
  Marke „Informationstelefon“ steht hinter „Presse“.
- `sprungpalette`: Die Szenarien der Ansichten nennen die Presse, und „Anruf erfassen“ prüft die
  Freigabe der Presse.
- `stab-medienlage`: Der Einstieg aus der S5-Zeile wird zum Einstieg über das Modul Presse.
- `stab-pressemitteilung`: Adresse und Rechte hängen am Modul Presse. Die Freigaberegel bleibt.
- `stab-presse-log`: Die Rechte hängen am Modul Presse.
- `stab-infotelefon`: Die Rechte hängen am Modul Presse.
- `lagebesprechung`: Die Stab-Seite ist kein Einstieg mehr.
- `lagebesprechung-vorbereitung`: Den Ton des überfälligen Termins zeigt der Stabsmonitor statt
  der Stab-Seite.
- `einsatzkopf-live`: Der neue Termin erreicht den Stabsmonitor statt die Stab-Seite.
- `stab-funkplan`: Der Einstieg aus der Zeile S6 wird zum Werkzeug des S6-Fachzugangs.
- `fernmeldewesen`: „Einstiege von der Stab-Seite“ entfällt und steht jetzt im Fachzugang.
- `modul-zaehler`: Die Szenarien nennen die Startseite des Fachzugangs statt der Stab-Seite.
- `fuehrungsfunktionen`: Das wirksame Label gilt im Paneel „Stab“, im Fachzugang und im
  Stabsmonitor statt auf der Stabseite.

## Impact

**Backend**
- `src/einsatz/modul.rs`: `MODUL_KEYS` um `presse`, Marker `Presse`, drei Unterpräfixe in
  `PFAD_KEY`.
- `src/routes/presse.rs`, `src/routes/infotelefon.rs`: Extraktoren auf `Presse`.
- `src/live/mod.rs`: Gate für Presse und Infotelefon.
- `src/geraet/` (`mod.rs`, `repo.rs`, `stelle.rs`): Ansichten `stab-sachgebiet` und `stabsmonitor`,
  Bindung an ein Sachgebiet, Schranke über die Modulmenge, Lese-Module je Kopplung.
- `src/routes/geraet.rs`: Kopplung prüfen.
- Neu `src/routes/stabsmonitor.rs`.
- Zwei Migrationen:
  - Presse-Freigaben aus dem Stab
  - Neubau von `geraet_kopplung` mit Spalte `sachgebiet` und den neuen Ansichten im CHECK
- Typ-Codegen.
- Tests: `tests/geraet_kopplung.rs`, `tests/geraet_routen_guard.rs`, `tests/modul_override.rs`,
  `tests/modul_freigaben.rs`, `tests/einsatz_kontext_guard.rs`, `tests/enum_wire_kontrakt.rs`,
  die Presse- und Infotelefon-Tests, Migrationstests in `src/db.rs`.

**Frontend**
- Registry und Navigation: `einsatz/modulRegistry.ts` (Eintrag `presse`, Flag für `stab` ohne
  Navigationsziel), alle Abnehmer der Registry, `App.tsx`, `routing/deeplinks.ts`,
  `api/queryKeys.ts`, `einsatz/sprungmarken.ts`, `command-palette/befehle.ts`.
- Seiten: neue Hülle `presse/`, `pages/PressePage.tsx`, `pages/PressemitteilungDetailPage.tsx`,
  `pages/InfotelefonPage.tsx`, `pages/EinsatzdatenPage.tsx` (Paneel „Stab“). `pages/StabPage.tsx`
  entfällt.
- Geräte:
  - `geraet/GeraeteLayout.tsx` mit neuer Hülle für den Fachzugang
  - Startseite des Sachgebiets mit `stab/SachgebietKachel.tsx` und `stab/werkzeugZahlen.ts`
  - `geraet/StabsmonitorPage.tsx`
  - `pages/einstellungen/EinsatzGeraete.tsx` und `geraeteKern.ts`
- Vitest und e2e.

**Regeln und Doku**
- `AGENTS.md` (Regelkarte), `frontend/AGENTS.md`, `frontend/src/stab/AGENTS.md`,
  `frontend/src/geraet/AGENTS.md`, `frontend/src/command-palette/AGENTS.md`.
- `docs/anwender/`: `stab.md`, `presse-infotelefon.md`, `einsatz-oberflaeche.md`, ein Kapitel zu
  Fachzugang und Stabsmonitor, die Bilder.

**Bezüge**
- LLH-1180 (Fernmeldewesen) und LLH-1111 (Lagebesprechung) sind das Muster der Abspaltung.
- LLH-1124 (Stab-Seite) wird zurückgebaut.
- LLH-892 und LLH-1153 (Funktionsansichten, Lagemonitor) sind das Muster der Geräteansichten.
- LLH-722 (Feldbefund Stab): Der Stab zählt künftig über Fachzugänge und Stabsmonitor.
