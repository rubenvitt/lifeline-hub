# Design

## Context

Vorbild ist die Rücknahme beim Fahrzeug (LLH-1722,
`openspec/changes/archive/2026-11-16-tfq6f4kb-loesende-aktionen/design.md` D5;
`src/fahrzeug/disposition_repo.rs`, `zuruecknehmen_tx`; Route
`routes::einsatz_fahrzeug::zuruecknehmen`). Bei der Person kommen zwei Dinge dazu, die das
Fahrzeug nicht hat:

- **Zeitachse:** `personal::disposition_repo::entlassen_tx` schreibt über
  `zeitachse::repo::schreibe_tx` ein Ereignis `entlassung` (Quelle `disposition`, Zeitpunkt
  `jetzt` = `beendet_at`), sofern eine Periode offen ist. Das Fahrzeug wirkt nur über seine Einheit
  und hat keine Zeitachse.
- **Rollen außerhalb der eigenen Zeile:** `release_bindungen_tx` leert `einsatz_einheit.fuehrer_id`
  (jede Einheit, die die Person führt), `einsatzabschnitt.leiter_id` und
  `einsatz_fuehrungsstelle.einsatzleiter_personal_id`. Bei der Einsatzleitung bleiben
  `einsatzleiter_art = 'personal'`, `einsatzleiter_name` und `einsatzleiter_seit` stehen: der
  Vermerk „nicht mehr disponiert“ (Migration 0177).

Das Entlassen fasst `status_id`, `disponiert_at` und `staerke_position` nicht an; erst
`reaktivieren_tx` setzt Initialstatus und Dispositionszeit neu. `zuletzt_entlassen_at` hält die
Storno-Sperre.

## Goals / Non-Goals

**Goals:**
- Nach „Entlassen“ und „Rückgängig“ steht die Person wie vorher da, ohne halbes Rückgängig an der
  Zeitachse (Spec `kraefte-entlassung`, „Entlassung einer Person zurücknehmen“).
- Dieselbe Sicherung wie beim Fahrzeug: Riegel, Bindungen nur wenn frei und mit Modulrecht,
  Ausgelassenes in Worten.

**Non-Goals:**
- Material „Aus dem Einsatz nehmen“ (LLH-1923) und die übrigen Lücken aus LLH-1924.
- Rückgängig nach Neuladen der Seite: der Vorzustand lebt nur im Client, solange der Hinweis
  offen ist (wie D5).
- Personal-Liste: Sie entlässt nicht, nur die Detailseite (`EinsatzkraftPage`).
- Auftragsempfänger, Schadensbezug und Bestätigungen: das Entlassen lässt sie stehen, es gibt
  nichts zurückzunehmen.

## Decisions

### D1 Vorzustand in der Antwort, Rücknahme mit eigenem Schreibweg

`POST …/personal/{ep}/entlassen` antwortet mit `{ personal, vorzustand }`
(`EntlassungAntwort` im Modul `personal`, eigener Typ neben dem des Fahrzeugs). Der
`vorzustand` (`PersonalEntlassungVorzustand`, im Schema eindeutig benannt, weil
`EntlassungVorzustand` schon das Fahrzeug trägt):

- `entlassen_at`: Kennung dieses Entlassens (= `beendet_at`);
- `einheit_id`, `fahrzeug_id`, `uhs_id`;
- `gefuehrte_einheiten: [einheit_id]`, `geleitete_abschnitte: [abschnitt_id]`;
- `einsatzleiter_name`: der Name, den die Führungsstelle für die Person eingefroren hat, wenn sie
  Einsatzleiter war (D5; Review vor dem PR, anfangs ein `bool`).

Status, Dispositionszeit, Stärke-Position und Storno-Sperre stehen nicht darin: das Entlassen
lässt sie stehen, die Rücknahme fasst sie nicht an. Das Zeitachsen-Ereignis steht ebenfalls nicht
darin: der Server findet es selbst (D3), damit der Client nichts Fremdes streichen lassen kann.
`entlassen_tx` liest die Rollen vor dem Lösen, so wie es heute den Einheitsnamen liest. Der Code
der Rücknahme liegt in `src/personal/ruecknahme.rs` (die Datei `disposition_repo.rs` ist schon über
2400 Zeilen lang).

