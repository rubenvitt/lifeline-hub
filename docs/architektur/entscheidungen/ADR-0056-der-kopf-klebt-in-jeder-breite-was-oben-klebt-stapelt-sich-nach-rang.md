---
id: ADR-0056
titel: Der Kopf klebt in jeder Breite, und was oben klebt, stapelt sich nach Rang
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - frontend/src/components/rahmenOben.ts
  - frontend/src/einsatz/EinsatzLayout.tsx
  - frontend/src/components/AppLayout.tsx
  - frontend/src/live/LiveStatusBanner.tsx
  - frontend/src/components/instrument/Uebung.tsx
  - frontend/src/alarm/AlarmZone.tsx
herleitung:
  - openspec/changes/archive/2026-11-15-ejt520so-handy-kopfleiste-fixiert/design.md
  - Zunder LLH-1728 (Inhalt der Handy-Zeile, Reichweite und Stapel abgestimmt mit Ruben am 15.11.2026)
---

# ADR-0056: Der Kopf klebt in jeder Breite, und was oben klebt, stapelt sich nach Rang

## Regeln

- MUST: Die Kopfleiste von Einsatz- und App-Rahmen klebt in jeder Breite; Regel und Inhalt der
  Handy-Zeile: `frontend/AGENTS.md`, Rahmen, „Stehenbleiben“.
- MUST: Jede klebende Quelle des Rahmens meldet sich mit einem Rang aus `RAHMEN_RANG`
  (`frontend/src/components/rahmenOben.ts`) und nimmt ihr `top` aus `useRahmenObenStapel`, nie
  aus einer gerechneten Höhe.
- MUST NOT: Eine Quelle des Rahmens übernimmt `top: 0` aus `RAHMEN_KLEBT`, ohne es durch das `oben`
  aus dem Stapel zu ersetzen, auch nicht beim kleinsten Rang.
- SHOULD: Ein neues Element, das selbst oben klebt, hängt sich unter `--lfh-rahmen-oben`, statt
  einen eigenen Rang zu bekommen.

## Prüfung

```sh
verlange 'RAHMEN_RANG\.kopf' frontend/src/einsatz/EinsatzLayout.tsx
verlange 'RAHMEN_RANG\.kopf' frontend/src/components/AppLayout.tsx
verlange 'RAHMEN_RANG\.betriebszeile' frontend/src/live/LiveStatusBanner.tsx
verlange 'RAHMEN_RANG\.uebungsband' frontend/src/components/instrument/Uebung.tsx
verlange 'RAHMEN_RANG\.alarmzone' frontend/src/alarm/AlarmZone.tsx
verbiete 'mittel \? \{ \.\.\.KOPF_STIL, \.\.\.RAHMEN_KLEBT \}' frontend/src/einsatz/EinsatzLayout.tsx frontend/src/components/AppLayout.tsx
verbiete 'useRahmenObenQuelle' frontend/src/einsatz/EinsatzLayout.tsx frontend/src/components/AppLayout.tsx frontend/src/live/LiveStatusBanner.tsx frontend/src/components/instrument/Uebung.tsx
```

## Kontext

Am Handy rollte der Kopf mit (LFH-952: „am Handy zu teuer“), im ETB lag er nach dem Rollen
tausende Pixel über dem Fenster: kein Menü, kein Einsatzname, keine Verbindung, keine Uhr. Mit dem
Übungsband (LLH-1725) klebten dort zwei Quellen, mit dem Kopf drei; „Summe ohne mich“ trug nur eine
Quelle unter den übrigen. Zur Wahl standen der Kopf als einziger Träger der Störung, ein fester
Kopf mit Platzhalter und ein Stapel nach Rang.

## Konsequenzen

Der Kopf ist in jeder Breite erreichbar und bleibt am Handy einzeilig, weil Suche und Benutzermenü
dort in die Navigation wandern und die Alarmzentrale den Ruhezustand als Symbol zeigt. Betriebszeile,
Kopf, Übungsband und Alarmzone (LLH-1735, dort zuerst mit eigenen Rängen
eingeführt und hier zusammengeführt) stehen in fester Reihenfolge übereinander; gestört nimmt das am Handy oben über
110 px. Wer eine weitere klebende Rahmenquelle einführt, vergibt ihr einen Rang und ändert diese ADR.
