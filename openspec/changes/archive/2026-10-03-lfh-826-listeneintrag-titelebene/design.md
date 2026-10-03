# Design

## Context

`components/Liste.tsx` reicht über `ListeContext` heute nur `size` und `bordered` an die
Einträge weiter. Der Kopf (LFH-470) rendert über `KOPF_ELEMENT[kopf.unterEbene]` eine Ebene unter
dem Einbauort. `ListenEintragMeta` rendert den Titel als festes `<h4>`. Größe, Farbe, Abstand und
Zeilenhöhe setzt es inline. Das Gewicht kommt aus dem Browser-Standard für `h4` (`bold`, 700), denn
weder das Projekt noch antd setzen eine Regel für Überschriften.

Einbauorte (Überschrift darüber → heute):

| Einbauort | darüber | heute |
| --- | --- | --- |
| `pages/StabPage.tsx`, Besetzung S1–S6 | Paneel `h2` | `h4` |
| `stab/LagebesprechungHistorie.tsx` (auch im Collapse „Frühere“) | Paneel `h2` „Lagebesprechung“ | `h4` |
| `pages/PressePage.tsx`, Pressemitteilungen | Paneel `h2` | `h4` |
| `chat/NachrichtenStrom.tsx` | Seitentitel `h1` (das Kanäle-Paneel `h2` ist Nachbarspalte) | `h4` |
| `stammdaten/FuehrungsfunktionenTab.tsx` | `AdminPage` `h1` | `h4` |
| `pages/einstellungen/EinsatzPegel.tsx` | `Formularpaneel` `h2` | `h4` |
| `karten/OfflineRegionPicker.tsx` | Gruppentitel `h5` im Dialog | `h4` über `h5` |
| `karten/OfflineVorhandeneModal.tsx` | Dialog, Titel ist ein `Input` | `h4` mit Eingabefeld |
| `karten/AusKatalogModal.tsx` | Dialog | `h4` |

Ein antd-Dialogtitel ist keine Überschrift (`div.ant-modal-title`), er benennt den Dialog nur über
`aria-labelledby`.

## Goals / Non-Goals

**Goals:**
- Die Ebene des Eintragstitels hängt am Einbauort der Liste, nicht an der Meta-Komponente.
- Unter einem Kopf ist die richtige Ebene ohne Zutun des Aufrufers garantiert.
- Fehlt eine Angabe, entsteht nie eine falsche Gliederung (fail-safe).

**Non-Goals:**
- Die Gruppentitel im Dialog „Region aufs Gerät bringen“ werden nicht zum Listenkopf
  umgebaut. Das wäre ein Optikwechsel, und der Konflikt löst sich schon dadurch, dass die
  Einträge dort keine Überschriften mehr sind.
- Keine Prüfung anderer Überschriften auf den betroffenen Seiten (Paneele, Dialoge).

## Decisions

### D1 — Die Ebene steht an der Liste, die Meta-Komponente liest sie aus dem Context

`ListeContext` bekommt ein Feld `titelEbene: 2 | 3 | 4 | 5 | 6 | null`. `Liste` berechnet es:

- mit Kopf (der eine Überschrift ergibt): `min(6, kopf.unterEbene + 2)`, also eine Ebene unter
  dem Kopf, der selbst `unterEbene + 1` ist;
- ohne Kopf mit neuer Prop `unterEbene?: UnterEbene`: `min(6, unterEbene + 1)`, dieselbe
  Rechnung wie `Markdown`;
- sonst `null`.

`kopf` und `unterEbene` schließen sich per Typ aus (Union mit `never`), damit es keine zwei
Quellen für dieselbe Zahl gibt. `ListenEintragMeta` rendert bei `titelEbene` ein `h{N}`, bei
`null` ein `div`. Beide tragen denselben Inline-Stil. Das Gewicht wird jetzt ausdrücklich gesetzt,
und zwar auf 700, das Gewicht des früheren `<h4>`. So sehen `div` und `h*` gleich aus, und die
Optik bleibt unverändert. `token.fontWeightStrong` (600) schiede aus, denn damit würde jeder Titel
leichter.

*Ein Kopf ohne Inhalt* ergibt keine Überschrift (LFH-470). Dann zählt er auch für die
Titelebene nicht. Es gilt `unterEbene`, und weil die Union beides ausschließt, ist das in der
Praxis `null`.

