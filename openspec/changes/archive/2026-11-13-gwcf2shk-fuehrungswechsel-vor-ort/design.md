# Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/gwcf2shk8trgugyk871op4lc (LLH-1678). Den Lösungsweg hat
Ruben am 13.11.2026 abgestimmt. Zu drei Fragen fiel die Wahl jeweils auf die Empfehlung:
Widerspruch, Nachziehen am Hub, Anfrage. Dazu kommt der Hinweis auf Protokoll 4.

## Context

Die Motivation steht in `proposal.md`, „Why“. Für das Vorgehen zählt Folgendes.

**Die Führung folgt heute der Richtung** (Change `v6hj7xl2`, D7; Ergänzung `faq7l7m4`, D3):

| Fall | erreichte Seite (Hub) | meldende Seite (ELW) |
| --- | --- | --- |
| Gegenüber nimmt mir die Führung | nimmt an (`entscheide`) | nur mit Beweis, dann offen bis zum Menschen, sonst verwerfen |
| Notübernahme gegen mich | ohne Beweis (`notuebernahme_gegen_erreichte`) | Unterschrift oder Code (`notuebernahme_gegen_meldende`) |
| Anfrage an mich | sofort erfüllt (`erfuelle_anfrage`) | kann nicht angefragt werden |
| Abgabecode | erzeugt sie nicht | erzeugt sie (`code_abgeben`) |
| Antwort auf Widerspruch/Verwerfen | nimmt an | – |

**Direktkopplung (LLH-1497).** `InstanzKopplungArt::traegt(Fluss::Fuehrungswechsel)` ist für
`vor_ort` `false`. Daraus folgt:
- `dienst::fordere_wechsel` antwortet mit 409.
- `austausch::entscheide_vor_ort` verwirft jeden Wechsel zwischen den beiden Seiten.
- Eine Abgabe des bisherigen Führers an eine Dritte nimmt sie an.
- `instanz::repo` holt nach dem Widerruf einer Direktkopplung nichts zurück.

Der Wächter `instanz::art_tests::jeder_fluss_hat_seine_pruefstellen` zählt diese Stellen.

**Der Hub** lehnt als erreichte Seite zwei Arten von Akten ab:
- eine Akte, in der der Sender eine dritte Instanz als Führer nennt (`apply_eingang`, Zweig
  `von_sender && m.fuehrer != sender`);
- eine Akte, mit der der Sender die Führung beansprucht, die bei einer dritten Instanz liegt.