Neu `POST …/personal/{ep}/entlassen/zuruecknehmen` mit dem Vorzustand als Body, Gate
`EinsatzSchreibzugriff<Personal>` (ADR-0005). Die Listen werden wie beim Fahrzeug gedeckelt
(`src/AGENTS.md`, „Eingabegrenzen“) und entdoppelt. Antwort `{ personal, ausgelassen }` mit dem
vorhandenen `RuecknahmeAusgelassen { bezeichnung, grund }`.

**Verworfen:** Vorzustand serverseitig speichern und eine Kette vorhandener Schreibwege im Client,
aus denselben Gründen wie in D5 von LLH-1722.

### D2 Riegel und Endzustand

In einer Transaktion, wie beim Fahrzeug:

1. **Riegel:** `beendet_als = 'entlassen'`, `beendet_von` = Aufrufer, `beendet_at` =
   `entlassen_at`, höchstens `RUECKNAHME_FRIST_MINUTEN` (zehn) her. Sonst 409 „Die Entlassung
   lässt sich nicht mehr zurücknehmen; die Person lässt sich erneut disponieren“. Die Frist teilt
   sich die Konstante mit dem Fahrzeug; sie wandert dafür nach `crate::entlassung`.
2. **Endzustand aufheben:** `beendet_*` = NULL, bedingt auf `beendet_at = entlassen_at` (ein
   gleichzeitiger zweiter Versuch trifft keine Zeile → 409). `status_id`, `disponiert_at`,
   `staerke_position` und `zuletzt_entlassen_at` bleiben.

### D3 Zeitachse: die Entlassung streichen, sonst nichts

Der Server sucht das Ereignis E: `personal_id` = Person, `art = 'entlassung'`,
`quelle = 'disposition'`, `zeitpunkt_at = entlassen_at`, ohne Fan-out-Ursprung.

- **E fehlt:** Das Entlassen hat keine Zeitachse geschrieben (keine offene Periode). Nichts zu
  streichen.
- **Die Zeitachse ist seit dem Entlassen berichtigt** (Streichen, „Zeit berichtigen“, Nachtrag,
  „Periode nachtragen“, auch an einem Ereignis vor E): ein Ereignis der Person ist seit
  `entlassen_at` gestrichen, oder eines ist nach E erfasst (`id > E`; ohne E: `erfasst_at` nach
  `entlassen_at`). Erfasst- und Streichzeit stehen im Format von `crate::zeit::FORMAT`. Anfangs
  zählte nur ein Ereignis nach E nach `zeitpunkt_at`; der Review vor dem PR fand, dass eine
  Berichtigung davor so durchrutschte. Dann 409 „Die Zeitachse der Person ist seit dem Entlassen
  berichtigt; die Person lässt sich erneut disponieren“, und die ganze Transaktion fällt: nichts
  kommt zurück (mit dem Menschen abgestimmt, 16.11.2026).
- **Sonst:** `zeitachse::repo::streiche_tx` mit Grund `GRUND_RUECKNAHME` = „Entlassung
  zurückgenommen“ (neue Konstante in `crate::entlassung`), `durch_ruecknahme = false`. Damit ist
  die Periode davor wieder offen; keine neue Periode, kein neuer Initialstatus. Ein Verstoß gegen
  die Perioden-Regeln, den `pruefe_streichen` meldet, bricht ebenfalls alles ab (422 aus
  `streiche_tx`).

Die Prüfung läuft **vor** dem Aufheben des Endzustands und vor jeder Bindung, damit ein 409 nichts
geschrieben hat. Das Streichen selbst läuft nach dem Aufheben: an einer aktiven Person gelten die
Perioden-Regeln wie bei jedem Streichen, nicht die Ausnahme für Entlassene (LLH-1263).

Eine Kopplung an Schicht oder Ablösungsplanung hängt nur an Einheit-Ereignissen
(`streiche_tx`, `Kraft::Person` → kein Hinweis); bei der Person fällt keine an.

**Verworfen:** eine neue Periode wie bei `reaktivieren` (genau der Fehler, den die Aufgabe
behebt); die Zeitachse bei Berichtigung auslassen und den Rest zurücknehmen (die Person stünde
aktiv ohne offene Periode da, Abstimmung).

### D4 Bindungen einzeln, nur wenn frei, mit dem Recht des Zielmoduls

