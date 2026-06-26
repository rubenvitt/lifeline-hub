# Persistenz der Basemap-Wahl — Entscheidung (LFH-34)

**Status:** entschieden (kein Code) · **Datum:** 2026-06-25 · **Board:** LFH-34 (Epic LFH-56 „Lagekarte – Karten-Technik & Basemap")

## Problem

Die zuletzt gewählte Basemap (Modus `online/offline/blind` + Online-View) wird pro Einsatz
im `localStorage` gemerkt (`frontend/src/pages/lagekarte/basemapAuswahl.ts`, verdrahtet in
`LagekartePage.tsx`). Bewusst als schnelle, backendlose Lösung umgesetzt. Offene Produktfrage:
Reicht die Pro-Gerät-Semantik von `localStorage`, oder braucht die Kartenwahl eine robustere,
gerätübergreifende Persistenz?

`localStorage`-Grenzen: gilt nur pro Gerät/Browser; nicht serverseitig/teilbar; geht bei
Browser-Reset, Privatmodus, Quota-Clearing verloren.

## Bewertete Optionen

| Faktor (Gewicht) | A: localStorage/Einsatz | B: Backend geteilt | C: Backend pro User & Einsatz |
|---|---|---|---|
| Passung zur Natur der Wahl — Modus hängt von Gerät+Netz ab (40) | **5** | 1 | 2 |
| Aufwand/Wartung — Migration, Endpoint, Auth-Scope (25) | **5** | 3 | 1 |
| Offline-Tauglichkeit — Schreiben/Lesen ohne Netz (20) | **5** | 2 | 2 |
| Multi-Device-Konsistenz (10) | 1 | 5 | 5 |
| Robustheit — überlebt Reset/Privatmodus/Quota (5) | 3 | 5 | 5 |
| **Score (×Gewicht, max 500)** | **450** | 230 | 220 |

Kein knappes Rennen. Sensitivität: Selbst bei vollständigem Streichen des Top-Faktors
(Passung) führt A weiter (250 vs. 190/140) — getragen von Aufwand + Offline. Das Ergebnis
wackelt nicht.

## Entscheidung

**`localStorage` pro Einsatz bleibt (Status quo) — bewusst bestätigt.** Kein Backend, keine
Migration.

### Begründung (Multi-User-/Multi-Device-Verhalten)

Der Basemap-**Modus** (`online/offline/blind`) ist eine **geräte- und netzabhängige**
Anzeigeentscheidung, keine geteilte Sachstandsinformation. Eine gerätübergreifende
Synchronisierung (Option C) wäre nicht nur unnötig, sondern **schädlich**: `modusGueltig` in
`basemapAuswahl.ts` validiert nur gegen die *Server*-Config (`online_styles.length > 0`,
`pmtiles_verfuegbar`), **nicht** gegen die Konnektivität *dieses* Geräts. Ein gerätübergreifend
gesynctes `online` bestünde die Validierung und würde dann auf einem Gerät im Funkloch nicht
rendern. Genau der eine Zustand, den man syncen würde, ist der, der nicht reisen darf.
Option B (eine geteilte Spalte) ist noch schlechter — sie zwingt allen Geräten/Personen
denselben Modus auf, obwohl jedes Endgerät einen anderen Konnektivitäts-Kontext hat.

### Stützende Punkte

- **Geteilter Startpunkt existiert bereits serverseitig:** `basemap_modus` (LFH-131, aus
  `einstellungenQuery`) liefert den gemeinsamen Einsatz-Default. Die Schichtung ist sauber:
  *Backend-Default (geteilt) → Geräte-Personalisierung (`localStorage`) → Verfügbarkeits-Fallback*
  (`waehleInitialeBasemap`). LFH-131s Default deckt dabei nur den **Modus** ab.
- **Modus vs. Online-View getrennt:** Der Online-View ist eine fast reine Präferenz und wäre
  teilbar — aber keine eigene Backend-Tabelle wert.
- **Benigne Failure-Mode:** Fehlt `localStorage` (Privatmodus/Quota), degradiert das `try/catch`
  in `merkeLetzteBasemap`/`liesLetzteBasemap` sauber auf den LFH-131-Einsatz-Default. Die
  „Schwäche" landet auf dem richtigen Sicherheitsnetz statt in einem kaputten Zustand.

### Scope: pro Einsatz vs. global

**Pro Einsatz bleibt.** Verschiedene Einsätze haben unterschiedliche Verfügbarkeiten
(`online_styles`/`pmtiles`) und Konnektivitäts-Kontexte. Eine globale persönliche Default-Basemap
(über alle Einsätze) wäre ein billiges Nice-to-have für den Ersteinstieg in einen neuen Einsatz,
aber der Bedarf ist unbestätigt → nicht jetzt. Mögliche spätere, billige Ergänzung: globaler
persönlicher Default-Modus als zusätzlicher `localStorage`-Fallback vor dem Verfügbarkeits-Default.

## Akzeptanzkriterien (LFH-34)

- [x] Entscheidung dokumentiert (Semantik + Begründung, inkl. Multi-User-/Multi-Device-Verhalten) → dieses Dokument
- [x] `localStorage` bleibt: Pro-Gerät-Semantik bewusst als ausreichend (sogar fachlich korrekter) bestätigt
- [—] Kein Backend gewählt → keine Migration/Endpoint/Frontend-Anbindung nötig

## Referenzen

- `frontend/src/pages/lagekarte/basemapAuswahl.ts` (`waehleInitialeBasemap`, `merkeLetzteBasemap`, `liesLetzteBasemap`)
- `frontend/src/pages/LagekartePage.tsx` (Verdrahtung, Init-Effekt ~Z. 208–225)
- LFH-131: serverseitiger Einsatz-Default `basemap_modus` (`einstellungenQuery.data?.basemap_modus`)
