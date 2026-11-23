package dev.rubeen.lifeline.kern

import kotlinx.serialization.json.JsonPrimitive

/**
 * Text als JavaScript-Literal (JSON-String). Maskiert auch `/` (also `</script>`) und die
 * Zeilentrenner U+2028 und U+2029; die gelten in älteren Engines als Zeilenende im Literal.
 */
internal fun jsLiteral(text: String): String =
    JsonPrimitive(text).toString()
        .replace("/", "\\/")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")
