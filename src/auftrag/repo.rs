use crate::error::AppError;
use crate::kommunikation::{repo as krepo, OBJEKT_AUFTRAG, VOLLZUG_IN_ARBEIT, VOLLZUG_VOLLZOGEN};
use sqlx::SqlitePool;

use super::{
    empfaenger_typ_gueltig, prioritaet_gueltig, AuftragAnzeige, AuftragDetail,
    AuftragEmpfaengerAnzeige,
};

/// Validierte Eingabe für eine Empfänger-Zeile (genau ein Ziel-Slot belegt).
#[derive(Debug, Clone)]
pub struct EmpfaengerEingabe {
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
    pub extern_kategorie: Option<String>,
    pub extern_bezeichnung: Option<String>,
}

/// Validierte Eingabe für einen neuen Auftrag (Handler hat getrimmt/normalisiert).
#[derive(Debug)]
pub struct AuftragDaten<'a> {
    pub auftrag_text: &'a str,
    pub absicht: Option<&'a str>,
    pub lage: Option<&'a str>,
    pub ort: Option<&'a str>,
    pub zeit: Option<&'a str>,
    pub mittel: Option<&'a str>,
    pub verbindung: Option<&'a str>,
    pub sicherheit: Option<&'a str>,
    pub prioritaet: &'a str,
    pub richtung: &'a str,
    pub frist_at: Option<&'a str>,
    pub erteilt_at: &'a str,
    pub empfaenger: Vec<EmpfaengerEingabe>,
}

