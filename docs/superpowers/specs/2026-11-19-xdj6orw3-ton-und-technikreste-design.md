# Ton und Technikreste: einheitliche Anrede, keine Servertexte, kein Layoutsprung

Zunder: https://zunder.rubeen.dev/#/aufgabe/xdj6orw3n3wzx7b7rb543ihi (LLH-1830)
Route: `entwurf` (E1 Anrede-Wahl, E2 Regeln in `frontend/AGENTS.md`, E3 Backend und Frontend).
Lösungsweg abgestimmt am 19.11.2026 (alle vier Fragen nach Empfehlung).

## Absicht

Die Oberfläche soll klingen wie aus einem Guss und sich beim Laden ruhig verhalten. Heute
spricht sie mal mit „du“, mal mit „Sie“. Fachbegriffe wechseln für dieselbe Sache, technische
Servermeldungen kommen roh bis zum Anwender, und drei viel genutzte Seiten springen beim ersten
Aufruf. Keiner dieser Punkte ist für sich schlimm. Zusammen wirkt die App unfertig, gerade auf
den Seiten, die im Einsatz dauernd offen sind.

## Ziele, Nicht-Ziele, Anti-Ziele

- **Ziele:**
  - Eine Anrede-Regel für die App, durchgezogen.
  - Gleiche Begriffe für gleiche Dinge an den genannten Stellen.
  - Keine serde- oder axum-Texte mehr in einer Fehlermeldung an Anwender.
  - Meldebild, ETB und Betroffene beim kalten Erstaufruf mit CLS ≤ 0,1, durch einen e2e-Test
    belegt.
- **Nicht-Ziele:**
  - Eine allgemeine Textrevision der App.
  - Die Marketing-Seite (`website/`).
  - Die öffentliche API v1 mit ihrem eigenen Fehlerformat (`src/public_api/rechner.rs`,
    `error.rs`).
  - Andere Seiten als die drei genannten beim Layoutsprung.
- **Anti-Ziele:**
  - Unpersönliche Texte, die steif oder passiv-bürokratisch werden („Es wird gebeten …“).
  - Ein Gerippe, das selbst springt oder die Seite länger leer zeigt als heute. Das Gerippe
    darf den echten Inhalt nicht verzögern.
  - Ein neuer Fehlertext, der verschweigt, dass etwas nicht gespeichert wurde.

## Ansätze

| Frage | Gewählt | Verworfen |
|---|---|---|
| Anrede | **unpersönlich**, wie die Anwenderdoku (`docs/anwender/AGENTS.md`: „kein Du, kein Sie“). Fast alle Texte sind es schon, und der Einsatzton ist knapp. | Du (locker, Ehrenamt), Sie (förmlich). Beide machen künftig jede neue Ansprache zur Stilfrage. |
| Servertexte | **Server neutral, Einzelheiten ins Log** (`src/extract.rs`) | Der Server schickt einen Grund und `fehlerText()` übersetzt ihn. Das bringt mehr Teile, und der Rohtext ginge weiter über die Leitung. |
| Layoutsprung | **Kopf sofort, Gerippe in Zielgröße auch beim Erstaufruf**. Die Regel LLH-1838 wird erweitert. | Nur Einzelstellen reparieren. Der größte Sprung, der spät erscheinende Seitenkopf, bliebe. |
| Schnitt | **ein Task, ein Entwurf, ein PR** | drei Subtasks |

## Teil 1: Anrede und Begriffe

**Regel (neu in `frontend/AGENTS.md`, Abschnitt Texte/Bedien-Leitlinie):** UI-Texte sprechen
niemanden an, weder mit Du noch mit Sie. Sie nennen die Sache („Eigene Rolle“, „Code aus der
Authenticator-App“) oder den Handgriff im Infinitiv („Rufnamen für Von und An wählen“). Eine
Frage ohne Pronomen ist erlaubt („Mit welchem Rufnamen ins ETB schreiben?“). Das gilt auch für
Server-Fehlertexte, die bis zum Anwender durchkommen. Aus der Anwenderdoku wird auf die Regel
verwiesen, nicht doppelt geschrieben.

**Texte** (Stand des Scope-Scans; der Bauende greppt noch einmal nach
`\b(du|dein\w*|dich|dir|Sie|Ihr\w*|Ihnen)\b` in UI-Strings, Kommentare ausgenommen):

