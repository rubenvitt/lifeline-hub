# Führungsfunktionen — Regeln

Gilt für `frontend/src/fuehrung/`, `src/fuehrung/` und jede Stelle, die eine Führungsfunktion
speichert oder anzeigt (Erinnerung, Auftragsempfänger, Führungsstelle, ETB „An“); ergänzt
`frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`, sofern nicht `src/…` (Server).

**Führungsfunktionen** (LFH-549, `openspec/changes/archive/2026-09-30-lfh-549-funktionskatalog/design.md`):
geschlossener Katalog `fuehrung::Fuehrungsfunktion` (EL, S1–S7, Führungshilfspersonal, Fachberater;
`art` abgeleitet), Mandantenlabels und S7-Schalter in `org_fuehrungsfunktion`, Client liest nur
`GET /api/fuehrungsfunktionen` (keine zweite Labelliste). Erinnerung, Auftragsempfänger und
Führungsstelle tragen eine **Codespalte neben dem Text** (Text = Freitext ohne Code bzw.
Bezeichnung bei FHP/FB, Prüfung `fuehrung::pruefe_funktion`); **kein Rückschluss vom Freitext auf
einen Code**, auch nicht „S3“ (Kodierung `funktion:<code>` nur über `fuehrung/funktionsOptionenKern.ts`).
Der Snapshot trägt nur das Label, **nie einen Personennamen** (Retain vs. Scrub); die Besetzung löst
der Server zur Lesezeit auf (`fuehrung::aufloesung`, nur mit Stab-Recht, `stab`-Ereignis invalidiert
Aufträge und Erinnerungen). ETB-Vorbelegung „An“: Führungsstelle → erstes eigenes Sachgebiet → nichts
(`anVorbelegung`); `etb_eintrag.von`/`an` bleiben Freitext.
