# Proposal

## Why

Eine aufgelöste Einheit (LLH-1079) bleibt mit Zeitachse und ETB-Bezügen im Nachweis, lässt sich
aber nicht mehr öffnen: die Einheit-Ansicht sucht nur in der aktiven Liste und zeigt „Diese
Einheit gibt es nicht (mehr)“. Für Nachweis und Lagebericht muss man sehen können, wer und was
zur Einheit gehörte und wann sie aufgelöst wurde. Das geht heute auch mit Datenzugriff nicht: das
Auflösen setzt `einheit_id` an Personal, Fahrzeug und Material und `fuehrer_id` an der Einheit auf
`NULL`, die letzte Besetzung steht danach nirgends mehr. Nachzug aus LLH-1036 (LLH-1266).

## What Changes

- **Auflösen hält die letzte Besetzung fest:** in derselben Transaktion, bevor die Bindungen
  gelöst werden, schreibt der Server je Person (samt Führer-Kennzeichen und Fahrzeug, auf dem sie
  saß), je Fahrzeug und je Materialposten (samt Menge) eine Zeile in eine neue Tabelle. Nur, wenn
  die Einheit als aufgelöst stehen bleibt; eine ohne Spur gelöschte oder stornierte Einheit hält
  nichts fest.
- **Der Server liefert sie mit:** `GET …/einheiten?aufgeloeste=1` trägt je Einheit das neue Feld
  `letzte_besetzung` (Personen, Fahrzeuge, Material mit Namen aus den Dispositionszeilen;
  stornierte Kräfte fehlen). Fehlt es, wurde die Einheit vor dieser Änderung aufgelöst und es gibt
  nichts festgehaltenes. Aktive Einheiten tragen das Feld nie.
- **Lesende Ansicht einer aufgelösten Einheit** unter derselben Route
  `/einsaetze/:id/einheiten/:einheitId`: Kopf mit „aufgelöst“ und Zeitpunkt, Kopfdaten als Werte,
  letzte Besatzung nach Fahrzeugen gegliedert, Fahrzeuge, Material, Zeitachse. Keine
  Bearbeiten-Aufforderung, kein Menü, keine Auswahl, kein Auflösen, auch mit Schreibrecht;
  Links bleiben.
- **Einstieg aus dem Block „Aufgelöst“** der Einheitenliste: jeder Name wird ein Link auf die
  Ansicht.
- **Einstieg aus dem ETB:** der System-Eintrag „Einheit «…» aufgelöst“ nennt die Einheit in
  `etb_eintrag_einheit`; der ETB-Eintrag trägt auf dem Draht die Einheiten, die er nennt
  (`einheiten`), und die Zeitachse zeigt je Einheit einen Verweis „Einheit «Name» ↗“ auf ihre
  Ansicht. Das gilt auch für die bestehenden Auftragseinträge (Empfänger, LLH-1175).

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `kraefte-entlassung`: „Einheit auflösen“ hält die letzte Besetzung fest; „Beendete Kräfte in
  Listen und Zahlen“ macht die Einträge des Blocks „Aufgelöst“ zu Links.
- `einheit-ansicht`: neue Anforderung „Aufgelöste Einheit nur lesend“.
- `etb-vorgaenge`: neue Anforderung „Verweis auf genannte Einheiten“ (Draht und Zeitachse).

## Impact

- **Backend:** neue Migration (Tabelle der letzten Besetzung), `src/einheit/repo.rs`
  (`aufloesen_tx`, `list_aufgeloeste`), `src/einheit/mod.rs` (DTO `LetzteBesetzung`),
  `src/routes/einsatz_einheit.rs` (`end_einheit` verknüpft den ETB-Eintrag), `src/etb/`
  (DTO-Feld `einheiten`, Nachladen je Seite wie `folgeauftraege`), Wächter für neue Tabellen
  (Schwärzungsregister, Zustandswächter der Kräftetabellen, Transfer/Demo), Typ-Codegen.
- **Frontend:** `pages/EinheitDetailPage.tsx` (Rückfall auf die aufgelösten), neue lesende
  Ansicht unter `pages/einheit/`, `pages/EinheitenPage.tsx` (`ziel` am Block „Aufgelöst“),
  `etb/EtbBacklinkBadges.tsx`, generierte Typen.
- **e2e:** Sprung aus dem ETB-Eintrag „aufgelöst“ in die lesende Ansicht.
- **Daten:** Einheiten, die vor der Migration aufgelöst wurden, bekommen keine nachträgliche
  Besetzung (nicht rekonstruierbar); die Ansicht sagt das.
