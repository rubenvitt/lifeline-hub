# Prüfliste für den Review vor dem PR

Gegen diese Liste prüft der Review, den der Agent vor jedem PR selbst startet
(`dev-zunder-ausfuehren`, Abschnitt „Review vor dem PR“). Sie ist die einzige Stelle, an der die
Fehlerarten stehen; `dev-zunder-orchestrieren` verweist hierher.

**Herkunft:** Vom 08. bis 12.11.2026 lief CodeRabbit in der Testphase auf jedem PR. Die Klassen
sind die Arten von Fehlern, die es dort gefunden hat und der eigene Review nicht
(`git log -i --grep=coderabbit`). Die Beispiele nennen den Commit der Behebung.

**So benutzen:**

- Die Liste ersetzt nicht das Lesen des Diffs. Ein Fehler, der in keine Klasse passt, wird
  genauso gemeldet.
- Je Klasse sagt „Trifft zu, wenn“, ob der Diff sie berühren kann. Trifft sie nicht zu, auslassen.
- Ein Befund nennt den konkreten Fall: welche Eingabe oder welcher Zustand führt zu welchem
  falschen Ergebnis. „Könnte ein Problem sein“ ist kein Befund.
- Ein neuer Eintrag beschreibt eine Fehlerart, nicht einen Einzelfall. Höchstens drei Beispiele
  je Klasse; ein besseres ersetzt ein schwächeres.

## 1. Stiller Verlust

**Trifft zu, wenn** der Diff etwas begrenzt, abschneidet, überspringt, ablehnt, nachliefert oder
wiederholt: Lieferungen zwischen Instanzen, Listen mit Obergrenze, Stände und Zähler, Hinweise,
Retries.

- Rückt ein Stand, ein Zähler oder ein „gesendet bis“ vor, obwohl etwas abgeschnitten, abgelehnt
  oder noch nicht übernommen wurde?
- Was geschieht mit dem Rest einer begrenzten Liste: kommt er später, oder scheitert der Aufruf
  mit Grund? Beides ist recht, still weglassen nicht.
- Wird ein Hinweis oder eine Marke gelöscht, bevor der Fall, den er meldet, wirklich erledigt ist?
- Ist ein Retry idempotent, und unterscheidet er sich von einer neuen Meldung gleichen Inhalts?
- Erreicht eine Meldung (etwa ein Widerruf) die Gegenseite auch, wenn der erste Versuch scheitert?
- Bekommt etwas, das neu zugeordnet oder wieder freigegeben wird, einen frischen Stand, damit es
  erneut hinausgeht?

Beispiele:

- `7a6817e7`: Der Grundstock wurde auf die Obergrenze gekürzt; die übrigen Schlüssel scheiterten
  in der Nachlieferung, der Stand rückte trotzdem vor.
- `573056e8`: Zwei Schlüssel in einer Meldung, der zweite vom noch wartenden ersten
  gegengezeichnet. Der zweite fiel heraus und kam nie wieder.
- `9728feca`: Scheiterte die letzte Meldung beim Widerruf, erfuhr die Gegenseite ihn nie, weil die
  Meldeschleife nur aktive Kopplungen nahm.

## 2. Lade-, Fehler- und Offline-Zustand

**Trifft zu, wenn** der Diff im Frontend etwas von einer Abfrage abhängig macht: eine Anzeige,
eine Warnung, eine Sperre, einen Dialog.

- Was zeigt und was erlaubt die Seite, solange die Abfrage lädt, gescheitert ist oder das Netz
  fehlt? Eine Warnung, die von der Antwort abhängt, darf ohne Antwort nicht einfach entfallen.
- Blendet ein späterer Fehlschlag eines Neuabrufs Daten aus, die schon da waren?
- Verschwindet ein Hinweis oder ein Paneel bei einem Ladefehler, statt den Fehler mit „Erneut
  laden“ zu zeigen?
- Sagt die Seite ohne Netz und ohne Cache, dass sie nichts laden kann, oder behauptet sie „wird
  abgerufen“?
- Lässt sich ein Dialog schließen, während er speichert? Lässt sich ein Dialog versehentlich
  schließen, der etwas zeigt, das der Server nie wieder liefert?
- Ist eine Aktion ohne Netz gesperrt, mit Grund?

Beispiele:

- `f8f0f9e6`: Lud die Abfrage nach dem letzten Schlüsselhalter noch oder scheiterte sie,
  deaktivierte die Benutzerverwaltung ohne die Warnung, die die Spec verlangt.
- `39a0053e`: Ein Fehlschlag des 30-s-Abrufs blendete vorhandene Daten aus; der Dialog mit dem
  einmaligen Code schloss per Escape.
- `d77a742f`: Die Registrierliste zeigte ohne Netz und ohne Cache „wird abgerufen“.

## 3. Grenzen für Eingaben von außen

**Trifft zu, wenn** der Diff etwas entgegennimmt, das eine gekoppelte Instanz, ein Gerät, ein
Fremdsystem oder ein Client schickt, oder Zeit und Größen aus solchen Werten rechnet.

