# Design

## Context

- Nachtrag und Streichung laufen über `src/routes/zeitachse.rs` (`nachtragen`, `streichen`). Beide
  rufen in der Transaktion zuerst `require_aktiv_tx`. Für eine Person landet das in
  `personal::disposition_repo::require_aktiv_tx`, das bei jedem `beendet_als` (`entlassen`,
  `storniert`) einen 409 liefert, für eine Einheit in `einheit::repo::require_aktiv_tx`.
- Die Perioden-Regeln prüft `zeitachse::perioden` rein (`pruefe_einfuegen`, `pruefe_streichen`).
  Ob eine Periode offen ist, sagt `zeitachse::repo::has_offene_periode_tx`.
- Eine Person hat keinen Fan-out und keine Kopplung an die Ablösung. Beides hängt nur an
  `Kraft::Einheit` (`schreibe_tx`, `streiche_tx`). Eine Berichtigung an einer Person berührt
  also nur ihre eigene Zeitachse.
- Der Lebenszustand (`beendet_*`) ist keine Zeitachse (`frontend/src/kraefte/AGENTS.md`): Dauer und
  Perioden rechnen nur aus den Ereignissen. Eine Berichtigung ändert `beendet_at` nicht.
- Im Client setzt `pages/EinsatzkraftPage.tsx` für eine entlassene Person `darfSchreiben = false`
  für die ganze Ansicht und reicht das an `KraftZeitachse` weiter (D12 aus LLH-1079). Die Ansicht
  kennt den Zustand schon über `?entlassene=1`.
- Ein bestehender Test (`tests/einsatz_personal.rs`, Liste der 409-Wege an einer entlassenen
  Person) erwartet für einen Nachtrag noch 409.

## Goals / Non-Goals

**Goals:**

- Nachtrag und Streichung an einer entlassenen Person mit genau den Regeln der aktiven Kraft,
  plus der einen Zusatzregel „keine offene Periode danach“.
- Jede andere Sperre aus LLH-1079 bleibt unverändert.

**Non-Goals:**

- **Atomares Ersetzen eines Zeitpunkts.** Ein Ereignis, das ein anderes trägt (Eintreffen als
  Anker einer Periode ohne Alarmierung, die abschließende Entlassung), lässt sich auch an einer
  aktiven Kraft nicht in einem Schritt ersetzen: erst streichen bricht die Ordnung, erst
  nachtragen verdoppelt. Das ist eine bestehende Grenze der Zeitachse und braucht einen eigenen
  Weg („Zeitpunkt berichtigen“). Für die entlassene Person heißt das: Die Entlassungszeit
  berichtigt man über „Erneut disponieren“, dann streichen und nachtragen, dann wieder entlassen.
- Berichtigung an einer aufgelösten Einheit oder einer stornierten Person.
- Fahrzeuge: Sie haben keine eigene Zeitachse (`Kraft` kennt nur Einheit und Person).

## Decisions

### D1 — Nur die entlassene Person, nicht jede beendete Kraft

Der Auftrag nennt „beendete Kraft“, die Oberfläche „entlassene Person“. Wir öffnen nur die
entlassene Person.

- Die **stornierte** Person ist laut Spec in keinem Nachweis. Ihre Ereignisse sind alle mit
  „Fehldisposition storniert“ gestrichen. Eine Berichtigung dort schriebe in einen Nachweis, den
  es nicht gibt.
- Die **aufgelöste** Einheit hat keine Ansicht mit Zeitachse (die Einheitenliste zeigt sie nur im
  Block „Aufgelöst“). Ein Nachtrag dort liefe durch die Kopplung an die Ablösung: Eine Entlassung
  ohne offene Periode beendet die Schicht, ihre Streichung öffnet sie wieder. Dazu käme der
  Fan-out auf Personen, die die Einheit nicht mehr hat. Das wäre eine eigene Entscheidung.

*Alternative:* jede beendete Kraft öffnen. Verworfen wegen der Kopplung an die Ablösung und
weil kein Bedarf benannt ist. Kommt er, ist es ein Nachzug.

### D2 — Lebenszustand lesen statt ablehnen

