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
    ) => {
        $(#[$meta])*
        $vis enum $name {
            $($(#[$vmeta])* $var),+
        }
        $crate::wire_enum::wire_enum!(@impl $name { $($var => $wire),+ } $(|$s| $fehler)?);
    };
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($(#[$vmeta:meta])* $var:ident => $wire:tt),+ $(,)?
        }
        $(try_from = |$s:ident| $fehler:expr;)?
    ) => {
        $(#[$meta])*
        $vis enum $name {
            $($(#[$vmeta])* #[serde(rename = $wire)] $var),+
        }
        $crate::wire_enum::wire_enum!(@impl $name { $($var => $wire),+ } $(|$s| $fehler)?);
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
    (@eins $var:ident) => {
        ()
    };
}

pub(crate) use wire_enum;
