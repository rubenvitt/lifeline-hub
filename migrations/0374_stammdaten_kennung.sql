-- LLH-1633 (Stammdaten-Eingang): Kennung und Herkunft für Fahrzeuge, Personal und Qualifikationen.
-- Der Stammdaten-Import aus einer Datei findet ein Objekt über das Paar (Herkunft, Kennung) wieder
-- und legt es beim zweiten Lauf nicht noch einmal an. Eine Zuordnungstabelle statt Spalten an den
-- Stammtabellen: ein Objekt kann aus mehreren Quellen bekannt sein, und die Zuordnung einer
-- Qualifikation je Quelle liegt in derselben Tabelle. Entwurf: LLH-1633, Spec
-- `docs/superpowers/specs/2026-11-24-yd5yen5n-stammdaten-eingang-design.md`, Abschnitt „Datenmodell“.
--
-- Die Tabelle wird von der Instanzkopplung (LLH-1493) nicht verteilt; ein ELW sieht sie nicht.
--
-- Drei echte Fremdschlüssel statt Art + Ziel-Id, damit keine Waise entsteht; genau eines davon ist
-- gesetzt (CHECK). Fahrzeug und Personal halten fest (NO ACTION): Der Demo-Löschweg behält eine
-- verwiesene Zeile (demo::schema_tests::kein_fk_kaskadiert_in_stammdaten), und eine übernommene
-- Kennung zeigt echte Nutzung. Eine Qualifikation nimmt ihre Kennungen mit. Die Herkunft ist normalisiert (getrimmt, Kleinschreibung).
-- Die Org des Ziels muss gleich `org_id` sein; das prüft Rust beim Schreiben. Abgesichert von
-- db::tests::migration_0374_stammdaten_kennung.
CREATE TABLE stammdaten_kennung (
    id               INTEGER PRIMARY KEY,
    org_id           INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    herkunft         TEXT    NOT NULL,
    kennung          TEXT    NOT NULL,
    fahrzeug_id      INTEGER REFERENCES fahrzeug(id),
    personal_id      INTEGER REFERENCES personal(id),
    qualifikation_id INTEGER REFERENCES qualifikation(id) ON DELETE CASCADE,
    angelegt_at      TEXT    NOT NULL,
    CHECK ((fahrzeug_id IS NOT NULL) + (personal_id IS NOT NULL) + (qualifikation_id IS NOT NULL) = 1)
);

-- je Org, Art, Herkunft und Kennung höchstens ein Ziel
CREATE UNIQUE INDEX uq_stammdaten_kennung_fz ON stammdaten_kennung(org_id, herkunft, kennung) WHERE fahrzeug_id IS NOT NULL;
CREATE UNIQUE INDEX uq_stammdaten_kennung_p  ON stammdaten_kennung(org_id, herkunft, kennung) WHERE personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_stammdaten_kennung_q  ON stammdaten_kennung(org_id, herkunft, kennung) WHERE qualifikation_id IS NOT NULL;

-- je Fahrzeug bzw. Person und Herkunft höchstens eine Kennung; eine Qualifikation darf mehrere
-- Kennungen derselben Quelle tragen (Aliasse wie „San-A“ und „SanH“ → „Sanitäter“)
CREATE UNIQUE INDEX uq_stammdaten_kennung_fz_ziel ON stammdaten_kennung(herkunft, fahrzeug_id) WHERE fahrzeug_id IS NOT NULL;
CREATE UNIQUE INDEX uq_stammdaten_kennung_p_ziel  ON stammdaten_kennung(herkunft, personal_id) WHERE personal_id IS NOT NULL;