Das Zweite ist der Schutz „ein ELW nimmt keinem anderen ELW die Führung“ (CodeRabbit, PR #1243).

**Unterschriftsschlüssel** fließen nur von der ausstellenden zur einlösenden Seite:
- `grundstock` beim Koppeln, danach `nachlieferung` in der `MeldenAntwort`;
- beides nur mit `herkunft = 'lokal'`.

Eine Nachlieferung braucht eine Gegenzeichnung. `check_gegenzeichnung` prüft dabei auch, dass
`AufnahmeErklaerung.org == fremde_org_kennung` der Org-Zuordnung ist. Danach wartet der Schlüssel
auf Bestätigung. Ein Widerruf trifft nur die Zeile dieser Zuordnung.

**Protokoll:** `PROTOKOLL = 3`. Das Fenster N/N−1 (`protokollfenster`) lässt bei einem Abstand von
zwei nur Melden und Status zu. Jede Kopplung kennt `gegenueber_protokoll` aus der letzten Nachricht.

## Goals / Non-Goals

**Goals:**
- Für einen Wechsel zwischen den beiden Seiten einer Direktkopplung gilt an beiden Seiten die Regel
  der meldenden Seite. Die Richtung bestimmt die Regel nicht mehr.
- Am Hub bleibt eine Instanz kein falscher Führer, wenn die Führung zwischen zwei ELW gewechselt
  ist.
- Jede Annahmeregel bleibt eine reine Funktion mit Tabelle und Test.

**Non-Goals:**
- Hub ↔ ELW ändert sich nicht. Dazu gehören die automatische Anfrage, die Notübernahme ohne Beweis
  gegen den Hub und die Verwahrung.
- Verwahrung über die Direktkopplung (Fluss `Verwahrung` bleibt `false`).
- Zurückholen nach dem Widerruf einer Direktkopplung.
- Weiterleiten über mehrere Instanzen.
- Ein eigener Entwurf mit `/design`. Das Paneel „Führung“ bekommt einen Block und andere
  Bedingungen für vorhandene Knöpfe; eine neue Seite gibt es nicht.

## Decisions

### D1 Eine Regel je Gegenüber statt `traegt(Fluss::Fuehrungswechsel)` an jeder Stelle

Neu ist `instanz::Wechselregel` mit drei Werten:

| Wert | Wann | Bedeutung |
| --- | --- | --- |
| `NachRichtung` | `standard` | die Tabelle oben, unverändert |
| `Gleichrangig` | `vor_ort`, und die Gegenstelle nennt `gegenueber_protokoll >= PROTOKOLL_FUEHRUNG_VOR_ORT` (4) | jede Seite verhält sich gegenüber der anderen wie eine meldende Seite |
| `Gesperrt` | `vor_ort` mit älterer Gegenstelle | wie heute: kein Wechsel zwischen den Seiten, 409, Hinweis „<Name> braucht ein Update für den Führungswechsel vor Ort“ |

Berechnet wird sie in `wechselregel(art, gegenueber_protokoll)`, `KopplungZeile::wechselregel()` und
`FuehrungGegenueber::wechselregel`. Diese Stellen fragen sie ab:
- `dienst::fordere_wechsel` sowie jede Bedingung auf `richtung` in `dienst`:
  - Code nur an der meldenden Seite
  - Anfrage nur an der meldenden Seite
  - Notübernahme ohne Beweis nur gegen die erreichte Seite
  - Erklärung mit Beweis nur gegen die meldende Seite
- `austausch::apply_eingang`
- `repo::list_hubs`

Für die Regel `Gleichrangig` sind die Prüfungen auf `richtung` so umgestellt:

| Stelle | Bedingung heute | mit `Gleichrangig` |
| --- | --- | --- |
| `code_abgeben` | `richtung == MeldetSich` | erlaubt |
| `anfragen` | Führer ist `MeldetSich` | erlaubt |
| `notuebernahme_gegen_erreichte` | gegen `MeldetSich` | 422 „Über eine Direktkopplung braucht die Notübernahme eine Unterschrift oder einen Code.“ |
| `build_erklaerung_gegen_meldende` | nur gegen `WirdGemeldet` | erlaubt |

`Fluss::Fuehrungswechsel` bleibt für das, was nur die Richtung trägt. Konkret ist das nur noch das
Zurückholen nach dem Widerruf (`instanz::repo`). Der Doc-Kommentar heißt künftig „Führungswechsel
nach Richtung (Hub-artig)“. Der Wächter zählt `wechselregel(` in `dienst.rs` und `austausch.rs`
anstelle der bisherigen Nadeln.

**Verworfene Alternativen**
- *`traegt(Fluss::Fuehrungswechsel)` für `vor_ort` auf `true` setzen:* Damit gälten an der
  erreichten Seite die Hub-Regeln, also Annahme ohne Beweis und automatische Anfrage. Das ist genau
  das stille Abgeben, das die Aufgabe ausschließt.
- *Die Protokollprüfung je Stelle:* Sie läuft auseinander wie die `if art == VorOrt`, die D2 von
  `t10a7luh` schon verworfen hat.

### D2 Annahmeregel vor Ort als reine Funktion

`austausch::entscheide_vor_ort` bekommt die Regel und zwei abgeleitete Merker:
- `bewiesen`: der Beweis gegen mich trägt.
- `antwort`: die Akte ist eine Antwort auf meine eigene Übernahme (D3).

Die Regel gilt **vor** allen Zweigen, die von der Richtung abhängen. Heute läuft der Block
„dritter führt/dritte Epoche → offen halten“ der meldenden Seite noch vor dem Zweig für vor Ort.
Das wird berichtigt, so wie es der Nachtrag zu D4 von `t10a7luh` schon beschreibt.

| Akte über `vor_ort` mit größerer Epoche | `Gesperrt` | `Gleichrangig` |
| --- | --- | --- |
| Ich führe, Sender nennt sich als Führer, Antwort auf meine Übernahme | verwerfen + Hinweis | **annehmen**, Alarm, Spur, Hinweis (D3) |
| Ich führe, Sender nennt sich als Führer, Beweis trägt | verwerfen + Hinweis | **offen halten** (Hinweisband, Benachrichtigung „Führung übernommen“) |
| Ich führe, Sender nennt sich als Führer, kein Beweis | verwerfen + Hinweis | **verwerfen** wie die meldende Seite: weiterführen, Alarm, Spur |
| Sender führte, nennt mich als Führer (Übergabe, Code-Abgabe, Anfrage erfüllt) | verwerfen + Hinweis | **annehmen** |
| Sender führte, nennt eine dritte Instanz | annehmen | annehmen |
| sonst (weitergereicht) | nur Anzeige | nur Anzeige |

Auch die Zweige bei gleicher Epoche gelten mit `Gleichrangig` an beiden Seiten:
- *Code prüfen:* heute nur für `MeldetSich`.
- *Bestätigt nachtragen:* heute nur für `WirdGemeldet`.
- `check_offene`.

Die Tabelle steht als Test über alle Zellen fest, wie D7 aus LLH-1491.

**Verworfene Alternative:** Den Wechsel vor Ort über `entscheide` mit einer gedachten Richtung
`MeldetSich` laufen lassen. Das ginge, verstreute aber die Sonderfälle (Antwort, dritte Instanz) auf
die vorhandenen Zweige, und dort hängen auch Hub-Fälle (Verwahrung, `ist_konflikt`).

### D3 Antwort auf die eigene Übernahme

Eine Akte gilt als Antwort, wenn alles davon zutrifft:
- Ich führe per Notübernahme, also `a.art()` ist `Notuebernahme` oder `CodeAbgabe` und
  `a.epoche().instanz == ich`.
- Die gespeicherte Erklärung nennt den Sender als `fuehrer_alt`.
- `m.fuehrer == sender`.
- `m.art` ist `widerspruch` oder `verworfen`.
- `m.epoche == (a.epoche().zaehler + 1, sender)`.

Die letzte Bedingung folgt aus der Rechnung der abgebenden Seite: `widersprechen` und
`fuehre_weiter` nehmen die nächste Epoche nach der größten bekannten, und das ist meine.

Wird angenommen, gibt es:
- `Folge::Alarm` (Benachrichtigung „Ungültige Übernahme der Führung“);
- Spur `FuehrungWiderspruch` bzw. `FuehrungVerworfen`;
- einen Hinweis an der Kopplung („<Name> hat der Notübernahme widersprochen“ bzw. „… hat die
  Übernahme als ungültig verworfen“).

Ein Hin und Her ist ausgeschlossen. Jede spätere Akte, mit der der Sender die Führung beansprucht,
ist keine Antwort mehr und läuft durch die Prüfung des Beweises.

**Verworfene Alternative:** Auch die übernehmende Seite hält offen. Das wäre ganz symmetrisch, aber
zwei Einsatzleitungen könnten sich die Führung dann gegenseitig zuschieben. Abgestimmt ist die
Annahme mit Alarm.

### D4 Anfrage vor Ort

**Am Führer**
- Kommt `anfrage: true` über eine gleichrangige Kopplung von der Gegenstelle bei gleicher Epoche,
  setzt der Führer `einsatz_fuehrung.anfrage_von = sender`.
- Er erfüllt die Anfrage nie von selbst. `erfuelle_anfrage` und `erfuelle_wartende` gelten nur für
  `NachRichtung`.
- Wechselt `anfrage_von` von leer auf den Sender, entsteht `Folge::Anfrage`, und die Benachrichtigung
  geht an die Einsatzleitung. Kommt dieselbe Anfrage wieder, bleibt `anfrage_von` gesetzt, und es
  entsteht keine Folge (Spec „Führung angefragt“).
- `FuehrungAnzeige.anfrage_eingang` trägt `{kennung, name}`, solange `anfrage_von` gesetzt ist und
  die Regel `Gleichrangig` gilt.

**Übergeben** ist das vorhandene `uebergeben` an `anfrage_von`, abgeglichen. Die Übergabe löscht
`anfrage_von`, so wie jeder Wechsel.

**Ablehnen**: neue Route `POST …/fuehrung/anfrage/ablehnen`, Recht wie bei der Übergabe.
- Sie setzt `anfrage_von = NULL` und `anfrage_abgelehnt = <kennung>` (neue Spalte) und hebt den
  Stand.
- Ab da trägt die Akte auf der Leitung `anfrage_abgelehnt: Some(kennung)`, ein optionales Feld.
- Am Führer bleibt `anfrage_abgelehnt` stehen, bis die Gegenstelle eine Akte derselben Epoche mit
  `anfrage: false` schickt. Bis dahin setzt eine wiederkehrende `anfrage: true` `anfrage_von` nicht
  neu. Danach gilt eine neue Anfrage wieder.

**Am Anfragenden**
- Kommt eine Akte mit gleicher Epoche und `anfrage_abgelehnt == ich`, während `anfrage_at` gesetzt
  ist, löscht er `anfrage_at`.
- Er schreibt einen Verlaufseintrag „Anfrage abgelehnt“ und setzt in seiner Akte
  `anfrage_abgelehnt` auf seine eigene Kennung.
- Das Paneel zeigt „Anfrage abgelehnt“, bis er neu anfragt oder die Führung wechselt.

**Verworfene Alternativen**
- *Nur Hinweis ohne „Ablehnen“:* Der Anfragende wüsste nicht, woran er ist. Abgestimmt ist
  „Übergeben/Ablehnen“.
- *Ablehnung als eigene Nachricht:* Das braucht einen neuen Kanal. Die Akte trägt den Stand ohnehin
  in beide Richtungen.

### D5 Nachziehen an der erreichten Seite einer Standardkopplung

Im Zweig `Greater` von `apply_eingang` greifen bei `WirdGemeldet` zwei Regeln, und zwar vor den
beiden Ablehnungen.

**(a) Zeuge**
- Bedingung: `a.fuehrer_kennung == sender` und `m.fuehrer ∉ {sender, ich}`.
- Folge: annehmen über `folge_dem_absender`, gleich wer die Epoche vergab. Bei einer bestätigten
  Notübernahme vor Ort vergab sie der neue Führer.
- Das ist sicher, weil der Sender nur seine eigene Führung abgibt.

**(b) Unterschrift**
- Bedingungen:
  - `m.fuehrer == sender`, und `a.fuehrer_kennung ∉ {sender, ich}`;
  - die Erklärung nennt `fuehrer_alt == a.fuehrer_kennung` und `epoche_alt == a.epoche()`;
  - der Beweis ist eine Unterschrift, die gegen die Schlüssel dieser Instanz gilt.
- Geprüft wird mit `check_unterschrift`, verallgemeinert auf den bisherigen Führer `gegen` statt
  `ich`.
- Folge: annehmen, Verlaufseintrag mit Grund und Unterzeichner, Spur `FuehrungNotuebernahme`.
- Ein Code oder eine Erklärung zu einem anderen Stand führt zur bisherigen Ablehnung mit Hinweis.

Kommt danach der alte Führer zurück, führen beide Fälle zum selben Ergebnis:
- *Er bestätigt:* Seine Akte hat dieselbe Epoche wie die des Hubs, also ändert sich nichts.
- *Er widerspricht:* Der Hub lehnt seine Akte ab, die Führung liege bei ELW 2. Dann nimmt ELW 2 den
  Widerspruch an (D3) und bezeugt die Abgabe an ELW 1, und der Hub folgt nach (a).

**Verworfene Alternative:** Nur der Zeuge. Ein zerstörter ELW 1 ließe den Spiegel am Hub dann für
immer stehen, und ELW 2 könnte nicht an den Hub übergeben. Abgestimmt ist „Zeuge oder
Unterschrift“.

### D6 Unterschriftsschlüssel über die Direktkopplung

**Welche Schlüssel gehen hinaus**
- *Über eine Direktkopplung:* der Grundstock und die Nachlieferung, beide mit den gültigen
  Schlüsseln der Org aus `lokal` und aus `gegenueber`.
- *Ausgenommen:* Zeilen, die über dieselbe Org-Zuordnung gekommen sind (`kopplung_org_id`). Sonst
  ginge der Schlüssel im Kreis.
- *Über Standardkopplungen:* unverändert nur `lokal`.

**Stand für Weitergereichtes**
- Neue Spalte `unterschrift_schluessel.weiter_stand`.
- Sie wird aus demselben Zähler wie die lokalen Stände vergeben (`next_stand` nimmt das Maximum
  beider), sobald eine übernommene Zeile hier gültig oder widerrufen wird.
- Die Nachlieferung vor Ort liest `lokal` mit `stand > seit` und `gegenueber` mit
  `weiter_stand > seit`. Der Stand der Lieferung ist der jeweilige Wert.

**Herkunft der Aufnahme**
- `UnterschriftSchluesselLieferung.aufnahme_org` ist optional. Der Weiterreichende setzt darin die
  `fremde_org_kennung`, unter der er den Schlüssel bekam.
- `check_gegenzeichnung` vergleicht `e.org` mit `aufnahme_org`, wenn das Feld gesetzt ist, sonst wie
  bisher mit `fremde_org_kennung`.
- Der Gegenzeichner muss weiterhin ein hier gültiger Schlüssel dieser Org-Zuordnung sein.

**Beide Richtungen**
- Über eine Direktkopplung schickt auch die meldende Seite Schlüssel: `MeldenAnfrage.orgs[].unterschrift`
  und `unterschrift_bis`.
- Die erreichte Seite quittiert in `MeldenAntwort.orgs[].unterschrift_stand`. Beides ist optional
  und additiv.
- Das Byte-Budget kommt aus der Anfrage (64 KiB Rumpf): `UNTERSCHRIFT_ANFRAGE_BYTES`. Was nicht
  passt, folgt mit der nächsten Meldung.

**Grundstock der meldenden Seite**
- Mit ihrer ersten Meldung über die Zuordnung, auch einer ohne Schlüssel, nennt die meldende Seite
  `grundstock_bis`, ihren höchsten Stand zu diesem Zeitpunkt.
- Die erreichte Seite speichert ihn einmal in `instanz_kopplung_org.unterschrift_grundstock_bis`.
  Spätere Angaben überliest sie.
- Zeilen bis zu diesem Stand übernimmt sie wie einen Grundstock: sofort gültig. Alles danach
  wartet ohne Gegenzeichnung auf die Bestätigung eines Admins (siehe Nachträge).
- Die Bindung durch den Code gilt in beide Richtungen („Der Code bindet die Schlüssel beider
  Seiten“). Die einlösende Seite ist also so gut verankert wie die ausstellende.

**Widerruf je Credential**
- Das gilt für `accept_lieferungen` (Zweig Widerruf), für `widerrufen` und
  `alle_des_benutzers_widerrufen`, nicht für das Ende einer Zuordnung (siehe Nachträge).
- Dort wird jede übernommene Zeile der Org mit derselben `credential_id` auf `widerrufen` gesetzt,
  mit neuem `weiter_stand`, damit der Widerruf weiterwandert. Aus einer Lieferung wirkt das nur für
  eine Zeile, die hier gültig war, und mit deren gespeicherter Credential-ID.
- Ein Schlüssel, der über eine andere Zuordnung später wieder als gültig kommt, trifft auf
  „Schlüssel war widerrufen“. Die vorhandene Prüfung `schon` wird dafür auf die ganze Org statt auf
  die Zuordnung erweitert, nur für widerrufene und abgelehnte Zeilen einer noch geltenden
  Zuordnung.

**Verworfene Alternativen**
- *Nur in Richtung der ausstellenden Seite weiterreichen:* Dann kennt die ausstellende Seite die
  Schlüssel der einlösenden nicht, und eine Notübernahme gegen sie wäre nicht beweisbar. Das
  widerspricht der gleichrangigen Regel.
- *Jeden weitergereichten Schlüssel warten lassen, auch im Grundstock:* Eine Notübernahme vor Ort
  wäre erst nach einer Bestätigung an der Gegenstelle möglich, und im Ausfall fehlt genau die.

### D7 Protokoll 4

`PROTOKOLL = 4`, neu `PROTOKOLL_FUEHRUNG_VOR_ORT = 4`. Neu auf der Leitung, alles optional:
- `AkteMeldung.anfrage_abgelehnt`
- `UnterschriftSchluesselLieferung.aufnahme_org`
- Schlüssel und `grundstock_bis` in der `MeldenAnfrage`, Quittung in der `MeldenAntwort`

`PROTOKOLL_SPIEGEL` (2) und `PROTOKOLL_VOR_ORT` (3) bleiben. Nach dem Fenster N/N−1 kommt eine
Instanz mit Protokoll 2 mit einer Instanz mit Protokoll 4 nur noch zu Melden und Status, mit
„Update nötig“. Laut `src/AGENTS.md` darf Version 2 jetzt aus dem Code; entfernt wird sie in dieser
Change nicht.

**Verworfene Alternative:** Ein Fähigkeitsmerker in der Meldung statt einer neuen Version. Er hätte
Protokoll 2 nicht ausgesperrt, aber neben der Version einen zweiten Kompatibilitätsweg geschaffen.
Abgestimmt ist Protokoll 4.

### D8 Oberfläche

Das Frontend leitet die Bedienbarkeit nicht mehr selbst aus `art` und `richtung` ab:
- `FuehrungGegenueber` trägt `wechsel: 'nach_richtung' | 'gleichrangig' | 'gesperrt'` und bei
  `gesperrt` den Grund.
- `fuehrungText.fuehrungMoeglich` liest daraus:
  - die Ziele der Übergabe;
  - die Code-Abgabe (`nach_richtung` und meldend, oder `gleichrangig`);
  - die Anfrage;
  - die Notübernahme. Mit `gleichrangig` ist ein Beweis Pflicht, der Dialog bietet dann nur
    „Eigene Unterschrift“ und „Code des Gegenübers“.

**Block „<Name> bittet um die Führung“** im Paneel, bei `anfrage_eingang`:
- Knöpfe „Übergeben“ (vorhandene Mutation mit `an`) und „Ablehnen“ (neue Mutation).
- Die Rechte sind die der Übergabe.

**Weitere Anzeigen**
- Beim Anfragenden zeigt `anfrage_abgelehnt` „Anfrage abgelehnt“ statt „Führung angefragt“.
- Die Kopplungskarte zeigt bei `gesperrt` den Grund aus D1.
- Der Hinweis „Führungswechsel dorthin kommt später“ entfällt.
- Die Benachrichtigung „Führung angefragt“ kommt in `alarm/benachrichtigungKatalog.ts` und springt
  zum Paneel „Führung“ des Einsatzes.

Texte liegen in `fuehrungText.ts` und `instanzText.ts`, die Query-Keys bleiben (`fuehrung`, `einsatz`,
`instanzkopplung`).

### D9 Regel als ADR

Eine neue ADR mit der nächsten freien Nummer auf `alpha` (heute ADR-0039): „Über eine
Direktkopplung gibt keine Seite ohne Beweis und ohne ihre Einsatzleitung ab“.

**MUST-Regeln**
- Vor Ort nur mit `Gleichrangig`.
- Eine Notübernahme vor Ort nur mit Beweis.
- Die abgebende Seite hält offen.
- Der Hub folgt nur dem Zeugen oder der Unterschrift.

**Prüfzeilen** (`verlange`/`verbiete`) gegen `austausch.rs` und `dienst.rs`.

**Zugleich**
- ADR-0033 bekommt einen Verweis: vor Ort ist die Gegenstelle kein Dritter.
- `src/AGENTS.md`, Abschnitte „Führung je Einsatz“ und „Direktkopplung vor Ort“, wird angepasst.
- arc42 Kapitel 8 (Querschnitt Instanzkopplung) wird ergänzt.

### D10 Migrationen

Die Nummern müssen größer sein als jede auf `origin/alpha` (heute 0345), vorher
`scripts/check-migrationen.sh`.
1. `einsatz_fuehrung.anfrage_abgelehnt TEXT NULL`,
   `unterschrift_schluessel.weiter_stand INTEGER NULL`,
   `instanz_kopplung_org.unterschrift_grundstock_bis INTEGER NULL`. Das sind nur `ADD COLUMN`,
   kein Neubau.
2. Neubau von `benachrichtigung` für den CHECK der neuen Art `fuehrung_angefragt`, mit
   `einheit_id` und `durch_einheit_id` (`src/AGENTS.md`, Benachrichtigungen). Es ist ein
   Blatt-Umbau ohne `-- no-transaction`, denn keine Tabelle verweist auf `benachrichtigung`. Er
   folgt dem letzten Neubau, Muster `0316`.

## Risks / Trade-offs

- **[Protokoll 2 fällt aus dem Fenster]** → Instanzen mit Protokoll 2 und 4 zeigen beide „Update
  nötig“. Akten, Spiegel und Stammdaten ruhen bis zum Update. Ausrollen: erst alle Instanzen auf
  Protokoll 3, dann 4. Das gehört in die Versionshinweise.
- **[Eine Gegenstelle vor Ort kann per Grundstock Admin-Schlüssel einschleusen]** → Das gilt heute
  genauso für den Hub gegenüber dem ELW, und es setzt eine gekoppelte, also per Code vertraute
  Instanz voraus. Die abgebende Seite gibt trotzdem erst nach ihrer Einsatzleitung ab, und jeder
  neue Schlüssel nach dem Grundstock wartet auf Bestätigung.
- **[Zwei Führer, bis die abgebende Seite entscheidet]** → Das ist gewollt, denn im Ausfall gibt es
  niemanden, der entscheiden könnte. Beide Seiten zeigen den Zustand (Hinweisband bzw. Kopf), die
  Bruchstelle steht im Verlauf, und der Hub folgt nur einem Beleg (D5).
- **[Hub folgt einer Unterschrift, die ELW 1 später ablehnt]** → Der Ablauf führt in jedem Fall zu
  einem gemeinsamen Ergebnis (D5), mit Spur an beiden Stellen.
- **[Ein weitergereichter Schlüssel wird nach seinem Widerruf am Hub weiter vor Ort genutzt, solange
  die weiterreichende Seite offline ist]** → Der Widerruf je Credential greift, sobald die Instanz
  ihn über irgendeine Kopplung erfährt. Bis dahin gilt dasselbe Fenster wie heute zwischen Hub und
  ELW.
- **[Neubau von `benachrichtigung`]** → Der Umbau folgt dem Muster der letzten Migration dieser
  Tabelle. Der Test `check_listen_entsprechen_dem_katalog` und die Migrationstests laufen.

## Migration Plan

1. Migrationen wie in D10 anlegen. `scripts/check-migrationen.sh` läuft gegen `origin/alpha`.
2. Ausrollen:
   - Der Hub kann zuerst oder zuletzt kommen, Standardkopplungen mit Protokoll 3 arbeiten weiter.
   - Eine Direktkopplung trägt den Führungswechsel erst, wenn beide ELW Protokoll 4 sprechen. Bis
     dahin gilt die Sperre mit Hinweis.
3. Rückweg: Eine Instanz mit Protokoll 3 überliest die neuen Felder. Liegt eine Akte offen, bleibt
   sie dort bestehen. Die neuen Spalten stören ältere Lesepfade nicht.

## Nachträge

- **13.11.2026, D5/D6: ELW-Schlüssel zum Hub (mit Ruben abgestimmt).** Beim Umsetzen zeigte sich:
  Eine Unterschrift entsteht immer mit einem Schlüssel der unterschreibenden Instanz, denn ein
  Passkey ist an deren Adresse gebunden. Der Hub kannte nur seine eigenen Schlüssel, Regel (b) hätte
  also nie gegriffen. Deshalb liefert die meldende Seite einer Standardkopplung dem Hub jetzt ihre
  hier registrierten Schlüssel (`GegenzeichnungPflicht::NurBestaetigung`):
  - ohne Gegenzeichnung, denn ein ELW zeichnet nicht gegen;
  - jeder wartet auf die Bestätigung eines Admins am Hub, ein Grundstock entsteht dort nicht;
  - der Hub reicht sie nicht weiter.

  Verworfen wurde „(b) entfällt, nur der Zeuge“: Bei einem zerstörten ELW 1 bräuchte es dann eine
  Notübernahme durch den Hub-Admin und eine Übergabe an ELW 2.
- **13.11.2026, D6: Quittung an der meldenden Seite.** Die meldende Seite merkt sich, wie weit die
  erreichte Seite ihre Schlüssel quittiert hat (`instanz_kopplung_org.unterschrift_gesendet_bis`).
  Die Spalte kam zu den drei in D10 genannten dazu. Die Migration gibt bestehenden übernommenen
  Schlüsseln einen `weiter_stand` über jedem lokalen Stand. Über eine Direktkopplung, die vor
  diesem Stand bestand, kommen sie deshalb als Nachlieferung, mit Gegenzeichnung und Bestätigung.
- **13.11.2026, D6: Widerruf je Credential nicht beim Ende einer Zuordnung.**
  `fremde_der_zuordnung_widerrufen` widerruft nur die Zeilen der beendeten Zuordnung. Der Schlüssel
  selbst ist dabei nicht widerrufen und gilt über andere Kopplungen weiter.
- **13.11.2026, D4: Anfrage und Ablehnung am Stand der Epoche.** `repo::save` löscht
  `anfrage_von` und `anfrage_abgelehnt`, sobald sich die Epoche ändert. Rechts im `UPDATE` stehen
  die alten Werte der Zeile. Damit gilt eine Anfrage nur dem Stand, den sie sah, und es braucht
  keine eigene Löschung an jedem Wechselweg.
- **13.11.2026, D6: spätere Schlüssel der meldenden Seite vor Ort.** Die meldende Seite einer
  Direktkopplung zeichnet nicht gegen, weil ihre Org dort nicht „verteilend“ ist. Was nach dem
  Grundstock von ihr kommt, wartet deshalb ohne Gegenzeichnung auf einen Admin
  (`NurBestaetigung`), wie die Schlüssel eines ELW am Hub. Mit Pflicht zur Gegenzeichnung würde
  jeder spätere Schlüssel verworfen.
- **13.11.2026, D2: Der Hub reicht einen Wechsel vor Ort nur weiter.** Gefunden im Test „ELW 1
  widerspricht, nachdem der Hub der Unterschrift gefolgt ist“. Der Hub nannte ELW 1 noch ELW 2 als
  Führer, und ELW 1 hielt das als Übernahme „eines Dritten“ offen (Regel von `faq7l7m4`, D3).
  Danach verwarf ELW 1 sie an der Direktkopplung gegen die eigene neue Epoche, und beide Seiten
  schaukelten sich hoch. Die meldende Seite einer Standardkopplung hält deshalb nichts offen, was
  ihre gleichrangige Gegenstelle als Führer oder Vergeber der Epoche nennt
  (`austausch::is_gleichrangig_gekoppelt`). Über diesen Wechsel entscheidet allein die
  Direktkopplung.
- **13.11.2026, Befunde aus dem Review vor dem PR.**
  - *Widerruf aus einer Lieferung:* Er nahm die Credential-ID der Lieferung, nicht die der
    gespeicherten Zeile. Ein Gegenüber konnte so mit einer eigenen Zeile fremde und sogar lokale
    Schlüssel widerrufen. Jetzt wirkt er weiter nur für eine Zeile, die hier gültig war, und nur
    mit deren Credential-ID, und nur auf übernommene Zeilen. Eine Credential-ID, die hier schon für
    einen anderen Schlüssel steht, nimmt keine Lieferung an. Bewusst bleibt: Ein Widerruf über eine
    Zuordnung, über die der Schlüssel nie kam, wirkt nicht; das Gegenüber, das ihn lieferte,
    meldet den Widerruf selbst.
  - *Ende einer Zuordnung:* Die org-weite Prüfung `schon` zählt widerrufene Zeilen einer beendeten
    Zuordnung nicht mehr; sonst nähme ein neues Koppeln die Schlüssel nie wieder an.
  - *Grenze des Grundstocks:* Sie gilt ab der ersten Meldung, auch einer leeren.
  - *Nachlieferung über die Direktkopplung an die meldende Seite:* Auch sie wartet ohne
    Gegenzeichnung auf einen Admin. Die erste Schlüsselzeile eines Hubs trägt keine Gegenzeichnung
    und ginge sonst verloren.
  - *Grenzen gelieferter Felder* (`check_felder`): Was hier gespeichert wird, geht weiter und muss
    in jede Lieferung passen.
  - *Keine Weitergabe von ELW-Schlüsseln:* Am Hub bestätigte Schlüssel eines ELW (Zuordnung einer
    Standardkopplung, an der diese Instanz erreicht wird) gehen nicht weiter.
  - *Kennung einer Anfrage:* Eine Anfrage vor Ort trägt eine zufällige Kennung (`anfrage_kennung`,
    am Führer `anfrage_von_kennung`), nicht ihren Zeitpunkt: Zeitpunkte bleiben im Format von
    ADR-0012. Eine Ablehnung gilt genau dieser Anfrage (`anfrage_abgelehnt_kennung`). So geht eine
    neue Anfrage nicht verloren, die vor der Rücknahme der alten ankommt.
  - *Zwei Gegenstellen fragen an:* Die erste wartet weiter, die zweite steht als Hinweis an ihrer
    Kopplung; ebenso, solange die erste ihre Ablehnung noch nicht gesehen hat. Überschrieben wird
    nichts mehr.
  - *Ende einer Zuordnung:* Ihre Zeilen tragen `zuordnung_beendet`. Nur solche Zeilen halten ein
    späteres Koppeln nicht auf; ein echter Widerruf und eine Zurückweisung durch einen Menschen
    gelten weiter org-weit (zweiter Review-Durchgang).
  - *Offen:* Ein Widerruf über eine Zeile, die hier nur wartete, wirkt nicht weiter. Sonst könnte
    ein Gegenüber einen echten Schlüssel liefern und gleich widerrufen und so Unterschriften
    sperren. Dafür bleibt ein Schlüssel, den der Hub widerrief, an einem ELW gültig, bis dieser
    den Widerruf über die Kopplung erfährt, über die er ihn bekam. Das liegt dem Menschen vor.
  - *Ablehnen nur vor Ort:* Eine wartende Anfrage einer Standardkopplung ist kein Fall für
    „Ablehnen“ (409); der Hub erfüllt sie selbst.
  - *Offenhalten am Hub:* Übersprungen wird nur, wenn der genannte Führer die gleichrangige
    Gegenstelle ist, nicht schon, wenn nur die Epoche von ihr stammt.
  - *Sprung der Benachrichtigung:* „Führung angefragt“ öffnet die Einsatzdaten mit dem Paneel
    „Führung“.
  - *Code-Abgabe mit mehreren Zielen:* Der Knopf nennt das Ziel (gesehen in den Bildern).
