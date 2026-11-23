package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Init-Skript der Hülle: die App setzt ihre volle Version für den Platzhalter ein. */
class InitskriptTest {
    private val vorlage = """
        const rohVersion = '__LIFELINE_VERSION__';
        const version = rohVersion === '__LIFELINE_' + 'VERSION__' ? undefined : rohVersion;
    """.trimIndent()

    @Test
    fun `die Version ersetzt den Platzhalter`() {
        val skript = Initskript.render(vorlage, "1.0.0-alpha.312+build.5")
        assertTrue("const rohVersion = '1.0.0-alpha.312+build.5';" in skript)
        // Der zusammengesetzte Vergleich bleibt stehen, sonst meldete das Skript nie eine Version.
        assertTrue("'__LIFELINE_' + 'VERSION__'" in skript)
        assertFalse("'__LIFELINE_VERSION__'" in skript)
        assertEquals("__LIFELINE_VERSION__", Initskript.PLATZHALTER)
    }

    @Test
    fun `ohne Version bleibt der Platzhalter stehen`() {
        assertEquals(vorlage, Initskript.render(vorlage, null))
    }

    @Test
    fun `eine Version mit fremden Zeichen wird nicht eingesetzt`() {
        // Die Version landet in einem JS-String; Anführungszeichen o. Ä. dürfen nie hinein.
        for (version in listOf("1.0.0'; alert(1); '", "1.0.0\n", "", "1.0.0 beta", "1.0.0\\", "1.0.0é")) {
            assertEquals(vorlage, Initskript.render(vorlage, version), version)
        }
    }
}
