# Design

## Context

Das Organigramm (`frontend/src/pages/einsatzabschnitte/Organigramm.tsx`) liest ein Modell, das
`fuehrungsorganisation.ts:buildFuehrungsorganisation` rein aus Abschnitten und Einheiten ableitet.
Bildschirm, Druck und Lagebericht-Markdown (`renderFuehrungsorganisationMarkdown`) lesen dieses
eine Modell. Der Knoten (`OrgKnoten`) kennt heute keinen Lagezustand, obwohl der Abschnitt ihn
trägt (`Einsatzabschnitt.lagezustand`, LFH-608). „Leitung nicht besetzt“ steht in
`rollen.achtungText`, an Abschnitten wie an Einheiten.

Der Baum steht im Gerüst `components/organigramm/HaengenderBaum`, das die Fernmeldeskizze mitnutzt,
hinter der Zufluss-Schleuse (`baumSchleuse.ts`). Die Schleuse hält Struktur, der Inhalt eines
Knotens fließt je Schlüssel frisch durch (außer am alten Ort eines umgehängten Knotens).

Die Gliederung zeigt denselben Lagezustand schon als `StatusTag` mit `darstellungsart="rand"` aus
`theme/statusFarben.ts:abschnittLagezustand` (`AbschnittKnoten.tsx`), der Überblick ebenso.
Die abgestimmten Entscheidungen stehen in proposal.md; hier steht, wie.

## Goals / Non-Goals

**Goals:**

- Der Lagezustand ist Teil des Modells, damit Bildschirm, Druck und Bericht dieselbe Angabe lesen.
- Die Zählung der fehlenden Leitung ist eine reine Funktion über das Modell und damit ohne DOM
  testbar.

**Non-Goals:**

- Keine Änderung am Gerüst `HaengenderBaum` und keine Lagekante am Knoten: die Fernmeldeskizze
  bliebe sonst nicht unberührt.
- Kein „UA <Zustand>“ wie im Überblick (abgestimmt verworfen).
- Keine Alarmgründe aus Welle 1 (Rückmeldung überfällig, Ausfall) im Organigramm: sie gehören in
  die Alarmzeile (LLH-1743).
- Der Gliederungsbaum behält sein „ohne Leiter“-Etikett; er ist eine andere Ansicht mit eigener
  Dichte.

## Decisions

**D1 Lagezustand im Modell, nur am Abschnittsknoten.** `OrgKnoten` der Art `abschnitt` bekommt
`lagezustand: AbschnittLagezustand | null`, gefüllt aus `a.lagezustand ?? null`. Einheitsknoten
bekommen das Feld nicht (sie haben keinen Lagezustand), statt eines immer leeren Felds an der
Basis. Weil die Schleuse den Inhalt je Schlüssel frisch durchreicht, fließt eine Zustandsänderung
ohne weiteres Zutun live, auch bei gehaltener Struktur.
*Alternative:* Zustand im Inhalt-Renderer aus den Abschnitten nachschlagen. Verworfen: der Bericht
bräuchte denselben Nachschlag ein zweites Mal, und das Modell wäre nicht mehr die eine Quelle.

**D2 Etikett wie in der Gliederung.** `KnotenInhalt` setzt `StatusTag` mit
`darstellung={abschnittLagezustand[k.lagezustand]}` und `darstellungsart="rand"` direkt hinter den
Namenslink, in die Zeile des Namens (Flex mit Umbruch), nicht in die Metazeile. So steht der
Zustand dort, wo das Auge den Knoten zuerst trifft, und die Form ist dieselbe wie in Gliederung und
Überblick.
*Alternative:* Lagekante am Knotenrand. Verworfen (abgestimmt): neue Form im geteilten Gerüst.

**D3 Gedämpftes Wort am Knoten.** „Leitung nicht besetzt“ verliert `rollen.achtungText` und erbt
`rollen.gedaempft` der Metazeile. Das Wort bleibt (Spec: benannte Abwesenheit), nur die Rolle
geht in die Sammelzeile.

**D4 Zählung als reine Funktion.** `fuehrungsorganisation.ts` bekommt
`countOhneLeitung(org): { abschnitte: number; einheiten: number | null }`, rekursiv über alle
Knoten einschließlich Sammelknoten und unterstellter Einheiten. `einheiten` ist `null`, wenn
`org.einheitenFehlen` gilt: ein fehlender Bestand ist kein leerer (wie bei der Stärke). Dazu
`ohneLeitungText(z): string | null` mit Einzahl/Mehrzahl („1 Abschnitt ohne Leitung“, „2 Abschnitte
ohne Leitung“, „1 Einheit ohne Führer“, „7 Einheiten ohne Führer“), Teile mit 0 oder `null`
entfallen. `ohneLeitungTeile(z): string[]` liefert die Teile, `ohneLeitungText(z): string | null`
fügt sie mit „ · “ zusammen (`null`, wenn nichts bleibt). Der Bildschirm setzt je Teil ein Etikett
(D5), der Bericht schreibt den Text (D6); die Wörter sind dieselben.

