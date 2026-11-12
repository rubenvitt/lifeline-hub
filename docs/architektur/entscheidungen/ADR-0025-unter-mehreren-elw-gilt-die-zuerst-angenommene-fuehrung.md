---
id: ADR-0025
titel: Unter mehreren ELW an einem Hub gilt die zuerst angenommene Führung; die unterlegene ELW hält sie offen
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/instanz/fuehrung/**
herleitung:
  - openspec/changes/archive/2026-11-12-faq7l7m4-zwei-elw-unterlegene-seite/design.md
  - LLH-1669 (mit Ruben am 12.11.2026 abgestimmt)
---

# ADR-0025: Unter mehreren ELW an einem Hub gilt die zuerst angenommene Führung; die unterlegene ELW hält sie offen

## Regeln

- MUST: Die erreichte Seite lehnt die Epoche einer meldenden Seite ab, wenn die Führung weder bei
  ihr selbst noch bei dieser meldenden Seite liegt, auch wenn die Epoche größer ist.
- MUST: Führt die meldende Seite und nennt die Akte der erreichten Seite einen Dritten als Führer,
  hält sie diese Akte offen (`austausch::halte_offen`), gleich welche Epoche größer ist; sie
  verwirft sie nicht und löst keinen Alarm aus.
- MUST: Ob eine offene Übernahme ein Konflikt ist, sagt allein `austausch::ist_konflikt`.
- MUST NOT: Einer offenen Übernahme im Konflikt wird widersprochen (422); Bestätigen übernimmt den
  Stand der erreichten Seite, auch mit kleinerer Epoche.
- MUST: Nennt die erreichte Seite keinen Dritten mehr, erlischt der Konflikt.
- MUST: Führt die erreichte Seite laut ihrer Akte selbst, mit einer größeren Epoche einer dritten
  Instanz, zieht die meldende Seite ihre Führung still mit der nächsten Epoche nach
  (`austausch::ziehe_nach`), ohne Alarm.

## Prüfung

```sh
verlange 'pub fn ist_konflikt' src/instanz/fuehrung/austausch.rs
verlange 'async fn ziehe_nach' src/instanz/fuehrung/austausch.rs
verlange 'austausch::ist_konflikt' src/instanz/fuehrung/dienst.rs
verlange 'pub konflikt: bool' src/instanz/fuehrung/dienst.rs
```

## Kontext

Zwei Notübernahmen gegen denselben Führer gibt es nur, wenn mindestens zwei Instanzen nicht führen,
also bei mehreren ELW an einem Hub. Der Hub behielt schon die zuerst angenommene (Schutz vor dem
Diebstahl unter ELW), aber die unterlegene ELW erfuhr davon nichts und schrieb dauerhaft weiter.
Die größere Epoche gelten zu lassen, hätte eine schon arbeitende ELW nachträglich abgelöst und den
Diebstahlschutz geöffnet.

## Konsequenzen

Nach dem nächsten Meldetakt weiß die unterlegene ELW, wer führt, und gibt nach Bestätigung ab;
bis dahin schreiben beide, sichtbar im Hinweisband. Was sie in dieser Zeit erfasst hat, bleibt als
Bruchstelle gesichert und erreicht die führende ELW nicht. Es braucht kein neues Feld auf der
Leitung und keine Migration.
