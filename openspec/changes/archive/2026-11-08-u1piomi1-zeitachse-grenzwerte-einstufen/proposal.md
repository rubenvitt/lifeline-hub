## Why

Die Kräfte-Zeitachse (LFH-552) zeigt Einsatzdauer und Ruhezeit bisher **neutral**: Wer seit 14 Stunden ohne ausreichende Ruhe im Dienst steht, sieht im Meldebild genauso aus wie jemand, der gerade eingetroffen ist. Der Schichtplan (LLH-1552) prüft das **Geplante** inzwischen gegen Höchstdienst und Mindestruhe des Einsatzes, das **Ist** aber nicht. Mit der Entscheidung vom 08.11.2026 (LLH-722, ohne Feldbefund) fällt die Sperre aus LFH-46 E17: Das Ist wird gegen **dieselben** Grenzwerte eingestuft (Zunder LLH-730, alte Kennung LFH-860).

## What Changes

- Das Ist wird eingestuft. Ist die **laufende Dienststrecke** einer Kraft länger als der Höchstdienst des Einsatzes, heißt sie „zu lang“. Die Dienststrecke folgt derselben Regel wie der Plan-Befund `dienst`: Perioden, zwischen denen weniger als die Mindestruhe liegt, bilden eine Strecke.
- Begann die laufende Periode nach einer Ruhe unter der Mindestruhe, heißt sie „Ruhe zu kurz“.
- Es gelten die **wirksamen** Grenzwerte des Einsatzes, also die gesetzten Werte und ohne eigenen Wert die Vorgaben 12 h bzw. 8 h, genau wie im Plan. Es gibt keine zweite Einstellung.
- Ohne Ereignis gibt es keine Einstufung, und eine fehlende Zahl gilt nie als 0. Die Werte werden nicht gespeichert.
- Angezeigt wird die Einstufung in der Rolle `achtung` mit einem Wort als zweitem Kanal. Sie steht in der Spalte „Im Einsatz“ des Meldebilds und in der Spalte „Einsatzdauer“ der Personal-Seite. Die Spalte „Ruhe“ bleibt neutral.
- Neue Lese-Endpunkte `GET /api/einsaetze/{id}/einheiten/zeitachse/grenzwerte` (Modul Einheiten) und `GET /api/einsaetze/{id}/personal/zeitachse/grenzwerte` (Modul Personal) liefern die wirksamen Grenzwerte, ohne dass das Modul Ablösung nötig ist. Die Perioden-Listen behalten ihre Form.
- **Nicht:** kein Hinweis in der AlarmZentrale, kein Modulzähler, keine Benachrichtigung (Alarmbudget nach EEMUA 191). Ebenfalls keine Einstufung auf der Einsatzkraft-Seite, in der Zeitachse einer Kraft, im Überblick, im Stab und im Einsatzbericht.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `kraefte-zeitachse`: Die Anforderung „Einsatzdauer und Ruhezeit“ verbietet die Einstufung nicht mehr. Neu kommen die Anforderungen „Einstufung gegen die Grenzwerte des Einsatzes“ und „Grenzwerte lesen“ hinzu.
- `kraefte-schichtplan`: In den „Prüfbefunden“ entfällt der Satz „Die Kräfte-Zeitachse MUST weiterhin nicht gegen Grenzwerte einstufen“. Die Anforderung „Grenzwerte des Einsatzes“ nennt jetzt, dass Plan und Ist dieselben wirksamen Werte lesen.

## Impact

- **Backend:** `src/routes/zeitachse.rs` mit zwei Lese-Handlern, `src/app.rs` mit zwei Routen. Wiederverwendet werden `abloesung::schichtplan::repo::grenzwerte` und das DTO `SchichtplanGrenzwerte`. Es gibt keine Migration und keinen neuen Typ im Codegen. Der Wächter `tests/einsatz_kontext_guard.rs` muss die Routen als Lesezugriff auf Einheiten bzw. Personal sehen.
- **Frontend:** `kraefte/zeitachse.ts` bekommt die reine Funktion für die Einstufung. Dazu kommen `api/kraefteZeitachse.ts`, ein neuer Query-Key unter dem Prefix `kraefteZeitachse` (live über `abloesung`, ohne Netz lesbar wie die Perioden), `pages/KraefteuebersichtPage.tsx` (Zelle „Im Einsatz“) und `pages/PersonalPage.tsx` (Zelle „Einsatzdauer“).
- **Regeln und Doku:** `frontend/src/kraefte/AGENTS.md` (Absatz Kräfte-Zeitachse), Code-Kommentare mit „LFH-860 / stuft nicht ein“ in `src/abloesung/schichtplan/` und die Anwenderkapitel `meldebild.md` und `personal.md` (Mitänderungsregel, Bilder).
- **Druck:** Das Meldeblatt druckt die Spalte „Im Einsatz“ mit, das Wort erscheint dort also auch.
