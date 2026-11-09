# Design

## Context

Warum diese Change kommt und was sie umfasst, steht in `proposal.md`, das Verhalten in
`specs/instanz-fuehrung/spec.md`. Lage im Code (09.11.2026):

- **Kopplung (LLH-1490).** Die Seite mit Richtung `meldet_sich` (ELW) ruft
  `POST /api/instanz/melden` alle 60 s, die Seite `wird_gemeldet` (Hub) antwortet nur. Anfrage
  und Antwort sind signiert (`src/instanz/signatur.rs`). Der Rumpf ist höchstens 64 KiB groß
  (`extractor.rs`), und das Schema wächst nur additiv (`src/AGENTS.md`, „Instanzkopplung“).
- **Unterschriften (LLH-1490/1605).**
  - `auth::unterschrift::pruefen::verify` prüft eine Passkey-Assertion über den Hash einer
    Erklärung, auch für einen an anderer Stelle registrierten Schlüssel.
  - Als Unterzeichner zählt nur `zustand = 'gueltig'`.
  - Die einzige Zeremonie zum Unterschreiben ist die Gegenzeichnung (`routes/instanz.rs`,
    `zeremonie.rs` mit `Registrierung` und `Gegenzeichnung`).
- **Codes.** `instanz::code` erzeugt 16 Zeichen Crockford-Base32 (80 bit), normalisiert die
  Eingabe und bildet Prüfwerte per HMAC (`pruefwert`).
- **Schreibsperre heute.** `berechtigung::fordere_aktiv(&einsatz)` sitzt in allen Einsatz-Gates
  (`src/einsatz/kontext.rs`), in rund 20 Replay-Handlern und in den Modulen aus
  `DEFERRED_MODULE`. Innerhalb einer Transaktion gilt `einsatz::repo::fordere_aktiv_in_tx`.
  Beide geben 409 zurück.
- **Kein Einsatzinhalt fließt zwischen Instanzen.** Das baut LLH-1492. Ein Einsatz liegt also
  genau an der Instanz, die ihn angelegt hat.

## Goals / Non-Goals

**Goals:**

- Jede Instanz weiß je Einsatz einer gekoppelten Org, wer ihn führt, und hält sich daran.
- Ein kompromittierter Hub kann einem ELW die Führung nicht nehmen, ohne dass ein Mensch am ELW
  das sieht und bestätigt.
- Die Schnittstelle zu LLH-1492 liegt fest: die Bruchstelle, die Epoche und die Sperre.

**Non-Goals:**

- Kein Inhalt fließt mit: keine ETB-Einträge, keine Lage, keine Anträge. Auch Führungswechsel
  im ETB kommen erst mit LLH-1492, weil die abgebende Seite dort nicht mehr schreiben darf.
- Kein drittes Gegenüber. Neuer Führer ist immer eine der beiden Seiten einer Kopplung.
  ELW↔ELW kommt mit LLH-1497.
- Kein Wechsel von `PROTOKOLL`.
- Kein eigener Entwurf mit `/design`. Die Oberfläche besteht aus einem Paneel, einem Hinweisband
  im vorhandenen Platz unter der Kopfleiste, einem Chip und Dialogen aus vorhandenen Bausteinen.
  Es gibt keine neue Seite und kein neues Modul (`frontend/AGENTS.md`, „Größere UI-Entwürfe“).

## Decisions

### D1 Führungsakte als eigene Tabelle, Sperrmerker am Einsatz

Die neue Migration legt zwei Tabellen und eine Spalte an:

- `einsatz_fuehrung`, je Einsatz eine Zeile.
  - Schlüssel `kennung` = `<Instanzkennung des Ursprungs>/<lokale Einsatz-ID dort>`, im Stil der
    Org-Schlüssel (`mod.rs`).
  - `einsatz_id`: lokal, NULL für eine Akte des Gegenübers.
  - `kopplung_org_id`: die Zuordnung, über die die Akte läuft.
  - Kopf (`nummer`, `bezeichnung`, `stichwort`, `status`) für die Anzeige beim Gegenüber.
  - `epoche_zaehler`, `epoche_instanz`, `fuehrer_instanz`.
  - Offene Übernahme (`offen_erklaerung`, `offen_beweis`), `abgabe_schluessel`, `anfrage`,
    `bruch_at`, `stand`.
