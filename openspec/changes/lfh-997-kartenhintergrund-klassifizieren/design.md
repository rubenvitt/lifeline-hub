# Design: Bild-Hintergründe der Lagekarte schwärzen (LFH-997)

## Context

Die Lagekarte nimmt PNG- oder JPEG-Bilder bis 25 MB als georeferenzierten Hintergrund an
(LFH-35, Tabelle `karte_hintergrundbild`, BLOB in `daten`). Die Schwärzungs-Registry
(`src/einsatz/schwaerzung_registry.rs`) führt `daten` als Retain („Kartografie-Skelett, kein
Personenbezug“) und scrubbt nur `name` (Zuordnung Einsatz-Frist). LFH-749 hat das als
Nicht-Ziel an dieses Ticket abgegeben.

Was die Oberfläche nicht unterscheidet: Der Upload fragt nicht, was das Bild zeigt. Ein
Orthofoto einer Drohne, ein Luftbild aus einem Geoportal, ein Feuerwehrplan und eine
Handskizze laufen denselben Weg.

Datei-Anhänge (`anhang`) lösen dasselbe Problem schon: Scrub mit
`Strategie::ZeileEinzelnLoeschen` und Zuordnung `anhaenge`. Der atomare Vorgang macht sie nur
unerreichbar, `anhang::repo::entferne_vorgesehene` löscht sie danach einzeln (LFH-905), weil
`secure_delete = ON` beim Commit jedes freigewordene Byte nullt und so lange die Schreibsperre
hält. „Vorgesehen“ ist eine reine Zustandsbedingung: Einsatz abgeschlossen und geschwärzt, oder
seine Kategorie `anhaenge` geschwärzt.

## Goals / Non-Goals

**Goals:**

- Die Klassifikation von `karte_hintergrundbild.daten` ist begründet und per Test festgelegt.
- Ein Bild mit Personenbezug überdauert die Schwärzung nicht, und eine Organisation kann es
  über eine eigene Frist früher entfernen lassen (Drohnenbild-Frist nach NKatSG).
- Die physische Entfernung und die Begrenzung der Schreibsperre gelten auch für diese Bilder.

**Non-Goals:**

- Eine Kennzeichnung der Bildquelle beim Upload (Option c, siehe D1).
- Eine vierte Datenkategorie „Bildaufnahmen“ (siehe D2).
- Frist-Vorgaben im Code: die Dauer bleibt Sache der Organisation (Spec
  `aufbewahrung-kategorien`, keine Vorgabewerte).
- Lage-Stände (`lage_snapshot`), die auf gelöschte Bilder verweisen, zu bereinigen: Sie werden
  mit dem Einsatz ohnehin ganz gelöscht, und ein Verweis ins Leere entsteht heute schon, wenn
  jemand ein Bild im laufenden Einsatz entfernt.

## Decisions

### D1 Alle Bilder schwärzen, ohne Unterscheidung der Quelle (Option a)

Ein Kartenhintergrund kann Personenbezug tragen. Bei einem Luft- oder Drohnenbild ist das die
Regel: Personen, Kennzeichen, Hausansichten, im Zusammenhang mit der Einsatzadresse auch
Betroffene. Bei einem Plan ist es möglich: Ein eingescannter Objektplan nennt Bewohner, eine
Skizze ist mit „Familie Müller“ beschriftet. Aus demselben Grund scrubbt die Registry den
Dateinamen schon seit LFH-229.

- **(b) Retain** hielte die Bilder bis zur endgültigen Löschung des Skeletts, also Jahre. Das
  widerspricht § 32b Abs. 3 NKatSG für Drohnenbilder und dem Grundsatz der Datenminimierung. Das
  Skelett dient der Führungsdokumentation und der Statistik; beides steht im ETB und in den
  Zählern, nicht im Hintergrundbild. Ein Plan, den man später braucht, liegt bei seiner Quelle
  (Feuerwehrplan, Bauamt, Geoportal).
