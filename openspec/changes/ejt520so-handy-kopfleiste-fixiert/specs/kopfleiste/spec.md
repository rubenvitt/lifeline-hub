## MODIFIED Requirements

### Requirement: Der Alarmton hält den Platz seines Störungsworts

Ab `md` SHALL der Alarmton in der Kopfleiste auch im Ruhezustand die Breite des Worts „Ton
blockiert“ freihalten. Der Browser sperrt den Ton vor der ersten Bediengeste ohne Zutun, und das
Wort erscheint dann nach der Prüffrist. Unter `md` SHALL er keinen Platz freihalten: die
Kopfleiste trägt dort eine Zeile (Spec `einsatztauglichkeit-layout`), und nur in `handschuh` darf
sie umbrechen, wenn das Wort erscheint.

#### Scenario: Ton beim Start gesperrt
- **WHEN** ein Einsatz in `handschuh` zwischen 1100 und 1440 px mit Maus geladen wird und der Browser den Ton bis zur ersten Bediengeste sperrt
- **THEN** erscheint nach der Frist „Ton blockiert“, und die Kopfleiste behält dabei ihre Zeilenzahl

#### Scenario: Ruhezustand am Handy
- **WHEN** ein Einsatz bei 390 × 844 mit bereitem Ton offen ist
- **THEN** steht die Glocke ohne Wort und ohne freigehaltenen Platz, und die Kopfleiste ist einzeilig