`disposition_repo` bekommt eine Abfrage, die den Lebenszustand der Person liefert (aktiv,
entlassen, storniert; `NotFound` bei fremder Zeile). `routes::zeitachse` ersetzt
`require_aktiv_tx` durch eine Prüfung, die für eine Person bei `entlassen` durchlässt und sich den
Zustand merkt. Für `storniert` liefert sie weiter `beendet_conflict`, für eine Einheit weiter
`einheit::repo::require_aktiv_tx`. Der bestehende `require_aktiv_tx` bleibt für alle anderen
Schreibwege unverändert. So steht die Ausnahme an genau einer Stelle, dem Zeitachsen-Handler.

*Alternative:* ein Schalter `erlaube_entlassen` an `require_aktiv_tx`. Verworfen, weil jeder
andere Aufrufer ihn mitlesen müsste und die Ausnahme dann über das Repo verstreut wäre.

### D3 — „Keine offene Periode“ als Nachprüfung in derselben Transaktion

Nach `schreibe_tx` bzw. `streiche_tx` fragt der Handler bei einer entlassenen Person
`has_offene_periode_tx`. Ist eine offen, gibt er `UnprocessableEntity` zurück:
„Die Person ist entlassen; eine offene Einsatzperiode entsteht nur über ‚Erneut disponieren‘“.
`write_retry!` rollt die Transaktion bei einem Fehler zurück, es bleibt also nichts geschrieben,
auch kein ETB-Eintrag. Eine Person ohne Ereignisse oder mit nur geschlossenen Perioden bleibt
regelkonform.

*Alternative:* Vorabprüfung rein über `perioden` (Kandidat einfügen bzw. streichen, letzte
Periode ansehen). Gleichwertig, aber eine zweite Kopie der Regel neben `schreibe_tx`. Die
Nachprüfung nutzt die schon vorhandene Abfrage und kann nicht von der Schreiblogik abweichen.

### D4 — ETB-Vermerk als Zusatz am bestehenden Text

`etb_text_nachtrag` und `etb_text_streichung` bekommen ein Flag `berichtigt: bool`. Der Nachtrag
lautet dann „Zeitachse: Person «Anna» eingetroffen 300630sep26 (nachgetragen, berichtigt nach
Entlassung)“, die Streichung „Zeitachse: Person «Anna» eingetroffen 300640sep26 gestrichen
(berichtigt nach Entlassung) — Grund: …“. „nach Entlassung“ sagt, warum an einer beendeten Kraft
geschrieben wurde. Ein bloßes „berichtigt“ läse sich wie jede Streichung.

### D5 — Client: Schreibrecht der Zeitachse getrennt, abschließende Entlassung gesperrt

`EinsatzkraftPage` gibt `KraftZeitachse` `darfSchreiben={imEinsatzSchreiben}` und
`rechteText={einsatzRechteGrund(...)}`, auch für eine entlassene Person. Alle anderen Paneele
behalten `darfSchreiben = imEinsatzSchreiben && !isEntlassen`. `KraftZeitachse` bekommt den Prop
`beendet`. Ist er gesetzt, sperrt sie den Streichen-Knopf des Ereignisses, das die letzte Periode
mit einer Entlassung schließt, mit dem Kurzgrund „Erst erneut disponieren“ (LFH-966: was der
Server sicher ablehnt, steht gesperrt mit Kurzgrund). Welches Ereignis das ist, berechnet eine
reine Funktion in `kraefte/zeitachse.ts` aus Perioden und Ereignissen (Vitest). Einen Nachtrag,
der eine Periode öffnen würde, sperrt der Client nicht vorab. Das sagt die 422 im Dialog, denn
die Prüfung hängt am eingegebenen Zeitpunkt.

## Risks / Trade-offs

- [Eine Entlassungszeit lässt sich an einer entlassenen Person nicht direkt berichtigen] → Der
  Umweg über „Erneut disponieren“ steht in der Anwenderdoku. Ein Nachzug „Zeitpunkt berichtigen“
  (atomares Ersetzen, auch für aktive Kräfte) wird am Checkpoint vorgeschlagen.
- [Live-Aktualisierung der Ansicht einer entlassenen Person] → `publiziere` meldet die Person
  schon über `sse_personal`. Die Umsetzung prüft per Test, dass die Zeitachsen-Abfrage der
  Ansicht danach neu lädt.
- [Der Wächter, der Abfragen der Kräftetabellen auf den Zustand prüft] → Die neue
  Zustandsabfrage liest `beendet_als` und muss nicht in die Ausnahmeliste. Das bestätigt der
  Lauf von `cargo test`.

## Migration Plan

Keine Migration, keine Wire-Änderung. Ein Rückbau ist ein Revert des Commits.