Reihenfolge und Bedingung; jedes Ausfallen landet in `ausgelassen` mit Bezeichnung und Grund in
Worten:

| Teil | Frei, wenn | Recht |
| --- | --- | --- |
| Einheit (`einheit_id`) | Einheit besteht und ist nicht aufgelöst | Modul Einheiten |
| Führung (`gefuehrte_einheiten`) | Einheit besteht, nicht aufgelöst, `fuehrer_id` leer, die Person ist (wieder) ihr Mitglied | Modul Einheiten |
| Fahrzeug (`fahrzeug_id`) | Fahrzeug besteht und ist nicht beendet | Modul Fahrzeuge |
| UHS (`uhs_id`) | UHS besteht und ist nicht `aufgeloest` | Modul Unfallhilfsstellen |
| Abschnittsleitung (`geleitete_abschnitte`) | Abschnitt besteht, `leiter_id` leer | Modul Einsatzabschnitte |
| Einsatzleitung (`einsatzleiter_name`) | der Vermerk dieser Person steht unverändert (D5) | Einsatzdaten (wie das Gate der Führungsstelle) |

Das Recht fragt die Route vor der Transaktion je Modul ab (`EinsatzKontext::darf_zielmodul`, aus
der Fahrzeug-Route dorthin gehoben). Die Bindung schreibt jeweils ein bedingtes UPDATE
(`… AND fuehrer_id IS NULL` usw.), das dann auch gegen einen gleichzeitigen Schreiber hält.

Nach dem Review vor dem PR:

- **Listen über `json_each`:** Führung und Abschnittsleitung binden je Liste mit einem UPDATE samt
  `RETURNING` und lesen das Ausgelassene mit einer Abfrage (`src/AGENTS.md`, „Eingabegrenzen“).
- **Unbekannte Kennungen still aus:** Nennt eine Kennung der Listen nichts dieses Einsatzes, bleibt
  sie ohne Wort aus, wie beim Fahrzeug. Ohne gespeicherten Vorzustand ließe sich ein gelöschter
  Abschnitt nicht von einer erfundenen Kennung unterscheiden, und das Einsatztagebuch nennte
  Erfundenes.
- **Führung nur mit Mitgliedschaft:** Der Führer ist Mitglied (`einheit::repo::check_fuehrer`);
  ohne Mitgliedschaft lautet der Grund „nicht mehr Mitglied der Einheit“.
- **Ohne Recht ohne Namen:** Fehlt das Recht eines Moduls, nennt der Hinweis den Teil allgemein
  („Einheit“, „Leitung eines Abschnitts“), nicht den Namen aus dem Modul.

**Verworfen:** Personalrecht genügt (umginge die Modulrechte; Abstimmung).

### D5 Einsatzleitung: nur wenn kein anderer Einsatzleiter eingetragen ist

Das Entlassen leert nur `einsatzleiter_personal_id`; `art = 'personal'`, Name und „seit“ bleiben
als Vermerk „nicht mehr disponiert“. Mit dem Menschen abgestimmt: zurück nur, wenn keine andere
Person und kein Freitext-Einsatzleiter eingetragen ist. Umgesetzt als: die Zeile trägt noch genau
diesen Vermerk (`einsatzleiter_art = 'personal'`, `einsatzleiter_personal_id IS NULL`,
`einsatzleiter_name` = der eingefrorene Name aus dem Vorzustand). Dann setzt die Rücknahme
`einsatzleiter_personal_id` zurück; Name und „seit“ bleiben, wie sie waren.

Nach dem Review vor dem PR, mit dem Menschen abgestimmt (17.11.2026): die Einsatzleitung kommt nur
mit dem Recht zurück, das auch der Weg über die Führungsstelle verlangt (`EinsatzVerwaltungszugriff`,
`fordere_schreibrecht_oder_admin`); ohne es bleibt sie aus. Das Gate der Rücknahme verlangt schon
das Schreibrecht im Einsatz, das diese Prüfung erfüllt; sie steht trotzdem ausdrücklich da, damit
sie nicht still auseinanderläuft. Der Vorzustand trägt den eingefrorenen Namen statt eines
`bool`: der Name einer Ad-hoc-Person kann sich ändern, während sie Einsatzleiter ist, und der
Abgleich mit ihrem heutigen Namen träfe den Vermerk dann nicht. Ein gefälschter Name bindet
höchstens einen Vermerk ohne Verweis an die Person, und das darf, wer dieses Recht hat, ohnehin
über die Führungsstelle.

