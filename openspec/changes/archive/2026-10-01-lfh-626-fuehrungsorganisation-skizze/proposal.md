# Proposal

## Why

Die Führungsorganisation eines Einsatzes nach FwDV 100 / DV 100 wird heute neben der App von Hand
skizziert: Einsatzleitung, Einsatzabschnitte, Unterabschnitte, Leitungen und unterstellte
Einheiten. Im Gespräch vom 22.09.2026 hieß sie „Führungsskizze“. Die Daten dafür pflegt der Einsatz
längst. Es gibt Abschnitte mit `ueber_abschnitt_id`, Leitung und Kurzbezeichnung, Einheiten mit
Abschnitt, Unterstellung, Funkrufname, Führer und kumulierter Stärke, dazu die Stärke-Summierung
aus LFH-347/LFH-550. `EinsatzabschnittePage` zeigt sie aber nur als Bedienbaum. Ein Organigramm,
das man lesen, aushängen und in den Lagebericht nehmen kann, fehlt. Deshalb zeichnet heute jemand
ab, was die App schon weiß, und die Abschrift veraltet mit jeder Umgliederung.

## What Changes

- **Neue Ansicht „Organigramm“ auf der Seite Einsatzabschnitte.** Eine `Segmentleiste`
  „Gliederung | Organigramm“ steht im Seitenkopf, auch ohne Schreibrecht. Dazu kommt die
  Sichtvorgabe `?ansicht=organigramm` nach dem Muster des FMS-Tableaus (apply-then-clean). Das
  ergibt kein neues Modul, keine neue Route und keinen Backend-Eingriff.
- **Abgeleitet, ohne eigene Datenhaltung.** Das Organigramm entsteht im Client aus den Listen, die
  die Seite schon lädt (Abschnitte, Einheiten), und folgt Änderungen live über die bestehenden
  SSE-Ereignisse.
- **Knoten:**
  - Wurzel „Einsatzleitung“
  - darunter die obersten Abschnitte, dann Unterabschnitte und Einheiten
  - unter einer Einheit ihre unterstellten Einheiten
  - ein Sammelknoten „Ohne Abschnitt“

  Jeder Knoten zeigt Bezeichnung, Rufname (Kurzbezeichnung bzw. Funkrufname), Leitung und Stärke
  `F/UF/M//Σ`. Fehlt eine Angabe, steht sie als benannte Abwesenheit da und wird nie erfunden.
  Taktische Zeichen kommen aus der bestehenden Zeichenbibliothek (`EinsatzZeichen`).
- **Stärke aus derselben Funktion wie die Abschnittsseite** (`abschnittStaerken` →
  `summiereStaerke`, formatiert über `staerkeText`). Die Wurzel trägt keine eigene Gesamtstärke,
  weil die Kräftezahl ihre Heimat im Meldebild hat (LFH-550).
- **Einsatzleitung ohne erfundene Leitung.** Die Wurzel trägt „Leitung nicht erfasst“, denn die
  eigene Führungsstelle ist kein Datum ([LFH-849](https://app.clickup.com/t/123zgec5xhy)). Ist der
  Stab freigegeben, hängt er als Stabsstelle mit der Besetzung S1–S6 daneben. Ohne Freigabe
  erscheinen weder Stab noch Namen.
- **Hängendes Layout:** Die erste Ebene unter der Einsatzleitung bricht in Spalten um, tiefere
  Ebenen hängen senkrecht. So bleibt das Organigramm am Fükw, am Tablet und mobil ohne
  waagerechtes Scrollen lesbar. Knoten mit Kindern sind ein- und ausklappbar.
- **Drucken / als PDF** über die bestehende Druckmechanik mit Druckkopf „Führungsorganisation“.
  Vor dem Druck wird alles aufgeklappt, und der Ausdruck passt auf A4 hochkant.
- **In Lagebericht übernehmen** in einem Aufruf (Spec `dokument-uebernahme`) als Freitext-Bericht
  „Führungsorganisation <DTG>“ mit der Gliederung als Markdown-Liste.
- **Vorbereitet für den Kommunikationsplan**
  ([LFH-625](https://app.clickup.com/t/123zgec4863)): Das Knotenmodell entspricht dem Baum des
  Funkplans. LFH-625 kann darauf eine zuschaltbare Kommunikationsebene setzen (Sprechgruppen an den
  Kanten), statt eine zweite Skizze zu bauen. Die Ebene selbst gehört nicht zu dieser Change.

## Capabilities

### New Capabilities

- `fuehrungsorganisation`: Das aus der Einsatzgliederung abgeleitete Organigramm der
  Führungsorganisation. Die Fähigkeit regelt Ort und Einstieg, Knotenaufbau und Knoteninhalt,
  Stärke, Einsatzleitung und Stab, Lesbarkeit ohne waagerechtes Scrollen, Ein- und Ausklappen,
  Druck, Übernahme in den Lagebericht und Deeplinks.

### Modified Capabilities

Keine. Druck (`druck-dokumente`) und Übernahme (`dokument-uebernahme`) werden unverändert genutzt.

## Impact

- **Frontend:**
  - `pages/EinsatzabschnittePage.tsx` bekommt den Ansichtsumschalter.
  - Neu: `pages/einsatzabschnitte/fuehrungsorganisation.ts` für das reine Knotenmodell und das
    Markdown.
  - Neu: `pages/einsatzabschnitte/Organigramm.tsx` für Darstellung, Druck und Übernahme.
  - `routing/deeplinks.ts` bekommt `einsatzabschnittePfad` mit `ansicht` und die Prüfung des
    Parameters.
  - `frontend/AGENTS.md` bekommt einen Regel-Eintrag neben dem FMS-Tableau.
- **Backend:** keine Änderung, keine Migration, kein neuer Endpunkt. Typ-Codegen bleibt unberührt.
- **Abhängigkeiten:** keine neue Bibliothek. Das Layout entsteht aus CSS (Grid/Flex), die Zeichen
  kommen aus `@einsatzzeichen/react`.
- **Tests und Nachweise:**
  - Vitest für Knotenmodell, Stärke-Gleichheit, Markdown und die Seite
  - e2e für Breite am Fükw, Tablet und mobil, Druck mit ausgelöstem `beforeprint`, Übernahme mit
    genau einem POST und Live-Folgen
  - `pruefliste.md` (Prüfliste Einsatztauglichkeit)