- `einsatz_fuehrung_verlauf`, je Wechsel eine Zeile: Epoche, Art, von, nach, wer, Grund,
  Erklärung, Beweis, Bruchstelle, Zeitpunkt.
- `einsatz.fuehrung_bei TEXT NULL`: der Anzeigename der führenden Instanz, wenn eine andere
  führt, sonst NULL. Schreiben darf ihn nur `instanz::fuehrung`, in der Transaktion des Wechsels.

**Warum der Merker am Einsatz:** `fordere_aktiv` ist synchron und bekommt das geladene `Einsatz`.
Mit der Spalte prüfen beide Sperren ohne Join, und die Einsatzanzeige hat den Grund gleich dabei.

**Verworfen:** eine Abfrage der Akte in jedem Gate. Sie braucht `async` und einen zweiten
Zugriff je Schreibvorgang.

**Verworfen:** die Akte als Spalten am Einsatz. Akten des Gegenübers haben keinen lokalen
Einsatz.

### D2 Epoche als Paar, lexikografisch geordnet

`(zaehler, instanz)`. Es gilt das größere Paar: zuerst der Zähler, bei Gleichstand die
Instanzkennung als Text (UUID, fest je Instanz). Wer eine Epoche vergibt, nimmt den
größten ihm bekannten Zähler plus eins und die eigene Kennung.

**Abgestimmt mit Ruben am 09.11.2026.** Damit braucht der Gleichstand keinen eigenen Zustand: Wer
unterliegt, durchläuft den normalen Ablauf einer Übernahme gegen ihn (D7).

**Verworfen:** die Pflicht, einen Konflikt von Hand zu klären. Das bräuchte einen dritten
Zustand „Konflikt“ samt Bedienung, und solange er offen ist, schreiben beide.

### D3 Austausch als Delta über einen Stand, in der Meldung

`MeldenAnfrage` und `MeldenAntwort` bekommen `#[serde(default)]`-Felder:

- `fuehrung`: Akten, die sich seit der letzten Bestätigung des Gegenübers geändert haben.
- `fuehrung_bis`: bis zu welchem Stand des Gegenübers diese Seite Akten übernommen hat.

**Mechanik:**

- Jede Änderung einer Akte vergibt einen neuen `stand`, monoton je Instanz (Muster
  `stammdaten_aenderung`).
- Die Kopplung merkt sich zwei Stände (neue Spalten an `instanz_kopplung`):
  - `fuehrung_gesendet_bis`: was das Gegenüber bestätigt hat;
  - `fuehrung_empfangen_bis`: was diese Seite übernommen hat.
- Je Nachricht gehen höchstens 50 Akten mit. Bleibt mehr übrig, meldet sich der ELW sofort
  wieder (wie nach dem Einlösen).

**Warum ein Delta:** Der Rumpf darf höchstens 64 KiB groß sein. Eine Akte mit Erklärung und
Assertion kommt auf 2–3 KiB, und ein ELW sammelt über Jahre abgeschlossene Einsätze.

**Verworfen:** bei jeder Meldung alle Akten zu schicken.

Eine Akte in der Nachricht trägt:

- Kennung, Org-Schlüssel, Kopf, Epoche, Führer;
- bei einer Notübernahme die Erklärung als Text und den Beweis (Assertion oder Code-Prüfwert,
  D6/D8);
- die Merker `anfrage` (Übernahme erbeten, D9) und `offen` (diese Seite hat die Übernahme
  gesehen, aber noch nicht bestätigt).

Der Hub weiß damit, dass der Hinweis am ELW steht.

**Ältere Gegenstellen:** Ein Gegenüber vor LLH-1491 kennt die Felder nicht und ignoriert sie.
Ist der Schalter nur an einer Seite an, fließt nichts, weil die andere keine Akten schickt und
empfangene verwirft.

### D4 Die Sperre sitzt in `fordere_aktiv`

