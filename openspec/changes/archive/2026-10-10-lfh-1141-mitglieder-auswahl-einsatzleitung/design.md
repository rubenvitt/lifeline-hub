## Context

Motivation: proposal.md, „Why“.

- Der Schreibweg ist schon richtig geschnitten: `mitglied_setzen` (`src/routes/einsatz.rs`) steht
  hinter `EinsatzLeitungszugriff` (Org-Floor → Einsatzleitung → `fordere_aktiv`) und nimmt nur
  aktive Personenkonten der Einsatz-Org an. Der Org-Guard sitzt zusätzlich im SQL von
  `repo::setze_mitgliedschaft` (F05/LFH-232).
- Daraus folgt: **Jede Mitgliedschaft und damit jede Einsatzleitung gehört zur Organisation des
  Einsatzes.** Die Anlage trägt den Ersteller ein, und `setze_mitgliedschaft` lässt nichts
  anderes durch. „Personen der eigenen Organisation“ und „Personen der Einsatz-Org“ sind für die
  Einsatzleitung dieselbe Menge.
- Die Lücke liegt nur im Lesen: `MitgliederAbschnitt.tsx` füllt die Auswahl aus
  `GET /api/benutzer` (`AdminUser`, alle Orgs, volle Verwaltungsdarstellung).
- Gerätesitzungen erreichen nur Routen ihrer Ansicht (`src/geraet/mod.rs`, Positivliste, Guard
  `tests/geraet_routen_guard.rs`). Eine neue Route ist für Geräte also ohne Zutun gesperrt.

## Goals / Non-Goals

**Goals:**
- Die Einsatzleitung bekommt eine Auswahl, die genau die Menge zeigt, die `mitglied_setzen`
  annimmt, und keine Angabe darüber hinaus.

**Non-Goals:**
- Die Benutzerverwaltung (`GET /api/benutzer`) bleibt, wie sie ist, auch ihre fehlende
  Org-Filterung für System-Admins. Die anderen Abnehmer (`PersonalDetailPage`,
  `ZugangsprotokollPage`) bleiben auf ihr.
- Kein Aufnehmen von Personen fremder Organisationen, keine Suche, keine Seitenkette: eine
  Organisation hat Dutzende, nicht Tausende Konten, und die antd-Auswahl filtert lokal.
- Kein Live-Ereignis für die Auswahl.

## Decisions

### D1 Eigener Lese-Endpunkt am Einsatz

`GET /api/einsaetze/{id}/mitglieder/auswahl`, Gate `EinsatzLeitungszugriff` (ohne Modul), Antwort
`Vec<MitgliedAuswahl { benutzer_id, anzeigename }>`, sortiert nach Anzeigename (ohne Groß-/
Kleinschreibung), dann Kennung.

Das Gate ist dasselbe wie das des Schreibwegs, den die Auswahl speist: Wer die Liste sieht, kann
aus ihr auch aufnehmen, und umgekehrt. Am abgeschlossenen Einsatz verweigert `fordere_aktiv` sie
wie den Schreibweg.

Der Pfad hängt unter `mitglieder`, weil er dessen Kandidaten liefert. matchit zieht das statische
Segment `auswahl` dem Parameter `{benutzer_id}` vor; `PUT`/`DELETE` auf `…/mitglieder/{benutzer_id}`
bleiben unberührt (ein Benutzer mit der Kennung „auswahl“ existiert nicht, Kennungen sind Zahlen).

**Verworfen:**
- *`GET /api/benutzer` für Nicht-Admins öffnen und je Rolle filtern:* vermischt Verwaltung und
  Auswahl in einem Handler, die Antwort trüge Benutzername, Rollen und MFA-Status, oder sie
  bekäme je Aufrufer eine andere Form. Ein Fehler in der Verzweigung legte die
  Verwaltungsdaten der Org offen.
- *Org-weiter Endpunkt `GET /api/organisation/personen`:* das Recht hängt an der Rolle im Einsatz,
  nicht an der Org. Ein Org-Endpunkt bräuchte ein eigenes Gate („ist irgendwo Einsatzleitung“)
  und zeigte die Liste auch ohne Bezug zu einem Einsatz.

### D2 Die Menge ist die Vorbedingung von `mitglied_setzen`

Die Abfrage spiegelt die Vorabprüfung des Schreibwegs: `b.org_id = e.org_id`, `b.aktiv = 1`,
`OHNE_GERAETEKONTEN`, dazu `NOT EXISTS` einer Mitgliedschaft im Einsatz. Damit führt jeder
angebotene Eintrag zu einem erfolgreichen `PUT`, und kein abgewiesener wird angeboten.

