# Proposal

## Why

Der Einsatzbericht aus LFH-726 hat einen festen Umfang. Wer nur einen Teil braucht, etwa
Stammdaten, Zeiten und Kräfte für die Abrechnung, druckt heute alles und sortiert Papier aus.
Wer die Bilanz nicht lesen darf, kann gar nicht drucken, obwohl er sie nicht braucht. Und für
den Helfernachweis (Freistellung, Verdienstausfall, Abrechnung) fehlt die Einsatzzeit je
Person. LFH-726 hat beides beim Scoping bewusst in diesen Folgetask gelegt.

## What Changes

- **Blöcke an- und abwählen:** Über dem Bericht steht am Bildschirm eine Auswahl der Blöcke. Ein
  abgewählter Block fehlt im Ausdruck ganz. Mindestens ein Block bleibt gewählt.
- **Auswahl in der Adresse:** `…/einsatzdaten/bericht?bloecke=stammdaten,zeiten,kraefte`. Die
  Adresse ist teilbar und übersteht ein Neuladen. Unbekannte Schlüssel werden verworfen. Ohne
  Parameter (oder ohne gültigen Schlüssel) gilt der **Standardumfang**, also genau der Bericht
  aus LFH-726.
- **Druckkopf nennt den Umfang:** „Standardumfang“ oder „Auswahl: …“ mit den gedruckten Blöcken
  in Druckreihenfolge, wie die Auswahlzeile im ETB-Druck.
- **Nur abrufen, was gedruckt wird:** Freigabe-Weiche und Abruf gelten nur für die Quellen der
  gewählten Blöcke. „Vollständig oder gar nicht“ bezieht sich auf die gewählte Menge. Wer die
  Bilanz abwählt, braucht kein Leserecht an Personen oder Schäden.
- **Zwei optionale Anlagen, standardmäßig aus**, am Ende des Berichts:
  - **Anlage Einheiten mit Einsatzzeiten:** je Einheit Beginn, Ende und Einsatzzeit aus der
    Kräfte-Zeitachse. Ohne Personenbezug.
  - **Anlage Personal je Kopf:** je Einsatzkraft Name, Funktion, Einheit, Beginn, Ende und
    Einsatzzeit, als Helfernachweis. Sie enthält Namen von Einsatzkräften, nie von Betroffenen.
    Ist sie gewählt, sagt der Druckkopf das ausdrücklich.
- **Fahrzeuge mit Einsatzzeiten entfallen:** Fahrzeuge haben keine eigene Zeitachse. Eine aus
  der Einheit abgeleitete Zeit wäre erfunden (Begründung in `design.md`, D5).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatzbericht`: Die Blockreihenfolge kennt einen Standardumfang und zwei optionale Anlagen.
  „Vollständig oder gar nicht“ gilt für die gewählten Blöcke. Neu sind die Auswahl in der
  Adresse, die Umfangszeile im Druckkopf und die beiden Anlagen samt Regeln zum Personenbezug.

## Impact

- **Frontend only**, kein neuer Endpunkt, keine Migration, kein DTO.
- `druck/einsatzbericht/quellen.ts` (Blockliste mit Standard/optional, Quelle → mehrere Blöcke,
  Weiche je Auswahl), neues `druck/einsatzbericht/auswahl.ts` (Adresse lesen und schreiben,
  Kopfzeile), `abruf.ts` und `verdichtung.ts` (nur gewählte Blöcke, zwei Anlagen),
  `pages/EinsatzberichtDruckPage.tsx` (Auswahlleiste, Kopfzeile), `routing/deeplinks.ts`
  (`einsatzberichtPfad` mit Auswahl), `api/queryKeys.ts` (Schnappschuss-Key je Auswahl).
- Tests: Vitest für Auswahl, Weiche und Verdichtung; e2e `einsatzbericht-druck.spec.ts` erweitert.
- Regel: `frontend/src/druck/AGENTS.md`, Abschnitt Einsatzbericht.