| Stelle | Heute | Neu (Vorschlag) |
|---|---|---|
| `etb/lesemarkeModell.ts:25–34` | „… Einträge, die Sie noch nicht gesichtet haben“, „seit Ihrer letzten Sichtung“ | „1 noch nicht gesichteter Eintrag“ / „n noch nicht gesichtete Einträge“, „seit der letzten Sichtung“ |
| `aufbewahrung/FristPaneel.tsx:203` | „… für alle gesperrt, auch für Sie, …“ | „… für alle gesperrt, auch für die eigene Rolle, …“ |
| `etb/RufnameAbfrage.tsx:121` | „Dein Rufname für Von und An“ / „Mit welchem Rufnamen schreibst du ins ETB?“ | „Eigener Rufname für Von und An“ / „Mit welchem Rufnamen ins ETB schreiben?“ |
| `instanz/fuehrungText.ts:37` | „Deine Notübernahme hat …“ | „Die Notübernahme dieser Instanz hat …“ |
| `neuigkeiten/NeuigkeitenPage.tsx:71` | „Seit deiner letzten Version“ | „Seit der zuletzt gesehenen Version“ |
| `pages/ProfilPage.tsx:234, 387`, `pages/LoginPage.tsx:395` | „… deines Kontos“, „Code aus deiner Authenticator-App“ | „… dieses Kontos“, „Code aus der Authenticator-App“ |
| `pages/LoginPage.tsx:540` | „Die Administration deiner Organisation setzt es zurück.“ | „Die Administration der Organisation setzt es zurück.“ |
| `pages/AppAnmeldungPage.tsx:85` | „Bestätige nur, wenn du gerade …“ | „Nur bestätigen, wenn gerade in der Lifeline-App „Im Browser anmelden“ gewählt wurde.“ |
| `pages/EinsaetzePage.tsx:475` | „Deine Rolle: …“ | „Eigene Rolle: …“ |
| `einsatz/ModulGesperrt.tsx:67` | „Für deine Rolle nicht freigegeben“ | „Für die eigene Rolle nicht freigegeben“ |
| `geraet/KoppelnPage.tsx:63` | „Lass dir bei der Einsatzleitung einen neuen geben.“ | „Einen neuen bei der Einsatzleitung holen.“ |
| Rückmeldung („Was ist passiert, was wünschst du dir?“, in `docs/anwender/kapitel/rueckmeldung.md` zitiert) | Du | „Was ist passiert, was wäre gewünscht?“ (Quelle im Code suchen) |

**Begriffe:**

- **„Person erfassen“ (Sprungpalette) und „Betroffene erfassen“ (Dialog):** Beide heißen
  „Betroffene erfassen“, wie das Modul „Betroffene“. „Person erfassen“ bleibt als Schlagwort in
  der Palette. *Meine Wahl.*
- **„Personal nach Status · 0 Kräfte“:** Titel und Zähler nennen dieselbe Menge. Der Zähler
  wird „0 Personen“/„1 Person“ …, und der Titel bleibt, weil e2e, Unit-Tests und Doku ihn als
  Regionsnamen führen. *Meine Wahl; die Alternative „Kräfte nach Status“ hätte mehr
  Folgeänderungen.*
- **„Der Datensatz wurde entfernt oder gehört zu einer anderen Organisation“** (Personal- und
  Fahrzeugdetail, `EinheitVorlageDetailPage`): wird „Nicht gefunden: entfernt oder nicht in
  dieser Organisation.“ Gleicher Wortlaut an allen drei Stellen.
- **„Über Server proxen“** (`karten/OnlineQuelleFormModal.tsx:178`) wird „Über den Server
  abrufen“. Die Tests ziehen mit.
- Docs, die zitierte Texte enthalten (`einsatz-oberflaeche.md` „Deine Rolle“,
  `instanzkopplung.md`, `geraet-bedienen.md`, `rueckmeldung.md`), ziehen im selben PR mit
  (Mitänderungsregel `docs/anwender/AGENTS.md`). Bilder mit dem alten Text werden im Bildlauf
  neu aufgenommen, soweit der Wächter es verlangt.

## Teil 2: Servertexte (`src/extract.rs`)

`rejection_zu_app_error` bildet heute `JsonDataError` auf
`"Anfrage-Body passt nicht zum erwarteten Format: {e}"` ab, also mit dem serde-Text. Neu gilt
für alle 400-Arme (`JsonSyntaxError`, `JsonDataError`, `MissingJsonContentType`,
`BytesRejection`):

- Der Anwender bekommt **einen** neutralen Text: „Die Eingabe hat ein unerwartetes Format und
  wurde nicht gespeichert. Seite neu laden; tritt es wieder auf, bitte über Rückmeldung
  melden.“
- Die Einzelheiten (Variante und Rejection-Text) gehen per `tracing::warn!` ins Log, mit Methode
  und Pfad, soweit der Extraktor sie hat. Keine Körperinhalte im Log.
- Unverändert bleiben:
  - `PayloadTooLarge` („Anfrage ist zu groß.“), weil Tests und `offline/fehler.test.ts` darauf
    bauen und der Text verständlich ist.
  - Der `Internal`-Arm.
  - Der Statuscode 400.
- `JsonBody` nutzt auch die Einlöse-Route der öffentlichen API (`public_api/routen.rs:129`).
  Sie bekommt damit ebenfalls den neutralen Text. Das ist vertretbar: Fremdsysteme sehen 400,
  die Einzelheiten stehen im Log. *Meine Wahl.* Das eigene Format von `public_api/rechner.rs`
  bleibt.
- `PfadParam` und Query-Extraktoren in derselben Datei werden mitgeprüft. Geben sie
  serde-Text weiter, gilt dieselbe Behandlung.
