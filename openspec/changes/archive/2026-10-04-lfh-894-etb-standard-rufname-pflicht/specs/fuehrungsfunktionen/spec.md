# Spec Delta

## MODIFIED Requirements

### Requirement: Vorrangregel der ETB-Vorbelegung
Die Abfrage des Standard-Rufnamens im ETB (Fähigkeit `etb-absender-empfaenger`) SHALL ihren
ersten Vorschlag so bilden:
1. aus der gesetzten Führungsstelle (Katalogwert als Kürzel, bei Führungshilfspersonal und
   Fachberater als „<Label>: <Bezeichnung>“, sonst der Freitext);
2. sonst aus dem Kürzel des ersten Sachgebiets in S1–S6-Folge, das die mit dem Benutzer über
   `personal.benutzer_id` verknüpfte Person besetzt;
3. sonst gar nicht.

Der Vorschlag MUST übernommen werden können, ohne ihn zu tippen, und MUST NOT ohne Zutun der
Person zum Standard werden. Eine neue ETB-Erfassung MUST NOT „An“ nach dieser Regel vorbelegen;
vorbelegt wird nur aus dem Standard-Rufnamen.

#### Scenario: Führungsstelle gewinnt
- **WHEN** ein Mitglied ohne Standard-Rufnamen die Führungsstelle Fachberater mit der
  Bezeichnung „THW“ hat und zugleich S2 besetzt
- **THEN** schlägt die Abfrage zuerst „Fachberater: THW“ vor

#### Scenario: Ableitung aus der Besetzung
- **WHEN** ein Mitglied ohne Standard-Rufnamen keine Führungsstelle hat und über sein Konto S2
  und S3 besetzt
- **THEN** schlägt die Abfrage zuerst „S2“ vor

#### Scenario: Weder noch
- **WHEN** ein Mitglied ohne Standard-Rufnamen keine Führungsstelle hat und kein Sachgebiet
  besetzt
- **THEN** steht in der Abfrage kein vorgewählter Vorschlag

#### Scenario: Kein stilles Vorbelegen
- **WHEN** ein Mitglied ohne Standard-Rufnamen mit der Führungsstelle „S3“ das ETB öffnet und
  die Abfrage nicht beantwortet
- **THEN** trägt die Erfassung weder Von noch An
