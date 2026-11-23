package dev.rubeen.lifeline.kern

import java.text.Normalizer

/**
 * Hostnamen mit Umlauten (IDN) in die ASCII-Form, die der WebView als Origin meldet (LLH-2070).
 * Ohne diese Umwandlung stünde `einsatz-lüneburg.de` in der Serverliste, die Seite käme aber als
 * `xn--einsatz-lneburg-7vb.de`, und Brücke und Linkregeln passten nie zur Seite.
 *
 * Gleiches Ergebnis wie das Rust-Crate `url` der Desktop-Hülle (URL-Standard, UTS 46
 * nicht-transitional) für die gemeinsamen Fälle (`src-tauri/faelle/adresse.json`): Faltung über
 * NFKC und Kleinschreibung, `ß` und `ς` bleiben (`java.net.IDN` machte nach IDNA 2003 `ss` und `σ`
 * daraus), Punkt-Varianten trennen Labels, unsichtbare Füllzeichen fallen weg, Verbinder und im
 * Host verbotene Zeichen werden abgelehnt. Nicht nachgebildet sind die Bidi-Regel, die Regel für
 * ein Kombinationszeichen am Labelanfang und der Kontext, in dem UTS 46 einen Verbinder erlaubt:
 * solche Hosts nimmt der Kern an oder lehnt sie ab, wo `url` es umgekehrt hielte. Das ist kein
 * Loch, denn der WebView lädt genau die Adresse, die der Kern speichert. ICU fehlt dem
 * Kern (kein SDK), deshalb der Punycode-Kodierer nach RFC 3492 hier. Der iOS-Kern braucht keinen:
 * dort liefert Foundation den Host so (`URLComponents.encodedHost`).
 */
internal object Idna {
    /** Zero-Width-Non-Joiner und -Joiner: der URL-Standard lehnt sie hier ab (CheckJoiners). */
    private val verbinder = setOf('\u200c', '\u200d')

    /**
     * Zeichen, die UTS 46 ersatzlos entfernt („ignored“): weiches Trennzeichen, Combining Grapheme
     * Joiner, mongolische Variantenwähler, Zero-Width-Space, Word Joiner, Invisible Plus,
     * Variantenwähler und Byte Order Mark. Sie kommen beim Einfügen aus anderen Programmen mit.
     */
    private val fuellzeichen = Regex("[\u00ad\u034f\u180b-\u180f\u200b\u2060\u2064\ufe00-\ufe0f\ufeff]")

    /**
     * Im Host verboten (URL-Standard, „forbidden domain code point“), geprüft **nach** der Faltung:
     * NFKC macht aus `：`, `＠` und `／` erst hier `:`, `@` und `/`, also nachdem `Adresse.kt` Port
     * und Zugangsdaten abgetrennt hat. Ohne diese Prüfung umginge
     * `https://elw.local：8443＠evil.example` die Sperre für Zugangsdaten (Review LLH-2070).
     */
    private val verboten = Regex("[\\u0000-\\u0020#%/:<>?@\\[\\\\\\]^|\\u007f\\p{Cc}]")

    /** Der ideografische Punkt trennt Labels wie `.`; NFKC bildet `．` und `｡` auf ihn oder `.` ab. */
    private const val IDEOGRAFISCHER_PUNKT = '\u3002'

    /**
     * Wandelt einen Host in seine ASCII-Form; ein reiner ASCII-Host wird nur klein. `null`, wenn
     * der Host keine Adresse ergibt.
     */
    fun toAscii(host: String): String? {
        if (host.all { it.code < 0x80 }) return host.lowercase()
        if (host.any { it in verbinder }) return null
        val gefaltet = fold(host.replace(fuellzeichen, "")).replace(IDEOGRAFISCHER_PUNKT, '.')
        if (verboten.containsMatchIn(gefaltet)) return null
        val labels = gefaltet.split('.').map { label ->
            if (label.all { it.code < 0x80 }) label else "xn--" + (punycode(label) ?: return null)
        }
        return labels.joinToString(".")
    }

    /**
     * Faltung wie UTS 46: Kompatibilitätszeichen auf ihre Grundform (NFKC: `Ｅ` → `E`, `Ⅸ` → `IX`),
     * dann klein. Großes Sigma wird immer `σ`; die Kleinschreibung von Java machte am Wortende `ς`
     * daraus, die Faltung nicht.
     */
    private fun fold(host: String): String {
        val kompatibel = Normalizer.normalize(host, Normalizer.Form.NFKC)
        val klein = kompatibel.replace('Σ', 'σ').lowercase()
        return Normalizer.normalize(klein, Normalizer.Form.NFKC)
    }

    private const val BASE = 36
    private const val TMIN = 1
    private const val TMAX = 26
    private const val SKEW = 38
    private const val DAMP = 700
    private const val INITIAL_BIAS = 72
    private const val INITIAL_N = 128

    /** Punycode eines Labels nach RFC 3492, Abschnitt 6.3; `null` bei Überlauf. */
    internal fun punycode(label: String): String? {
        val zeichen = label.codePoints().toArray()
        val ausgabe = StringBuilder()
        for (code in zeichen) if (code < 0x80) ausgabe.append(code.toChar())
        val basis = ausgabe.length
        var verarbeitet = basis
        if (basis > 0) ausgabe.append('-')
        var n = INITIAL_N
        var delta = 0L
        var bias = INITIAL_BIAS
        while (verarbeitet < zeichen.size) {
            val m = zeichen.filter { it >= n }.min()
            delta += (m - n).toLong() * (verarbeitet + 1)
            if (delta > Int.MAX_VALUE) return null
            n = m
            for (code in zeichen) {
                if (code < n) delta++
                if (code == n) {
                    var q = delta
                    var k = BASE
                    while (true) {
                        val t = if (k <= bias) TMIN else if (k >= bias + TMAX) TMAX else k - bias
                        if (q < t) break
                        ausgabe.append(digit(t + (q - t) % (BASE - t)))
                        q = (q - t) / (BASE - t)
                        k += BASE
                    }
                    ausgabe.append(digit(q))
                    bias = adapt(delta, verarbeitet + 1, verarbeitet == basis)
                    delta = 0
                    verarbeitet++
                }
            }
            delta++
            n++
        }
        return ausgabe.toString()
    }

    private fun digit(wert: Long): Char =
        if (wert < 26) ('a' + wert.toInt()) else ('0' + (wert.toInt() - 26))

    private fun adapt(delta: Long, anzahl: Int, erstes: Boolean): Int {
        var d = if (erstes) delta / DAMP else delta / 2
        d += d / anzahl
        var k = 0
        while (d > ((BASE - TMIN) * TMAX) / 2) {
            d /= BASE - TMIN
            k += BASE
        }
        return (k + (BASE - TMIN + 1) * d / (d + SKEW)).toInt()
    }
}
