package dev.rubeen.lifeline.kern

/**
 * Stil, den die Hülle in jede Seite des Hauptframes einspielt (Entwurf D6): lange Berührung zeigt
 * außerhalb von Eingaben weder Lupe noch Textmenü. Eingaben, Textfelder und bearbeitbare
 * Bereiche bleiben auswählbar. Der Stil gehört in die Hülle, nicht ins Frontend-CSS: im Browser
 * bleibt Text auswählbar, und ältere Server bekommen ihn auch.
 */
object Huellenstil {
    /** `id` des eingespielten `<style>`. */
    const val KENNUNG = "lifeline-huelle-stil"

    /**
     * Auf jedem Element, nicht nur auf `body`: ob die Eigenschaften erben, hängt vom Browser ab.
     * Die Ausnahmen gewinnen über die Spezifität des Elementselektors gegenüber `*`.
     */
    val CSS: String = """
        * { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
        input, textarea, select, [contenteditable]:not([contenteditable="false"]), [contenteditable]:not([contenteditable="false"]) * { -webkit-touch-callout: default; -webkit-user-select: text; user-select: text; }
    """.trimIndent()

    /**
     * Läuft zu Dokumentbeginn. Der WebView spielt es auch in Unterframes der Origin ein; dort
     * steigt es aus (nur der Hauptframe ist die Oberfläche). Fehlt `<html>` noch, hängt es den Stil
     * bei `DOMContentLoaded` an; ein zweiter Lauf fügt nichts doppelt ein.
     */
    val skript: String
        get() {
            val kennung = jsLiteral(KENNUNG)
            return "(() => { if (window.top !== window) return; const einfuegen = () => { if (document.getElementById($kennung)) return; " +
                "const stil = document.createElement('style'); stil.id = $kennung; " +
                "stil.textContent = ${jsLiteral(CSS)}; " +
                "(document.head || document.documentElement).appendChild(stil); }; " +
                "if (document.documentElement) einfuegen(); " +
                "else document.addEventListener('DOMContentLoaded', einfuegen, { once: true }); })();"
        }
}