- `berechtigung::fordere_aktiv` prüft nach dem Status `einsatz.fuehrung_bei`. Ist der Wert
  gesetzt, antwortet es mit 409 „Führung liegt bei „…“.“.
- `fordere_aktiv_in_tx` liest beide Spalten in einer Abfrage und nennt denselben Grund.

Damit sind auf einen Schlag gesperrt: alle Gates, die Replay-Handler, `DEFERRED_MODULE` und die
Transaktionen unter `write_retry!`.

**Verworfen:** ein eigenes Gate neben `fordere_aktiv`. Es fehlte an den rund 20 direkten Aufrufen
und in den Transaktionen.

**Hintergrundläufe gehen nicht über die Gates:** Erinnerung, Benachrichtigung, Ablösung und
`planung/uebernahme.rs`. Aufgabe 2.4 prüft jeden darauf, ob er Einsatzinhalt schreibt. Wenn ja,
geht er über `fordere_aktiv_in_tx` oder überspringt einen Einsatz mit gesetztem `fuehrung_bei`.

Der Schalter steht in `instanz_identitaet.fuehrung_an`, beim Start geschrieben wie
`datentraeger_bestaetigt` (Nachtrag beim Umsetzen: ein prozessweiter Merker hätte zwei Instanzen im
selben Testprozess denselben Schalter gegeben). `fuehrung_bei` ist ein abgeleiteter Merker: der
Start richtet ihn aus den Akten aus, ohne Schalter überall NULL. Ein Betreiber, der die Führung
wieder ausschaltet, sperrt so keinen Einsatz dauerhaft, und die Sperre selbst bleibt eine Prüfung
ohne Abfrage.

**Ergebnis der Prüfung der Hintergrundläufe (Aufgabe 2.4):** Keiner schreibt Einsatzinhalt. Der
Erinnerungslauf setzt nur Merker (ausgelöst, eskaliert, angekündigt) und meldet
Benachrichtigungen; `planung/uebernahme.rs` prüft schon `fordere_aktiv`. Sobald LLH-1492 Inhalte
spiegelt, darf nur die führende Instanz Erinnerungen und Eskalationen auslösen (Nachzug dort).

### D5 Eigenes Gate für die Bedienung der Führung

`EinsatzFuehrungszugriff` = Schalter, Org-Grenze, dann Einsatzleitung oder Admin der
Einsatz-Org, dann die Lese-Policy, **ohne** `fordere_aktiv`. Den Admin braucht es am Hub: die
Notübernahme mit Unterschrift leistet ein Admin, der selten Mitglied des Einsatzes ist. Damit
geht die Bedienung auch, wenn die Instanz gerade nicht führt oder der Einsatz abgeschlossen ist
(Übergabe zur Verwahrung). Das Gate steht in `SANKTIONIERTE_GATES` (ADR-0005), die Routen liegen
unter `/api/einsaetze/{id}/fuehrung/…`.

Akten des Gegenübers (ohne lokalen Einsatz) bedient ein Admin der zugeordneten Org über
`/api/admin/instanz/fuehrung/{kennung}/…`. Gelesen wird über die Übersicht der Kopplungsseite.

### D6 Erklärung und Unterschrift

Die Erklärung einer Notübernahme ist ein kanonischer JSON-Text mit:

- `typ = "lifeline-fuehrung-notuebernahme/1"`;
- Einsatzkennung, alte und neue Epoche, alte und neue führende Instanz;
- Grund, Zeitpunkt (UTC, ADR-0012), Unterzeichner (Konto-ID und Name), Org-Schlüssel.

Unterschrieben wird mit dem vorhandenen Ablauf:

- `zeremonie.rs` bekommt die Variante `Fuehrungserklaerung`.
- Start und Abschluss der Route laufen wie bei `gegenzeichnen_start/_abschluss`.
- Die Challenge ist `erklaerung_hash`.

Im Frontend wird aus `gegenzeichne` ein allgemeines `unterschreibeErklaerung(start, abschluss)`,
das beide Aufrufer nutzen.

Die meldende Seite prüft mit `pruefen::verify` gegen die Schlüssel mit `zustand = 'gueltig'` der
lokal zugeordneten Org. Das sind die vom Hub gelieferten und bestätigten Schlüssel (LLH-1605).

