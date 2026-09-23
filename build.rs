// `sqlx::migrate!("./migrations")` bettet die Migrationen zur Compile-Zeit ein. Ohne diese
// Zeile baut Cargo den Crate nicht neu, wenn in `migrations/` nur eine Datei hinzukommt oder
// sich ändert — ein `cargo run` spielte die neue Migration dann nicht ein, und
// `db::tests::migrationsnummern_sind_eindeutig` sähe eine doppelte Nummer erst, wenn
// zufällig auch Rust-Code angefasst wird (gemessen: Dublette angelegt, Test blieb grün).
// Dasselbe erzeugt `sqlx migrate build-script`.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
