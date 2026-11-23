package dev.rubeen.lifeline.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.kern.Updateentscheidung
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

/**
 * Vertrauen der Hülle (`res/xml/network_security_config.xml`, Entwurf D2a): System- und
 * Nutzer-CAs für die Server, für die Download-Hosts des Updaters nur die CAs des Systems.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class NetzvertrauenTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    /** Je Abschnitt (`base-config` oder die Domains einer `domain-config`) die Quellen der CAs. */
    private fun abschnitte(): Map<String, Set<String>> {
        val parser = context.resources.getXml(R.xml.network_security_config)
        val ergebnis = mutableMapOf<String, Set<String>>()
        var domains = mutableListOf<String>()
        var quellen = mutableSetOf<String>()
        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            when {
                parser.eventType == XmlPullParser.START_TAG && parser.name in setOf("base-config", "domain-config") -> {
                    domains = mutableListOf()
                    quellen = mutableSetOf()
                }
                parser.eventType == XmlPullParser.START_TAG && parser.name == "domain" -> {
                    assertEquals("false", parser.getAttributeValue(null, "includeSubdomains"))
                    domains += parser.nextText().trim()
                }
                parser.eventType == XmlPullParser.START_TAG && parser.name == "certificates" ->
                    quellen += parser.getAttributeValue(null, "src")
                parser.eventType == XmlPullParser.END_TAG && parser.name == "base-config" -> ergebnis["base"] = quellen
                parser.eventType == XmlPullParser.END_TAG && parser.name == "domain-config" ->
                    domains.forEach { ergebnis[it] = quellen }
            }
        }
        return ergebnis
    }

    @Test
    fun `Server vertrauen System- und Nutzer-CAs, die Update-Hosts nur dem System`() {
        val abschnitte = abschnitte()

        assertEquals(setOf("system", "user"), abschnitte["base"])
        for (host in Updateentscheidung.ERLAUBTE_HOSTS) {
            assertEquals(host, setOf("system"), abschnitte[host])
        }
        assertEquals(Updateentscheidung.ERLAUBTE_HOSTS + "base", abschnitte.keys)
    }
}
