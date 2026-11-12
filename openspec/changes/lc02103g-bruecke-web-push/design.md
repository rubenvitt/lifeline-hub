# Design

## Context

Siehe `proposal.md` (Why). Abgestimmt mit Ruben am 12.11.2026: nur die Push-Brücke (Alarm-Teil
nach LLH-1679), Weg B1, Rückfall auf eigenen Push, Hinweis mit Link am ELW.

Bestand, der den Weg bestimmt:

- Eine Benachrichtigung entsteht nur in `benachrichtigung::melden` aus einem `Anlass` (Art,
  Bezug, Auslöser, Adressaten, Einheit). Die Empfänger bestimmt allein `aufloesung::empfaenger`;
  `ausliefern` schreibt je Empfänger eine Zeile, stellt live zu und pusht
  (`src/benachrichtigung/mod.rs`). Etwa 15 Schreibwege rufen `melden`.
- `benachrichtigung` und `web_push_abo` werden nicht gespiegelt (`spiegel::art`, AUSGENOMMEN).
  Mitgliedschaften, Vorgaben je Funktion und alle Einsatzzeilen dagegen schon, in denselben
  Tabellen unter Hub-eigenen Kennungen (ADR-0018). Der Hub kann die Empfänger also selbst
  bestimmen.
- Der Abgleich geht nur von der meldenden Seite (ELW) aus: Anfrage mit Lieferungen, Antwort mit
  Quittungen (`spiegel::abgleich`). `SpiegelPaket` und `MeldenAntwort` wachsen nur additiv
  (`src/AGENTS.md`, Instanzkopplung).
- Kennungen bildet der Spiegel über `spiegel_herkunft` (Zeilen) und `KontoAngabe.gegen_id`
  (Konten, nur die meldende Seite kennt die Herkunft) ab (`spiegel::abbildung`).
- Payload und Service Worker tragen nur Kennungen der sendenden Instanz; der Worker holt den Text
  an seinem eigenen Ursprung (`frontend/public/alarm-sw.js`).

## Goals / Non-Goals

**Goals:**
- Am Hub entstehen vollwertige Hinweise zu Einsätzen eines gekoppelten ELW (Eingang, Live, Push),
  nach den Regeln des Hubs.
- Kein Hinweis geht still verloren: pusht der Hub nicht, pusht der ELW.
- Ungekoppelte Instanzen und der Ablauf am ELW ohne Push bleiben unverändert.

**Non-Goals:**
- Alarmmeldung am Hub (LLH-1679).
- Hinweise in der Gegenrichtung: führt der Hub, meldet er selbst; der ELW-Spiegel bekommt wie
  heute nichts.
- `umadressieren` weiterreichen (D6).
- Abos zwischen den Instanzen teilen.

## Decisions

### D1 Der Anlass reist, nicht das Ergebnis (B1)

Der ELW reicht den `Anlass` weiter, nicht die aufgelösten Empfänger. Der Hub löst ihn mit
`aufloesung::empfaenger` gegen seinen Spiegel auf und ruft `melden` wie für einen eigenen
Einsatz.

- Verworfen B2 (der ELW schickt fertige Empfänger und Nutzlast, der Hub pusht nur): Die
  Kennungen in der Nutzlast wären die des ELW, der Service Worker fände am Hub keinen Text und
  zeigte nur „Neue Benachrichtigung“. Der Hub prüfte keine Rechte, und Hub-Nutzer ohne
  Mitgliedschaft (Führungskräfte der Org, `Adressat::Fuehrungskraefte`) blieben außen vor.
- Verworfen B3 (der Hub leitet Anlässe aus eingehenden Zeilen ab): Das verdoppelt die Auslöser
  aller Schreibwege und läuft auseinander.
- Folge: Der Hub sieht den Hinweis so, wie seine eigenen Daten es erlauben. Unterscheidet sich
  ein Recht am Hub von dem am ELW, gilt am Hub das des Hubs; das ist gewollt (Spec
  `benachrichtigungen`, „Lesen prüft das Recht erneut“).

### D2 Ausgang am ELW, Eingang am Hub

