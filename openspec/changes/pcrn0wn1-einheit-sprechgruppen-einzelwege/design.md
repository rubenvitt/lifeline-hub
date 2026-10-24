# Design

## Context

- `EinheitFunk` (Einheit-Ansicht, LLH-1036/LLH-1134) speichert die Zeile „Sprechgruppen“ über
  `InlineAngabe` und `onPatch('Sprechgruppen', { sprechgruppe_ids })`. Der Server ersetzt die Menge
  (`sprechgruppe::repo::setze_einheit_sprechgruppen` → `ersetzen_tx`).
- Die Einzelwege `PUT/DELETE /api/einsaetze/{id}/einheiten/{eid}/sprechgruppen/{sg}` (LFH-893 D5)
  sind idempotent, prüfen wie der PATCH, senden das `einheit`-Live-Ereignis nur bei Wirkung und
  antworten `204` ohne Körper. Sie schreiben heute kein ETB; der Test
  `gleiches_live_und_keine_etb_wirkung_wie_der_patch` sichert das für alle vier Ziele.
- Die Fernmeldeskizze ordnet Einheiten über genau diese Wege zu
  (`api/fernmeldeskizze.ts`, `ordneSprechgruppeZu`). Ihre Spec verlangt: „Eine Zuordnung aus der
  Skizze MUST im ETB dieselbe Wirkung haben wie dieselbe Zuordnung über den Datensatz“
  (`stab-fernmeldeskizze-bearbeitung`, „Kein ETB je Skizzenänderung“).
- `InlineAngabe` kennt `onOeffnen` (LLH-1103): der Aufrufer hält dort den Serverstand fest. Ein
  neuer Serverstand während der Bearbeitung ändert den Entwurf nicht.

## Goals / Non-Goals

**Goals:**
- Zwei Arbeitsplätze verlieren keine Sprechgruppen-Änderung des anderen.
- Jede wirksame Sprechgruppen-Änderung einer Einheit steht im ETB, aus Ansicht und Skizze gleich.

**Non-Goals:**
- Abschnitt und Führungsstelle (gleiches Muster, eigener Nachzug).
- Der Server-PATCH mit `sprechgruppe_ids` bleibt, wie er ist (ohne ETB). Kein Client der Einheit
  nutzt ihn danach noch; ihn zu entfernen wäre eine Wire-Änderung (`AGENTS.md`,
  „Bezeichner-Sprache“, Grenzwerte).
- Keine Sammelanfrage („Delta-Endpunkt“), keine Migration.

## Decisions

### D1 · Diff gegen den Stand beim Öffnen, nicht gegen den aktuellen

`EinheitFunk` merkt sich in `onOeffnen` die IDs der Zeile (Ref). Beim Speichern:
`hinzu = neu \ beimOeffnen`, `weg = beimOeffnen \ neu`.

- *Verworfen:* Diff gegen den aktuellen Cache-Stand. Kommt während der Bearbeitung live „505“ von
  einem anderen Arbeitsplatz hinzu, fehlt „505“ im Entwurf, und der Diff würde es lösen. Genau das
  Verlustbild, das die Aufgabe beseitigt.
- *Verworfen:* Entwurf bei neuem Serverstand nachführen. `InlineAngabe` tut das bewusst nicht
  (ein laufender Entwurf ändert sich nicht unter der Hand).

### D2 · Nacheinander senden, zuerst lösen, dann zuordnen; bei Ablehnung anhalten

Die Seite schickt die Anfragen der Reihe nach (eine `useMutation` mit `{ hinzu, weg }`), erst alle
Lösungen, dann alle Zuordnungen. Die erste Ablehnung bricht ab und lehnt das Versprechen ab:
`InlineAngabe` lässt die Zeile mit dem Entwurf offen und zeigt den Grund (Spec „Fehler am Ort der
Handlung“). In jedem Fall (Erfolg wie Ablehnung) lädt die Seite danach `einheiten` und `etb` neu
und wartet auf `einheiten`, damit die Zeile den gespeicherten Stand zeigt (Vertrag von
`onSpeichern`: „erfüllt erst, wenn der neue Stand im Cache steht“). Erfolgsmeldung wie bisher
„Sprechgruppen gespeichert“.

