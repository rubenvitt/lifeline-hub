# Proposal

## Why

Drei Nachzüge aus LLH-1395 und LLH-1444 haben dieselbe Lücke: Eine Einheit trägt zwar den Verweis
auf ihre Nachforderung, aber nicht, auf welchem Weg er entstanden ist. Deshalb nennt die eingetroffene
Karte jede Einheit „übernommen“, auch eine, die am Raum eingetroffen ist (LLH-1445). Die Übernahme
scheitert mit 422 an einem gleichnamigen Fahrzeug ohne Einheit, das der Eintreffen-Weg seit LLH-1444
zur Einheit macht (LLH-1448). Und für den Storno einer am Raum verknüpften Einheit war offen, ob
er sie aus dem Raum bucht (LLH-1449).

Zunder: https://zunder.rubeen.dev/#/aufgabe/o659va5r2xyd5ok6mw03y7pd (LLH-1021) mit den
Unteraufgaben LLH-1445 (`d25v3ukf`), LLH-1448 (`n11hhwje`) und LLH-1449 (`zglesj5a`).

## What Changes

- **Herkunft am Raum festhalten (LLH-1445):** Jede Verknüpfung, die das Eintreffen am Raum setzt,
  wird an der Einheit markiert (neue Spalte, Migration 0250). Die Übernahme und der Storno setzen
  die Markierung zurück. Das DTO der Nachforderung nennt zusätzlich die Kennungen der am Raum
  verknüpften Einheiten. Die Karte zeigt „Am Raum eingetroffen: …“ und „Als Einheit übernommen: …“
  als getrennte Zeilen, je nach Einheit.
- **Übernahme macht ein gleichnamiges Fahrzeug ohne Einheit zur Einheit (LLH-1448):** Statt mit 422
  abzulehnen, überführt die Übernahme das Fahrzeug, wie es das Eintreffen am Raum tut. Steht das
  Fahrzeug in einem Raum, tritt es aus, und die neue Einheit tritt dort ein. Die Einheit gilt als
  von der Übernahme angelegt, ein Storno löst sie also auf. Eine gleichnamige Einheit und ein
  gleichnamiges Fahrzeug, das schon einer Einheit angehört, führen weiter in die 422.
- **Storno nach Verknüpfung am Raum (LLH-1449, Entscheidung 24.10.2026):** Er löst nur den Verweis,
  die Einheit bleibt im Raum. Das ist das heutige Verhalten. Es wird jetzt als Regel festgeschrieben
  und mit einem Test belegt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `nachforderung-einheit`: Die Übernahme überführt ein gleichnamiges Fahrzeug ohne Einheit, statt
  abzulehnen (Requirement „Eingetroffene Kräfte als Einheit übernehmen“, Szenario „Name schon im
  Einsatz“). Der Storno einer am Raum verknüpften Einheit bucht nicht aus („Storno einer
  Fehlübernahme“). Die Karte trennt „am Raum eingetroffen“ und „übernommen“ je Einheit, auch nach
  dem Eintreffen der Nachforderung („Verweis in beide Richtungen“).

## Impact

- **Backend:** `migrations/0250_*.sql` (neue Spalte an `einsatz_einheit`),
  `src/bereitstellungsraum/eintreffen.rs` (`verknuepfe_tx`, Überführung als gemeinsame Hilfe,
  Namensprüfung), `src/bereitstellungsraum/belegung_repo.rs` (Austritt eines Fahrzeugs mit Notiz),
  `src/einheit/aus_nachforderung.rs` (`uebernehmen_tx`, `stornieren_tx`, ETB-Wortlaut),
  `src/routes/einsatz_einheit.rs` (Live für Fahrzeuge und Räume der Überführung),
  `src/nachforderung/mod.rs` und `repo.rs` (DTO-Feld `einheit_ids_am_raum`).
- **Frontend:** `frontend/src/nachforderungen/nurVorwaerts.ts` (`einheitenEinleitung` je
  Einheit) und `NachforderungKarte.tsx` (`UebernommeneEinheiten` in zwei Gruppen), generierte Typen.
- **API:** Das Antwortfeld `einheit_ids_am_raum` kommt additiv hinzu. Eine Übernahme, die bisher mit
  422 abgelehnt wurde, gelingt jetzt.
- **Doku:** Ein Anwenderkapitel zur Nachforderung, falls es die Einleitung der Karte beschreibt.