### D7 Wer was annimmt — die Richtung entscheidet

Das Protokoll unterscheidet weiter nicht Hub und ELW, sondern die Richtung:

| Eingehende Akte nimmt mir die Führung | `wird_gemeldet` (Hub) | `meldet_sich` (ELW) |
| --- | --- | --- |
| Epoche von mir vergeben (eigene Übergabe, Abgabe per Code) | schon gesetzt | schon gesetzt |
| Epoche vom Gegenüber, mit gültigem Beweis (D6/D8) | annehmen | offen halten, bis die Einsatzleitung entscheidet |
| Epoche vom Gegenüber, ohne gültigen Beweis | annehmen | verwerfen (D10) |

**Warum die erreichte Seite ohne Rückfrage annimmt:** Entscheidung 9 schützt den ELW. Ein
kompromittierter ELW kann ohnehin nur Einsätze der Orgs nehmen, die seiner Kopplung zugeordnet
sind.

**Prüfung vor der Übernahme:** Jede Akte wird nur angenommen, wenn ihre Org der Kopplung
zugeordnet ist und der neue Führer eine der beiden Seiten ist.

**Solange eine Übernahme offen ist,** bleibt `fuehrung_bei` am ELW NULL, er schreibt weiter. Die
Akte trägt die Übernahme in `offen_*`, und das Hinweisband erscheint.

- **Bestätigen** übernimmt die offene Epoche und setzt `fuehrung_bei` und `bruch_at`.
- **Widersprechen** führt zu D10.

### D8 Abgabecode bindet Erklärung und Epoche, ohne über die Leitung zu gehen

Am ELW erzeugt `instanz::code::generate` den Code.

- Gespeichert wird nur `abgabe_schluessel` = HKDF(Code), mit eigenem Salz
  `"lifeline-fuehrung/1"` und Info = Einsatzkennung und die reservierte Epoche `(n+1, ELW)`.
- Der ELW gibt die Führung sofort ab: Akte und `fuehrung_bei` zeigen das Gegenüber, im Verlauf
  steht „per Code abgegeben, wartet auf Hub“.

Am Hub tippt der Admin den Code ein.

- Der Hub bildet denselben Schlüssel und als Beweis HMAC(Schlüssel, `erklaerung_hash`).
- Der Code selbst geht nicht über die Leitung; der Beweis bindet ihn an genau diese Erklärung
  (Muster `pruefwert`).
- Der Hub kann den Code nicht vorab prüfen. Ein Tippfehler zeigt sich erst am ELW: als ungültige
  Übernahme mit Alarm, und der ELW ist nach D10 wieder Führer.

Mit 80 bit ist Raten aussichtslos. Ein neuer Code überschreibt den Schlüssel.

**Abgestimmt mit Ruben am 09.11.2026.**

**Verworfen:** Notfallcodes, die beim Koppeln entstehen. Die liegen auf Papier herum und gelten
für jeden Einsatz.

### D9 Übergabe und Anfrage

- **Übergabe:** Die führende Seite vergibt `(n+1, ich)` mit dem Gegenüber als Führer und setzt
  `fuehrung_bei` sofort. Sie geht mit der nächsten Meldung oder Antwort hinaus.
- **Anfrage:** Der ELW setzt `anfrage` an einer Akte des Hubs. Der Hub gibt bei dieser Meldung
  ab, vergibt `(n+1, Hub)` mit dem ELW als Führer und schickt die Akte in der Antwort zurück.
- **Notübernahme gegen den Hub:** Der ELW vergibt nach der Rückfrage mit Grund `(n+1, ELW)` sich
  selbst. Der Hub nimmt sie nach D7 an.

Einen Einsatz, den der ELW nur als Akte kennt, kann er nach einer Übernahme noch nicht füllen.
Darum bleibt der Schalter bis LLH-1492 aus.

### D10 Verwerfen und Widersprechen erhöhen die Epoche

Verwirft der ELW eine ungültige Übernahme oder widerspricht die Einsatzleitung einer gültigen,
vergibt der ELW `(max+1, ELW)` sich selbst. Der Hub nimmt diese höhere Epoche nach D7 an. Damit
endet der Zustand, in dem beide glauben zu führen, von selbst, ohne zusätzlichen Konfliktzustand.

