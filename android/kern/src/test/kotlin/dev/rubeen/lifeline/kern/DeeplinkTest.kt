package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable

/** Deeplink `lifeline://verbinden?server=…` gegen die gemeinsamen Fälle (`deeplink.json`). */
class DeeplinkTest {
    @Serializable
    private class Datei(val deute: List<DeuteFall>, val entscheide: List<EntscheideFall>)

    @Serializable
    private class DeuteFall(val beschreibung: String, val link: String, val ziel: String? = null)

    @Serializable
    private class EntscheideFall(
        val beschreibung: String,
        val gespeichert: String? = null,
        val neu: String,
        val aktion: String,
    )

    private fun adresse(text: String) = ServerAdresse.parse(text)

    @Test
    fun `jeder gemeinsame Fall des Deeplinks gilt`() {
        val datei = GemeinsameFaelle.load("deeplink.json", Datei.serializer())
        assertTrue(datei.deute.size >= 10)
        assertTrue(datei.entscheide.size >= 5)
        for (fall in datei.deute) {
            assertEquals(fall.ziel, Deeplink.parse(fall.link)?.text, fall.beschreibung)
        }
        for (fall in datei.entscheide) {
            val aktion = Deeplink.decide(fall.gespeichert?.let(::adresse), adresse(fall.neu))
            assertEquals(fall.aktion, aktion.kennwort, fall.beschreibung)
        }
    }

    @Test
    fun `ein unbekannter Server wird vorbelegt statt gewechselt`() {
        val aktiv = adresse("https://elw.local:8443")
        val bekannt = adresse("https://fuekw.local:8443")
        val fremd = adresse("https://fremd.example")
        val liste = listOf(aktiv, bekannt)
        assertEquals(Deeplink.Aktion.Vorbelegen(fremd), Deeplink.decide(aktiv, liste, fremd))
        assertEquals(Deeplink.Aktion.Bestaetigen(bekannt), Deeplink.decide(aktiv, liste, bekannt))
        assertEquals(Deeplink.Aktion.Nichts, Deeplink.decide(aktiv, liste, adresse("https://ELW.local:8443/")))
        assertEquals(Deeplink.Aktion.Vorbelegen(fremd), Deeplink.decide(null, emptyList(), fremd))
    }

    @Test
    fun `der QR-Code traegt einen Deeplink oder eine Adresse`() {
        val elw = adresse("https://elw.local:8443")
        assertEquals(elw, Deeplink.adresseAusQrCode("lifeline://verbinden?server=https://elw.local:8443"))
        assertEquals(elw, Deeplink.adresseAusQrCode(" https://elw.local:8443 "))
        assertNull(Deeplink.adresseAusQrCode("lifeline://verbinden?server=http://elw.local"))
        assertNull(Deeplink.adresseAusQrCode("lifeline://anmeldung?code=abc"))
    }

    @Test
    fun `fremder QR-Inhalt belegt nichts vor`() {
        for (inhalt in listOf(
            "WIFI:S:ELW;T:WPA;P:x;;",
            "http://elw.local",
            "lifeline://verbinden?server=https://elw.local:8443@evil.example",
        )) {
            assertNull(Deeplink.adresseAusQrCode(inhalt), inhalt)
        }
    }
}
