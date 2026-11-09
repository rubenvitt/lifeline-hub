# Spec Delta

## Purpose

Ein Einsatz bleibt an einer gekoppelten Instanz, die ihn nicht führt, als Lesekopie (Spiegel)
lesbar und aktuell. Nachgeholt wird über eine Position im Log, über eine schmale Leitung und ohne
dass die erreichte Seite je selbst eine Verbindung aufbaut.

## ADDED Requirements

### Requirement: Jede Änderung eines Einsatzes erhöht seinen Stand

Jede Instanz SHALL für jede Zeile eines Einsatzes festhalten, dass sie sich geändert hat. Das gilt
für Anlegen, Ändern, Schwärzen, weiches und hartes Löschen und für jeden Schreibweg, auch einen
künftigen. Der Stand MUST nur steigen. Je Zeile MUST das Log höchstens einen Eintrag halten, den
jüngsten. Jede Tabelle, die zu einem Einsatz gehört, MUST entweder dem Log angehören oder
ausdrücklich mit Grund ausgenommen sein.

#### Scenario: Hartes Löschen
- **WHEN** eine Zeile eines Einsatzes hart gelöscht wird
- **THEN** steigt der Stand des Einsatzes, und die nächste Lieferung meldet die Zeile als gelöscht

#### Scenario: Neue Tabelle ohne Einordnung
- **WHEN** eine Migration eine Tabelle mit `einsatz_id` anlegt, die weder dem Log angehört noch ausgenommen ist
- **THEN** schlägt der Wächter-Test fehl

### Requirement: Wer einen Einsatz anlegt, führt ihn, die anderen spiegeln

Ein Einsatz SHALL von der Instanz geführt werden, an der er angelegt wurde. Ist seine Org einer
aktiven Kopplung zugeordnet, MUST das Gegenüber ihn als Spiegel erhalten. Das gilt in beide
Richtungen, unabhängig davon, welche Seite sich meldet. Ein Spiegel MUST mit der Org des
Gegenübers verbunden sein, die über die Kopplung zugeordnet ist. Ein Einsatz SHALL eine Kennung
tragen, die über Instanzen hinweg gleich bleibt.

#### Scenario: ELW führt, Hub spiegelt
- **WHEN** am gekoppelten ELW ein Einsatz der zugeordneten Org angelegt wird
- **THEN** erscheint er nach dem nächsten Abgleich am Hub in der Einsatzliste der zugeordneten Org, gekennzeichnet als „Spiegel von <ELW>“

#### Scenario: Hub führt, ELW spiegelt
- **WHEN** am Hub ein Einsatz der zugeordneten Org angelegt wird
- **THEN** erscheint er nach dem nächsten Abgleich am ELW als „Spiegel von <Hub>“

#### Scenario: Org nicht zugeordnet
- **WHEN** ein Einsatz einer Org angelegt wird, die keiner Kopplung zugeordnet ist
- **THEN** verlässt er die Instanz nicht

### Requirement: Nachholen über den Stand

Die spiegelnde Seite SHALL je Einsatz ihren Stand nennen, und die führende Seite MUST alle
Zeilen liefern, deren Stand darüber liegt, jede mit ihrem aktuellen Inhalt, eine gelöschte als
gelöscht. Eine Lieferung SHALL in Teilen kommen dürfen. Die spiegelnde Seite MUST ihren Stand nur
bis zum höchsten vollständig übernommenen Stand vorrücken: nichts fehlt, nichts doppelt.

#### Scenario: Lange Funkstille
- **WHEN** der ELW zwei Stunden ohne Netz 300 ETB-Einträge schreibt und dann wieder Verbindung hat
- **THEN** hat der Hub nach den folgenden Abgleichen alle 300 Einträge in der Reihenfolge ihrer laufenden Nummer, keinen doppelt

#### Scenario: Abbruch mitten in einer Lieferung
- **WHEN** die Verbindung abbricht, nachdem der erste Teil einer Lieferung übernommen wurde
- **THEN** setzt der nächste Abgleich nach diesem Teil fort

### Requirement: Verweise und Rücksetzen beim Nachholen

Verweist eine gelieferte Zeile auf eine Zeile mit höherem Stand, MUST diese vorher mitkommen.
Nennt die spiegelnde Seite einen niedrigeren Stand als zuletzt bestätigt, etwa nach einer
Wiederherstellung, MUST ab diesem Stand neu geliefert werden.

#### Scenario: Verweis auf eine später geänderte Zeile
- **WHEN** ein ETB-Eintrag auf eine Meldung zeigt, die danach geändert wurde
- **THEN** kommt beim Nachholen von vorn die Meldung vor dem Eintrag