**Abgestimmt mit Ruben am 09.11.2026** (Widerspruch = Rückübernahme).

**Folgen und Spuren:**

| Fall | Hub | ELW |
| --- | --- | --- |
| Widerspruch | Hinweis „ELW hat der Notübernahme widersprochen“ an der Kopplung, Admin-Spur | — |
| Verwerfen | Hinweis „ELW hat die Übernahme als ungültig verworfen“ | Alarm, Admin-Spur |

### D11 Bruchstelle für LLH-1492

`bruch_at` ist `instanz_kopplung.zuletzt_gesehen_at` vor der Meldung, die die Übernahme brachte.
Bis dahin hatte das Gegenüber den Stand des ELW. LLH-1492 ersetzt den Zeitpunkt durch die
Log-Position und macht alles danach zu Anträgen. Die Spalte bleibt als Anzeige.

### D12 Anzeige, Benachrichtigung, Spur

**Anzeige:**

- Die Einsatzanzeige bekommt `fuehrung: { fuehrend, bei, epoche, offen }`. Sie fehlt, wenn es
  keine Akte gibt. Der Chip im Kopf erscheint nur, wenn eine andere Instanz führt
  („Führung: Hub Nord“, Nachtrag nach den Bildern: mit eigener Führung drückte er den
  Einsatznamen weg und sagte nichts, was das Paneel nicht zeigt).
- Jede Änderung sendet das `einsatz`-Ereignis, damit das Hinweisband live erscheint. Der
  Query-Key ist schon live.

**Frontend:**

- `schreibrecht.ts` bekommt die Führung als Achse. `darfImEinsatzSchreiben`,
  `darfEinsatzLeiten` und `darfEinsatzVerwalten` werden falsch, wenn eine andere Instanz führt.
- Ein neues `darfFuehrungBedienen` gilt für die Einsatzleitung, unabhängig von Status und
  Führung.
- `nurAnsicht.ts` bekommt den Grund „Führung liegt bei …“.

**Benachrichtigungen:**

| Art | Stufe | An | Wann |
| --- | --- | --- | --- |
| `fuehrung_ungueltig` | Alarm | Einsatzleitung | Übernahme verworfen |
| `fuehrung_uebernommen` | Warnung | Einsatzleitung | gültige Übernahme offen |

Das bleibt im Budget von höchstens zwei Alarmen in zehn Minuten.

**Admin-Spur:** drei neue Aktionen:

- `fuehrung_notuebernahme` (an der erklärenden Seite und beim Bestätigen);
- `fuehrung_verworfen`;
- `fuehrung_widerspruch`.

Vom Gegenüber ausgelöste Einträge laufen über `schreibe_ohne_akteur`.

### D13 Neue ADR

Der Kern wird ADR-0018 (nächste freie Nummer beim Merge): Ein Einsatz hat genau eine führende
Instanz.

**Regeln:**

- Schreibwege gehen über `fordere_aktiv` bzw. `fordere_aktiv_in_tx`.
- `einsatz.fuehrung_bei` schreibt nur `src/instanz/fuehrung/`.
- Die meldende Seite nimmt eine fremde Epoche nur mit geprüftem Beweis an.

**Prüfung:** `verbiete` für Schreibzugriffe auf `fuehrung_bei` außerhalb des Moduls und der
Migrationen.

## Risks / Trade-offs

- **[Ein kompromittierter Hub erschleicht eine Admin-Unterschrift für eine Notübernahme** (wie
  R24, die Seite ruft `credentials.get` mit eigener Challenge)] → Der ELW gibt nie still ab: Ein
  Mensch am ELW bestätigt und sieht Grund und Unterzeichner. Bleibt als Risiko in Kapitel 11
  (Gewöhnung an die Bestätigung).
- **[Während einer offenen Übernahme schreiben beide Seiten]** → So gewollt (Entscheidung 9: Der
  ELW arbeitet weiter). LLH-1492 führt die Schreibvorgänge über die Bruchstelle als Anträge
  zusammen. Bis dahin ist der Schalter aus.
