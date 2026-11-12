---
id: ADR-0024
titel: Die Verwahrung wechselt die Führung; einen verwahrten Einsatz gibt der Hub nicht mehr ab
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/instanz/fuehrung/**
  - src/instanz/spiegel/lebensende.rs
herleitung:
  - LLH-1647 (Entwurf E1–E4, mit Ruben am 11.11.2026 abgestimmt)
  - LLH-1494 (Verwahrung am Hub, PR #1279)
---

# ADR-0024: Die Verwahrung wechselt die Führung; einen verwahrten Einsatz gibt der Hub nicht mehr ab

## Regeln

- MUST: `lebensende::umwandeln` vergibt bei eingeschalteter Führung die nächste Epoche mit Art
  `verwahrung` (`fuehrung::repo::verwahren`) und schreibt den Verlauf; die Quittung `angenommen`
  trägt diese Epoche.
- MUST: Die meldende Seite wendet eine Epoche `verwahrung` nie an. Ist die Übergabe quittiert,
  räumt sie ab; sonst lehnt sie ohne Alarm ab und führt mit der nächsten Epoche weiter.
- MUST NOT: Eine Quittung `angenommen`, deren Epoche unter der eigenen Akte liegt, räumt ab.
- MUST NOT: Ein verwahrter Einsatz wird übergeben, per Code abgegeben oder einer Anfrage oder
  Notübernahme überlassen. Einzige Ausnahme ist die Ablehnung durch die übergebende Seite.

## Prüfung

```sh
verlange 'fuehrung::repo::verwahren\(' src/instanz/spiegel/lebensende.rs
verlange 'fn verwahrung_abgelehnt\(' src/instanz/spiegel/lebensende.rs
verlange 'fn verwahrung_ablehnen\(' src/instanz/fuehrung/austausch.rs
verlange 'fn fordere_nicht_verwahrt\(' src/instanz/fuehrung/dienst.rs
```

## Kontext

Nach der Nachbereitung übergibt ein ELW einen Einsatz dem Hub zur Verwahrung (LLH-1494). Ohne
Wechsel der Führung nannte die Akte weiter den ELW; der Hub machte den Einsatz deshalb wieder zum
Spiegel und räumte ihn ab, sobald der ELW sein Lebensende meldete. Akte (Meldung) und Quittung
(Spiegel-Abgleich) reisen auf getrennten Wegen und können sich überholen.

## Konsequenzen

Der Verlauf zeigt, wer den Einsatz bis zur Verwahrung führte. Lehnt der ELW ab, wird der Hub
wieder Spiegel, und das nächste Angebot läuft mit einer neuen Epoche; eine veraltete Quittung
räumt nichts ab. Wer einen verwahrten Einsatz zurück will, braucht einen neuen Weg (heute keiner).
