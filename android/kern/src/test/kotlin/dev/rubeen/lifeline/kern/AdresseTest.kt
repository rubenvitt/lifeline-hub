package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** Adressprüfung gegen die gemeinsamen Fälle (`src-tauri/faelle/adresse.json`). */
class AdresseTest {
    @Serializable
    private class Datei(
        val meldungen: Map<String, String>,
        @Suppress("PropertyName") val gesperrte_ports: List<Int>,
        val faelle: List<Fall>,
    )

    @Serializable
    private class Fall(
        val beschreibung: String,
        val eingabe: String,
        val adresse: String? = null,
        val fehler: String? = null,
    )

    private fun datei() = GemeinsameFaelle.load("adresse.json", Datei.serializer())

    @Test
    fun `jeder gemeinsame Fall der Adressprüfung gilt`() {
        val datei = datei()
        assertTrue(datei.faelle.size >= 16)
        for (fall in datei.faelle) {
            val adresse = fall.adresse
            val fehler = fall.fehler
            when {
                adresse != null && fehler == null ->
                    assertEquals(adresse, ServerAdresse.parse(fall.eingabe).text, fall.beschreibung)
                adresse == null && fehler != null -> {
                    val ausnahme = assertFailsWith<AdressException>(fall.beschreibung) {
                        ServerAdresse.parse(fall.eingabe)
                    }
                    assertEquals(fehler, ausnahme.error.kennwort, fall.beschreibung)
                }
                else -> error("${fall.beschreibung}: genau eins von „adresse“ und „fehler“")
            }
        }
    }

    @Test
    fun `gesperrte Ports gleichen den gemeinsamen Fällen`() {
        val datei = datei()
        assertEquals(datei.gesperrte_ports, ServerAdresse.GESPERRTE_PORTS.sorted())
        for (port in datei.gesperrte_ports) {
            val ausnahme = assertFailsWith<AdressException>("Port $port") {
                ServerAdresse.parse("https://elw.local:$port")
            }
            assertEquals(AdressError.GESPERRTER_PORT, ausnahme.error, "Port $port")
        }
    }

    @Test
    fun `Meldungen sind wortgleich mit der Desktop-Hülle`() {
        val datei = datei()
        assertEquals(datei.meldungen.keys, AdressError.entries.map { it.kennwort }.toSet())
        for (fehler in AdressError.entries) {
            assertEquals(datei.meldungen[fehler.kennwort], fehler.meldung, fehler.name)
        }
    }

    @Test
    fun `Standardport fällt weg, Host wird klein`() {
        assertEquals(
            "https://elw.local/a?b#c",
            ServerAdresse.parse("https://ELW.local:443/a?b#c").text,
        )
    }

    @Test
    fun `Adresse überlebt JSON`() {
        val adresse = ServerAdresse.parse("https://ELW.local:8443")
        val text = Json.encodeToString(ServerAdresse.serializer(), adresse)
        assertEquals("https://elw.local:8443/", Json.decodeFromString(String.serializer(), text))
        assertEquals(adresse, Json.decodeFromString(ServerAdresse.serializer(), text))
        assertNotNull(
            assertFailsWith<Exception> {
                Json.decodeFromString(ServerAdresse.serializer(), "\"http://elw.local\"")
            },
        )
    }

    @Test
    fun `der Hostname ist der Vorgabename`() {
        assertEquals("elw.local", ServerAdresse.parse("https://elw.local:8443/").host)
        assertEquals(8443, ServerAdresse.parse("https://elw.local:8443/").port)
        assertEquals(null, ServerAdresse.parse("https://elw.local/").port)
    }
}