- **[Ein kompromittierter ELW nimmt dem Hub Einsätze]** → Das geht nur für Orgs seiner Kopplung
  und steht in der Admin-Spur des Hubs. Die Kopplung lässt sich widerrufen.
- **[Ein Tippfehler im Abgabecode wirft die Führung an den ELW zurück]** → Er wird sichtbar
  (Alarm, Verlauf). Am ELW gibt es einen neuen Code, der Hub gibt ihn erneut ein.
- **[Hintergrundläufe schreiben an einem Einsatz, den die Instanz nicht führt]** → Aufgabe 2.4
  prüft jeden Lauf. Was übrig bleibt, wird ein Nachzug zu LLH-1492.
- **[Der Rumpf wächst über 64 KiB]** → Delta und höchstens 50 Akten je Nachricht (D3).

## Nachträge aus dem Review (09.11.2026)

- **Widerruf löst die Sperre:** Wird eine Org-Zuordnung widerrufen (hier oder vom Gegenüber),
  holt diese Instanz ihre lokalen Einsätze, die das Gegenüber führte, mit der nächsten Epoche
  zurück (`repo::release_nach_widerruf`). Sonst bliebe ein Einsatz gesperrt, ohne dass ihn jemand
  übergeben oder zurückholen könnte.
- **Zähler begrenzt:** Eine gelieferte Epoche über 2^40 wird nicht übernommen; ein Überlauf beim
  Weiterzählen hätte jede Meldung der Kopplung scheitern lassen.
- **Anfrage nur auf den gesehenen Stand:** Eine Anfrage wird nur bei gleicher Epoche erfüllt, und
  jeder Wechsel löscht den eigenen Merker. Ist das Gegenüber zurück, geht die eigene Akte mit
  neuem Stand noch einmal hinaus.
- **Mehrere ELW an einem Hub:** Die meldende Seite übernimmt eine Übergabe an eine dritte Instanz
  zur Anzeige (nimmt sie ihr die Führung, braucht sie wie jede Übernahme einen Beweis).
- **Kennung mit Zufallsteil:** `<Ursprung>/<Einsatz-ID>-<8 Hex>`, weil eine Einsatz-ID nach
  endgültigem Löschen wieder vergeben werden kann.
- **Bestätigen prüft den Stand:** Die offene Übernahme muss noch der geltenden Epoche gelten.
- **Code am Hub beweist nichts:** Die Seite, die den Code eingibt, kann ihn nicht prüfen und führt
  bis zur nächsten Meldung der meldenden Seite. Sicher bleibt die meldende Seite: Sie nimmt nur den
  passenden Code an.

**Aus dem Review von CodeRabbit (PR #1243):**

- Die erreichte Seite nimmt eine Epoche der meldenden nur an, wenn die Führung bisher bei ihr
  selbst oder bei dieser meldenden Seite lag; sonst Hinweis an der Kopplung. So nimmt ein ELW
  keinem anderen ELW derselben Org die Führung.
- Der Widerruf räumt auch offene Übernahmen dieses Gegenübers; Bestätigen verlangt ein noch
  gekoppeltes Gegenüber.
- Die Schwärzung setzt `offen` und `offen_bruch_at` gemeinsam auf NULL (CHECK der Tabelle).
- Sofort wieder melden nur, wenn das Gegenüber quittiert hat.

## Migration Plan

- Die Migration ist rein additiv: zwei neue Tabellen, neue Spalten an `einsatz` und
  `instanz_kopplung`, Neuaufbau der CHECKs von `admin_audit` und `benachrichtigung`. Die Nummer
  ist die nächste freie über `origin/alpha` (`scripts/check-migrationen.sh`).
- Der Schalter steht auf aus. Für bestehende Installationen ändert sich nichts.
- Wer ihn einschaltet, bekommt Akten für alle Einsätze der gekoppelten Orgs bei der nächsten
  Meldung (Epoche 1, Führer = Ursprung).
- **Rückweg:** Schalter aus. Die Sperre ignoriert `fuehrung_bei` dann (D4), die Akten bleiben
  liegen.