Die Bedingungen stehen in `src/einsatz/repo.rs` neben `mitglieder`. Den Filter teilen sich
Auswahl und Vorabprüfung nicht als gemeinsames SQL-Fragment: die Vorabprüfung muss „deaktiviert“
(409) von „unbekannt“ (404) unterscheiden, die Auswahl filtert beides weg. Ein Test hält beide
Seiten zusammen (D4).

### D3 Schmale Antwort

Nur `benutzer_id` und `anzeigename`. Der Benutzername ist die Anmeldekennung und bleibt in der
Benutzerverwaltung; die Mitgliederliste zeigt ihn für Mitglieder weiter wie bisher. Die Auswahl
zeigt heute schon nur den Anzeigenamen, die UI verliert also nichts.

### D4 Tests

- Backend-Integrationstest unter `tests/` (`einsatz_mitglieder_auswahl.rs`): Einsatzleitung ohne
  Systemrolle bekommt 200 mit genau der aktiven Nicht-Mitglied-Person; Mitglied, deaktiviertes
  Konto, Gerätekonto und eine Person einer zweiten Org fehlen; Führungspersonal, Beobachter,
  System-Admin ohne Rolle → 403; abgeschlossener Einsatz → abgewiesen; Felder der Antwort genau
  `benutzer_id`, `anzeigename`; jeder angebotene Eintrag lässt sich anschließend per `PUT`
  aufnehmen (Zusammenhalt mit D2).
- Frontend (`MitgliederAbschnitt.test.tsx`): Auswahl lädt aus dem neuen Endpunkt und nicht aus
  `/api/benutzer`; leere Antwort zeigt den Leer-Hinweis; Fehler zeigt „Personenauswahl nicht
  verfügbar“; ohne `darfVerwalten` kein Abruf.

### D5 Frontend

- `ladeMitgliedAuswahl(einsatzId)` in `api/einsaetze.ts`, Typ `MitgliedAuswahl` aus dem
  generierten Schema (`api/types.ts`).
- Neuer Key `einsatzKeys.mitgliedAuswahl(einsatzId)` mit eigenem Prefix
  `einsatz-mitglieder-auswahl`, in `NICHT_LIVE_KEYS` (wie `mitglieder`: selten geändert, kein
  Ereignis) und nicht in `LAGEBILD_OFFLINE` (Personenliste, ohne Netz kann ohnehin niemand
  aufgenommen werden). Eigener Prefix statt Sub-Key von `mitglieder`, damit eine Invalidierung der
  Mitgliederliste die Auswahl nicht zwangsläufig mitzieht und die Klassifizierung je Prefix
  eindeutig bleibt.
- Nach erfolgreichem `setzen`/`entfernen` wird die Auswahl invalidiert: Wer aufgenommen wurde,
  fällt heraus, wer entfernt wurde, kommt zurück. Der Client-Filter gegen die Mitgliederliste
  bleibt als Schutz gegen den Moment zwischen Antwort und Neuladen.
- `notFoundContent`: bei Fehler „Personenauswahl nicht verfügbar“, bei leerer Antwort „Keine
  weitere Person der Organisation“. Der 403-Zweig „Benutzerliste nur für Admins“ entfällt: Wer
  die Auswahl sieht (`darfVerwalten`), ist Einsatzleitung und bekommt kein 403.

## Risks / Trade-offs

- [Die Einsatzleitung sieht die Namen aller aktiven Personen ihrer Organisation] → Sie gehört zu
  dieser Organisation (Context), und Führungskräfte der Org sehen ohnehin jeden Einsatz samt
  Mitgliedern. Die Antwort trägt nur den Anzeigenamen.
- [Auswahl und Schreibweg laufen auseinander, wenn einer von beiden die Bedingungen ändert] → Der
  Zusammenhaltstest aus D4 nimmt jeden angebotenen Eintrag per `PUT` auf.
- [System-Admins sehen in der Auswahl weniger als bisher] → Was wegfällt, wies der Server schon
  heute mit 404 ab; das ist eine Korrektur, kein Verlust.
- [Gleiche Anzeigenamen sind nicht unterscheidbar] → Wie heute; nicht Teil dieses Tasks.

## Migration Plan

Keine Migration. Neuer Lese-Endpunkt, Frontend wechselt im selben Release. Rückweg: Frontend
zurück auf `/api/benutzer`, der Endpunkt kann stehen bleiben.