#### Scenario: Hub aus der Sicherung zurückgeholt
- **WHEN** der Hub aus einer Sicherung von gestern zurückgeholt wird und sich der ELW danach meldet
- **THEN** liefert der ELW ab dem Stand von gestern neu, und der Spiegel ist danach vollständig

### Requirement: Die Verbindung baut nur die meldende Seite auf

Der Abgleich SHALL über eine eigene signierte Route laufen, die nur die meldende Seite aufruft.
Führt die meldende Seite einen Einsatz, MUST sie seine Lieferung in der Anfrage schicken, und die
erreichte Seite MUST ihren übernommenen Stand in der Antwort nennen. Führt die erreichte Seite,
MUST sie die Lieferung in der Antwort schicken. Die erreichte Seite MUST NOT selbst eine
Verbindung aufbauen.

#### Scenario: Hub hinter NAT nicht nötig
- **WHEN** der ELW hinter NAT sitzt und einen Einsatz führt
- **THEN** erhält der Hub den Spiegel, ohne den ELW je zu erreichen

### Requirement: Feste Größe, Anträge vorn

Anfrage und Antwort des Abgleichs MUST eine feste Größengrenze haben. Anträge, Quittungen und
Stände MUST in jeder Nachricht vor allen gelieferten Zeilen stehen.

#### Scenario: Viel nachzuholen und ein Antrag
- **WHEN** am Hub ein Antrag wartet und der ELW gleichzeitig tausende Zeilen nachzuholen hat
- **THEN** wird der Antrag mit dem ersten Abgleich zugestellt

### Requirement: Takt des Abgleichs

Solange an einer Kopplung ein gespiegelter oder gelieferter Einsatz aktiv ist, Anträge offen sind
oder Anhänge abgerufen werden, SHALL die meldende Seite alle 5 s abgleichen, einstellbar. Sonst
MUST sie im Takt der Meldung abgleichen. Scheitert der Abgleich, MUST der Abstand wachsen wie bei
der Meldung.

#### Scenario: Ruhige Kopplung
- **WHEN** an einer Kopplung kein Einsatz aktiv ist und nichts offen ist
- **THEN** gleicht die meldende Seite nur im Takt der Meldung ab

### Requirement: Ein Spiegel ist nur über die Übernahme schreibbar

An einem Spiegel MUST jeder direkte Schreibversuch auf eine Zeile des Einsatzes scheitern,
gleich über welchen Weg, und der Server MUST mit 409 „Dieser Einsatz ist ein Spiegel“ antworten.
Nur das Übernehmen einer Lieferung SHALL ihn ändern. Die Oberfläche MUST am Spiegel
Schreibbedienungen sperren wie bei einem Beobachter. Ausgenommen sind die beantragbaren
Erfassungen (Spec `spiegel-antraege`).

#### Scenario: Bearbeiten am Spiegel
- **WHEN** jemand am Hub den Status einer Einheit im Spiegel eines ELW-Einsatzes ändern will
- **THEN** ist die Bedienung gesperrt mit „Spiegel von <ELW>“, und ein direkter Aufruf der Route endet mit 409

### Requirement: Rechte am Spiegel wie am Führer

Mitgliedschaften und Rollen eines Einsatzes SHALL mitgespiegelt werden. Ein Konto, das über die
Stammdaten-Verteilung an beiden Seiten dasselbe ist, MUST am Spiegel dieselbe Einsatzrolle haben
wie am Führer. Ein Konto, das es nur an einer Seite gibt, MUST am Spiegel ohne diese
Mitgliedschaft bleiben. Ein Verweis auf Stammdaten, die es an der spiegelnden Seite nicht gibt,
MUST leer bleiben. Der Schnappschuss des Namens MUST erhalten bleiben.

#### Scenario: Spontanhelfer nur am ELW
- **WHEN** ein am ELW angelegter Spontanhelfer einer Einheit zugeordnet ist
- **THEN** zeigt der Spiegel am Hub ihn mit seinem Namen aus dem Schnappschuss, ohne Verweis auf ein Hub-Konto

### Requirement: Kategorie je Zeile

Jede gelieferte Zeile SHALL ihre Kategorie tragen: `fuehrung`, `etb`, `lage`, `kraefte`,
`personen`, `betreuung`, `kommunikation` oder `anhaenge`. Personenbezogene Gesundheitsdaten
(Art. 9) MUST zu `personen` gehören.

