use super::FreiesZeichenAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Felder zum Anlegen eines freien Zeichens (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct ZeichenNeu<'a> {
    pub lat: f64,
    pub lon: f64,
    pub grundzeichen: &'a str,
    pub organisation: Option<&'a str>,
    pub fachaufgabe: Option<&'a str>,
    pub symbol: Option<&'a str>,
    pub einheit: Option<&'a str>,
    pub funktion: Option<&'a str>,
    pub farbe: Option<&'a str>,
    pub label: Option<&'a str>,
    pub erstellt_von: i64,
}

/// Teil-Patch eines freien Zeichens (LFH-306, Tri-State): die äußere `Option` sagt
/// „im Patch enthalten?" — `None` lässt die Spalte unverändert. Bei den nullable
/// Overlay-Spalten trägt der Wert selbst noch eine `Option`: `Some(None)` setzt sie auf NULL.
/// `grundzeichen` ist NOT NULL und daher nur einfach optional (absent = unverändert).
/// lat/lon sind NICHT verschiebbar (v1) und daher NICHT Teil des Updates.
#[derive(Debug, Default)]
pub struct ZeichenPatch<'a> {
    pub grundzeichen: Option<&'a str>,
    pub organisation: Option<Option<&'a str>>,
    pub fachaufgabe: Option<Option<&'a str>>,
    pub symbol: Option<Option<&'a str>>,
    pub einheit: Option<Option<&'a str>>,
    pub funktion: Option<Option<&'a str>>,
    pub farbe: Option<Option<&'a str>>,
    pub label: Option<Option<&'a str>>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, lat, lon, grundzeichen, organisation, fachaufgabe, symbol, \
           einheit, funktion, farbe, label, erstellt_von, erstellt_at, geaendert_at \
    FROM freies_zeichen";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    lat: f64,
    lon: f64,
    grundzeichen: String,
    organisation: Option<String>,
    fachaufgabe: Option<String>,
    symbol: Option<String>,
    einheit: Option<String>,
    funktion: Option<String>,
    farbe: Option<String>,
    label: Option<String>,
    erstellt_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> FreiesZeichenAnzeige {
    FreiesZeichenAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        lat: r.lat,
        lon: r.lon,
        grundzeichen: r.grundzeichen,
        organisation: r.organisation,
        fachaufgabe: r.fachaufgabe,
        symbol: r.symbol,
        einheit: r.einheit,
        funktion: r.funktion,
        farbe: r.farbe,
        label: r.label,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle freien Zeichen eines Einsatzes, älteste zuerst.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<FreiesZeichenAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Lädt ein Zeichen; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<FreiesZeichenAnzeige, AppError> {
    sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .map(zu_anzeige)
    .ok_or(AppError::NotFound)
}

/// Legt ein Zeichen an (Felder bereits validiert). Liefert die Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: ZeichenNeu<'_>,
) -> Result<FreiesZeichenAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO freies_zeichen \
            (einsatz_id, lat, lon, grundzeichen, organisation, fachaufgabe, symbol, \
             einheit, funktion, farbe, label, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.lat)
    .bind(daten.lon)
    .bind(daten.grundzeichen)
    .bind(daten.organisation)
    .bind(daten.fachaufgabe)
    .bind(daten.symbol)
    .bind(daten.einheit)
    .bind(daten.funktion)
    .bind(daten.farbe)
    .bind(daten.label)
    .bind(daten.erstellt_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Teil-Patch der TZ-Overlays + label + grundzeichen (LFH-306); `geaendert_at` wird immer
/// nachgezogen. lat/lon bleiben UNVERÄNDERT (kein Verschieben in v1). `NotFound`, falls
/// fremd/unbekannt.
///
/// Flag/Wert-Paare statt Vollersatz: erst so lässt ein `{"label":"X"}`-Patch die sieben
/// Overlays stehen, statt sie stillschweigend zu nullen — und `null` bleibt trotzdem als
/// Leerwunsch verfügbar. Die Parameter sind nummeriert, weil eine um eine Position
/// verschobene Bind-Kette die gleichtypigen Nachbarspalten (`organisation`↔`fachaufgabe`)
/// STILL vertauschen würde — abgesichert von `patche_setzt_jede_spalte_an_ihren_platz`.
pub async fn patche(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    patch: ZeichenPatch<'_>,
) -> Result<FreiesZeichenAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE freies_zeichen SET \
            grundzeichen = CASE WHEN ?1 IS NULL THEN grundzeichen ELSE ?2 END, \
            organisation = CASE WHEN ?3 IS NULL THEN organisation ELSE ?4 END, \
            fachaufgabe = CASE WHEN ?5 IS NULL THEN fachaufgabe ELSE ?6 END, \
            symbol = CASE WHEN ?7 IS NULL THEN symbol ELSE ?8 END, \
            einheit = CASE WHEN ?9 IS NULL THEN einheit ELSE ?10 END, \
            funktion = CASE WHEN ?11 IS NULL THEN funktion ELSE ?12 END, \
            farbe = CASE WHEN ?13 IS NULL THEN farbe ELSE ?14 END, \
            label = CASE WHEN ?15 IS NULL THEN label ELSE ?16 END, \
            geaendert_at = datetime('now') \
         WHERE id = ?17 AND einsatz_id = ?18",
    )
    .bind(patch.grundzeichen.map(|_| 1_i64))
    .bind(patch.grundzeichen)
    .bind(patch.organisation.map(|_| 1_i64))
    .bind(patch.organisation.and_then(|v| v))
    .bind(patch.fachaufgabe.map(|_| 1_i64))
    .bind(patch.fachaufgabe.and_then(|v| v))
    .bind(patch.symbol.map(|_| 1_i64))
    .bind(patch.symbol.and_then(|v| v))
    .bind(patch.einheit.map(|_| 1_i64))
    .bind(patch.einheit.and_then(|v| v))
    .bind(patch.funktion.map(|_| 1_i64))
    .bind(patch.funktion.and_then(|v| v))
    .bind(patch.farbe.map(|_| 1_i64))
    .bind(patch.farbe.and_then(|v| v))
    .bind(patch.label.map(|_| 1_i64))
    .bind(patch.label.and_then(|v| v))
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Hard-Delete. `NotFound`, falls nicht zum Einsatz.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    laden(pool, einsatz_id, id).await?;
    sqlx::query("DELETE FROM freies_zeichen WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org + Benutzer + Einsatz; liefert (einsatz_id, benutzer_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, benutzername, passwort_hash, anzeigename) \
             VALUES (1, 'tester', 'x', 'Tester') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, benutzer)
    }

    fn neu(von: i64) -> ZeichenNeu<'static> {
        ZeichenNeu {
            lat: 50.1,
            lon: 8.6,
            grundzeichen: "einheit",
            organisation: Some("feuerwehr"),
            fachaufgabe: Some("brandbekaempfung"),
            symbol: None,
            einheit: Some("zug"),
            funktion: None,
            farbe: Some("#ff0000"),
            label: Some("A"),
            erstellt_von: von,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert_eq!(z.einsatz_id, einsatz);
        assert_eq!(z.grundzeichen, "einheit");
        assert_eq!(z.organisation.as_deref(), Some("feuerwehr"));
        assert_eq!(z.lat, 50.1);
        assert_eq!(z.lon, 8.6);
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, z);
    }

    #[tokio::test]
    async fn liste_ordnet_nach_id() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let b = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let liste = liste(&pool, einsatz).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].id, a.id);
        assert_eq!(liste[1].id, b.id);
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert!(matches!(
            laden(&pool, 999, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    /// Migriert von `aktualisiere_whole_spec_haelt_lat_lon` (LFH-306): ein **Vollbody**
    /// (jedes Feld gesendet, die Leerwünsche explizit als `Some(None)`) verhält sich
    /// weiterhin exakt wie der frühere Vollersatz — und lat/lon bleiben unberührt.
    #[tokio::test]
    async fn patche_whole_spec_haelt_lat_lon() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let n = patche(
            &pool,
            einsatz,
            z.id,
            ZeichenPatch {
                grundzeichen: Some("fahrzeug"),
                organisation: Some(Some("thw")),
                fachaufgabe: Some(None),
                symbol: Some(Some("kran")),
                einheit: Some(None),
                funktion: Some(Some("zugtrupp")),
                farbe: Some(None),
                label: Some(Some("B")),
            },
        )
        .await
        .unwrap();
        // Neue Overlay-Werte übernommen …
        assert_eq!(n.grundzeichen, "fahrzeug");
        assert_eq!(n.organisation.as_deref(), Some("thw"));
        assert_eq!(n.symbol.as_deref(), Some("kran"));
        assert_eq!(n.funktion.as_deref(), Some("zugtrupp"));
        assert_eq!(n.label.as_deref(), Some("B"));
        // … explizit geleerte Felder auf NULL …
        assert_eq!(n.fachaufgabe, None);
        assert_eq!(n.einheit, None);
        assert_eq!(n.farbe, None);
        // … lat/lon UNVERÄNDERT.
        assert_eq!(n.lat, z.lat);
        assert_eq!(n.lon, z.lon);
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, n);
    }

    /// Bind-Reihenfolge der Flag/Wert-Kette: alle acht Spalten in EINEM Patch auf distinkte
    /// Werte setzen und einzeln prüfen. Eine um eine Position verschobene Kette würde die
    /// gleichtypigen Nachbarn (`organisation`↔`fachaufgabe`↔`symbol`…) still vertauschen —
    /// ohne Compile- und ohne Laufzeitfehler.
    #[tokio::test]
    async fn patche_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let n = patche(
            &pool,
            einsatz,
            z.id,
            ZeichenPatch {
                grundzeichen: Some("stelle"),
                organisation: Some(Some("thw")),
                fachaufgabe: Some(Some("bergung")),
                symbol: Some(Some("kran")),
                einheit: Some(Some("gruppe")),
                funktion: Some(Some("zugtrupp")),
                farbe: Some(Some("#00ff00")),
                label: Some(Some("B")),
            },
        )
        .await
        .unwrap();
        assert_eq!(n.grundzeichen, "stelle");
        assert_eq!(n.organisation.as_deref(), Some("thw"));
        assert_eq!(n.fachaufgabe.as_deref(), Some("bergung"));
        assert_eq!(n.symbol.as_deref(), Some("kran"));
        assert_eq!(n.einheit.as_deref(), Some("gruppe"));
        assert_eq!(n.funktion.as_deref(), Some("zugtrupp"));
        assert_eq!(n.farbe.as_deref(), Some("#00ff00"));
        assert_eq!(n.label.as_deref(), Some("B"));
    }

    /// Der Kern von LFH-306: ein Patch fasst NUR die gesendeten Spalten an. Der
    /// `Default`-Patch (alle Felder absent) darf die Zeile Byte für Byte so lassen.
    #[tokio::test]
    async fn patche_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        // Nur `label` im Patch.
        let n = patche(
            &pool,
            einsatz,
            z.id,
            ZeichenPatch {
                label: Some(Some("B")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.grundzeichen, "einheit", "unberührt");
        assert_eq!(n.organisation.as_deref(), Some("feuerwehr"), "unberührt");
        assert_eq!(
            n.fachaufgabe.as_deref(),
            Some("brandbekaempfung"),
            "unberührt"
        );
        assert_eq!(n.einheit.as_deref(), Some("zug"), "unberührt");
        assert_eq!(n.farbe.as_deref(), Some("#ff0000"), "unberührt");

        // Leerer Patch → alles bleibt, insbesondere kein NotFound.
        let unveraendert = patche(&pool, einsatz, z.id, ZeichenPatch::default())
            .await
            .unwrap();
        assert_eq!(unveraendert.label.as_deref(), Some("B"));
        assert_eq!(unveraendert.organisation.as_deref(), Some("feuerwehr"));
    }

    /// `Some(None)` ist der Leerwunsch und muss von „absent" unterscheidbar sein —
    /// grenzt gegen `patche_laesst_nicht_gesendete_spalten_stehen` ab.
    #[tokio::test]
    async fn patche_organisation_none_loescht_nur_diese_spalte() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        let n = patche(
            &pool,
            einsatz,
            z.id,
            ZeichenPatch {
                organisation: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(n.organisation, None);
        assert_eq!(
            n.fachaufgabe.as_deref(),
            Some("brandbekaempfung"),
            "Nachbarfeld unberührt"
        );
        assert_eq!(n.farbe.as_deref(), Some("#ff0000"), "Nachbarfeld unberührt");
    }

    /// Mandantenzusage (migriert von `aktualisiere_fremder_einsatz_ist_notfound`): ein
    /// Zeichen über einen fremden Einsatz zu patchen bleibt `NotFound`.
    #[tokio::test]
    async fn patche_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                999,
                z.id,
                ZeichenPatch {
                    grundzeichen: Some("einheit"),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn loeschen_dann_laden_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(matches!(
            laden(&pool, einsatz, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
        // Fremd-Delete ebenfalls NotFound.
        let z2 = anlegen(&pool, einsatz, neu(von)).await.unwrap();
        assert!(matches!(
            loese_auf(&pool, 999, z2.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }
}
