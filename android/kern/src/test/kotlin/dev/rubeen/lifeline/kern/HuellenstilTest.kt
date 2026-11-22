package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Natives Gefühl im WebView (Entwurf D6): kein Textmenü außerhalb von Eingaben, per eingespieltem Stil. */
class HuellenstilTest {
    @Test
    fun `außerhalb von Eingaben keine Lupe und kein Textmenü`() {
        assertTrue("-webkit-touch-callout: none" in Huellenstil.CSS, Huellenstil.CSS)
        assertTrue("-webkit-user-select: none" in Huellenstil.CSS, Huellenstil.CSS)
    }

    @Test
    fun `Eingaben bleiben auswählbar`() {
        for (selektor in listOf("input", "textarea", "[contenteditable]")) {
            assertTrue(selektor in Huellenstil.CSS, selektor)
        }
        assertTrue("-webkit-user-select: text" in Huellenstil.CSS)
        assertTrue("-webkit-touch-callout: default" in Huellenstil.CSS)
    }

    @Test
    fun `das Skript hängt den Stil einmal an und bricht nicht aus`() {
        val skript = Huellenstil.skript
        assertTrue(Huellenstil.KENNUNG in skript, skript)
        assertTrue("getElementById" in skript, skript)
        assertTrue("DOMContentLoaded" in skript, skript)
        // Das CSS steht als JSON-Literal darin, nicht als Vorlage mit Backticks.
        assertFalse("`" in skript, skript)
    }

    /**
     * Review K3: `addDocumentStartJavaScript` spielt Skripte auch in Unterframes der Origin ein.
     * Stil und Init-Skript steigen dort aus; nur der Hauptframe ist die Oberfläche.
     */
    @Test
    fun `Stil und Init-Skript wirken nur im Hauptframe`() {
        assertTrue(Huellenstil.skript.startsWith("(() => { if (window.top !== window) return;"), Huellenstil.skript)
        val initskript = java.io.File(GemeinsameFaelle.wurzel(), "android/app/src/main/assets/huelle.js").readText()
        assertTrue("(() => {\n  if (window.top !== window) return;" in initskript)
    }

    @Test
    fun `die Beispielseite der Oberflächentests hat Text und Eingabe`() {
        assertTrue("id=\"text\"" in Testzustand.BEISPIELSEITE)
        assertTrue("<input" in Testzustand.BEISPIELSEITE)
    }
}