- Tests: Ein Integrationstest schickt falsch getyptes JSON an eine interne Route. Er prüft den
  neutralen Text und dass im `error` kein „deserialize“ steht. `tests/fehler_vertrag.rs` wird
  angepasst, falls es den alten Text festhält.

## Teil 3: Layoutsprung beim Erstaufruf

**Ursache:** `KraefteuebersichtPage.tsx:1303`, `EtbPage.tsx:804` und `PersonenPage.tsx:891`
geben während `einsatzQuery.isLoading` nur `<SeitenSkeleton />` zurück: drei Balken ohne
Seitenkopf. Kommt der Einsatz, schiebt `EinsatzSeite` (Ortspfad, Titel, Meta) alles nach
unten. Dazu kommen kleinere Quellen:

- **ETB:** `EtbLesemarkeBanner` erscheint erst nach seiner Abfrage über der Zeitachse.
- **Betroffene:** Die Meta hat keinen `metaPlatzhalter` (`PersonenPage.tsx:1075`). Die
  Sichtungszeile über der Liste (unter `xl`) erscheint erst mit den Daten.
- **Alle drei:** Das 3-Balken-Gerippe ist viel kürzer als Tabelle oder Zeitachse.

**Weg:**

1. `ModulGerippeSeite` (`einsatz/ModulWechselGerippe.tsx`) bekommt einen optionalen Inhalt für
   das Gerippe (Standard: das heutige `SeitenSkeleton verzoegert`). Die drei Seiten geben im
   Frühausstieg `ModulGerippeSeite` mit ihrem Modulschlüssel zurück statt des nackten
   `SeitenSkeleton`. Der Titel steht damit sofort am Platz. Den Einsatznamen für den Ortspfad
   kennt der Rahmen.
2. **Gerippe in Zielgröße:** Das Gerippe unter dem Kopf füllt die Höhe, die der Inhalt einnehmen
   wird, mindestens die Resthöhe des Fensters unter dem Kopf. Der Inhalt schiebt dann nichts
   mehr nach unten, sondern ersetzt Fläche. Die inneren Ladezustände (`Datensicht ladend`,
   `EtbZeitachse` ladend, Karten- und Kachelansicht in Betroffene) folgen derselben
   Mindesthöhe.
3. **Kleinere Quellen:**
   - Betroffene bekommt den `metaPlatzhalter` wie Meldebild und ETB.
   - Das Lesemarke-Band im ETB reserviert seine Zeile, solange seine Abfrage lädt. Endet sie
     ohne Anzeige, fällt die Zeile weg; das ist ein einmaliger Sprung **nach oben** unter dem
     Gerippe, ohne Inhalt darunter. Bei der Messung prüfen. Ist er messbar, steht das Band nur
     noch, wenn die Lesemarke-Abfrage vor der Zeitachse fertig ist, sonst das Sammelbanner.
   - Die Sichtungszeile in Betroffene steht ab dem ersten Bild mit leerem Platzhalter.
4. **Regel:** `frontend/AGENTS.md`, „Modulwechsel zeigt sofort Kopf und Gerippe“, wird
   erweitert: Auch beim ersten Aufruf zeigt eine Modulseite, solange der Einsatz lädt, sofort
   `ModulGerippeSeite`, und das Gerippe hat die Zielgröße des Inhalts. Der Satz „Das gilt
   nicht … beim ersten Aufruf“ entfällt für den Frühausstieg. `ModulWechselGerippe` selbst
   zeigt beim direkten Aufruf weiterhin kein Vorab-Gerippe; das tut nun die Seite im
   Frühausstieg. Andere Modulseiten mit demselben Frühausstieg folgen der Regel beim nächsten
   Anfassen; das wird ein Nachzug in Zunder.
5. **Messung:** `e2e/rahmen-cls-dichte.spec.ts` misst heute Meldebild und ETB unter 0,1 und ist
   grün. Die 0,17/0,12/0,10 stammen also aus einer anderen Bedingung. Der Bauende stellt sie
   zuerst nach: kalter Aufruf per `page.goto` direkt auf die Modulseite, langsame
   Einsatz-Antwort (Route verzögern), schmale und breite Breite. Er schreibt den Test rot,
   bevor gebaut wird. Neu dazu kommt Betroffene (`personen`). Die Grenze bleibt < 0,1, ohne
   anstehenden Alarm.

## Dem Bauenden überlassen

- Die genaue Formulierung der neuen Texte innerhalb der Regel. Die Tabelle oben ist ein
  Vorschlag.
- Wie das Gerippe seine Zielhöhe bekommt: `min-height` aus `--lfh-kopf-oben` oder die
  Zeilenzahl aus der Zeilenhöhe der Dichte.
- Ob die Lesemarke-Zeile reserviert oder anders gelöst wird; maßgeblich ist der Messwert.

## Prüfung

- `./scripts/check-all.sh --geaendert --ohne-e2e`
- Die geänderten und neuen e2e-CLS-Specs gezielt laufen lassen.
- Review nach Ermessen: Der Diff berührt Backend und Frontend. Die Schnittstelle ändert sich
  nur im Text, nicht in Form oder Status, also voraussichtlich kein Pflichtanlass. Am fertigen
  Diff wird neu entschieden.
