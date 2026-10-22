# nachforderung-erfassung Specification

## Purpose
Eine Nachforderung ist am Funkgerät in wenigen Griffen erfasst: Was, Anzahl, Wohin. Die übrigen
Angaben stehen eingeklappt mit Vorgaben bereit. Ziel (Meldeort) und Bedarfszeit „benötigt bis“
gehen mit der Nachforderung in die Anzeige und ins ETB (LLH-1089).

## Requirements

### Requirement: Drei Felder sichtbar

Die Erfassung SHALL sichtbar nur „Was“ (Pflicht), „Anzahl“ (Vorgabe 1) und „Wohin“ zeigen. Details
/ Zweck, Adressat, Adressat-Bezeichnung, Priorität, „Benötigt bis“ und Begründung MUST unter
„Weitere Angaben“ eingeklappt stehen, mit einer Vorgabe je Feld. Der Kopf von „Weitere Angaben“
MUST jede Abweichung von der Vorgabe nennen, und ein Prüffehler in einem eingeklappten Feld MUST
den Teil aufklappen. Details / Zweck MUST optional sein; Leerraum zählt als fehlend. Eine
Teil-Vorbelegung aus einem Sprung (z. B. Fehlmenge Material) MUST die Anzahl leer lassen.

#### Scenario: Ohne Details
- **WHEN** die Einsatzleitung nur „Sandsäcke“ einträgt und absetzt
- **THEN** legt der Server die Nachforderung an und schreibt „Nachforderung: 1× Sandsäcke“ ins ETB

#### Scenario: Abweichung im Kopf
- **WHEN** die Priorität „Sofort“ und Details eingetragen sind und „Weitere Angaben“ zugeklappt ist
- **THEN** lautet der Kopf „Weitere Angaben · Priorität Sofort · Details“

### Requirement: Schnellwahl

Über den Feldern SHALL eine Schnellwahl mit sechs Arten stehen: die häufigsten Arten der
Nachforderungen dieses Einsatzes, danach die üblichen Arten der Organisation (Requirement
„Übliche Arten der Organisation“, LLH-1379), aufgefüllt aus der festen Liste gängiger Kräfte und
Mittel in deren Folge; jede Art höchstens einmal, ohne Rücksicht auf Groß- und Kleinschreibung. Ein Klick MUST „Was“ setzen und den Fokus mit markiertem Inhalt auf „Anzahl“ legen,
sodass eine Ziffer die Vorgabe ersetzt und Enter absetzt.

#### Scenario: 2× RTW mit drei Tasten
- **WHEN** jemand in einem neuen Einsatz „RTW“ in der Schnellwahl klickt, „2“ tippt und Enter drückt
- **THEN** wird „2× RTW“ an den einzigen aktiven Bereitstellungsraum abgesetzt

#### Scenario: Neuer Einsatz ohne Vorgeschichte
- **WHEN** der Einsatz noch keine Nachforderung hat und der Benutzer keinen anderen Einsatz der Organisation mit Nachforderungen lesen darf
- **THEN** zeigt die Schnellwahl RTW, KTW, NEF, LF 10, HLF 20 und DLK 23-12

#### Scenario: Neuer Einsatz in einer Organisation mit Vorgeschichte
- **WHEN** der Einsatz noch keine Nachforderung hat und in lesbaren Einsätzen der Organisation Sandsäcke und Tauchpumpen angefordert wurden
- **THEN** beginnt die Schnellwahl mit Sandsäcke und Tauchpumpe, aufgefüllt mit RTW, KTW, NEF und LF 10

### Requirement: Vorschläge für „Was“

„Was“ SHALL Freitext annehmen und Vorschläge in vier Gruppen zeigen: „In diesem Einsatz“ (frühere
Arten nach Häufigkeit), „In der Organisation“ (übliche Arten der Organisation), „Einheitstypen“
(aktive Typen der Organisation) und „Kräfte und Mittel“ (feste Liste). Gleiche Arten MUST ohne
Rücksicht auf Groß- und Kleinschreibung einmal stehen, in der ersten Gruppe; leere Gruppen MUST
wegfallen.

#### Scenario: Einheitstyp der Organisation
- **WHEN** die Organisation den Einheitstyp „Wasserrettungszug“ führt
- **THEN** steht er unter „Einheitstypen“ zur Auswahl

### Requirement: Übliche Arten der Organisation

Der Server SHALL unter `GET /api/einsaetze/{id}/nachforderungen/arten` die Arten der
Nachforderungen aus den anderen Einsätzen der Organisation des Einsatzes liefern, höchstens 20,
als Wortlaut mit der Zahl der Einsätze, in denen sie vorkamen (LLH-1379). Die Route MUST dieselbe
Tür haben wie die Liste der Nachforderungen. Gezählt MUST nur über Einsätze werden, deren
Nachforderungen der Benutzer selbst lesen darf: Leserecht am Einsatz mit Nachlauf- und
Aufbewahrungsfrist und Zugriff auf das Modul Nachforderungen in diesem Einsatz. Der laufende
Einsatz, Einsätze anderer Organisationen, gelöschte und geschwärzte Einsätze und Arten mit dem
Schwärzungs-Platzhalter MUST nichts beitragen. Die Rangfolge MUST die Zahl der Einsätze sein,
dann die Zahl der Nachforderungen, dann die jüngste Anforderung; gleich ist, was sich nur in
Groß-/Kleinschreibung und Leerraum am Rand unterscheidet, in der Schreibweise der jüngsten
Anforderung. Die Antwort MUST keine Einsatz-Kennung, Zeit oder Person tragen. Gekoppelte Geräte
MUST die Route nicht erreichen. Die Oberfläche MUST die Antwort nicht im Lagebild ohne Netz
speichern; ohne Antwort gilt die feste Liste.