**Verworfen:**
- **Pflicht-Prop an `ListenEintragMeta`** (`unterEbene: UnterEbene | null`). Das prüft der
  Compiler. Unter einem Kopf steht die Zahl aber doppelt, und Kopf und Eintrag können
  auseinanderlaufen. Genau dieses Auseinanderlaufen soll LFH-826 abstellen.
- **Pflicht-Prop `unterEbene` an jeder `Liste` ohne Kopf.** 22 Aufrufer, davon 13 ohne
  `ListenEintragMeta`. Dort hätte die Angabe keine Wirkung und wäre nur Lärm.
- **Fester Versatz** (Eintrag immer `h3`). Das ist derselbe Fehler wie die feste `h4`, nur eine
  Ebene höher.

**Abweichung vom Ticket:** Das Ticket schlägt ohne Kopf eine *Pflicht*angabe vor. D1 macht sie
optional und wählt ohne Angabe „keine Überschrift“. Begründung: Die Angabe ist nur nötig, wenn
die Liste `ListenEintragMeta` mit Titel nutzt, und das kann der Typ der `Liste` nicht sehen. Eine
fehlende Angabe kostet so höchstens eine Sprungmarke. Eine falsche oder übersprungene Ebene
entsteht dadurch nie. Das Akzeptanzkriterium („keine feste h4, die nicht passt, oder der
Verzicht ist begründet“) erfüllt jeder Einbauort ausdrücklich, s. D2.

### D2 — Entscheidung je Einbauort

Maßstab (Spec, „Eintragstitel als Überschrift nur bei eigenständigen Gegenständen“): Eine
Überschrift bekommt ein Eintrag, der ein eigener Gegenstand mit Inhalt darunter ist und
zwischen dem jemand springen will. Auswahl-, Einstellungs- und Stromlisten bekommen keine.

- **`unterEbene={2}` → `h3`:** Stab-Besetzung (sechs Sachgebiete mit Besetzung und
  Werkzeugen darunter), Lagebesprechungs-Historie (Entschluss und nächster Termin darunter;
  beide `Liste`-Instanzen, auch die im Collapse), Pressemitteilungen (Kette mit Status und
  Verlauf darunter).
- **ohne Angabe → keine Überschrift:**
  - Chat: ein Strom, keine Gliederung. Bei 200 Nachrichten wären es 200 Sprungmarken.
    Autor und Zeit sind Meta, kein Titel.
  - Führungsfunktionen und Pegel: Einstellungslisten. Der Titel benennt die Zeile, das
    Bedienelement trägt sein eigenes Etikett.
  - Drei Kartendialoge: Auswahllisten („welcher von diesen?“). In „Gebaute Region
    übernehmen“ ist der Titel ein Eingabefeld, und in „Region aufs Gerät bringen“ stünde die
    Überschrift sonst über ihrer Gruppe.

An jedem Einbauort ohne Angabe steht ein Ein-Satz-Kommentar mit dem Grund. Der Verzicht wird so
nicht still zur Vorgabe.

### D3 — Regel im Komponentenkatalog

`frontend/AGENTS.md`, Abschnitt Komponenten, neben `Markdown`: „`Liste`: Eintragstitel folgt
dem Kopf (`hN+1`) oder `unterEbene`, ohne beides keine Überschrift. Überschrift nur bei
eigenständigen Gegenständen (Spec `ueberschriften-gliederung`).“ Kurz, mit Verweis auf die Spec.

## Risks / Trade-offs

- [Tests oder e2e, die Zeilentitel per Rolle `heading` finden, brechen an den „keine
  Überschrift“-Orten.] → Beim Umsetzen per `grep` auf `heading` in den Tests und e2e-Specs
  dieser Seiten suchen und auf Text- oder Listenpunkt-Abfragen umstellen. Die Pegel-Abfragen in
  `e2e/pegel-pruefliste.spec.ts` betreffen den Inspector der Lagekarte, nicht diese Liste.
- [Das Gewicht des Titels hing am Browser-Standard für `h4`. Ein `div` sähe ohne ausdrückliches
  Gewicht dünner aus.] → `fontWeight: 700` inline setzen und den Wert in `Liste.test.tsx` für
  beide Varianten festhalten.
- [Ein künftiger Aufrufer vergisst `unterEbene`.] → Fail-safe: es entsteht keine falsche Ebene.
  Die Regel steht im Katalog (D3) und im Dateikopf von `Liste.tsx`.

## Migration Plan

Reine Frontend-Änderung ohne Daten. Ein Rollback ist ein Revert des Commits.
