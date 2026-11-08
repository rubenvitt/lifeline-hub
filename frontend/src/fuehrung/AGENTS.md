# Führungsfunktionen — Regeln

Gilt für `frontend/src/fuehrung/`, `src/fuehrung/` und jede Stelle, die eine Führungsfunktion
speichert oder anzeigt (Erinnerung, Auftragsempfänger, Führungsstelle, Meldung, ETB „An“); ergänzt
`frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`, sofern nicht `src/…` (Server).

**Führungsfunktionen** (LFH-549, `openspec/changes/archive/2026-09-30-lfh-549-funktionskatalog/design.md`):
geschlossener Katalog `fuehrung::Fuehrungsfunktion` (EL, S1–S7, Führungshilfspersonal, Fachberater;
`art` abgeleitet), Mandantenlabels und S7-Schalter in `org_fuehrungsfunktion`, Client liest nur
`GET /api/fuehrungsfunktionen` (keine zweite Labelliste). Erinnerung, Auftragsempfänger und
Führungsstelle tragen eine **Codespalte neben dem Text** (Text = Freitext ohne Code bzw.
Bezeichnung bei FHP/FB, Prüfung `fuehrung::pruefe_funktion`); die Meldung trägt
`empfaenger_funktion` ohne Bezeichnung, also nur EL und Sachgebiete (FHP/FB 422, LLH-1214), und
die Wahl füllt einen leeren Freitext mit dem Kürzel vor; **kein Rückschluss vom Freitext auf
einen Code**, auch nicht „S3“ (Kodierung `funktion:<code>` nur über `fuehrung/funktionsOptionenKern.ts`).
Der Snapshot trägt nur das Label, **nie einen Personennamen** (er steht im ETB); die Besetzung löst
der Server zur Lesezeit auf (`fuehrung::aufloesung`). ETB-Vorschlag: Führungsstelle → nichts
(`anVorbelegung`) ist nur der erste Vorschlag der Rufname-Abfrage, er belegt keinen Eintrag vor
(LFH-894, `etb/AGENTS.md`); `etb_eintrag.von`/`an` bleiben Freitext.

**Wer eine Funktion trägt, sagt allein die Mitgliedschaft** (i6k6mzed,
`openspec/changes/i6k6mzed-stab-herausnehmen/design.md` D2, D7): `einsatz_mitgliedschaft.fuehrungsfunktion`,
gepflegt als Führungsstelle im Reiter „Zugriff“ (`pages/MitgliederAbschnitt.tsx`). Eine zweite
Zuordnung „Funktion → Name“ gibt es nicht. Server: Auflösung (`fuehrung::aufloesung`), Empfänger
(`benachrichtigung::aufloesung`, EL zuerst der Einsatzleiter der Führungsstelle), Kopf
(`meine_funktion`/`meine_sachgebiete`, `einsatz::MeineFelder`), ETB-Snapshot (`einsatz::funktion`,
nur Kürzel bzw. Standardlabel, nie die Bezeichnung). Client: nur über
`fuehrung/besetzungAusMitgliedern.ts` aus `GET …/mitglieder` (Organigramm, Fernmeldeskizze,
Kommunikationsplan, Eigene Lage, Einsatzbericht, Empfängerfelder, Chat-Erwähnungen). Kein
Modulrecht: die Mitgliederliste liest jedes Mitglied. Mehrere Träger einer Funktion gelten alle,
Namen alphabetisch mit „, “ (`namensliste` hier und im Server). Gekoppelte Geräte bekommen keine
Auflösung, ein geschwärzter Einsatz keinen Namen (`einsatz.geschwaerzt_at`). Wire-Form
`AktuelleBesetzung`/`BesetzungsZustand` bleibt; erzeugt werden nur `personal` und `nicht_vergeben`.
Live: `PUT`/`DELETE …/mitglieder/…` verteilt `mitglieder` (Gate Einsatz-Lesezugriff) neben
`einsatz`; der Client invalidiert damit Mitglieder, Aufträge, Erinnerungen und Modulzähler.
