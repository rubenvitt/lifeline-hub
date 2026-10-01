# Proposal

## Why

Zum Kommunikationskonzept des Sachgebiets S6 gehört nach FwDV 100 Anlage 2 eine
**Fernmeldeskizze**: wer über welchen Kanal mit wem spricht. Diese Skizze wird heute neben der App
von Hand gezeichnet (Gespräch vom 22.09.2026). Die Daten dafür pflegt der Einsatz längst: Abschnitte
und Einheiten tragen Rufname, Sprechgruppen und Kommunikationsmittel. Zwei Bausteine gibt es
inzwischen:

- Der **Funkplan S6** (LFH-548) zeigt diese Daten als Tabelle.
- Das **Organigramm** (LFH-626) zeigt die Führungsorganisation als Grafik. Sein Knotenmodell nutzt
  absichtlich dieselben Schlüssel wie der Funkplan, damit eine Kommunikationsebene darauf aufsetzen
  kann.

Was fehlt, ist das Bild der Verbindungen. Die Tabelle sagt, welche Sprechgruppen eine Stelle hat.
Ob eine Einheit ihren Abschnitt überhaupt erreicht, sagt sie nicht: Das sieht man erst, wenn man
die Sprechgruppen zweier Zeilen von Hand vergleicht.

## What Changes

- **Zweite Darstellung des Funkplans: „Tabelle | Skizze“.** Der Umschalter steht auf der
  Funkplan-Seite (`stab/funkplan`). Die Sichtvorgabe `?ansicht=skizze` wird angewendet und dann aus
  der Adresse entfernt. Es entsteht keine neue Route und kein neues Modul. Die Skizze erbt die
  Stab-Freigabe und die Rechteweiche je Quelle der Seite.
- **Hängendes Organigramm mit Funkangaben.** Den Baum (Einsatzleitung → Abschnitte →
  Unterabschnitte/Einheiten → unterstellte Einheiten, Sammelknoten „Ohne Abschnitt“) liefert das
  Knotenmodell des Organigramms. Jeder Knoten zeigt Bezeichnung, Rufname, TMO- und
  DMO-Sprechgruppen und Kommunikationsmittel aus derselben Ableitung wie die Tabelle. Leitung,
  Stärke und Erreichbarkeit zeigt die Skizze nicht.
- **Verbindungen als Kanten.** Unter einer übergeordneten Stelle trägt jede Kante die Sprechgruppen,
  die beide Seiten gemeinsam haben, also den Kanal, auf dem sie sich erreichen. Haben beide Seiten
  Sprechgruppen, aber keine gemeinsame, steht an der Kante „keine gemeinsame Sprechgruppe“: als
  Wort und Zeichen, nicht nur als Farbe.
- **Neue Lücke „Verbindungen ohne gemeinsame Sprechgruppe“.** Sie wird in `stab/luecken.ts`
  gerechnet und steht im Lücken-Paneel des Funkplans (Tabelle und Skizze) und im übernommenen
  Lagebericht. Die betroffenen Stellen werden als Verweise genannt.
- **Wurzel ohne erfundene Gegenstelle.** Die Einsatzleitung trägt „Gegenstelle nicht erfasst“
  (LFH-849). Die Kanten der ersten Ebene haben deshalb kein Urteil.
- **Druck als eigenes Druckstück „Fernmeldeskizze“**: Druckkopf, alles aufgeklappt, A4 hochkant
  ohne Überhang. Das Lücken-Paneel wird mitgedruckt.
- **Lagebericht:** Es gibt keine zweite Übernahme. „In Lagebericht übernehmen“ bleibt die
  bestehende Funkplan-Übernahme in beiden Darstellungen. Lageberichte sind Text ohne Bild, und die
  Gliederung mit Sprechgruppen steht dort schon.
- **Geteiltes Gerüst:** Das hängende Layout des Organigramms (Spalten der ersten Ebene, senkrechte
  Zweige, Klappziele, Druckregeln) wird zu einem Bauteil, das Organigramm und Skizze gemeinsam
  nutzen. Das Organigramm ändert dabei sein Verhalten nicht.

## Capabilities

### New Capabilities

- `stab-fernmeldeskizze`: Die aus der Einsatzgliederung abgeleitete Fernmeldeskizze des S6. Die
  Fähigkeit regelt Ort und Umschalter, Knoteninhalt, Kanten mit gemeinsamer Sprechgruppe, die
  benannten Lücken an Knoten und Kanten, die Wurzel ohne Gegenstelle, Lesbarkeit ohne waagerechtes
  Scrollen, Ein- und Ausklappen, Druck und Deeplinks.

### Modified Capabilities

- `stab-funkplan`: Die Anforderung „Lücken oberhalb der Tabelle“ bekommt die Lücke „Verbindungen
  ohne gemeinsame Sprechgruppe“. Das Paneel steht in beiden Darstellungen.

## Impact

- **Frontend:**
  - `stab/luecken.ts` bekommt die Verbindungslücke.
  - `stab/funkplan.ts` erweitert die Lücken und das Markdown um sie.
  - Neu: `stab/fernmeldeskizze.ts` (reines Modell) und `stab/FernmeldeskizzeBild.tsx` (Darstellung).
  - `pages/FunkplanPage.tsx` bekommt Umschalter, Druckkopf je Darstellung und die neue Lückenzeile.
  - `routing/deeplinks.ts` bekommt `funkplanPfad` mit `ansicht` und `parseFunkplanAnsicht`.
  - Neu: geteiltes Gerüst `components/organigramm/` (Layout und Druck-CSS) aus
    `pages/einsatzabschnitte/Organigramm.tsx` und `organigrammPrint.css`.
  - `stab/AGENTS.md` und der Organigramm-Eintrag in `frontend/AGENTS.md` werden nachgezogen.
- **Backend:** keine Änderung, keine Migration, kein Endpunkt, kein Typ-Codegen.
- **Abhängigkeiten:** keine neue Bibliothek.
- **Tests und Nachweise:**
  - Vitest für Modell, Lücke, Markdown, Gerüst und Seite
  - e2e für die Breiten 1366/1024/768/390, Druck bei A4 und Live-Folge
  - Aufnahme der Sichtvorgabe in die Gates 1 und 3
  - `pruefliste.md`