- **(c) Kennzeichnung beim Upload** verschiebt die Entscheidung auf die Person, die im Einsatz
  ein Bild hochlädt. Eine falsche oder bequeme Auswahl („Plan“) hält ein Luftbild dauerhaft
  fest, und der Fehler fällt erst Jahre später auf, wenn überhaupt. Sie bräuchte eine Migration,
  ein Pflichtfeld in der Upload-Maske und zwei Regeln für eine Tabelle, die die Registry nicht
  kennt: `zeilenfilter` gilt je Tabelle für alle Spalten, der Dateiname eines Plans müsste aber
  trotzdem geschwärzt werden. Der Gewinn, Pläne im Skelett zu behalten, trägt das nicht.

Die sichere Voreinstellung gilt also für alle Bilder.

### D2 Zuordnung zur Kategorie `anhaenge`

Ein Kartenhintergrund ist technisch und fachlich ein hochgeladener Datei-Inhalt wie ein Anhang:
gleiche Größengrenze, gleiche Art Inhalt (Fotos), gleiche Frage nach der Rechtsgrundlage. Die
Org-Einstellungen nennen beim Vorschlag für `anhaenge` schon die Drohnenbild-Frist des NKatSG
(`frontend/src/aufbewahrung/kategorieText.ts`); erst diese Zuordnung macht den Vorschlag wahr.

- **Einsatz-Frist** hielte die Bilder so lange wie Lagemeldungen und Schäden; die NKatSG-Frist
  ließe sich dann nur über eine kurze Einsatz-Frist erreichen, die alles andere mitnimmt.
- **Eigene Kategorie** bräuchte Migration (Org-Dauer, Kategorie-Zustand), API, Codegen, Frist-
  Paneel und Archivakte für einen Unterschied, den bisher niemand verlangt hat. Kommt er, lässt
  sich die Zuordnung in der Registry umhängen.

Ohne Kategorie-Dauer folgt `anhaenge` der Einsatz-Frist; für Organisationen ohne eigene
Anhang-Frist ändert sich der Zeitpunkt also nur insofern, als die Bilder jetzt mit dem Einsatz
geschwärzt statt behalten werden.

### D3 Ganze Zeile, in Einzelschritten (`ZeileEinzelnLoeschen`)

Jede Spalte der Tabelle wird Scrub mit `Strategie::ZeileEinzelnLoeschen` und `Z_ANHAENGE`,
wie bei `anhang`. Eine Zeile ohne Bild, aber mit Ecken, Opazität und Reihenfolge hätte keinen
Leser; ein leerer BLOB bräche zudem Annahmen der Lesewege (`groesse > 0`, Bildformat), und der
SHA-256 bliebe ein Fingerabdruck des gelöschten Bilds.

Einzeln statt im atomaren Vorgang, weil ein Einsatz mehrere Bilder bis 25 MB tragen kann und
die Schreibsperre sonst wieder wüchse (Begründung aus LFH-905,
`openspec/changes/archive/2026-10-05-lfh-905-schwaerzung-schreibsperre-begrenzen/design.md`).

### D4 Ein Nachlauf für beide Tabellen

Die Bedingung „zur Entfernung vorgesehen“ ist keine Eigenschaft des Anhangs, sondern des
Einsatzes; sie gilt für beide Tabellen unverändert. Sie wandert aus `anhang::repo` an eine
gemeinsame Stelle (Nachlauf der Schwärzung im Modul `einsatz`), parametriert mit dem Alias der
Tabelle. Eine Liste `EINZELN_GELOESCHT = ["anhang", "karte_hintergrundbild"]` ist die eine
Quelle für:

- den Nachlauf: je Tabelle und je Zeile eine Transaktion (`write_retry!`), Wächter im `DELETE`;
- den Guard der Registry: `ZeileEinzelnLoeschen` nur für Tabellen dieser Liste, und dort für
  alle Scrub-Spalten (heute fest auf `anhang`);
- Phase D der Skelett-Löschung: ein Einsatz wartet, solange in einer der Tabellen noch eine
  Zeile steht;
