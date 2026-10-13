# Spec Delta

## MODIFIED Requirements

### Requirement: Karte eines Befehls

Die Karte eines Einsatzbefehls SHALL links den Zeitstand in Mono und die Fassung `v<n>` zeigen,
daneben den Status (Entwurf bzw. Freigegeben), das Befehlsschema, den Titel und den Ersteller,
bei freigegebenen Befehlen dazu, wer wann freigegeben hat. Trägt der Befehl einen Verteiler, MUST
die Karte dessen Anzeigenamen nennen, und ein freigegebener Befehl MUST dazu den Quittungsstand
„n Empfänger · q/n quittiert“ zeigen. Sie MUST denselben Kartenrahmen, dieselbe Zeitspalte und
dieselbe Zählzeile des Quittungsstands wie die Auftragskarte nutzen.

#### Scenario: Fortgeschriebener Befehl
- **WHEN** ein Befehl in Fassung 2 vorliegt und Fassung 1 freigegeben bleibt
- **THEN** stehen zwei Karten mit gleichem Titel, unterscheidbar an `v1` und `v2`

#### Scenario: Freigegebener Befehl mit Verteiler
- **WHEN** ein freigegebener Befehl den Verteiler „EA Süd, S3 Einsatz“ trägt und „EA Süd“ quittiert hat
- **THEN** nennt seine Karte „EA Süd“ und „S3 Einsatz“ und zeigt „2 Empfänger · 1/2 quittiert“

#### Scenario: Entwurf mit Verteiler
- **WHEN** ein Befehlsentwurf den Verteiler „EA Süd“ trägt
- **THEN** nennt seine Karte „EA Süd“ ohne Quittungsstand

### Requirement: Einsatzbefehl im Detail

Das Detail eines Befehls SHALL die Abschnitte des Befehlsschemas als Lesefassung zeigen, dazu
Fassung, Zeitstand, Ersteller, Freigabe, den Verteiler und den Sprung zur Vollseite. Den Verteiler
eines freigegebenen Befehls MUST es wie den Empfängerblock eines Auftrags zeigen: Quittungsstand,
quittierte Empfänger mit ✓ und die offenen Empfänger mit der Handlung „Quittieren“ (Spec
`befehl-quittung`). Mit Schreibrecht MUST ein Entwurf „Entwurf bearbeiten“ (öffnet die Vollseite)
und „Freigeben“ tragen, ein freigegebener Befehl „Fortschreiben“. Freigeben MUST die Rückfrage mit
der Folge „Endgültig: geht ins ETB“ zeigen.

#### Scenario: Entwurf freigeben im Detail
- **WHEN** im Detail eines Entwurfs „Freigeben“ gewählt und die Rückfrage bestätigt wird
- **THEN** steht der Befehl als freigegeben, und das Detail trägt „Fortschreiben“

#### Scenario: Fortschreiben
- **WHEN** im Detail eines freigegebenen Befehls „Fortschreiben“ gewählt wird
- **THEN** öffnet die Vollseite des neuen Entwurfs in der nächsten Fassung

#### Scenario: Leerer Abschnitt
- **WHEN** ein Abschnitt des Befehls keinen Text hat
- **THEN** steht unter seiner Überschrift „—“

#### Scenario: Quittungsstand im Detail
- **WHEN** ein freigegebener Befehl mit dem Verteiler „EA Süd, S3 Einsatz“ gewählt wird und „EA Süd“ quittiert hat
- **THEN** zeigt das Detail „1/2 quittiert“, „EA Süd ✓“ und „S3 Einsatz“ unter „Quittung offen“

## ADDED Requirements

### Requirement: Beide Reiter gleich gebaut, mit Empfängerfilter

Die Reiter „Einzelaufträge“ und „Einsatzbefehle“ SHALL dasselbe Muster „Liste + Detailpaneel“
nutzen, mit gleich gebautem Bereichskopf (Titel, Mengen in der Form „n offen · m abgeschlossen“
bzw. „n Entwürfe · m freigegeben“, Datenstand, Erfassen-Aktion) und gleicher Filterleiste
(Status-Segmente mit Zahl, Suchfeld, Empfängerfilter). Der Empfängerfilter MUST in beiden Reitern
dieselbe Komponente mit denselben Optionen sein (Einsatzabschnitte und Einheiten des Einsatzes).
Nur die Aufträge MUST zusätzlich die Richtung filtern.

#### Scenario: Gleiche Leiste
- **WHEN** beide Reiter nacheinander geöffnet werden
- **THEN** steht in beiden zuerst eine Segmentleiste mit zwei Status-Segmenten samt Zahl, daneben ein Suchfeld und ein Empfängerfilter

#### Scenario: Richtungsfilter nur bei Aufträgen
- **WHEN** der Reiter „Einsatzbefehle“ geöffnet ist
- **THEN** gibt es keinen Richtungsfilter


### Requirement: Empfängerfilter der Befehle

Der Empfängerfilter im Reiter „Einsatzbefehle“ SHALL nur Befehle zeigen, deren Verteiler den
gewählten Einsatzabschnitt bzw. die gewählte Einheit nennt, wie bei den Aufträgen ohne
Unterabschnitte. Er MUST mit Suche und Status-Segmenten zusammenwirken: Die Zahlen der Segmente
zählen das Gefundene, die Mengen im Bereichskopf den Bestand.

#### Scenario: Filter auf einen Abschnitt
- **WHEN** Befehl A den Verteiler „EA Süd“ trägt, Befehl B „EA Nord“ und der Filter „EA Süd“ gewählt wird
- **THEN** steht nur Befehl A in der Liste, und der Bereichskopf zählt weiter beide

#### Scenario: Befehl ohne Verteiler
- **WHEN** ein Empfängerfilter gewählt ist
- **THEN** steht kein Befehl ohne Verteiler in der Liste

## REMOVED Requirements

### Requirement: Beide Reiter gleich gebaut
**Reason**: Der Empfängerfilter gilt jetzt in beiden Reitern (LLH-1173); die Anforderung steht
neu als „Beide Reiter gleich gebaut, mit Empfängerfilter“.
**Migration**: Siehe die neue Anforderung; der Richtungsfilter bleibt nur bei den Aufträgen.
