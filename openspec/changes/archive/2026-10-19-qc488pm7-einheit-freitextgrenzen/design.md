# Design

## Context

`bilden` (POST) und `update` (PATCH) in `routes/einsatz_einheit.rs` reichen Bemerkung,
Funkrufname und Erreichbarkeit nur durch `trimme`/`trimme_tri`. Den Namen prüfen beide schon mit
`pflicht_max` gegen `einheit::NAME_MAX`. `einheit::BEMERKUNG_MAX` (2 000) gibt es seit LLH-1075,
gilt aber nur beim Erfassen am Bereitstellungsraum. Weitere Wege, die diese Spalten schreiben:

- Erfassen einer unangemeldeten Kraft am Bereitstellungsraum: übernimmt den Funkrufnamen des
  ersten Fahrzeugs (`fahrzeug::ADHOC_TEXT_MAX`, 200) und die Bemerkung (`BEMERKUNG_MAX`).
- Bilden aus einer Vorlage: übernimmt Funkrufname (`einheit_vorlage::FUNKRUFNAME_MAX`, 100) und
  Bemerkung (`einheit_vorlage::BEMERKUNG_MAX`, 2 000) aus der Vorlage.
- Demo-Import: Systemdaten, kein Eingang von außen.

## Goals / Non-Goals

**Goals:** Grenze für die drei Freitexte an POST und PATCH; Spiegel; die Einheit-Ansicht hält sie.

**Non-Goals:** Bestandswerte über der Grenze nicht kürzen oder migrieren; Kommunikationsmittel
bleibt bei seiner Wertprüfung (`pruefe_kommunikationsmittel`), es ist kein Freitext.

## Decisions

**D1 Grenzwerte.** Bemerkung 2 000 (bestehendes `einheit::BEMERKUNG_MAX`). Funkrufname 200, neu
`einheit::FUNKRUFNAME_MAX`: die Erfassung am Bereitstellungsraum schreibt bis zu 200 Zeichen aus
dem Fahrzeug in den Funkrufnamen der Einheit; eine engere Grenze (100 wie die Vorlage) machte
einen dort entstandenen Wert in der Ansicht unbearbeitbar. Erreichbarkeit 200, neu
`einheit::ERREICHBARKEIT_MAX`: Rufnummer oder kurzer Freitext, eine Zeile; 200 wie die übrigen
kurzen Freitexte (`fahrzeug::ADHOC_TEXT_MAX`, `presse::KURZ_MAX`). Erwogen: Erreichbarkeit 100 wie
`EXTERNE_STELLE_KURZ_MAX` – verworfen, weil das Feld auch „Melder über Fü-Kfz, sonst 0151 …“
trägt.

**D2 Prüfort und Reihenfolge.** Im Handler mit `optional_max` (POST) und `optional_max_tri`
(PATCH) aus `routes::support`, direkt nach der Namensprüfung und vor `require_aktiv` (409) und den
Soll-Prüfungen, damit die 400 vor jedem 422/409 des Zusammenhangs kommt (`src/AGENTS.md`,
„Eingabegrenzen“). Feldnamen der Meldung wie in der Oberfläche: „Bemerkung“, „Funkrufname“,
„Erreichbarkeit“. Die Repo-Schicht bleibt ungeprüft: die anderen Wege (Kontext) sind schon
eingangsseitig begrenzt.

**D3 Maske.** Funkrufname und Erreichbarkeit sind kurze einzeilige Felder: natives `maxLength`
wie der Name im selben Kopf (`frontend/AGENTS.md`, „Freitext nie länger als der Server erlaubt“).
Die Bemerkung ist mehrzeilig und bekommt deshalb den Zähler `zeichenGrenze` und eine `pruefe`-
Regel mit `istZuLang` an `InlineAngabe` (Vorbild Personendaten, LLH-1329): Überlänge steht am Feld
und sperrt das Speichern, es wird nie gekürzt.

## Risks / Trade-offs

- [Bestandswert über der Grenze] → bleibt gespeichert. Ein PATCH prüft nur gesendete Felder; die
  Ansicht sendet nur das geänderte Feld. Beim Bearbeiten eines solchen Funkrufnamens lässt
  `maxLength` nur Löschen zu, bis der Wert passt; bei der Bemerkung sperrt `pruefe` das Speichern.
- [Fremde Clients senden längere Werte] → 400 mit klarer Meldung; die Desktop-Hülle nutzt dieselbe
  Oberfläche.
