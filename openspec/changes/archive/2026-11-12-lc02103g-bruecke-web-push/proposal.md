# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/lc02103gqfck2bzzl5r3ukly (LLH-1495)

## Why

Entscheidung 12 der Instanzkopplung (`docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`) sagt:
Pushs für Ereignisse eines gekoppelten ELW versendet der Hub. Heute pusht jeder ELW selbst. Das
geht nur, wenn er ins Internet kommt, und die Abos hängen an seiner Adresse, die außerhalb des
Einsatz-LAN oft niemand erreicht. Am Hub entsteht für einen Einsatz, den ein ELW führt, gar kein
Hinweis: Benachrichtigungen werden bewusst nicht gespiegelt (Change `polrv1lt-spiegel-antraege`,
„Hinweise zu Ereignissen eines ELW am Hub bringt LLH-1495“). Wer am Hub arbeitet, etwa der
Verwaltungsstab, erfährt deshalb nichts von Sofortmeldungen oder neuen Aufträgen des ELW.

Den Alarm-Teil der Entscheidung (Alarmmeldung am Hub als Einsatzvorschlag) gibt es erst mit der
Alarmübernahme LLH-1192. Er ist abgetrennt nach LLH-1679.

## What Changes

- Der ELW reicht jeden Anlass einer Benachrichtigung zu einem Einsatz, den er führt, über den
  Abgleich an den Hub weiter (additives Feld im Spiegelpaket). Der Hub ermittelt die Empfänger
  selbst aus dem Spiegel und legt eigene Benachrichtigungen an: Eingang, Live-Ereignis, Web Push.
  „Für alle erledigt“ (etwa eine gesichtete Meldung) reist ebenso mit.
- Der Hub nennt in der Meldeantwort, ob er Hinweise annimmt und ob er Web Push anbietet
  (additiv). Der ELW pusht für einen Einsatz nicht mehr selbst, wenn dessen Org mit einem Hub
  gekoppelt ist, der Push anbietet. Sonst pusht er wie heute; nichts geht still verloren.
  Benachrichtigungen und Live-Ereignisse am ELW bleiben unverändert.
- Die Push-Einstellung am gekoppelten ELW zeigt „Push läuft über ‹Hub›“ mit einem Link dorthin.
  Ein neues Abo am ELW wird abgelehnt. Bestehende Abos bleiben gespeichert, ruhen und gelten
  nach dem Entkoppeln wieder.
- Benachrichtigungen an Spiegel-Einsätzen werden aufgeräumt wie alle anderen (heute bleiben sie
  liegen, weil das Aufräumen Spiegel überspringt).
- Ungekoppelte Instanzen bleiben unverändert.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `benachrichtigungen`: Hinweise zu Einsätzen eines gekoppelten ELW entstehen auch am Hub, für
  dessen Empfänger; „Für alle erledigt“ reist mit; Aufräumen schließt Spiegel ein.
- `web-push`: Ein gekoppelter ELW pusht über den Hub, wenn der Hub Push anbietet; die
  Push-Einstellung am gekoppelten ELW verweist auf den Hub.

## Impact

- **Backend:** `src/benachrichtigung/` (Weiterreichen, Erledigen, Aufräumen, Push-Weiche),
  `src/instanz/spiegel/` (Paketfeld, Ausgang am ELW, Annahme am Hub), `src/instanz/melden.rs`
  (Meldeantwort), `src/instanz/repo.rs` (Fähigkeiten des Gegenübers), `src/web_push/`,
  `src/routes/web_push.rs` (`WebPushStand.ueber_hub`, Ablehnung neuer Abos).
- **Migration:** neue Tabellen für den Ausgang am ELW und den Eingang am Hub, zwei Spalten an
  `instanz_kopplung`.
- **Frontend:** `frontend/src/alarm/webPush.ts`, `frontend/src/pages/BenachrichtigungenPage.tsx`,
  generierte Typen.
- **Protokoll:** nur additive Felder; `instanz::PROTOKOLL` bleibt. Ein älterer Hub kennt die
  Fähigkeiten nicht, also pusht der ELW dann weiter selbst.
- **Doku:** ADR (Hinweise über den Hub), Kapitel 6 und 9, `docs/betrieb/web-push.md`,
  Anwenderdoku zum Push-Schalter, `src/AGENTS.md` (Abschnitt „Benachrichtigungen“).
