## ADDED Requirements

### Requirement: Das Statusmenü nennt das Fahrzeug

Das Menü, mit dem der FMS-Status eines Fahrzeugs gewechselt wird, SHALL über den Einträgen den
Rufnamen des Fahrzeugs als Kopf zeigen. Der Kopf ist kein wählbarer Eintrag.

#### Scenario: Menü in der Fahrzeugliste
- **WHEN** jemand in der Fahrzeugliste den Status von „85-1“ öffnet
- **THEN** steht „85-1“ als Kopf über den Statuswerten

### Requirement: Das Statusmenü liegt ganz im Fenster

Jedes Statusmenü SHALL vollständig im sichtbaren Fenster liegen: Es öffnet nach oben oder unten,
je nachdem wo Platz ist, und kein Eintrag MUST außerhalb des Fensters beginnen. Reicht die Höhe für
eine Spalte nicht, MUST das Menü im Handschuh-Betrieb zweispaltig stehen, in den übrigen Dichten
innerhalb des Fensters rollen.

#### Scenario: Tablet, Zeile oben
- **WHEN** am Tablet (1024 × 768) das Statusmenü der obersten Zeile geöffnet wird
- **THEN** liegt der erste Eintrag S1 innerhalb des Fensters

#### Scenario: Handschuh-Betrieb
- **WHEN** im Handschuh-Betrieb bei 1366 × 520 das Statusmenü eines Fahrzeugs geöffnet wird
- **THEN** sind alle Statuswerte einschließlich S9 und S0 sichtbar, ohne zu rollen

### Requirement: Hinweis nach dem Statuswechsel

Nach jedem Wechsel des FMS-Status eines Fahrzeugs durch eine Person SHALL ein Hinweis in der Form
„<Rufname>: <alter Code> → <neuer Code>“ mit dem Knopf „Rückgängig“ erscheinen, gleich ob über das
Menü oder über eine Zifferntaste im Tableau gewählt wurde. Der Hinweis MUST den Fokus nicht vom
Ort des Wechsels nehmen.

#### Scenario: Wahl im Menü
- **WHEN** jemand „85-1“ von S2 auf S3 setzt
- **THEN** erscheint „85-1: S2 → S3 · Rückgängig“

#### Scenario: Zifferntaste im Tableau
- **WHEN** im FMS-Tableau auf der Kachel „85-1“ die Taste 3 gedrückt wird
- **THEN** erscheint derselbe Hinweis, und der Fokus bleibt auf der Kachel

### Requirement: Statuswechsel zurücknehmen

„Rückgängig“ SHALL den FMS-Status des Fahrzeugs in einer Transaktion auf den Wert davor setzen,
mit dem „Status seit“ von davor. Ein Zeitachsen-Ereignis, das der Wechsel geschrieben hat, MUST
mit dem Grund „Rücknahme“ gestrichen werden, samt seinen Kopien bei der Besatzung. Die Rücknahme
MUST einen ETB-Eintrag „Fahrzeug «X»: Statuswechsel «A» → «B» zurückgenommen“ schreiben und
dieselben Live-Meldungen senden wie der Wechsel. Eine schon gesendete Benachrichtigung „wieder
verfügbar“ bleibt bestehen.

#### Scenario: Wechsel und Rückgängig
- **WHEN** „85-1“ seit 10:15 auf S2 steht, um 10:40 auf S3 gesetzt und direkt danach „Rückgängig“
  gewählt wird
- **THEN** steht es auf S2 seit 10:15, das Zeitachsen-Ereignis „S3“ ist gestrichen, und das ETB
  nennt die Rücknahme

#### Scenario: Zeitachse lässt sich nicht streichen
- **WHEN** das Streichen des Ereignisses die Ordnung der Zeitachse bräche
- **THEN** antwortet das System mit 409, und Status und Zeitachse bleiben unverändert

### Requirement: Rücknahme nur direkt nach dem Wechsel

Die Rücknahme MUST nur der Person gelingen, die gewechselt hat, und nur, solange das Fahrzeug seit
diesem Wechsel unverändert auf dem neuen Status steht und höchstens zehn Minuten vergangen sind.
Sonst MUST das System mit 409 antworten. Die Rücknahme verlangt dasselbe Schreibrecht wie der
Wechsel.

#### Scenario: Inzwischen erneut gewechselt
- **WHEN** nach dem Wechsel auf S3 eine andere Person S4 setzt und danach die Rücknahme ankommt
- **THEN** antwortet das System mit 409, und das Fahrzeug bleibt auf S4

#### Scenario: Andere Person
- **WHEN** eine andere Person als die wechselnde die Rücknahme sendet
- **THEN** antwortet das System mit 409

#### Scenario: Nach elf Minuten
- **WHEN** die Rücknahme elf Minuten nach dem Wechsel ankommt
- **THEN** antwortet das System mit 409