**D5 Sammelzeile fest über dem Organigramm.** `Organigramm` rechnet die Teile aus `org`
(Live-Stand) und rendert `OhneLeitungZeile` zwischen dem Hinweis „Einheiten: …“ und
`OrganigrammBild`, außerhalb der Schleuse. Die Zeile steht immer da und ist immer so hoch wie ein
`StatusChip` (22 px, `nowrap`, Überlauf abgeschnitten). Mit Lücken trägt sie je Teil einen
`StatusChip` mit `ton="achtung"` (derselbe Baustein wie „ohne Leiter“ in der Gliederung), ohne
Lücke leise „Leitung überall besetzt“, bei fehlenden Einheiten „Alle Abschnitte mit Leitung“; ohne
jeden Knoten bleibt sie leer. Container `data-lfh="org-ohne-leitung"` ohne `organigramm-no-print`,
damit sie gedruckt wird. So folgt die Zahl immer dem Live-Stand, und ihr Wechsel schiebt den Baum
nie, weder beim Eintreffen noch bei „anzeigen“.
*Verworfen im ersten Review:* die Zeile live außerhalb der Schleuse, nur bei Lücken sichtbar.
Erschien oder verschwand sie, während die Schleuse hielt, rückte der Baum samt Fokus und Zeiger.
*Verworfen im zweiten Review:* die Zeile im gehaltenen Kopf des Gerüsts. Eine live geänderte
Leitung an einem gezeigten Knoten floss in den Knoten, aber nicht in die Zahl, ohne Banner; und
„anzeigen“ schob den Baum, wenn mit ihm die erste Lücke kam oder die letzte ging.
*Weitere Alternative (16.11.2026 mit dem Menschen abgewogen):* live mit Scroll-Ausgleich
(`useAmSchirmHalten` der Fernmeldeskizze; mehr Code, oben auf der Seite ohne Wirkung).
*Warum jetzt der feste Platz:* Nach dem ersten Review war „fest reservierter Platz (leerer
Streifen, wenn nichts fehlt)“ zugunsten des gehaltenen Kopfs verworfen. Der zweite Review zeigte,
dass der Kopf die Zahl gegen den gezeigten Inhalt veralten lässt und „anzeigen“ trotzdem schiebt.
Am 16.11.2026 hat der Mensch deshalb den festen Platz gewählt, mit einem leisen Text statt eines
leeren Streifens.
*Folge:* Während jemand im Organigramm arbeitet, zählt die Zeile auch Knoten, die noch hinter dem
Sammelbanner warten; der Banner nennt sie zugleich.

**D6 Bericht.** `knotenMarkdown` setzt bei einem Abschnitt mit Zustand `Lage <label>` direkt hinter
den Namen (`**UHS Turnhalle** · Lage kritisch · Rufname … · Leitung … · Stärke …`).
`renderFuehrungsorganisationMarkdown` schreibt unter `## Gliederung` vor der Liste die Zeile aus
`ohneLeitungText` samt Leerzeile, wenn sie nicht `null` ist. Die Quellenzeile „Einheiten: … —
Einheiten und Stärken fehlen“ bleibt, wie sie ist.

## Risks / Trade-offs

- [Zwei Wörter für dieselbe Lücke einer Einheit: „Leitung nicht besetzt“ am Knoten, „ohne Führer“
  in der Sammelzeile] → Bewusst: die Spec definiert die Leitung einer Einheit als ihren Führer, und
  die Sammelzeile muss Abschnitte und Einheiten unterscheiden. Ein Angleichen des Knotenworts wäre
  eine eigene Spec-Änderung.
- [StatusTag und StatusChip im Druck] → Die Prüfung, dass beide dunkel auf hell drucken, steht als
  eigene Aufgabe in tasks.md (Druckemulation im Bildlauf).
- [Feste Höhe ohne Umbruch: auf schmalem Schirm kann der zweite Chip gekappt werden] → Bei 390 px
  und 100 % passen auch zweistellige Zahlen nebeneinander. Bei 320 px (WCAG 1.4.10) laufen erst
  dreistellige Zahlen über, mit Seitenzoom ab 125–150 % auch kleinere. Die Zahl steht vorn und
  bleibt meist sichtbar; jeder Chip trägt seinen vollen Text als `title`, Vorleser lesen ihn ganz.
  Ein Umbruch hätte die Höhe und damit den Baum bewegt.
- [Die Fernmeldeskizze teilt das Gerüst] → Es ändern sich nur `KnotenInhalt` und die Seite; ein
  Test der Skizze läuft im Gate mit.
