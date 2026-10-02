# Design

## Context

Der Frist-PUT (`aufbewahrungsfrist_setzen`, `src/routes/einsatz.rs`) zieht den
`EinsatzKontext`. Dessen Org-Floor (`fordere_org_zugehoerigkeit`) lässt Mitglieder durch und
alle, die einen Einsatz fremd lesen dürfen (`darf_fremdeinsatz_lesen`): den System-Admin
serverweit, die org-weite Führungskraft nur in der eigenen Org. Danach prüft der Handler nur
`ist_admin()`, sonst `fordere_einsatzleitung`. Ein Lesegate hat er bewusst nicht, damit eine
abgelaufene Frist reaktiv verlängert werden kann (`ohne_kopf_pii_wenn_gesperrt` beschneidet
deshalb die Antwort).

Das Archiv (`aufbewahrung::fordere_archivzugriff`) schneidet enger: nur der Admin der eigenen
Org, fremd 403. LFH-23 hat die Abweichung benannt und offen gelassen (Archiv-`design.md`, D1).

Der Client spiegelt das Frist-Recht in `darfFristSetzen` (`frontend/src/aufbewahrung/fristModell.ts`):
Einsatzleitung oder `system_rolle === 'admin'`. Die Org des Benutzers kennt er nicht, denn
`BenutzerAnzeige` trägt keine `org_id`. `EinsatzAnzeige` trägt sie schon.

Der Purge-Scheduler tickt alle zehn Minuten (`TICK_SEKUNDEN = 600`) und merkt jeden
abgeschlossenen Einsatz mit `retention_bis <= jetzt` vor (`faellige_soft_delete`). Danach weist
der Frist-PUT mit 422 ab, und nur das Wiederherstellen des Org-Admins führt weiter.

## Goals / Non-Goals

**Goals:**

- Der Frist-PUT folgt derselben Org-Regel wie das Archiv.
- Der Client sperrt die Aktion dort, wo der Server 403 antworten würde (Spiegel, kein Gate).
- Die Entscheidung zum Verlängern nach Fristablauf ist nachlesbar.

**Non-Goals:**

- Kein neuer Weg für die Einsatzleitung nach Fristablauf, keine Vorwarnung vor Fristablauf.
- Kein Umbau von `fordere_org_zugehoerigkeit` oder `darf_fremdeinsatz_lesen`: der Admin liest
  fremde Einsätze weiter serverweit.
- Andere Admin-Schreibwege mit demselben Muster (z. B. `modul_override_setzen`) bleiben, wie
  sie sind. Ob dort derselbe Schnitt gilt, ist eine eigene Frage.

## Decisions

### D1 — Org-Prüfung im Handler, mit derselben Regel wie `fordere_archivzugriff`

Der Handler lässt den Admin nur durch, wenn `benutzer.org_id == einsatz.org_id`; sonst greift
`fordere_einsatzleitung` (403 ohne Mitgliedschaft als Einsatzleitung). Ein unbekannter Einsatz
bleibt 404 aus dem Extractor. Eine Mitgliedschaft als Einsatzleitung trägt weiter, auch über
Org-Grenzen hinweg: sie ist ein ausdrücklich erteiltes Recht am Einsatz.

**Verworfen:** `fordere_archivzugriff` direkt aufrufen. Es verlangt `abgeschlossen` (sonst
409), der Frist-PUT gilt aber auch an aktiven Einsätzen, und es schließt die Einsatzleitung
aus. **Verworfen:** den Floor im Extractor enger ziehen. Das änderte das Leserecht des Admins
an allen ~200 Einsatzrouten.

### D2 — Client-Spiegel über `org_id` in `BenutzerAnzeige`

`BenutzerAnzeige` bekommt `org_id` (additiv, Typ-Codegen). `darfFristSetzen` vergleicht sie
mit `einsatz.org_id`: `istEinsatzLeitung(einsatz) || (istAdmin(benutzer) && benutzer.org_id === einsatz.org_id)`.
`darfFristSetzen` bekommt eigene Kontexttypen mit `org_id` (`FristEinsatzKontext`,
`FristBenutzerKontext`); die geteilten `…Schreibkontext`-Typen bleiben unberührt, weil viele
andere Rechte-Helfer sie nutzen. Der Rechte-Hinweis nennt den „System-Admin der Organisation
des Einsatzes“.

**Verworfen:** Client unverändert lassen. Der fremde Admin sähe die Aktion offen und bekäme
erst beim Speichern 403. Das widerspricht der Spec („Ohne Recht MUST die Aktion gesperrt
dastehen“), und `fristModell.test.ts` prüft ausdrücklich den Spiegel. **Verworfen:** ein vom
Server berechnetes Flag `darf_frist_setzen` an `EinsatzAnzeige`. `anzeige()` hat viele
Aufrufer, und das Flag wäre ein Sonderfall neben dem bestehenden Muster „Client spiegelt
Rollen“.

### D3 — Kein Weg für die Einsatzleitung nach Fristablauf (Entscheidung Ruben, 02.10.2026)

Zwischen Fristablauf und Vormerkung liegen höchstens zehn Minuten. Danach bleibt nur das
Wiederherstellen, und das gehört dem Org-Admin. Die Einsatzleitung bekommt dafür weder Recht
noch UI. Das Backend bleibt unverändert: In dem kurzen Fenster lässt der PUT die Einsatzleitung
weiter verlängern (kein Lesegate), aber die Oberfläche bietet es nicht an, weil die
Einstellungen dann 403 liefern.

**Verworfen:** Wiederherstellen durch die Einsatzleitung während der Karenz (neues Recht im
Archiv-Namensraum, gegen D1 des Archivs). **Verworfen:** Vorwarnung vor Fristablauf (nicht
gewünscht).

## Risks / Trade-offs

- [Verhaltensänderung für fremde Admins] Ein Betreiber, der bisher als Admin einer Org Fristen
  fremder Einsätze pflegte, bekommt jetzt 403 → Gewollt (Mandantengrenze). Weg bleibt eine
  Mitgliedschaft als Einsatzleitung oder der Admin der Einsatz-Org.
- [`BenutzerAnzeige` hat mehrere SELECTs] Die `query_as::<_, BenutzerAnzeige>` in
  `src/routes/benutzer.rs` brauchen die Spalte, sonst scheitert die Abbildung zur Laufzeit →
  Die bestehenden Tests der Benutzerverwaltung fahren alle Pfade; jeder SELECT bekommt
  `org_id`.
- [Test-Fixtures im Frontend] Fixtures mit `BenutzerAnzeige` brauchen das neue Pflichtfeld →
  `tsc` im Gate findet jede Stelle.
