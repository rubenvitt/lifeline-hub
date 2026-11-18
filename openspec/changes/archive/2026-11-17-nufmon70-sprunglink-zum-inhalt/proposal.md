# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/nufmon701h5c64to13lswiwf (LLH-1828)
Teil von LLH-1812 „Grundmuster: Zustände, Hilfe, Tastatur, Sprache“, Welle 1.

## Why

Wer mit der Tastatur arbeitet, drückt im Überblick 22-mal Tab, bevor der Fokus im Inhalt
ankommt, in den Betroffenen 24-mal. Davor liegen Kopfleiste, Rail und Modulpanel.
Einen Sprunglink zum Inhalt (WCAG 2.4.1) gibt es nirgends. Nur das ETB umgeht das Problem: Es
setzt den Fokus selbst ins Erfassungsfeld.

## What Changes

- Der erste Tab-Druck auf jeder Seite mit Rahmen (Einsatz, Ebene 1, Verwaltung, Planungen) und
  auf der Hilfe zeigt oben links einen Knopf „Zum Inhalt springen“. Er steht sogar vor der
  Betriebszeile, auch wenn diese bei einer Störung Knöpfe trägt.
- Enter darauf setzt den Fokus an den Anfang des Inhalts. Der nächste Tab-Druck landet auf dem
  ersten Bedienelement der Seite. In der Verwaltung ist das der Inhalt neben dem Menü, nicht das
  Menü selbst.
- Ohne Fokus bleibt der Link unsichtbar und verschiebt nichts. Mit Fokus liegt er über dem Kopf,
  ohne das Layout zu verschieben.
- Das doppelte `<main>` der Verwaltung (Inhalt im Inhalt) fällt dabei weg.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatztauglichkeit-layout`: neue Anforderung „Ein Sprunglink führt zum Inhalt“.

## Impact

- **Frontend:**
  - neuer Baustein `components/SprungZumInhalt.tsx` mit Klasse in `theme/sprache.css`
  - `App.tsx` (`BetriebsLayout`)
  - Sprungziel in `components/AppLayout.tsx`, `einsatz/EinsatzLayout.tsx`, `admin/AdminLayout.tsx`
    und `hilfe/HilfePage.tsx` (eigener Link, die Hilfe liegt außerhalb von `BetriebsLayout`)
  - eine e2e-Spec
- **Regeln und Doku:**
  - `frontend/AGENTS.md`, Abschnitt zum Rahmen
  - Anwenderkapitel zur Einsatzoberfläche, wenn es die Tastaturbedienung beschreibt
- **Nicht enthalten:** die Gerätehülle. Sie hat ein eigenes rollendes `<main>` und wenige Halte
  vor dem Inhalt.
- Kein Backend.