/// Empfänger-Filter fürs Board (genau ein Ziel-Slot gesetzt).
#[derive(Debug, Default)]
pub struct EmpfaengerFilter {
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

impl EmpfaengerFilter {
    fn passt(&self, e: &AuftragEmpfaengerAnzeige) -> bool {
        if let Some(a) = self.abschnitt_id {
            return e.abschnitt_id == Some(a);
        }
        if let Some(u) = self.einheit_id {
            return e.einheit_id == Some(u);
        }
        true
    }
}

/// SELECT-Projektion inkl. Vollzugs-Achse (LEFT JOIN kommunikation_status),
/// Quittungs-Aggregat (Subquery auf auftrag_empfaenger) und abgeleiteten Feldern.
/// `jetzt` wird als ERSTER `?` gebunden (computed columns vor WHERE), dann WHERE.
const ANZEIGE_SELECT: &str =
    "SELECT a.id, a.einsatz_id, a.auftrag_text, a.absicht, a.lage, a.ort, a.zeit, a.mittel, \
            a.verbindung, a.sicherheit, a.prioritaet, a.richtung, a.frist_at, a.erteilt_at, a.in_arbeit_at, \
            a.vollzugsmeldung, a.abgenommen_at, a.abgenommen_von_id, a.etb_anordnung_id, \
            a.quell_etb_eintrag_id, \
            a.erstellt_von_id, a.erstellt_at, \
            COALESCE(ks.vollzug_status, 'offen') AS vollzug_status, \
            ks.vollzogen_at AS vollzogen_at, ks.vollzogen_von_id AS vollzogen_von_id, \
            (SELECT COUNT(*) FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id) AS empfaenger_anzahl, \
            (SELECT COUNT(*) FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id AND ae.quittiert_at IS NOT NULL) AS quittiert_anzahl, \
            (a.frist_at IS NOT NULL AND a.frist_at <= ? \
             AND EXISTS (SELECT 1 FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id AND ae.quittiert_at IS NULL)) AS ist_ueberfaellig, \
            CASE WHEN a.abgenommen_at IS NOT NULL THEN 'abgenommen' \
                 ELSE COALESCE(ks.vollzug_status, 'offen') END AS bearbeitungsstatus \
     FROM auftrag a \
     LEFT JOIN kommunikation_status ks ON ks.objekt_typ = 'auftrag' AND ks.objekt_id = a.id";

/// Lädt einen Auftrag samt Empfängern. `NotFound`, wenn unbekannt.
/// Bind-Reihenfolge: zuerst `jetzt` (computed column), dann `id` (WHERE).
pub async fn laden(pool: &SqlitePool, id: i64, jetzt: &str) -> Result<AuftragDetail, AppError> {
    let auftrag = sqlx::query_as::<_, AuftragAnzeige>(&format!("{ANZEIGE_SELECT} WHERE a.id = ?"))
        .bind(jetzt)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    let empfaenger = empfaenger_von(pool, id).await?;
    Ok(AuftragDetail { auftrag, empfaenger })
}

/// Lädt die Empfänger-Zeilen eines Auftrags (Quittung pro Empfänger).
pub async fn empfaenger_von(
    pool: &SqlitePool,
    auftrag_id: i64,
) -> Result<Vec<AuftragEmpfaengerAnzeige>, AppError> {
    sqlx::query_as::<_, AuftragEmpfaengerAnzeige>(
        "SELECT id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, \
                funktion_text, extern_kategorie, extern_bezeichnung, snap_anzeige, quittiert_at, quittiert_von_id \
         FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id",
    )
    .bind(auftrag_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Listet Aufträge eines Einsatzes (optional gefiltert nach Bearbeitungsstatus
/// und/oder Empfänger). Sortierung: Priorität (sofort→normal), dann Frist, dann ID.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
    richtung_filter: Option<&str>,
    empfaenger_filter: Option<&EmpfaengerFilter>,
    jetzt: &str,
) -> Result<Vec<AuftragDetail>, AppError> {
    let mut sql = format!("{ANZEIGE_SELECT} WHERE a.einsatz_id = ?");
    if richtung_filter.is_some() {
        sql.push_str(" AND a.richtung = ?");
    }
    sql.push_str(
        " ORDER BY CASE a.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
          a.frist_at IS NULL, a.frist_at, a.id",
    );
    // Bind-Reihenfolge: jetzt (computed) → einsatz_id → optional richtung.
    let mut q = sqlx::query_as::<_, AuftragAnzeige>(&sql).bind(jetzt).bind(einsatz_id);
    if let Some(r) = richtung_filter {
        q = q.bind(r);
    }
    let auftraege = q.fetch_all(pool).await?;

    let mut out = Vec::with_capacity(auftraege.len());
    for auftrag in auftraege {
        if let Some(s) = status_filter {
            if auftrag.bearbeitungsstatus != s {
                continue;
            }
        }
        let empfaenger = empfaenger_von(pool, auftrag.id).await?;
        if let Some(f) = empfaenger_filter {
            if !empfaenger.iter().any(|e| f.passt(e)) {
                continue;
            }
        }
        out.push(AuftragDetail { auftrag, empfaenger });
    }
    Ok(out)
}

/// Prüft, ob ein Auftrag zum Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM auftrag WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Setzt die Quittung einer Empfänger-Zeile (idempotent: hält den ersten Zeitstempel).
pub async fn quittiere_empfaenger(
    pool: &SqlitePool,
    empfaenger_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE auftrag_empfaenger \
         SET quittiert_at = COALESCE(quittiert_at, ?), quittiert_von_id = COALESCE(quittiert_von_id, ?) \
         WHERE id = ?",
    )
    .bind(jetzt)
    .bind(von_id)
    .bind(empfaenger_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Prüft, ob eine Empfänger-Zeile zum Auftrag gehört (Cross-Objekt-Schutz).
pub async fn empfaenger_gehoert_zu_auftrag(
    pool: &SqlitePool,
    empfaenger_id: i64,
    auftrag_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM auftrag_empfaenger WHERE id = ? AND auftrag_id = ?")
            .bind(empfaenger_id)
            .bind(auftrag_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Legt einen Auftrag inkl. Empfänger an und erzeugt im selben Commit den
/// ETB-Anordnungseintrag (Pattern B: anlegen_tx + Backlink auftrag_id auf BEIDEN
/// Seiten). Arbeitet auf einer offenen Verbindung/Transaktion und committet NICHT
/// selbst — so kann ein Aufrufer (z. B. die Chat-Heraufstufung, LFH-101) im selben
/// Commit weitere Rückverweise setzen. Liefert die neue `auftrag_id`. `daten` ist
/// vom Handler validiert (auftrag_text + >=1 Empfänger, Slots/Zugehörigkeit geprüft).
pub async fn anlegen_tx(
    tx: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: &AuftragDaten<'_>,
) -> Result<i64, AppError> {
    debug_assert!(prioritaet_gueltig(daten.prioritaet));
    debug_assert!(super::richtung_gueltig(daten.richtung));

    let auftrag_id: i64 = sqlx::query_scalar(
        "INSERT INTO auftrag \
           (einsatz_id, auftrag_text, absicht, lage, ort, zeit, mittel, verbindung, sicherheit, \
            prioritaet, richtung, frist_at, erteilt_at, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.auftrag_text)
    .bind(daten.absicht)
    .bind(daten.lage)
    .bind(daten.ort)
    .bind(daten.zeit)
    .bind(daten.mittel)
    .bind(daten.verbindung)
    .bind(daten.sicherheit)
    .bind(daten.prioritaet)
    .bind(daten.richtung)
    .bind(daten.frist_at)
    .bind(daten.erteilt_at)
    .bind(ersteller_id)
    .fetch_one(&mut *tx)
    .await?;

    for e in &daten.empfaenger {
        debug_assert!(empfaenger_typ_gueltig(&e.empfaenger_typ));
        let snap = snap_anzeige_fuer(&mut *tx, e).await?;
        sqlx::query(
            "INSERT INTO auftrag_empfaenger \
               (auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, funktion_text, \
                extern_kategorie, extern_bezeichnung, snap_anzeige) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(auftrag_id)
        .bind(&e.empfaenger_typ)
        .bind(e.abschnitt_id)
        .bind(e.einheit_id)
        .bind(e.person_id)
        .bind(e.fahrzeug_id)
        .bind(e.funktion_text.as_deref())
        .bind(e.extern_kategorie.as_deref())
        .bind(e.extern_bezeichnung.as_deref())
        .bind(&snap)
        .execute(&mut *tx)
        .await?;
    }

    // ETB-Anordnung (Pattern B): erst NACH den Inserts, im selben Commit.
    let an = empfaenger_klartext(&daten.empfaenger, &mut *tx).await?;
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *tx,
        einsatz_id,
        ersteller_id,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_ANORDNUNG,
            inhalt: daten.auftrag_text,
            von: None,
            an: Some(&an),
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(daten.erteilt_at),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    sqlx::query("UPDATE etb_eintrag SET auftrag_id = ? WHERE id = ?")
        .bind(auftrag_id)
        .bind(etb_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE auftrag SET etb_anordnung_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(auftrag_id)
        .execute(&mut *tx)
        .await?;

    Ok(auftrag_id)
}

/// Legt einen Auftrag an (eigener Commit) und liefert das Detail. Dünner Wrapper
/// um [`anlegen_tx`].
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: AuftragDaten<'_>,
    jetzt: &str,
) -> Result<AuftragDetail, AppError> {
    let mut tx = pool.begin().await?;
    let auftrag_id = anlegen_tx(&mut tx, einsatz_id, ersteller_id, &daten).await?;
    tx.commit().await?;
    laden(pool, auftrag_id, jetzt).await
}

/// Erteilt aus einem ETB-Eintrag einen Auftrag (ETB→Auftrag, LFH-112) — in EINEM Commit:
/// legt den Auftrag inkl. seiner ETB-Anordnung an (`anlegen_tx`, Pattern B) und setzt am
/// ERZEUGTEN Auftrag den Rückbezug `quell_etb_eintrag_id` auf den Quell-Eintrag. Anders als
/// Meldung→Auftrag gibt es hier KEINEN first-write-wins-Guard: die Link-Spalte sitzt auf dem
/// Auftrag, nicht auf der einwertigen Quelle — ein ETB-Eintrag darf mehrere Aufträge auslösen.
/// `etb_anordnung_id` (vom Auftrag erzeugt) und `quell_etb_eintrag_id` (Quelle) sind verschieden.
/// `daten` ist vom Handler validiert; `quell_etb_eintrag_id` muss zum Einsatz gehören (Guard).
pub async fn erteile_aus_etb_tx(
    pool: &SqlitePool,
    einsatz_id: i64,
    quell_etb_eintrag_id: i64,
    erteiler_id: i64,
    daten: AuftragDaten<'_>,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    let auftrag_id = anlegen_tx(&mut tx, einsatz_id, erteiler_id, &daten).await?;
    sqlx::query("UPDATE auftrag SET quell_etb_eintrag_id = ? WHERE id = ?")
        .bind(quell_etb_eintrag_id)
        .bind(auftrag_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(auftrag_id)
}

/// Ermittelt den Anzeigenamen einer Empfänger-Zeile (snap zum Erfassungszeitpunkt).
/// EA/Einheit/Person/Fahrzeug → Name aus der jeweiligen Tabelle; Funktion → Freitext.
async fn snap_anzeige_fuer(
    tx: &mut sqlx::SqliteConnection,
    e: &EmpfaengerEingabe,
) -> Result<String, AppError> {
    let name: Option<String> = match e.empfaenger_typ.as_str() {
        "abschnitt" => sqlx::query_scalar("SELECT name FROM einsatzabschnitt WHERE id = ?")
            .bind(e.abschnitt_id)
            .fetch_optional(&mut *tx)
            .await?,
        "einheit" => sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ?")
            .bind(e.einheit_id)
            .fetch_optional(&mut *tx)
            .await?,
        "person" => sqlx::query_scalar("SELECT snap_name FROM einsatz_personal WHERE id = ?")
            .bind(e.person_id)
            .fetch_optional(&mut *tx)
            .await?,
        "fahrzeug" => sqlx::query_scalar("SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ?")
            .bind(e.fahrzeug_id)
            .fetch_optional(&mut *tx)
            .await?,
        "extern" => e.extern_bezeichnung.clone(),
        _ => e.funktion_text.clone(),
    };
    Ok(name
        .or_else(|| e.funktion_text.clone())
        .or_else(|| e.extern_bezeichnung.clone())
        .unwrap_or_else(|| "—".to_string()))
}

/// Empfänger als ETB-`an`-Klartext, kommagetrennt.
async fn empfaenger_klartext(
    empf: &[EmpfaengerEingabe],
    tx: &mut sqlx::SqliteConnection,
) -> Result<String, AppError> {
    let mut teile = Vec::with_capacity(empf.len());
    for e in empf {
        teile.push(snap_anzeige_fuer(&mut *tx, e).await?);
    }
    Ok(teile.join(", "))
}

/// Setzt Vollzug → 'in_arbeit' (geteilte Achse) und hält den Zeitstempel am Auftrag.
pub async fn setze_in_arbeit(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    krepo::setze_vollzug(pool, org_id, einsatz_id, OBJEKT_AUFTRAG, auftrag_id, VOLLZUG_IN_ARBEIT, von_id, jetzt).await?;
    sqlx::query("UPDATE auftrag SET in_arbeit_at = COALESCE(in_arbeit_at, ?) WHERE id = ?")
        .bind(jetzt)
        .bind(auftrag_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Meldet Vollzug: Rückmeldetext am Auftrag, Vollzug-Achse → 'vollzogen' und ein
/// ETB-Folgeeintrag (typ='meldung', gemeinsames auftrag_id). Liefert die ETB-`id`.
pub async fn melde_vollzug(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    vollzugsmeldung: &str,
    jetzt: &str,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE auftrag SET vollzugsmeldung = ? WHERE id = ?")
        .bind(vollzugsmeldung)
        .bind(auftrag_id)
        .execute(&mut *tx)
        .await?;
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        von_id,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_MELDUNG,
            inhalt: vollzugsmeldung,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(jetzt),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    sqlx::query("UPDATE etb_eintrag SET auftrag_id = ? WHERE id = ?")
        .bind(auftrag_id)
        .bind(etb_id)
        .execute(&mut *tx)
        .await?;
    // Vollzug-Achse im SELBEN Commit wie ETB-Meldung + Rückmeldetext (atomar):
    // ein Teilfehler rollt alles zurück, kein verwaister ETB-Eintrag.
    krepo::setze_vollzug_tx(&mut tx, org_id, einsatz_id, OBJEKT_AUFTRAG, auftrag_id, VOLLZUG_VOLLZOGEN, von_id, jetzt).await?;
    tx.commit().await?;
    Ok(etb_id)
}

/// Abnahme durch die Führung (4. Stufe). Setzt abgenommen_at/_von_id am Auftrag.
/// Idempotent (first-write-wins via `abgenommen_at IS NULL`) — eine bereits
/// erfolgte Abnahme (Zeitstempel + verantwortliche Person) bleibt unveränderlich.
pub async fn nimm_ab(pool: &SqlitePool, auftrag_id: i64, von_id: i64, jetzt: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE auftrag SET abgenommen_at = ?, abgenommen_von_id = ? WHERE id = ? AND abgenommen_at IS NULL")
        .bind(jetzt)
        .bind(von_id)
        .bind(auftrag_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kommunikation::{repo as krepo, OBJEKT_AUFTRAG, VOLLZUG_VOLLZOGEN};

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    fn daten<'a>(
        text: &'a str,
        frist: Option<&'a str>,
        empf: Vec<EmpfaengerEingabe>,
    ) -> AuftragDaten<'a> {
        AuftragDaten {
            auftrag_text: text,
            absicht: None,
            lage: None,
            ort: None,
            zeit: None,
            mittel: None,
            verbindung: None,
            sicherheit: None,
            prioritaet: super::super::PRIO_NORMAL,
            richtung: super::super::RICHTUNG_INTERN,
            frist_at: frist,
            erteilt_at: "2026-06-11 09:00:00",
            empfaenger: empf,
        }
    }

    fn funktion(t: &str) -> EmpfaengerEingabe {
        EmpfaengerEingabe {
            empfaenger_typ: "funktion".into(),
            abschnitt_id: None,
            einheit_id: None,
            person_id: None,
            fahrzeug_id: None,
            funktion_text: Some(t.into()),
            extern_kategorie: None,
            extern_bezeichnung: None,
        }
    }

    fn extern_empf(kat: &str, bez: &str) -> EmpfaengerEingabe {
        EmpfaengerEingabe {
            empfaenger_typ: "extern".into(),
            abschnitt_id: None,
            einheit_id: None,
            person_id: None,
            fahrzeug_id: None,
            funktion_text: None,
            extern_kategorie: Some(kat.into()),
            extern_bezeichnung: Some(bez.into()),
        }
    }

    /// Wie `daten`, aber mit frei wählbarer Priorität (für Sortier-Tests).
    fn daten_prio<'a>(
        text: &'a str,
        prio: &'a str,
        frist: Option<&'a str>,
        empf: Vec<EmpfaengerEingabe>,
    ) -> AuftragDaten<'a> {
        AuftragDaten {
            prioritaet: prio,
            ..daten(text, frist, empf)
        }
    }

    #[tokio::test]
    async fn anlegen_speichert_auftrag_mit_empfaenger_und_default_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("Deich sichern", None, vec![funktion("Abschnitt Nord")]), "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(d.auftrag.auftrag_text, "Deich sichern");
        assert_eq!(d.auftrag.vollzug_status, "offen");
        assert_eq!(d.auftrag.bearbeitungsstatus, "offen");
        assert_eq!(d.auftrag.empfaenger_anzahl, 1);
        assert_eq!(d.auftrag.quittiert_anzahl, 0);
        assert_eq!(d.empfaenger.len(), 1);
        assert_eq!(d.empfaenger[0].snap_anzeige, "Abschnitt Nord");
        assert!(d.auftrag.etb_anordnung_id.is_some(), "ETB-Anordnung wird erzeugt");
    }

    #[tokio::test]
    async fn anlegen_erzeugt_etb_anordnung_mit_backlink() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("Lage erkunden", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        let etb_id = d.auftrag.etb_anordnung_id.unwrap();
        let typ: String = sqlx::query_scalar("SELECT typ FROM etb_eintrag WHERE id = ?").bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(typ, "anordnung");
        let backlink: i64 = sqlx::query_scalar("SELECT auftrag_id FROM etb_eintrag WHERE id = ?").bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(backlink, d.auftrag.id);
    }

    #[tokio::test]
    async fn liste_liefert_auftraege_mit_empfaenger() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("A", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        anlegen(&pool, e, b, daten("B", None, vec![funktion("EA2")]), "2026-06-11 09:00:00").await.unwrap();
        let liste = liste(&pool, e, None, None, None, "2026-06-11 10:00:00").await.unwrap();
        assert_eq!(liste.len(), 2);
        assert!(liste.iter().all(|d| d.empfaenger.len() == 1));
    }

    #[tokio::test]
    async fn ueberfaellig_wenn_frist_ueberschritten_und_unquittiert() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("Frist", Some("2026-06-11 10:00:00"), vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        let vor = laden(&pool, d.auftrag.id, "2026-06-11 09:30:00").await.unwrap();
        assert!(!vor.auftrag.ist_ueberfaellig, "vor Frist nicht überfällig");
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:30:00").await.unwrap();
        assert!(nach.auftrag.ist_ueberfaellig, "nach Frist + unquittiert: überfällig");
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        assert!(gehoert_zu_einsatz(&pool, d.auftrag.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, d.auftrag.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn bearbeitungsstatus_spiegelt_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        krepo::setze_vollzug(&pool, 1, e, OBJEKT_AUFTRAG, d.auftrag.id, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 11:30:00").await.unwrap();
        assert_eq!(nach.auftrag.vollzug_status, "vollzogen");
        assert_eq!(nach.auftrag.bearbeitungsstatus, "vollzogen");
    }

    #[tokio::test]
    async fn quittieren_setzt_nur_quittung_nicht_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1"), funktion("EA2")]), "2026-06-11 09:00:00").await.unwrap();
        let empf1 = d.empfaenger[0].id;

        quittiere_empfaenger(&pool, empf1, b, "2026-06-11 10:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:01:00").await.unwrap();
        assert_eq!(nach.auftrag.quittiert_anzahl, 1, "ein Empfänger quittiert");
        assert_eq!(nach.auftrag.empfaenger_anzahl, 2);
        assert_eq!(nach.auftrag.vollzug_status, "offen", "Quittung ändert Vollzug nicht");
        assert_eq!(nach.auftrag.bearbeitungsstatus, "offen");
        let e1 = nach.empfaenger.iter().find(|x| x.id == empf1).unwrap();
        assert_eq!(e1.quittiert_at.as_deref(), Some("2026-06-11 10:00:00"));
        assert_eq!(e1.quittiert_von_id, Some(b));
    }

    #[tokio::test]
    async fn empfaenger_gehoert_zu_auftrag_schuetzt() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        assert!(empfaenger_gehoert_zu_auftrag(&pool, d.empfaenger[0].id, d.auftrag.id).await.unwrap());
        assert!(!empfaenger_gehoert_zu_auftrag(&pool, d.empfaenger[0].id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn in_arbeit_setzt_zeitstempel_und_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        setze_in_arbeit(&pool, 1, e, d.auftrag.id, b, "2026-06-11 10:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:01:00").await.unwrap();
        assert_eq!(nach.auftrag.bearbeitungsstatus, "in_arbeit");
        assert_eq!(nach.auftrag.in_arbeit_at.as_deref(), Some("2026-06-11 10:00:00"));
    }

    #[tokio::test]
    async fn melde_vollzug_setzt_text_status_und_etb_meldung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        let etb_id = melde_vollzug(&pool, 1, e, d.auftrag.id, b, "Deich gehalten", "2026-06-11 11:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 11:01:00").await.unwrap();
        assert_eq!(nach.auftrag.bearbeitungsstatus, "vollzogen");
        assert_eq!(nach.auftrag.vollzugsmeldung.as_deref(), Some("Deich gehalten"));
        let (typ, backlink): (String, i64) = sqlx::query_as("SELECT typ, auftrag_id FROM etb_eintrag WHERE id = ?")
            .bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(backlink, d.auftrag.id);
    }

    #[tokio::test]
    async fn nimm_ab_setzt_abnahme_nach_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        melde_vollzug(&pool, 1, e, d.auftrag.id, b, "fertig", "2026-06-11 11:00:00").await.unwrap();
        nimm_ab(&pool, d.auftrag.id, b, "2026-06-11 12:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 12:01:00").await.unwrap();
        assert_eq!(nach.auftrag.bearbeitungsstatus, "abgenommen");
        assert_eq!(nach.auftrag.abgenommen_von_id, Some(b));
    }

    #[tokio::test]
    async fn liste_sortiert_nach_prio_dann_frist() {
        use super::super::{PRIO_DRINGEND, PRIO_NORMAL, PRIO_SOFORT};
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // In gemischter Reihenfolge anlegen → erzwingt echtes ORDER BY (nicht Insert-Reihenfolge).
        // Erwartete Sortierung: sofort, dringend, dann drei 'normal' nach frist_at
        // (frühere Frist vor späterer, NULL-Frist zuletzt).
        anlegen(&pool, e, b, daten_prio("normal-spaet", PRIO_NORMAL, Some("2026-06-11 12:00:00"), vec![funktion("EA")]), "2026-06-11 09:00:00").await.unwrap();
        anlegen(&pool, e, b, daten_prio("normal-ohne", PRIO_NORMAL, None, vec![funktion("EA")]), "2026-06-11 09:00:00").await.unwrap();
        anlegen(&pool, e, b, daten_prio("sofort", PRIO_SOFORT, None, vec![funktion("EA")]), "2026-06-11 09:00:00").await.unwrap();
        anlegen(&pool, e, b, daten_prio("normal-frueh", PRIO_NORMAL, Some("2026-06-11 10:00:00"), vec![funktion("EA")]), "2026-06-11 09:00:00").await.unwrap();
        anlegen(&pool, e, b, daten_prio("dringend", PRIO_DRINGEND, None, vec![funktion("EA")]), "2026-06-11 09:00:00").await.unwrap();

        let liste = liste(&pool, e, None, None, None, "2026-06-11 09:30:00").await.unwrap();
        let reihenfolge: Vec<&str> = liste.iter().map(|d| d.auftrag.auftrag_text.as_str()).collect();
        assert_eq!(
            reihenfolge,
            vec!["sofort", "dringend", "normal-frueh", "normal-spaet", "normal-ohne"]
        );
    }

    #[tokio::test]
    async fn ueberfaellig_false_wenn_alle_quittiert() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("Frist", Some("2026-06-11 10:00:00"), vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        // Einzigen Empfänger quittieren → EXISTS(unquittiert) wird leer.
        quittiere_empfaenger(&pool, d.empfaenger[0].id, b, "2026-06-11 09:30:00").await.unwrap();
        // Laden NACH der Frist: nicht überfällig, weil alle quittiert.
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:30:00").await.unwrap();
        assert!(!nach.auftrag.ist_ueberfaellig, "alle quittiert → nicht überfällig trotz überschrittener Frist");
    }

    #[tokio::test]
    async fn richtung_default_intern_und_liste_filtert_extern() {
        use super::super::RICHTUNG_EXTERN;
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d_int = anlegen(&pool, e, b, daten("intern-a", None, vec![funktion("EA")]), "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(d_int.auftrag.richtung, "intern", "Default intern");
        let ext = AuftragDaten { richtung: RICHTUNG_EXTERN, ..daten("extern-a", None, vec![funktion("Leitstelle")]) };
        anlegen(&pool, e, b, ext, "2026-06-11 09:00:00").await.unwrap();

        let nur_extern = liste(&pool, e, None, Some("extern"), None, "2026-06-11 10:00:00").await.unwrap();
        assert_eq!(nur_extern.len(), 1);
        assert_eq!(nur_extern[0].auftrag.richtung, "extern");
        assert_eq!(nur_extern[0].auftrag.auftrag_text, "extern-a");
    }

    #[tokio::test]
    async fn erteile_aus_etb_setzt_quell_und_anordnung_verschieden() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Quell-ETB-Eintrag, aus dem der Auftrag erteilt wird.
        let quell_etb = crate::etb::repo::anlegen(
            &pool, e, b,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_MELDUNG,
                inhalt: "Deich instabil — Auftrag nötig",
                von: None, an: None, meldeweg: None, veranlassung: None,
                ereigniszeit: None, erfasst_lokal_at: None, berichtigt_eintrag_id: None,
            },
        ).await.unwrap();

        let auftrag_id = erteile_aus_etb_tx(
            &pool, e, quell_etb.id, b, daten("Deich sichern", None, vec![funktion("EA1")]),
        ).await.unwrap();

        let detail = laden(&pool, auftrag_id, "2026-06-11 10:00:00").await.unwrap();
        // Quell-Bezug auf den auslösenden Eintrag gesetzt.
        assert_eq!(detail.auftrag.quell_etb_eintrag_id, Some(quell_etb.id));
        // Eigene Anordnung im selben Commit erzeugt (Pattern B) …
        assert!(detail.auftrag.etb_anordnung_id.is_some());
        // … und VERSCHIEDEN vom Quell-Eintrag (getrennte Spalten, keine Heraufstufung der Quelle).
        assert_ne!(detail.auftrag.etb_anordnung_id, detail.auftrag.quell_etb_eintrag_id);
        assert_eq!(detail.auftrag.auftrag_text, "Deich sichern");
    }

    #[tokio::test]
    async fn erteile_aus_etb_mehrfach_aus_einem_eintrag_erlaubt() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let quell_etb = crate::etb::repo::anlegen(
            &pool, e, b,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_MELDUNG, inhalt: "Lage", von: None, an: None,
                meldeweg: None, veranlassung: None, ereigniszeit: None,
                erfasst_lokal_at: None, berichtigt_eintrag_id: None,
            },
        ).await.unwrap();
        // Anders als Meldung→Auftrag: ein ETB-Eintrag darf mehrere Aufträge auslösen (kein Conflict).
        let a1 = erteile_aus_etb_tx(&pool, e, quell_etb.id, b, daten("erster", None, vec![funktion("EA1")])).await.unwrap();
        let a2 = erteile_aus_etb_tx(&pool, e, quell_etb.id, b, daten("zweiter", None, vec![funktion("EA2")])).await.unwrap();
        assert_ne!(a1, a2);
        let d1 = laden(&pool, a1, "2026-06-11 10:00:00").await.unwrap();
        let d2 = laden(&pool, a2, "2026-06-11 10:00:00").await.unwrap();
        assert_eq!(d1.auftrag.quell_etb_eintrag_id, Some(quell_etb.id));
        assert_eq!(d2.auftrag.quell_etb_eintrag_id, Some(quell_etb.id));
    }

    #[tokio::test]
    async fn externer_adressat_wird_gespeichert_und_snap_aus_bezeichnung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("an Leitstelle", None, vec![extern_empf("leitstelle", "Leitstelle Nord")]), "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(d.empfaenger.len(), 1);
        let empf = &d.empfaenger[0];
        assert_eq!(empf.empfaenger_typ, "extern");
        assert_eq!(empf.extern_kategorie.as_deref(), Some("leitstelle"));
        assert_eq!(empf.extern_bezeichnung.as_deref(), Some("Leitstelle Nord"));
        assert_eq!(empf.snap_anzeige, "Leitstelle Nord", "snap aus Bezeichnung");
    }
}
