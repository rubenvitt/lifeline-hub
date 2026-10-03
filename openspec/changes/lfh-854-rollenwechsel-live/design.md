# Design

## Context

- Das Ereignis `einsatz` (LFH-555) trägt nur die Einsatzkennung und hat die leere Gate-Menge: Es
  erreicht jeden, der die Tür des Stroms passiert (`EinsatzLesezugriff` ohne Modul,
  `src/routes/live.rs`). Das Frontend ruft darauf den Kopf und die Stab-Anzeige neu ab
  (`frontend/src/api/queryKeys.ts`, Live-Partition `einsatz`).
- Das Schreibrecht im Frontend hängt allein an `status` und `meine_rolle` des Kopfs
  (`frontend/src/einsatz/schreibrecht.ts`). `meine_funktion` leitet sich aus `meine_rolle` und den
  Sachgebieten ab, `meine_fuehrungsstelle` aus der Mitgliedschaft.
- `mitglied_setzen`/`mitglied_entfernen` (`src/routes/einsatz.rs`) melden heute nur das
  Org-Ereignis `einsatzliste` (LFH-734), an die Leser des Einsatzes und zusätzlich an die betroffene
  Person. Den Einsatzkopf erreicht nichts.
- `GET /api/einsaetze/{id}/mitglieder` liegt hinter derselben Tür wie der Strom und der Kopf
  (`EinsatzLesezugriff` ohne Modul).

## Goals / Non-Goals

**Goals:**
- Der Schirm der betroffenen Person zeigt ihr neues Schreibrecht ohne Neuladen, in beide Richtungen.
- Kein Leser erfährt über den Strom mehr, als sein GET ohnehin zeigt.

**Non-Goals:**
- Die Mitgliederliste (`einsatzKeys.mitglieder`) live machen. Sie bleibt NICHT_LIVE. Sie ändert nur
  die Einsatzleitung, und deren eigener Schirm aktualisiert die Liste aus der Antwort des PUT/DELETE.
- `meine_sachgebiete` bei einer Stab-Besetzung live machen (D5 aus LFH-555 bleibt).
- `lagekennzahlen` (LFH-855, eigener Thread).
- Die Modulfreigaben des Stroms neu berechnen. Sie hängen an Org-Rolle und Modulregeln, nicht an der
  Einsatzrolle (`einsatz::berechtigung::modul_freigaben`). Ein Rollenwechsel im Einsatz ändert sie nicht.

## Decisions

### D1 — Das bestehende Ereignis `einsatz`, kein neues

Ein Mitgliedschaftswechsel verteilt `einsatz`. Das Frontend braucht dafür keine Änderung: Der Kopf
wird schon heute bei `einsatz` neu abgerufen, und mit ihm `meine_rolle`.

**Verworfen:**
- **`mitglieder` live machen** (neues Ereignis mit eigener Gate-Menge). Das Frontend müsste
  `mitglieder` zusätzlich auf den Kopf abbilden, und die Füll-Regel verlangte eine Gate-Menge für ein
  Objekt, das keinem Modul gehört. Das wäre eine dritte leere Menge neben `einsatz` und `lagged`, und
  genau die soll `ungegatet_sind_nur_lagged_und_einsatz` verhindern.
- **Gezielt nur an die betroffene Person senden.** Der Einsatz-Kanal kennt keine Empfänger, nur
  Modulfilter. Ein Benutzerfilter wäre eine neue Mechanik für einen seltenen Fall.

### D2 — Leck-Abwägung: kein Leck

Das Ereignis erreicht jeden Leser des Einsatzes. Erfährt er dadurch, dass sich eine Mitgliedschaft
geändert hat? Ja, der Zeitpunkt wird sichtbar. Der Inhalt ist es aber ohnehin: `GET …/mitglieder` liegt
hinter derselben Tür (`EinsatzLesezugriff` ohne Modul) und zeigt jedem Leser alle Mitglieder mit
Rolle. Die Nutzlast trägt nur die Einsatzkennung. Das Org-Ereignis `einsatzliste` meldet denselben
Zeitpunkt seit LFH-734 bereits an dieselben Leser. Der Unterschied zur Stab-Besetzung aus D5 von
LFH-555: Dort sieht ein Leser ohne Stab-Recht die Besetzung per GET nicht, hier sieht jeder Leser die
Mitgliederliste.

### D3 — Ein Emitter für Kopf und Liste

`kopf_geaendert` meldet heute `einsatz` und `einsatzliste` an die Leser. Die Mitgliedschaftswege
brauchen `einsatzliste` zusätzlich an die betroffene Person. Eine Variante
`kopf_geaendert_fuer(state, id, betroffene)` übernimmt beides, `kopf_geaendert` ruft sie mit leerer
Liste. So bleibt es bei einem `einsatzliste` je Änderung, und „jeder `einsatz`-Emitter läuft hierüber"
gilt weiter. Die übrigen Aufrufer bleiben unverändert.

### D4 — Jede erfolgreiche Mitgliedschaftsänderung feuert

Auch ein PUT, der Rolle und Stelle unverändert lässt, feuert. Anders als bei der Lagebesprechung (D3
aus LFH-555) ist der Weg selten und nur der Einsatzleitung offen. Ein Vergleich vor dem Schreiben
kostete einen zusätzlichen Lesezugriff für einen Kopf-Abruf, der nichts schadet. Abgelehnte Wege
(400, 403, 404, 409) feuern nicht, weil sie vor dem Schreiben zurückkehren.

### D5 — Entfernte Person

Die Revokation des Stroms ist ein Schnappschuss (`src/routes/live.rs`): Eine entfernte Person mit
offenem Strom bekommt das Ereignis noch. Ihr Kopf-Abruf liefert dann je nach Org-Rolle einen Kopf ohne
`meine_rolle` (nur noch lesend) oder 403/404, und die Fehlernaht räumt. Beides ist gewollt: Das
Schreibrecht verschwindet ohne Neuladen.

## Risks / Trade-offs

- [Mehr Abrufe] → Jede Mitgliedschaftsänderung ruft Kopf und Stab-Anzeige auf allen offenen Schirmen
  neu ab. Mitgliedschaftsänderungen sind selten, die Abrufe Einzelabfragen.
- [Spec-Konflikt mit LFH-855] → Beide Changes ändern die Anforderung „Bewusst nicht live" in
  `einsatzkopf-live`. Wer als Zweiter archiviert, zieht seinen MODIFIED-Block auf den Stand des Ersten
  nach.
- [Offenes Bearbeitungsformular] → Ein Kopf-Refetch lässt offene Formulare stehen (LFH-555, D4,
  Vitest in `EinsatzdatenPage.test.tsx`). Kein neues Risiko.

## Migration Plan

Keine Datenmigration, kein DTO, kein Codegen. Rückbau: die beiden Aufrufe in `mitglied_setzen`/
`mitglied_entfernen` zurück auf `einsatzliste_melden`.