#### Scenario: Sichtung
- **WHEN** eine Sichtung geliefert wird
- **THEN** trägt die Zeile die Kategorie `personen`

### Requirement: Freigabestufe je Einsatz

Jeder Einsatz SHALL eine Freigabestufe tragen, die mitgeliefert wird. Es gibt nur die Stufe
`alles`, und sie liefert jede Kategorie. Eine spiegelnde Seite, die eine unbekannte Stufe
erhält, MUST den Einsatz nicht weiter übernehmen und an der Kopplung „Freigabestufe unbekannt,
Update nötig“ zeigen.

#### Scenario: Stufe alles
- **WHEN** ein Einsatz mit der Stufe `alles` gespiegelt wird
- **THEN** enthält der Spiegel alle Kategorien, und jede Zeile der Lieferung nennt ihre Kategorie

#### Scenario: Unbekannte Stufe
- **WHEN** eine neuere Gegenseite eine Stufe liefert, die der Spiegel nicht kennt
- **THEN** bleibt der Spiegel auf dem letzten Stand, und die Kopplung zeigt „Freigabestufe unbekannt, Update nötig“

### Requirement: Anhänge auf Abruf

Ein Anhang SHALL zuerst nur mit Metadaten gespiegelt werden: Name, Typ, Größe, Prüfsumme. Öffnet
jemand am Spiegel einen Anhang ohne Inhalt, MUST der Spiegel den Inhalt anfordern und „wird
geholt“ zeigen. Der Inhalt MUST in Stücken mit fester Größe kommen, angeforderte Anhänge vor dem
Vorabladen. Im Leerlauf SHALL der Spiegel fehlende Inhalte vorab laden. Ein Inhalt MUST erst nach
geprüfter Prüfsumme gelten.

#### Scenario: Großes Foto über Satellit
- **WHEN** am ELW ein Foto mit 20 MiB an einen Schaden gehängt wird
- **THEN** sieht der Hub den Anhang sofort mit Name und Größe, und der ETB-Abgleich wartet nicht auf das Foto

#### Scenario: Öffnen am Hub
- **WHEN** jemand am Hub einen noch nicht geladenen Anhang öffnet
- **THEN** zeigt die Seite „wird geholt“, und nach Ankunft und Prüfung den Inhalt

### Requirement: Der Spiegel zeigt seine Herkunft und seinen Stand

An einem Spiegel SHALL jede Einsatzseite ein Hinweisband zeigen: „Spiegel von <Gegenstelle>“,
die Zeit des letzten erfolgreichen Abgleichs und die Zahl der ausstehenden und abgelehnten
Anträge. Liegt der letzte Abgleich länger zurück als das Dreifache des Takts, MUST das Band
„keine Verbindung seit …“ zeigen. Nach einer Übernahme MUST der Spiegel offene Seiten über die
Live-Aktualisierung neu laden lassen.

#### Scenario: Leitung weg
- **WHEN** der Hub einen ELW-Einsatz spiegelt und der ELW seit 10 min keine Verbindung hat
- **THEN** zeigt das Band am Hub „keine Verbindung seit 10 min“

### Requirement: Die Seite Instanzkopplung zeigt den Abgleich

Die Seite „Instanzkopplung“ SHALL je Kopplung die gelieferten und die gespiegelten Einsätze
zeigen, je mit Stand, letztem Abgleich und Hinweisen. Spricht das Gegenüber eine
Protokollversion ohne Spiegel, MUST dort „Gegenüber spiegelt noch nicht (Update nötig)“ stehen,
und es MUST nicht gespiegelt werden.

#### Scenario: Gegenüber zu alt
- **WHEN** der Hub Protokoll 2 spricht und der ELW Protokoll 1
- **THEN** bleibt die Kopplung bestehen, kein Einsatz wird gespiegelt, und beide Seiten zeigen den Hinweis

### Requirement: Widerruf beendet den Abgleich, nicht den Spiegel

Wird die Org-Zuordnung einer Kopplung widerrufen, MUST der Abgleich ihrer Einsätze enden. Die
vorhandenen Spiegel SHALL lesbar bleiben, mit „Spiegel von <Gegenstelle>, Abgleich beendet“, und
weiter schreibgeschützt. Ausstehende Anträge an diesen Spiegeln MUST als abgelehnt mit dem Grund
„Kopplung widerrufen“ erscheinen.

#### Scenario: Widerruf am Hub
- **WHEN** der Admin am Hub die Org-Zuordnung zu einem ELW widerruft
- **THEN** bleibt der Spiegel am Hub lesbar und zeigt „Abgleich beendet“, und der ELW liefert nichts mehr