Hat jemand den Einsatzleiter inzwischen ganz ausgetragen (alle Felder leer), kommt er nicht
zurück („inzwischen ausgetragen“): das war eine bewusste Handlung in den zehn Minuten, und ein
leeres „seit“ ließe sich nur erfinden.

### D6 ETB, Live, Antwort

- ETB `etb_text_entlassung_zurueckgenommen(name, funktion, ausgelassen)` in `personal`; der
  Eintrag geht eigens live hinaus (`live.publiziere`), das Ereignis `personal` frischt das
  Einsatztagebuch nicht auf (Review vor dem PR):
  „Person «X»: Entlassung zurückgenommen“, bei Auslassungen „, ohne A (Grund), B (Grund)“.
- Live nach dem Commit: `sse_personal` und ein `Betroffen` aus dem, was die Rücknahme
  tatsächlich zurückgebunden hat (Einheiten aus Mitgliedschaft und Führung, Abschnitte, UHS,
  Fahrzeug, Einsatzleitung über `kopf_geaendert`). `Betroffen::melden` bleibt der eine Weg.
- Keine Benachrichtigung.

### D7 Client

- `api/einsatzPersonal.ts`: `entlasseDisposition` liefert `PersonalEntlassungAntwort`, neu
  `nimmEntlassungZurueck(einsatzId, epId, vorzustand)`.
- `EinsatzkraftPage`: Das Rückgängig im Toast ruft die Rücknahme mit dem Vorzustand aus der
  Antwort. Die Kennung der Person steht in den `variables` der Mutation, die Hinweise tragen sie
  mit und erscheinen nur bei ihr; Erneut disponieren und Entlassen räumen sie (Review vor dem PR). Erfolg: Zeile zurück nach „aktiv“ (`moveZeile`), ein Ausgelassen-Satz im Seitenhinweis
  wie `ausgelassenSatz` der Fahrzeugliste (die Funktion wandert dafür in ein gemeinsames Modul,
  weil zwei Seiten sie brauchen). Ablehnung (409/422): Grund im Seitenhinweis („Rückgängig
  fehlgeschlagen“), wie heute. „Erneut disponieren“ bleibt `reaktivieren`.

### D8 Regeln

- `frontend/AGENTS.md`, „Beenden: Verb, Ort und Sicherung je Art“: Personal aus der bekannten
  Lücke streichen, die Rücknahme der Person neben die des Fahrzeugs stellen.
- Spec `bedien-muster`: Das Szenario „Bekannte Lücke bei Personal und Material“ behält seinen
  Namen, weil OpenSpec beim Ändern einer Anforderung kein Szenario fallen lässt; sein Text nennt
  nur noch Material. Mit LLH-1923 fällt es ganz.
- `frontend/src/kraefte/AGENTS.md`, Kräfte-Zeitachse: Die Rücknahme der Entlassung einer Person
  (`…/personal/{ep}/entlassen/zuruecknehmen`) streicht genau das Entlassungs-Ereignis dieses
  Entlassens; ist die Zeitachse seither berichtigt, 409.

## Risks / Trade-offs

- [Die Antwort von `…/entlassen` ändert ihre Form] → Einziger Aufrufer ist `EinsatzkraftPage`;
  keine öffentliche API, kein Instanzspiegel. Typ-Codegen und Client im selben Commit.
- [Berichtigung in den zehn Minuten blockiert die Rücknahme] → gewollt (Abstimmung); „Erneut
  disponieren“ bleibt, und der 409 sagt das.
- [Gefälschter Body] → Er nennt nur Kennungen; jede Bindung entsteht nur, wenn ihr Ziel frei ist
  und die Person das Modulrecht hat, und nur an der eigenen, eben entlassenen Person (Begründung
  wie D5 von LLH-1722). Das Zeitachsen-Ereignis wählt der Server.
- [Zwei Tabs nehmen gleichzeitig zurück] → Das bedingte UPDATE auf `beendet_at` lässt nur einen
  durch; der zweite bekommt 409.

## Migration Plan

Keine Migration. Ausrollen mit dem Release; Rückbau durch Zurücksetzen des Commits (die alte
Client-Version ruft `reaktivieren`, das unverändert bleibt).
