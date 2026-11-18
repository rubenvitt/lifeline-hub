# Proposal

## Why

Auf den Lageflächen steht dieselbe Stärke in vier Schreibweisen: „F/UF/M//Ges“, „F/UF/M//Σ“,
„Gesamtstärke“ und „F/UF/M“ ohne Summe. Organigramm, Lagebild und Meldebild zeigen den Wert „1/2/5//8“
oft ganz ohne Beschriftung. „UA“, „Fzg“ und „n.v.“ erklärt die Oberfläche nirgends, und bei
„Verbleib offen“ bleibt unklar, was offen ist. Eine Regel für Kürzel und ein Nachschlagekapitel gibt es
nicht. LLH-1750, Thema 3 der UI/UX-Analyse vom 12.11.2026, Entscheidungen vom 17.11.2026.

## What Changes

- **Eine Schreibweise der Stärke:** Der Wert lautet „1/2/5//8“ und trägt das Etikett „F/UF/M//Σ“.
  „Ges“ und „Gesamt“ entfallen. Jede Fläche, die eine Stärke zeigt, nennt die Schreibweise mindestens
  einmal sichtbar: als Spaltenkopf, Feldetikett oder Legendenzeile. Jeder Wert führt die ausgeschriebene
  Form („Führer / Unterführer / Mannschaft // Summe“) als zugängliche Beschreibung, ein Tooltip ergänzt.
- **Der Lagemonitor zeigt die Stärke mit Summe**, aus derselben Formatierung wie alle anderen.
- **Ausschreiben statt kürzen:** „UA“ wird zu „Unterabschnitte“ bzw. „Unterabschnitt kritisch“,
  „Fzg“ in der Verdichtungszeile zu „Fahrzeuge“, „n.v.“ im Kräftebild-Text zu „nicht verfügbar“.
- **„Verbleib offen“ erklärt sich:** Die Kennzahl trägt die Notiz „wohin nicht erfasst · n unterwegs“.
- **Regel für Kürzel:** Ein Kürzel steht nur, wenn es eingeführt ist (FMS und S1–S9, SK I–IV, ETB, UHS,
  BR, F/UF/M//Σ, Rückm., Einh., Fzg., Mtl., Pers.) oder auf der Fläche sichtbar erklärt wird. Kurzbezeichnungen,
  die eine Organisation selbst vergibt („EA 1.1“), sind Daten und bleiben unverändert.
- **Neues Anwenderkapitel „Zeiten und Kürzel“:** Zeitpunkt, Uhrzeit, Dauer und Datenstand (aus
  `aovwhho1-zeitformate`), die Stärke, die eingeführten Kürzel und als Ablauf das Umstellen der
  Zeitdarstellung am Gerät.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lage-verdichtung`: Neue Anforderung, nach der die Stärke auf jeder Fläche ihre Schreibweise
  sichtbar nennt und ausgeschrieben beschreibbar ist; der Lagemonitor mit Summe.
- `bedien-wortlaut`: Neue Anforderung „Kürzel sind eingeführt oder erklärt“.
- `betroffene-lagedaten`: Die Notiz der Kennzahl „Verbleib offen“ lautet „wohin nicht erfasst · n
  unterwegs“.

## Impact

- **Frontend:**
  - `anzeige/staerke.ts` und `StaerkeAnzeige.tsx` (Etikett, Beschreibung)
  - Aufrufer im Überblick, Organigramm, Einsatzabschnitten, Meldebild, Lagebild, Großbild,
    Lagebesprechung, Kräfte-Verdichtungszeile, `kraefte/kraeftebild.ts` und `geraet/LagemonitorPage.tsx`
  - `pages/fuehrung/UeberblickPage.tsx` (UA)
  - `pages/lage-dashboard/lagebild.ts` (Verbleib offen)
- **Backend:** keins.
- **Anleitungen:** `frontend/AGENTS.md` (Kürzel-Regel); Anwenderdoku mit neuem Kapitel und den Texten
  zu Meldebild, Einheiten, Lagemonitor und Überblick in der Schreibweise „F/UF/M//Σ“.