- `scrubbe_aus_registry`: für `anhang` löscht der atomare Vorgang die Verknüpfungen, für
  `karte_hintergrundbild` gibt es keine (keine Tabelle verweist auf sie), er übergeht die
  Tabelle also nur.

Alle bisherigen Aufrufer von `entferne_vorgesehene` (Einsatz-Schwärzung, Kategorie-Schwärzung,
Purge-Tick, Tests) rufen danach den gemeinsamen Nachlauf; der alte Name bleibt nicht als
Umweg stehen.

### D5 Lesewege übergehen vorgesehene Bilder

Zwischen atomarer Schwärzung und Nachlauf steht das Bild noch in der Tabelle. Die Lesewege in
`src/karte_hintergrundbild/repo.rs` (`liste`, `laden`, `meta_fuer_download`, `laden_bytes`)
filtern mit derselben Bedingung, wie es `anhang::repo` tut; der Download liefert dann 404. Die
Schreibwege brauchen keinen Filter: Hochladen, Ändern und Löschen verlangen einen aktiven
Einsatz, vorgesehen ist ein Bild nur an einem abgeschlossenen. Lage-Stände, die nach der
Schwärzung entstünden, gibt es nicht (ebenfalls nur am aktiven Einsatz).

### D6 Bestand wird beim nächsten Lauf entfernt, ohne neuen ETB-Eintrag

Weil „vorgesehen“ aus dem Zustand folgt, trifft der Nachlauf nach dem Update auch die Bilder
von Einsätzen, die schon früher geschwärzt wurden. Das ist gewollt: Die Bilder hätten nach der
neuen Klassifikation schon damals fallen müssen. Einen eigenen ETB-Eintrag gibt es nicht; die
Schwärzung des Einsatzes bzw. der Kategorie ist schon protokolliert, und der Nachlauf schreibt
auch für Anhänge keinen. Der Purge-Tick meldet die Zahl im Log wie bei Anhängen.

Unumkehrbar ist das trotzdem: Wer ein solches Bild aus einem geschwärzten Einsatz noch
braucht, muss es vor dem Update herunterladen (der Einsatz ist dann gesperrt; nur eine Sicherung
von vorher hilft). Das steht in der Abschlussmeldung.

### D7 Rückspielen einer alten Sicherung

Die Anforderung „Rückspielen einer Sicherung von vor der Schwärzung“ führt die Schwärzung nach
dem Rückspielen erneut aus. Weil der Nachlauf zustandsgetrieben ist, fallen die Bilder dabei
mit; eine eigene Behandlung braucht es nicht. Ein Test belegt das nicht eigens, der Nachlauf ist
derselbe.

## Risks / Trade-offs

- **Pläne gehen mit.** Ein gezeichneter Lageplan überlebt die Schwärzung nicht mehr. → Er liegt
  bei seiner Quelle; das ETB beschreibt die Lage im Wortlaut. Wer einen Plan länger braucht,
  setzt keine kurze Anhang-Frist.
- **Kategorie-Schwärzung an einem lesbaren Einsatz** nimmt der Lagekarte und ihrem Rückblick
  die Hintergründe. → Gewollt; der Rückblick verkraftet fehlende Bilder heute schon (gelöschtes
  Bild im laufenden Einsatz): er zeichnet die übrigen und meldet das fehlende als Hinweis
  (`useKartenbilder`, belegt in `useKartenbilder.test.tsx`).
- **Bestand fällt beim ersten Lauf** (D6). → In der Abschlussmeldung nennen.
- **Breitere Bedingung im Nachlauf** könnte fremde Zeilen treffen. → Der Wächter im `DELETE`
  wiederholt die Bedingung; ein Test belegt, dass Bilder eines nicht geschwärzten Einsatzes
  bleiben.

## Migration Plan

Keine Schema-Migration. Mit dem Deploy greift die neue Klassifikation; der erste Purge-Tick
entfernt den Bestand (D6). Zurückrollen heißt die Registry zurücksetzen; schon gelöschte Bilder
kommen nicht zurück.

## Open Questions

Keine. Die Wahl zwischen a, b und c legt der Freigabe-Checkpoint fest.
