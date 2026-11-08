-- LLH-1576: Zwei Demo-Lagen nebeneinander (Change oyqhesy9-demo-lage-stadtfest, design.md D1,
-- Spec demo-daten „Zwei Demo-Lagen nebeneinander“). Jeder Import-Kopf nennt seine Lage;
-- höchstens ein aktiver Kopf je Organisation UND Lage. Bestand (aktiv wie Historie) war die
-- einzige Lage, „starkregen“.
--
-- ADD COLUMN mit konstantem DEFAULT und CHECK braucht keinen Rebuild. Der partielle Index wird
-- unter demselben Namen auf (org_id, szenario) neu gebaut; `demo_herkunft` bleibt unverändert,
-- weil die Lagen getrennte Stammdaten-Kennungen tragen (design.md D2).
-- Abgesichert von db::tests::migration_0290_demo_import_szenario.

ALTER TABLE demo_import ADD COLUMN szenario TEXT NOT NULL DEFAULT 'starkregen'
    CHECK (szenario IN ('starkregen', 'stadtfest'));

DROP INDEX idx_demo_import_aktiv;

CREATE UNIQUE INDEX idx_demo_import_aktiv ON demo_import(org_id, szenario)
    WHERE entfernt_at IS NULL;