- *Verworfen:* parallel (`Promise.allSettled`). Spart bei üblich ein bis zwei Änderungen nichts,
  macht die Reihenfolge der ETB-Einträge zufällig und die Teilablehnung schwerer zu benennen.
- Reihenfolge lösen → zuordnen: so liest sich ein Tausch im ETB als „entfernt … zugeordnet“.

### D3 · ETB im Einzelweg der Einheit, nur bei Wirkung

`sprechgruppe_zuordnen`/`sprechgruppe_loesen` in `routes/einsatz_einheit.rs` schreiben nach einer
wirksamen Änderung (`einzeln_zuordnen`/`einzeln_loesen` liefern `true`) einen System-Eintrag über
`etb_system_degradiert` (Muster Führerwechsel: nach dem Schreiben, ein ETB-Fehler macht die
Zuordnung nicht rückgängig). Text: `Einheit «{name}»: Sprechgruppe «{bezeichnung}» ({TMO|DMO})
zugeordnet` bzw. `… entfernt`. Name über das Einheit-Repo, Sprechgruppe über
`sprechgruppe::repo::laden` (Org-gebunden; einsatz-lokale tragen die Org ebenfalls).

- *Verworfen:* ETB im Client (eigener ETB-POST je Änderung). Zwei Anfragen statt einer, und die
  Skizze wäre ausgenommen, was die Skizzen-Spec verletzt („dieselbe Wirkung wie über den
  Datensatz“).
- *Verworfen:* ETB auch für Abschnitt, Führungsstelle und externe Stelle. Fachlich naheliegend,
  aber außerhalb des Auftrags; gehört mit deren Umstellung in den Nachzug.
- *Verworfen:* auch der PATCH schreibt je Delta ins ETB. Er hat nach dieser Change keinen
  Einheit-Client mehr; den alten Stand vor `ersetzen_tx` zu lesen, kostet Code ohne Nutzen.

### D4 · Typen halten die Ansicht auf dem Einzelweg

`EinheitPatch` wird `Partial<Omit<EinheitEingabe, 'sprechgruppe_ids'>>`. `bildeEinheit` (POST)
behält `sprechgruppe_ids` in `EinheitEingabe`. Neue Client-Funktionen
`ordneEinheitSprechgruppeZu`/`loeseEinheitSprechgruppe` in `api/einheiten.ts` bauen den Pfad;
`api/fernmeldeskizze.ts` bleibt bei seinem eigenen Pfadbau (anderer Zuschnitt über
`ZuordnungsZiel`).

- *Erwogen:* `ordneSprechgruppeZu({ art: 'einheit' })` aus der Skizze wiederverwenden. Verworfen,
  weil die Einheit-Ansicht damit vom Skizzen-Client abhinge; die zwei Pfadzeilen sind billiger als
  die Kopplung.

## Risks / Trade-offs

- [Teilweise gespeichert, wenn eine von mehreren Anfragen scheitert] → Seite lädt den Stand nach,
  die Zeile bleibt mit dem Entwurf offen; ein erneutes Speichern schickt nur noch, was fehlt (der
  Ref-Stand gilt bis zum Schließen weiter, idempotente Wege machen Wiederholung harmlos).
- [Skizze schreibt jetzt ETB-Einträge für Einheiten, auch bei „Rückgängig“ zwei Einträge] → gewollt:
  das ETB hält fest, was geschah; Spec der Skizze verlangt dieselbe Wirkung.
- [Uneinheitlich: Einheit mit ETB, Abschnitt/Führungsstelle ohne] → Nachzug als Zunder-Aufgabe;
  bis dahin im Test ausdrücklich so festgehalten.
- [Viele Änderungen auf einmal = viele Anfragen] → realistisch ein bis drei; kein Handlungsbedarf.

## Migration Plan

Keine Daten- oder Schemaänderung. Rücknahme: Revert des Commits; der PATCH-Weg besteht weiter.
