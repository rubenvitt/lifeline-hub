//! `wire_enum!`: ein feldloses Domänen-Enum aus EINER Liste `Variante => "wire"`.
//!
//! Erzeugt das Enum samt `#[serde(rename = "wire")]` je Variante, `as_str()`, `parse()` und
//! `ALLE` (in Deklarationsreihenfolge). Serde, utoipa-Schema, `as_str()` und `parse()` lesen
//! damit dasselbe Literal — Wire == `as_str()` gilt per Bau statt per Abschrift.
//!
//! ```ignore
//! wire_enum! {
//!     #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
//!     pub enum UhsStatus {
//!         Geplant => "geplant",
//!         Aktiv => "aktiv",
//!     }
//!     // optional: TryFrom<String> mit wortgleicher Fehlermeldung
//!     try_from = |s| format!("Ungültiger UhsStatus: {s}");
//! }
//! ```
//!
//! Mit `sqlx = |s| <Meldung>;` (nach einem `try_from`) kommen `sqlx::Type` und `sqlx::Decode` als
//! Textspalte dazu (LLH-1690): gespeichert wird `as_str()`, gelesen über `parse()`, ein unbekannter
//! Wert ist ein Decode-Fehler mit der Meldung. Für nullbare Spalten liefert sqlx' Blanket-Impl
//! für `Option<T>` NULL → `None`; `#[sqlx(try_from = …)]` ginge dort nicht (Orphan-Rule).
//!
//! Enums ohne serde-Derive beginnen mit `#[wire(ohne_serde)]` (vor den Doc-Kommentaren) — ohne
//! Derive wäre das `#[serde]`-Attribut unbekannt. Nur dort darf der Wire-Wert statt eines
//! Literals auch eine `&str`-Konstante sein; serde verlangt ein Literal.
//!
//! Der Kopf bleibt bewusst `pub enum Name`: der Inventar-Guard in `tests/enum_wire_kontrakt.rs`
//! findet Enums über genau diesen Text.
//!
//! Der Wire-Wert ist ein `tt`, kein `literal`: ein als `literal` gefangenes Fragment reicht
//! `macro_rules!` als unsichtbare Gruppe an die Derives weiter. serde liest das `rename` dann
//! noch, utoipa nicht — `openapi.json` fiel gemessen auf die Variantennamen zurück.

macro_rules! wire_enum {
    (
        #[wire(ohne_serde)]
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($(#[$vmeta:meta])* $var:ident => $wire:tt),+ $(,)?
        }
        $(try_from = |$s:ident| $fehler:expr;)?
        $(sqlx = |$sq:ident| $sqfehler:expr;)?
    ) => {
        $(#[$meta])*
        $vis enum $name {
            $($(#[$vmeta])* $var),+
        }
        $crate::wire_enum::wire_enum!(@impl $name { $($var => $wire),+ } $(|$s| $fehler)?);
        $($crate::wire_enum::wire_enum!(@sqlx $name |$sq| $sqfehler);)?
    };
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($(#[$vmeta:meta])* $var:ident => $wire:tt),+ $(,)?
        }
        $(try_from = |$s:ident| $fehler:expr;)?
        $(sqlx = |$sq:ident| $sqfehler:expr;)?
    ) => {
        $(#[$meta])*
        $vis enum $name {
            $($(#[$vmeta])* #[serde(rename = $wire)] $var),+
        }
        $crate::wire_enum::wire_enum!(@impl $name { $($var => $wire),+ } $(|$s| $fehler)?);
        $($crate::wire_enum::wire_enum!(@sqlx $name |$sq| $sqfehler);)?
    };
    (@impl $name:ident { $($var:ident => $wire:tt),+ } $(|$s:ident| $fehler:expr)?) => {
        // Die Schnittstelle ist einheitlich; ein privates Enum nutzt nicht jeden Teil.
        #[allow(dead_code)]
        impl $name {
            /// Alle Varianten in Deklarationsreihenfolge.
            pub const ALLE: [$name; [$($crate::wire_enum::wire_enum!(@eins $var)),+].len()] =
                [$($name::$var),+];

            pub const fn as_str(&self) -> &'static str {
                match self {
                    $($name::$var => $wire),+
                }
            }

            pub fn parse(s: &str) -> Option<$name> {
                match s {
                    $($wire => Some($name::$var),)+
                    _ => None,
                }
            }
        }

        $(
            impl TryFrom<String> for $name {
                type Error = String;

                fn try_from($s: String) -> Result<Self, Self::Error> {
                    $name::parse(&$s).ok_or_else(|| $fehler)
                }
            }
        )?
    };
    (@sqlx $name:ident |$s:ident| $fehler:expr) => {
        impl<DB: sqlx::Database> sqlx::Type<DB> for $name
        where
            str: sqlx::Type<DB>,
        {
            fn type_info() -> DB::TypeInfo {
                <str as sqlx::Type<DB>>::type_info()
            }
        }

        impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for $name
        where
            &'r str: sqlx::Decode<'r, DB>,
        {
            fn decode(
                value: <DB as sqlx::Database>::ValueRef<'r>,
            ) -> Result<Self, sqlx::error::BoxDynError> {
                let $s = <&str as sqlx::Decode<DB>>::decode(value)?;
                $name::parse($s).ok_or_else(|| $fehler.into())
            }
        }
    };
    (@eins $var:ident) => {
        ()
    };
}

pub(crate) use wire_enum;

#[cfg(test)]
mod tests {
    wire_enum! {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
        pub enum Probe {
            Eins => "eins",
            Zwei => "zwei",
        }
        sqlx = |s| format!("Ungültige Probe: {s}");
    }

    /// LLH-1690: der `sqlx`-Zweig liest den Wire-Wert, NULL als `None`, und lehnt Unbekanntes mit
    /// der eigenen Meldung ab.
    #[tokio::test]
    async fn sqlx_zweig_liest_text_null_und_lehnt_unbekanntes_ab() {
        let pool = crate::db::test_pool().await;
        let p: Probe = sqlx::query_scalar("SELECT 'zwei'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(p, Probe::Zwei);
        let n: Option<Probe> = sqlx::query_scalar("SELECT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, None);
        let err = sqlx::query_scalar::<_, Probe>("SELECT 'drei'")
            .fetch_one(&pool)
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("Ungültige Probe: drei"), "{err}");
    }
}