- Hat jede Liste und jedes Feld eine Obergrenze? Wird vor dem Entdoppeln gezählt und danach
  entdoppelt?
- Passen die Grenzen zueinander: größte Anzahl mal größtes Element gegen die Lesegrenze der
  Antwort?
- Wird ein Feld begrenzt, bevor teure Arbeit (Signaturprüfung, Speichern, Weiterliefern) beginnt?
- Rechnet Zeit und Größe mit geprüfter oder gesättigter Arithmetik? Ein Wert wie `i64::MIN` darf
  keine Prüfung umgehen.
- Steht die Grenze auch im Frontend und im Spiegeltest der Eingabegrenzen?

Beispiele:

- `d5b56723`: Mit `iat = i64::MIN` lief `exp - iat` über und umging die 60-s-Grenze; Listen der
  Gegenstelle hatten keine Obergrenze.
- `727c5254`: 256 Lieferungen je Org passten nicht in 256 KiB Antwort; Melden wäre dauerhaft
  gescheitert.
- `d40bcb76`: Die Felder einer geprüften Assertion waren unbegrenzt und gehen gespeichert mit jeder
  Nachlieferung hinaus.

## 4. Berechtigung und Geltungsbereich

**Trifft zu, wenn** der Diff im Backend eine ID, einen Kopf oder eine Kennung von außen annimmt,
etwas zurückgibt oder zwischen Org, Stelle, Einheit, Gerät oder Kopplung unterscheidet.

- Trifft jede ID von außen nur ein Objekt der eigenen Org, Stelle, Einheit oder Kopplung?
- Sieht ein Gerätekonto nur, was an seiner Stelle oder Einheit war? Gilt das auch für abgeleitete
  Angaben (Name der Bezugsperson, Haushalt)?
- Gibt ein Replay derselben Kennung mehr zurück, als der Aufrufer jetzt sehen darf?
- Kann eine Seite einer Kopplung der anderen etwas nehmen oder für sie entscheiden?
- Verlangt eine Bestätigung ein Gegenüber im richtigen Zustand (gekoppelt, nicht widerrufen)?
- Wird einem weitergeleiteten Kopf (`X-Forwarded-*`) nur von einem vertrauten Proxy geglaubt?

Beispiele:

- `773b6b44`: Der Hub nahm die Epoche eines ELW an, auch wenn die Führung bei einem anderen ELW
  lag; ein ELW konnte so einem anderen die Führung nehmen.
- `d77a742f`: Das Gerät einer Stelle sah den Namen der Bezugsperson, auch wenn sie nie an seiner
  Stelle war (CWE-200).
- `aa02a45b`: Ein Replay derselben `client_id` gab die Person samt Personalien zurück, auch wenn
  sie inzwischen eine andere Einheit trug.

## 5. Veralteter Zustand im Frontend

**Trifft zu, wenn** der Diff im Frontend Mutationen, Rückgängig, Kontextmenüs, Dialoge, Fokus oder
Zeigerereignisse anfasst, oder eine Ansicht, die sich live abgleicht.

- Entsteht der Body einer Mutation beim Klick oder schon beim Rendern? Entstehen Aktion und
  Rückgängig aus demselben festgehaltenen Stand?
- Ist eine Prop oder ein Rückruf beim Einhängen eingefroren, während die Anzeige der aktuellen
  Prop folgt?
- Teilen sich zwei Stellen (Menü und Dialog) eine Mutation, sodass die eine Lauf und Fehler der
  anderen zeigt?
- Hält eine ausgehängte oder verschobene Komponente noch eine offene Rückfrage, eine Aktion oder
  den Fokus?
- Endet ein Druck oder eine Geste auch, wenn der Zeiger außerhalb des Elements oder über einem
  Portal loslässt?

Beispiele:

- `4d528bdb`: Der Reset-Body entstand beim Rendern, der Rückgängig-Body aus dem Cache; nach einem
  Live-Refetch dazwischen schickte Rückgängig Felder, die der Reset nie angefasst hatte.
- `fd31d60b`: Wanderte eine Karte beim Live-Abgleich in eine andere Gruppe, löste OK in der
  offenen Rückfrage eine überholte Aktion aus.
- `1388a015`: Ein stilles Kopieren aus dem Kontextmenü zeigte Lauf und Fehler im Dialog eines
  anderen Blocks.

## 6. Tests, die nichts prüfen

**Trifft zu, wenn** der Diff Tests oder Wächter hinzufügt oder ändert.

- Wird der Test ohne die Änderung rot? Wenn das nicht aus dem Diff hervorgeht: Gegenprobe
  verlangen.
- Wartet `waitFor` auf etwas, das wirft, solange die Bedingung fehlt? Ein Helfer, der `null`
  zurückgibt, löst sofort auf.
- Prüft der Test den echten Grenzwert (knapp darunter gilt, knapp darüber nicht) oder nur eine
  Beispielgröße?
- Baut der Test den Fall so, wie er wirklich entsteht (etwa ein Feld vor dem Signieren setzen,
  nicht danach)?