- **ELW:** `melden` schreibt nach dem Commit zusätzlich eine Zeile in `hinweis_ausgang`, wenn der
  Einsatz hier geführt und geliefert wird (`spiegel = 0`, kein Demo-Einsatz, nicht zum Abräumen
  vorgemerkt, wie `liefern`) und seine Org aktiv mit einer Instanz gekoppelt ist, die Hinweise
  annimmt (D4). Alle Ziele in einer Transaktion; scheitert sie, pusht der ELW selbst. Die Zeile trägt `kopplung_org_id`, Einsatz, die Anlass-Felder als
  JSON und `erstellt_at`. Danach `spiegel::takt::wecken()`, damit der Hinweis nicht auf den Takt
  wartet. Der Ausgang entsteht unabhängig davon, ob der ELW selbst Empfänger findet: Am Hub kann
  jemand gemeint sein, den es am ELW nicht gibt.
- **Paket:** neues Feld `hinweise: Vec<HinweisAnlass>` in der Anfrage (höchstens `HINWEISE_MAX`
  je Paket, älteste zuerst, zählt ins Budget), `hinweis_quittungen: Vec<i64>` in der Antwort.
  `HinweisAnlass` trägt die Ausgangs-Kennung, die Einsatzkennung, Art und Bezug als Text, den
  Bezug mit ELW-Kennung, Auslöser und Nutzer-Adressaten als `KontoAngabe`, die übrigen
  Adressaten als Text (`funktion:EL`, `modul_leser:meldungen` …), Einheit und Untereinheit mit
  ELW-Kennung, `erstellt_at`, dazu `erledigen: bool` (D5).
- **Hub:** in der Schreibtransaktion von `handle_abgleich`, nach `uebernehme_alle`, je Anlass:
  schon in `hinweis_eingang (kopplung_id, fremde_id)`? → quittieren. Sonst abbilden (D3);
  gelingt es → in `hinweis_eingang` eintragen, quittieren und nach dem Commit `melden`
  (bzw. `erledigen`). Fehlt etwas → nicht quittieren, die nächste Runde bringt den Anlass erneut.
  Älter als 12 Stunden (`VERLAUF_NACHREICHEN_STUNDEN`, dieselbe Grenze wie das Nachreichen) →
  quittieren ohne Hinweis.
- **ELW** löscht quittierte Zeilen des Ausgangs; was älter als 12 Stunden ist, räumt der
  Erinnerungs-Scheduler ab (der Hub würde es ohnehin verwerfen).
- `hinweis_eingang` wird nach 48 Stunden geräumt: Ein Anlass, der so lange nicht kam, wird nach
  12 Stunden ohnehin verworfen, also reicht das für die Einmaligkeit.
- Verworfen: Anlässe im Änderungslog `einsatz_aenderung` mitlaufen lassen. Das Log trägt Zeilen
  gespiegelter Tabellen; ein Anlass ist keine Zeile, und Benachrichtigungen werden bewusst nicht
  gespiegelt (Spec `spiegel-antraege`).
- Verlustfenster: Ein Absturz zwischen Commit und `melden` am Hub verliert den Hinweis. Das gilt
  heute für jeden Hinweis (`melden` läuft nach dem Commit) und bleibt so.

### D3 Abbildung der Kennungen am Hub

- Einsatz über `einsatz_spiegel.fremde_kennung`; nur ein Spiegel dieser Kopplung, sonst
  zurückstellen.
- Bezug über eine Tabelle Bezugstyp → gespiegelte Tabelle (`meldung`, `auftrag`,
  `auftrag_empfaenger`, `befehl`, `lagebericht`, `erinnerung`, `einsatz_abloesung`,
  `nachforderung`, Gefahrengebiet, `einsatz_person`, `einsatz_einheit`, `einsatz_fahrzeug`,
  `chat_nachricht`; Tabellennamen prüft die Umsetzung gegen `spiegel::art`) und
  `spiegel_herkunft`. `einsatz` und `lagebesprechung` tragen die Einsatzkennung, der
  `schichtplan_wechsel` einen Zeitpunkt, beide werden nicht abgebildet. Ein Wächter-Test verlangt
  für jeden `BenachrichtigungBezugTyp` einen Eintrag.
- `Adressat::Person` über `spiegel_herkunft` von `einsatz_personal`; Einheit und Untereinheit
  über `einsatz_einheit`.
