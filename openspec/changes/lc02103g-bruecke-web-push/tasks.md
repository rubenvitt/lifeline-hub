# Tasks

Jede Aufgabe entsteht per TDD (Test zuerst rot). Zwei Instanzen auf Loopback über
`tests/instanz_hilfen/mod.rs`; Push-Tests mit dem Push-Dienst aus `tests/web_push.rs` in einem
eigenen Testbinary, weil Live prozessweit ist (`tests/instanz_spiegel_live.rs`).

## 1. Fähigkeiten in der Meldeantwort (D4)

- [x] 1.1 Migration (Nummer über der höchsten auf `origin/alpha`): `instanz_kopplung.gegenueber_hinweise` und `gegenueber_web_push` (Vorgabe 0), `hinweis_ausgang`, `hinweis_eingang`; Einordnung in `spiegel::art` (AUSGENOMMEN mit Grund) und `einsatz::schwaerzung_registry`. Nachweis: `scripts/check-migrationen.sh` grün, Wächter in `spiegel::art` und `schwaerzung_registry` grün.
- [x] 1.2 `MeldenAntwort` um `hinweise` und `web_push` erweitern (additiv, `serde(default)`); die meldende Seite speichert beide an der Kopplung, `KopplungZeile` liest sie. Nachweis: Test in `tests/instanz_kopplung.rs` — Hub mit Push meldet beides `true`, ohne Push `web_push = false`; eine Antwort ohne die Felder ergibt `false`.

## 2. Weiche und Ausgang am ELW (D2, D4, D5)

- [x] 2.1 Eine Abfrage „Org dieses Einsatzes über den Hub“ (geführt, aktive meldende Kopplung, `gegenueber_hinweise`, dazu ob `gegenueber_web_push`). Nachweis: Einheitentests für geführt/gespiegelt, gekoppelte/ungekoppelte Org, widerrufene Kopplung, Hub ohne Push.
- [x] 2.2 `melden` schreibt den Ausgang (Anlass mit Kennungen und `KontoAngabe`) und weckt den Takt; `ausliefern` pusht nicht, wenn der Hub Hinweise und Push anbietet. Nachweis: Tests — Ausgangszeile entsteht auch ohne Empfänger am ELW; kein Push an ELW-Abos bei Hub mit Push; Push wie bisher bei Hub ohne Push, bei älterem Hub und bei ungekoppelter Org (Szenarien der Spec `web-push`, „Ein gekoppelter ELW pusht über den Hub“).
- [x] 2.3 `erledigen` schreibt einen Ausgang mit `erledigen = true`. Nachweis: Test — Sichten am ELW erzeugt die Zeile.
- [x] 2.4 Abräumen von Ausgangszeilen älter als 12 Stunden im Erinnerungs-Scheduler. Nachweis: Einheitentest mit fester Uhr.

## 3. Paket und Annahme am Hub (D2, D3, D5)

- [x] 3.1 `SpiegelPaket` um `hinweise` (Anfrage) und `hinweis_quittungen` (Antwort) erweitern, mit `HINWEISE_MAX` und Budget; `check()` prüft Grenzen. Nachweis: Einheitentest — ein älteres Paket ohne Felder liest sich, zu viele Hinweise sind ungültig.
- [x] 3.2 Abbildung am Hub: Einsatz, Bezug (Tabelle Bezugstyp → gespiegelte Tabelle), Person, Einheiten, Konten über `gegen_id` ohne Stellvertreter, Adressaten aus Text; unbekannte Werte verwerfen. Nachweis: Wächter „jeder Bezugstyp ist eingeordnet“, Einheitentests je Fall (abbildbar, fehlt noch, unbekannt).
- [x] 3.3 `handle_abgleich` nimmt Hinweise an: Einmaligkeit über `hinweis_eingang`, Zurückstellen ohne Quittung, Verwerfen nach 12 Stunden, nach dem Commit `melden` bzw. `erledigen` an der Hub-Instanz. Nachweis: Zwei-Instanzen-Tests für die Szenarien der Spec `benachrichtigungen` („Hinweise zu einem Einsatz des ELW …“, „Ein Hinweis kommt am Hub einmal …“, „Für alle erledigt gilt auch am Hub“): Sofortmeldung am ELW erreicht die Einsatzleitung am Hub, Auslöser bekommt nichts, Wiederholung ergibt eine Zeile, fehlende Zeile wird nachgeholt, alter Anlass verworfen, Sichten räumt am Hub.
- [x] 3.4 Die meldende Seite sendet offene Ausgangszeilen (älteste zuerst) und löscht quittierte. Nachweis: Zwei-Instanzen-Test — nach dem Abgleich ist der Ausgang leer; ohne Quittung bleibt die Zeile.
- [x] 3.5 Push vom Hub: Live und Push des Hubs erreichen das Abo am Hub mit Kennungen des Hubs. Nachweis: eigener Testbinary mit Push-Dienst-Attrappe am Hub — Nutzlast trägt die Benachrichtigungs- und Einsatzkennung des Hubs.

## 4. Aufräumen an Spiegeln (D8)

- [x] 4.1 `benachrichtigung::repo::aufraeumen` ohne Spiegel-Filter, Kommentar berichtigt. Nachweis: Test — eine 25 Stunden alte, ungelesene Zeile an einem Spiegel-Einsatz wird geräumt (Spec `benachrichtigungen`, „Benachrichtigungen an Spiegeln werden aufgeräumt“).

## 5. Push-Einstellung am ELW (D7)

- [x] 5.1 `WebPushStand.ueber_hub` (Name, Adresse) für Nutzer, deren Org die Bedingung erfüllt; `PUT /api/web-push/abo` dann 422, `DELETE` bleibt; bestehende Abos unverändert. Typen per `scripts/check-typ-codegen.sh` neu erzeugt und mitcommittet. Nachweis: Tests in `tests/web_push.rs` — Stand mit `ueber_hub`, 422 beim Anmelden, nach Widerruf der Kopplung Push wieder an das alte Abo.
- [x] 5.2 Frontend: `ladePushStand` kennt `'ueber_hub'`, `pushAbgleichen` überspringt ihn, die Seite „Benachrichtigungen“ zeigt „Push läuft über ‹Name›“ mit Link auf `<adresse>/benachrichtigungen`. Nachweis: Vitest für `webPush.ts` und die Seite; Lint und Typprüfung grün.

## 6. Doku

- [x] 6.1 ADR „Hinweise eines geführten Einsatzes reisen als Anlass zum Hub“ (nächste freie Nummer) mit `gilt_fuer`, Kapitel 9 nachgezogen, Kapitel 6 um den Ablauf „Hinweis über den Hub“ ergänzt. Nachweis: Wächter der Architekturdoku in `check-all.sh` grün.
- [x] 6.2 `docs/betrieb/web-push.md` (Push über den Hub, Fähigkeit des Hubs), Anwenderdoku zum Push-Schalter (Hinweis am gekoppelten ELW), `src/AGENTS.md` „Benachrichtigungen“ (Ausgang und Weiche in `melden`/`erledigen`, kein Push am ELW bei Hub mit Push) und Konzeptnotiz (Entscheidung 12: Push-Teil umgesetzt, Alarm-Teil LLH-1679). Nachweis: Prettier und Doku-Wächter grün.

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` grün (Verweis auf den Lauf vor dem PR).

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), Bilder der Push-Einstellung am gekoppelten ELW.
- `/opsx:archive lc02103g-bruecke-web-push` im selben Branch, dann PR gegen `alpha`.