- Erkennt ein Wächter oder Parser die Fälle, die ihn täuschen (Escapes, Zeichenliterale,
  Kommentare)?

Beispiele:

- `f6a4ad11`: `offenesKontextmenue` gab `null` zurück statt zu werfen; `waitFor` wartete nie.
- `c5a2742a`: Der Test ersetzte `clientDataJSON` erst nach dem Signieren und prüfte damit nicht
  die Größengrenze einer gültigen Unterschrift.
- `92596c79`: Der Wächter zählte die Klammer nach `'\\'` mit; ein Testmodul konnte folgenden
  produktiven Code verschlucken.

## 7. Verhalten gegen Spec

**Trifft zu, wenn** es zu dem geänderten Verhalten eine Spec unter `openspec/specs/`, eine
Delta-Spec der Change oder ein Anwenderkapitel gibt.

- Tut der Code, was dort steht, auch im leeren Fall, im Fehlerfall und am Rand (keiner, genau
  einer, mehr als einer)?
- Antwortet das Backend mit dem Statuscode der Konvention (`src/AGENTS.md`, Statuscode-Konvention)?
- Sperrt oder verändert ein Aufruf etwas, der laut Spec ohne Wirkung bleiben soll?

Beispiele:

- `6b3942e0`: Ohne Entlassen, UHS oder RTW legte der Server einen offenen Kontakt an; die Spec
  verlangt genau einen Ausgang, sonst 422.
- `a146a42f`: Eine Übernahme ohne jede Änderung in einen laufenden Einsatz sperrte die Planung,
  statt mit 422 nichts zu tun.

## 8. Atomarität

**Trifft zu, wenn** der Diff im Backend eine Entscheidung schreibt und dazu liest, mehrere Felder
zusammen setzt oder Zähler führt.

- Liegt jedes Lesen und Schreiben, das zu einer Entscheidung gehört, in derselben Transaktion,
  auch der Spureintrag?
- Werden Felder, die nur zusammen einen Sinn haben, zusammen gesetzt und zusammen gelöscht?
- Unterscheidet ein Zähler zwei Ereignisse, die auf zwei Seiten gleich oft vorkamen? Teilen sich
  zwei Pfade einen Zähler, den jeder für sich bräuchte?

Beispiele:

- `0eb982c7`: Die Route las die Gegenstelle erst nach dem Commit über den Pool; scheiterte das
  Lesen, galt die Entscheidung ohne Spureintrag.
- `a59413e4`: Schwärzten zwei Seiten während einer Trennung je einmal, standen zwei Zähler gleich
  und der Spiegel räumte nicht.
- `8f0ff439`: Ein gemeinsamer Reihum-Zähler für Auswahl und Lieferung rückte je Pfad in
  Zweierschritten vor.

## 9. Live-Verteilung

**Trifft zu, wenn** der Diff etwas ändert, das andere geöffnete Oberflächen zeigen: eine Zahl,
einen Kopf, eine Freigabe.

- Bekommt jeder, der den Wert sieht, das Ereignis, auch wer das Hauptrecht dafür nicht hat?
- Wird nach dem Commit gemeldet, nicht davor?
- Nennt eine Operation, die mehrere Einsätze berührt, alle, damit ihre Köpfe sich neu laden?

Beispiele:

- `b2abdbec`: Verbleibwechsel und Storno verteilten nur `person`; wer Verpflegung ohne
  Personenrecht führt, sah die Kostform-Zählung erst nach `staleTime` neu.
- `da7c3553`: Ein Widerruf änderte die Führung von Einsätzen, ohne dass deren geöffnete
  Oberflächen die Freigabe erfuhren.

## 10. Doku, ADR und Spec untereinander

**Trifft zu, wenn** der Diff ADRs, Konzepte, Specs, Anwenderkapitel, `AGENTS.md`-Dateien oder
Skills ändert, oder Code, den ein Kapitel beschreibt.

- Widersprechen sich ADR, Konzept, Spec und Anwenderkapitel in derselben Regel (Fristen,
  Reihenfolgen, Ausnahmen)?
- Zeigt jeder Verweis auf eine Regel, die es dort gibt?
- Gilt eine Regel für alle Fälle, die der Text nennt, oder passt sie zu einem davon nicht?
- Nennen die `quellen` eines Anwenderkapitels die geänderten Dateien
  (`docs/anwender/AGENTS.md`, Mitänderungsregel)?
- Hat ein neuer Baustein seine Karte im Design System (`frontend/AGENTS.md`)?
- Beschreibt ein Text das Verhalten genau so, wie der Code es tut, auch die Ausnahme?

Beispiele:

- `0e4c7ba8`: ADR-0023 schloss jeden zweiten Vorschlag aus, das Konzept legt nach zwei Minuten
  einen neuen mit Hinweis an.
- `72bb0dcc`: ADR-0023 verwies für die Idempotenz auf ADR-0022, das dazu keine Regel hat.
- `ae50df0b`: Das Kapitel nannte „alle Knöpfe“, gemeint waren nur die der Aktionszeile; die
  `quellen` nannten die neuen Stellen nicht.