- Konten (Auslöser, `Adressat::Nutzer`) nur über `KontoAngabe.gegen_id`, geprüft wie in
  `konto_lokal` (echtes Konto der Org des Einsatzes, kein Stellvertreter). Ohne Gegenstück
  entfällt der Nutzer-Adressat, und ein fehlender Auslöser bleibt `None`. Am Hub wird für einen
  Hinweis kein Stellvertreter angelegt; einer wäre ohnehin inaktiv und bekäme nichts.
- `Adressat::ModulLeser`/`ModulSchreiber` tragen einen `&'static str`: Der Hub nimmt nur einen
  Schlüssel an, den `BenachrichtigungBezugTyp::modul` kennt; ein unbekannter (neuerer ELW)
  verwirft den Anlass mit Quittung, statt ihn ewig zurückzustellen. Dasselbe gilt für eine
  unbekannte Art oder einen unbekannten Bezugstyp.

### D4 Fähigkeiten in der Meldeantwort, Weiche am ELW

- `MeldenAntwort` bekommt `hinweise: bool` (dieser Stand nimmt Hinweise an, immer `true`) und
  `web_push: bool` (`LiveHub::web_push()` ist eingerichtet). Beide `serde(default)`: Ein älterer
  Hub liefert `false`. Der ELW speichert sie an `instanz_kopplung`
  (`gegenueber_hinweise`, `gegenueber_web_push`), wie Softwarestand und Protokoll.
- Weiche in `ausliefern`: Der ELW pusht nicht, wenn der Einsatz hier geführt wird und seine Org
  eine aktive meldende Kopplung mit beiden Fähigkeiten hat. Dieselbe Abfrage entscheidet über den
  Ausgang (nur `gegenueber_hinweise`), damit nie ein Push wegfällt, ohne dass der Anlass reist.
- Kennt der Hub Hinweise, bietet aber keinen Push an, reist der Anlass trotzdem (Hinweise am Hub)
  und der ELW pusht selbst.
- Verworfen: Weiche je Einsatz über `spiegel_ziel`. Das gibt es erst nach dem ersten Abgleich;
  bis dahin pushte niemand oder beide.
- Verworfen: ELW pusht zusätzlich, wenn der Hub lange nicht erreichbar war. Ohne Hub fehlt dem ELW
  meist auch das Internet für den Push-Dienst; und ein Rückfall nach Zeit erzeugte doppelte
  Pushs, sobald der Ausgang nachläuft.

### D5 Für alle erledigt reist mit

`benachrichtigung::erledigen` schreibt unter derselben Bedingung einen Ausgang mit
`erledigen = true` (Art, Bezugstyp, die Kennungen). Der Hub ruft `erledigen` mit den
abgebildeten Kennungen. Fehlt eine Zeile noch, stellt er auch das Erledigen zurück: ein älterer
Melde-Anlass zu ihr kann noch warten und legte danach sonst einen offenen Hinweis an. Ein
Erledigen eines Alarms verwirft er. Die Kenntnisnahme in der Lage reicht die gesehenen Meldungen
mit, auch wenn am ELW keine offene Zeile mehr zu ihnen steht. So verschwindet ein „Neue Meldung“ am Hub, wenn die Meldung am ELW
gesichtet wird, statt 24 Stunden stehen zu bleiben.

### D6 umadressieren reist nicht

`umadressieren` (korrigierte Empfängerfunktion einer Meldung, LLH-1381) reist nicht mit. Es ist
selten und braucht den Zustand der Zeilen am Hub; der Hub zeigt den alten Hinweis, bis die
Meldung gesichtet ist (D5) oder 24 Stunden vergangen sind. Wen die Korrektur neu meint, den
pusht der ELW selbst, auch wenn der Hub Push anbietet: sonst erführe er es nirgends. Ein Nachzug
wäre ein eigener Anlass mit `umadressieren`, ohne Protokollbruch.

### D7 Push-Einstellung am ELW

- `WebPushStand` bekommt `ueber_hub: Option<{ name, adresse }>` (Name und Adresse der Kopplung),
  gesetzt, wenn die Org des Nutzers die Bedingung aus D4 erfüllt. Wire additiv, Typen generiert.