#### Scenario: Art aus einem Einsatz ohne Leserecht
- **WHEN** „Dolmetscher Ukrainisch“ nur in einem Einsatz angefordert wurde, in dem die Führungskraft kein Mitglied ist, und sie keine org-weite Rolle hat
- **THEN** fehlt die Art in ihrer Antwort, während ein System-Admin sie erhält

#### Scenario: Abgeschlossener Einsatz nach der Nachlauffrist
- **WHEN** ein Einsatz seit drei Tagen abgeschlossen ist
- **THEN** zählen seine Arten für dessen Einsatzleitung, nicht für dessen Führungspersonal

#### Scenario: Üblich heißt in vielen Einsätzen
- **WHEN** in einem Einsatz dreimal Sandsäcke und in zwei anderen je einmal RTW angefordert wurden
- **THEN** steht RTW mit zwei Einsätzen vor Sandsäcke mit einem

### Requirement: Ziel (Meldeort)

Eine Nachforderung SHALL beim Anlegen höchstens ein Ziel tragen: einen Bereitstellungsraum
(`ziel_br_id`), einen Einsatzabschnitt (`ziel_abschnitt_id`) oder einen Freitext (`ziel_text`,
höchstens 200 Zeichen). „Wohin“ MUST den Text beim Absetzen auflösen: ein nicht aufgelöster Raum
gleichen Namens, sonst ein Abschnitt gleichen Namens, sonst Freitext. Die Vorgabe MUST der
einzige aktive Raum sein, vorbelegt nur in ein leeres, unberührtes Feld. Der Server MUST nach den
Feldprüfungen prüfen: mehr als ein Ziel 422; beim Raum ohne Lesezugriff auf das Modul
Bereitstellungsräume 403, bevor der Raum gelesen wird, ein unbekannter oder fremder Raum 404, ein
aufgelöster oder stornierter Raum 409; beim Abschnitt ohne Lesezugriff auf das Modul
Einsatzabschnitte 403, ein unbekannter oder fremder Abschnitt 404. Ohne Ziel oder mit Freitext
MUST das Anlegen ohne diese Rechte möglich bleiben. Wird der Raum oder Abschnitt gelöscht, MUST
der Bezug fallen; die Nachforderung bleibt.

#### Scenario: Raum als Ziel
- **WHEN** „2× RTW“ an „BR Nord“ abgesetzt wird
- **THEN** trägt die Nachforderung die Kennung des Raums, und die Karte zeigt „→ BR Nord“

#### Scenario: Aufgelöster Raum
- **WHEN** das Ziel ein aufgelöster Bereitstellungsraum ist
- **THEN** antwortet der Server 409 und legt nichts an

#### Scenario: Ohne Recht am Modul des Ziels
- **WHEN** eine Führungskraft ohne Lesezugriff auf Bereitstellungsräume einen Raum als Ziel angibt
- **THEN** antwortet der Server 403

### Requirement: Bedarfszeit

Eine Nachforderung SHALL optional „benötigt bis“ tragen (UTC, normalisiert wie die Zeit der
Anforderung; unlesbar 400). Ohne Wert MUST „sofort“ gelten. Liegt die Bedarfszeit vor der
Anforderung, MUST der Server 422 antworten; gleich ist zulässig. Das Feld MUST die vorhandene
Zeiteingabe in der Art „Frist“ nutzen.

#### Scenario: Vor der Anforderung
- **WHEN** „benötigt bis“ eine Minute vor der Anforderung liegt
- **THEN** antwortet der Server 422 und legt nichts an

### Requirement: ETB-Wortlaut und Anzeige

Der ETB-Eintrag der Anlage SHALL „Nachforderung: {Anzahl}× {Art}“ lauten, gefolgt von
„ → {Ziel}“, „, benötigt bis {TT.MM. HH:MM}“ und „ — {Details}“, jeder Teil nur, wenn gesetzt. Den
Namen des Ziels MUST der Server in der Transaktion lesen, die Zeit MUST in der Anzeigezone des
Einsatzes stehen (Einsatz, sonst Organisation). Die Anzeige MUST vom Ziel nur Kennungen bzw. den
Freitext tragen; den Namen MUST die Oberfläche aus den Listen der Module lesen, nur mit deren
Freigabe, ohne Namen „→ Bereitstellungsraum“ bzw. „→ Einsatzabschnitt“. Wo die Nachforderung in
einer Liste oder Auswahl steht, MUST ihr Name „{Anzahl}× {Art}“ sein, mit Details
„{Anzahl}× {Art} — {Details}“.

#### Scenario: Vollständiger Wortlaut
- **WHEN** „2× RTW“ an „BR Nord“ bis 15:30 (Anzeigezone) mit Details „Transport aus UHS Turnhalle“ angefordert wird
- **THEN** lautet der ETB-Eintrag „Nachforderung: 2× RTW → BR Nord, benötigt bis 21.10. 15:30 — Transport aus UHS Turnhalle“

### Requirement: Schwärzung

Die Schwärzung eines Einsatzes SHALL den Freitext des Ziels leeren und die Details nur ersetzen,
wenn sie gesetzt sind. Die Kennungen von Raum und Abschnitt und die Bedarfszeit MUST bleiben.

#### Scenario: Freitext-Ziel geschwärzt
- **WHEN** ein Einsatz mit einer Nachforderung an „Garage Familie Kowalenko“ geschwärzt wird
- **THEN** trägt die Nachforderung kein Freitext-Ziel mehr
