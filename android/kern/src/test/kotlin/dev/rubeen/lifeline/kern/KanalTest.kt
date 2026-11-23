package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Kanal der App (Entwurf D4, D9): beim ersten Start aus der Version, sonst keine Updates. */
class KanalTest {
    @Test
    fun `Kanal folgt dem Vorab-Suffix`() {
        assertEquals(Kanal.ALPHA, Kanal.fromVersion("1.0.0-alpha.196"))
        assertEquals(Kanal.BETA, Kanal.fromVersion("1.0.0-beta.3"))
        assertEquals(Kanal.STABIL, Kanal.fromVersion("1.0.0"))
        assertEquals(Kanal.STABIL, Kanal.fromVersion("1.2.3+build.5"))
        assertEquals(Kanal.ALPHA, Kanal.fromVersion("1.0.0-alpha.196+abc"))
        for (version in listOf("1.0.0-rc.1", "0.0.0-dev", "", "kaputt", "1.0-alpha.1", "1.0.0-alpha", "1.0.0-alphabet.1")) {
            assertNull(Kanal.fromVersion(version), version)
        }
    }

    @Test
    fun `Kennwörter werden gelesen`() {
        assertEquals(Kanal.ALPHA, Kanal.fromKennwort("alpha"))
        assertEquals(Kanal.BETA, Kanal.fromKennwort("beta"))
        assertEquals(Kanal.STABIL, Kanal.fromKennwort("stabil"))
        assertNull(Kanal.fromKennwort("Alpha"))
        assertNull(Kanal.fromKennwort("nightly"))
        assertNull(Kanal.fromKennwort(""))
        assertNull(Kanal.fromKennwort(null))
        for (kanal in Kanal.entries) assertEquals(kanal, Kanal.fromKennwort(kanal.kennwort))
    }

    @Test
    fun `Manifest-Adressen je Kanal`() {
        assertEquals("https://github.com/rubenvitt/lifeline-hub", Kanal.REPO)
        assertEquals(
            "https://github.com/rubenvitt/lifeline-hub/releases/download/android-alpha/android.json",
            Kanal.ALPHA.manifestUrl,
        )
        assertEquals(
            "https://github.com/rubenvitt/lifeline-hub/releases/download/android-beta/android.json",
            Kanal.BETA.manifestUrl,
        )
        assertEquals(
            "https://github.com/rubenvitt/lifeline-hub/releases/download/android-stabil/android.json",
            Kanal.STABIL.manifestUrl,
        )
    }

    @Test
    fun `die Manifest-Adressen liegen auf erlaubten Hosts`() {
        for (kanal in Kanal.entries) assertEquals(true, Updateentscheidung.isErlaubterDownload(kanal.manifestUrl))
    }
}
