// NUR auf einem Host mit Docker + versatiles-Image + Netz.
// `cargo test -p karten-service --test smoke_bremen -- --ignored --nocapture`
#[tokio::test]
#[ignore]
async fn baut_bremen_und_bounds_passen() {
    use karten_service::build::{make_runner::MakeRunner, validate, BuildRunner};
    let runner = MakeRunner { karten_build_dir: "karten-build".into() };
    let art = runner.baue("bremen").await.expect("Bremen-Bau");
    assert_eq!(art.sha256.len(), 64);
    assert!(art.datei.exists());
    assert!(
        validate::bounds_passen(art.bounds, validate::erwartete_box("DE").unwrap()),
        "Bremen-bounds in DE-Box: {:?}",
        art.bounds
    );
}