- Ohne `--web-push` am ELW bleibt alles wie heute: 404, kein Schalter, kein Hinweis
  (Anforderung „Web Push nur auf Wunsch des Betreibers“). Verworfen: die Route dann trotzdem für
  den Hinweis öffnen. Das hätte die bestehende Anforderung aufgeweicht, und ein ELW ohne Push
  hat seinen Nutzern nie einen Schalter gezeigt, den der Hinweis ersetzen müsste.
- `PUT /api/web-push/abo` antwortet in diesem Fall 422 „Push läuft über ‹Hub›.“ (Zustand, nicht
  das Feld: `src/AGENTS.md`, Statuscode-Konvention). `DELETE` bleibt erlaubt, damit ein Nutzer
  sein ruhendes Abo loswird.
- Bestehende Abos werden weder gelöscht noch geändert. Sie ruhen nur für Einsätze gekoppelter
  Orgs (D4); nach dem Widerruf der Kopplung greift die Weiche nicht mehr.
- Frontend: `ladePushStand` liefert einen neuen Zustand `'ueber_hub'` mit Name und Adresse; die
  Seite „Benachrichtigungen“ zeigt statt des Schalters den Hinweis mit Link auf
  `<adresse>/benachrichtigungen`. Der automatische Wiederanmelde-Lauf (`pushAbgleichen`)
  überspringt diesen Zustand.
- Der Link zeigt die Adresse, unter der der ELW den Hub erreicht. Hat der Betreiber dafür eine
  interne Adresse (Overlay-Netz), sieht der Nutzer diese. Hinnehmbar: der Betreiber kennt sie,
  und eine eigene „öffentliche Adresse“ der Kopplung ist ein Nachzug ohne Protokollbruch.

### D8 Aufräumen schließt Spiegel ein

`benachrichtigung::repo::aufraeumen` lässt Spiegel heute aus, mit der Begründung, der
Schutz-Trigger ließe die Anweisung scheitern. `benachrichtigung` ist aber AUSGENOMMEN und hat
keinen Schutz-Trigger; der Filter stammt aus der Zeit vor dieser Einordnung. Der Filter fällt,
der Wächter `art::tests::trigger_passen_zur_beschreibung` hält die Annahme.

## Risks / Trade-offs

- [Doppelter Push während einer Fähigkeitsänderung] Der ELW liest die Fähigkeiten aus der
  letzten Meldung; schaltet der Hub Push aus, pushen bis zur nächsten Meldung weder ELW noch Hub.
  → Die Meldung läuft im Takt (Sekunden bis Minuten); der Hinweis am Hub bleibt. Hinnehmbar.
- [Hinweis am Hub kommt spät] Er wartet auf den Abgleich. → `takt::wecken()` nach jedem
  Ausgang; ohne Verbindung kommt er nach, höchstens 12 Stunden.
- [Zwei Konten, zwei Hinweise] Wer am ELW und am Hub angemeldet ist, sieht den Hinweis an beiden
  Instanzen. Das ist das bestehende Modell („jede Instanz führt ihre eigenen“), gepusht wird
  aber nur einmal.
- [Ausgang wächst ohne Hub] Ein ELW ohne Verbindung sammelt Anlässe. → Abgeräumt nach 12 Stunden;
  je Anlass wenige hundert Bytes.
- [Neuerer ELW, älterer Hub mit Hinweisen] Unbekannte Werte werden mit Quittung verworfen (D3),
  der Ausgang staut nicht.

## Migration Plan

- Eine Migration (Nummer über der höchsten auf `origin/alpha`, `scripts/check-migrationen.sh`):
  `hinweis_ausgang`, `hinweis_eingang`, `instanz_kopplung.gegenueber_hinweise` und
  `gegenueber_web_push` (Vorgabe 0). Beide Tabellen ohne Einsatzbezug im Sinne der
  Spiegel-Register: `hinweis_ausgang.einsatz_id` mit `ON DELETE CASCADE`; Einordnung in
  `einsatz::schwaerzung_registry` und `spiegel::art` (AUSGENOMMEN, Grund: Benachrichtigungen
  werden nicht gespiegelt) nach den Wächtern.
- Reihenfolge der Einführung ist frei: Bis beide Seiten den neuen Stand haben, meldet der Hub
  keine Fähigkeit, und alles bleibt wie heute.
- Zurück: Ein älterer ELW ignoriert die Fähigkeiten und pusht selbst; ein älterer Hub liefert
  `false`.
