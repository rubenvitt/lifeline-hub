---
id: ADR-0029
titel: Eine Erklärung, die das Gegenüber ablehnen würde, lehnt der Sender ab, bevor sie lokal gilt
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/instanz/fuehrung/**
herleitung:
  - openspec/changes/archive/2026-11-12-a13nxa2k-notuebernahme-erklaerung-begrenzen/design.md
  - LLH-1702 (mit Ruben am 12.11.2026 abgestimmt), LLH-1672
---

# ADR-0029: Eine Erklärung, die das Gegenüber ablehnen würde, lehnt der Sender ab, bevor sie lokal gilt

## Regeln

- MUST: Jeder Text einer Erklärung, der in die Akte oder unter eine Unterschrift geht, kommt aus
  `dienst::erklaerung_text`. Sie prüft gegen `austausch::ERKLAERUNG_MAX`, dieselbe Konstante und
  dasselbe Maß (Byte des Texts), mit dem die empfangende Seite eine Akte annimmt.
- MUST: Ist die Erklärung zu groß, antwortet der Server mit 422, bevor Epoche, führende Instanz
  oder Verlauf geschrieben sind.
- MUST: Als Unterzeichner trägt eine Erklärung `auth::truncate_anzeigename(…)`, also höchstens
  `auth::ANZEIGENAME_MAX` Zeichen des Anzeigenamens. Gekürzt wird nur der Unterzeichner.
- MUST NOT: Der Grund wird nicht gekürzt und nicht von Zeichen bereinigt; er steht in der
  Erklärung, wie die Person ihn eingegeben hat, oder die Notübernahme wird abgelehnt.
- SHOULD: Eine neue Grenze der empfangenden Seite an einem Feld, das diese Instanz selbst erzeugt,
  bekommt dieselbe Prüfung an der Stelle, an der das Feld entsteht.

## Prüfung

```sh
verlange 'pub fn erklaerung_text' src/instanz/fuehrung/dienst.rs
verlange 'pub\(super\) const ERKLAERUNG_MAX' src/instanz/fuehrung/austausch.rs
verlange 'unterzeichner: crate::auth::truncate_anzeigename' src/instanz/fuehrung/dienst.rs
verbiete 'erklaerung = Some\(e\.to_text\(\)\)' src/instanz/fuehrung/dienst.rs
```

## Kontext

Seit LLH-1672 schickt der Ausgang eine Akte nicht, die das Gegenüber ablehnen würde, und setzt
einen Hinweis an der Kopplung. Eine Notübernahme mit zu großer Erklärung galt lokal trotzdem:
Beide Seiten hielten sich für die führende Instanz. Die Größe hängt am Grund und am Anzeigenamen
des Unterzeichners, der keine Grenze hatte. Eine Grenze am Namen allein reicht nicht, weil die
Erklärung in Byte gemessen wird und Steuerzeichen in JSON sechs Byte kosten.

## Konsequenzen

Ein Konto mit altem, überlangem Namen kann im Notfall weiter übernehmen; die Erklärung nennt den
Anfang des Namens, der lokale Verlauf den ganzen. Der 422 ist mit gewöhnlichem Text nicht
erreichbar und bleibt deshalb nur über Tests an der Bytegrenze lebendig. Nur ablehnen hätte die
Notübernahme an einem Namen scheitern lassen, aufs Restbudget kürzen den Namen beliebig
verstümmelt.
