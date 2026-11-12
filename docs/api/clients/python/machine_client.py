#!/usr/bin/env python3
"""Referenz-Beispiel für den Maschinenzugang der öffentlichen API von Lifeline Hub (ADR-0022,
Doku docs/api/maschinenzugang.md). Braucht nur `cryptography` (pip install cryptography).

    python3 machine_client.py --selftest          # gegen docs/api/machine-auth-testvektoren.json
    python3 machine_client.py redeem URL CODE     # löst einen Code ein, schreibt lifeline-zugang.json
    python3 machine_client.py me lifeline-zugang.json
"""
import base64, hashlib, hmac, json, os, struct, sys, time, urllib.request

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDFExpand
from cryptography.hazmat.primitives import hashes, serialization

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
SALT = b"lifeline-machine-client/1"


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def normalize_code(code: str) -> str:
    out = "".join({"O": "0", "I": "1", "L": "1"}.get(c, c) for c in code.upper() if c not in " -")
    if len(out) != 16 or any(c not in ALPHABET for c in out):
        raise ValueError("Code hat nicht 16 gültige Zeichen")
    return out


def derive_code(code: str):
    prk = hmac.new(SALT, normalize_code(code).encode(), hashlib.sha256).digest()  # HKDF-Extract
    exp = lambda info: HKDFExpand(hashes.SHA256(), 32, info).derive(prk)
    return b64(exp(b"suche")), exp(b"einloeser"), exp(b"aussteller")


def transcript(label: bytes, *parts: str) -> bytes:
    return label + b"".join(struct.pack(">I", len(p.encode())) + p.encode() for p in parts)


def mac(key: bytes, data: bytes) -> str:
    return b64(hmac.new(key, data, hashlib.sha256).digest())


def compact(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()


def sign_request(cred: dict, method: str, path: str, body: bytes, now: int, jti: str) -> str:
    header = {"alg": "EdDSA", "typ": "lifeline-machine+jwt", "kid": cred["zugang_id"]}
    claims = {"iss": cred["zugang_id"], "aud": cred["instanz_id"], "iat": now, "exp": now + 60,
              "jti": jti, "htm": method.upper(), "htu": path,
              "bh": b64(hashlib.sha256(body).digest())}
    eingabe = b64(compact(header)) + "." + b64(compact(claims))
    key = Ed25519PrivateKey.from_private_bytes(unb64(cred["private_key"]))
    return "Machine " + eingabe + "." + b64(key.sign(eingabe.encode()))


def verify_response(cred: dict, token: str, req_jti: str, status: int, body: bytes, now: int):
    h, c, s = token.split(".")
    if json.loads(unb64(h)) != {"alg": "EdDSA", "typ": "lifeline-machine-response+jwt",
                                "kid": cred["instanz_id"]}:
        raise ValueError("Typ")
    Ed25519PublicKey.from_public_bytes(unb64(cred["instanz_public_key"])).verify(
        unb64(s), (h + "." + c).encode())
    cl = json.loads(unb64(c))
    ok = (cl["iss"] == cred["instanz_id"] and cl["aud"] == cred["zugang_id"]
          and cl["req"] == req_jti and cl["status"] == status
          and cl["bh"] == b64(hashlib.sha256(body).digest())
          and 0 < cl["exp"] - cl["iat"] <= 60 and cl["iat"] <= now + 300 and cl["exp"] >= now - 300)
    if not ok:
        raise ValueError("Antwortsignatur passt nicht")


def redeem(base_url: str, code: str, key: Ed25519PrivateKey | None = None) -> dict:
    key = key or Ed25519PrivateKey.generate()
    pub = b64(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    lookup, k_redeemer, k_issuer = derive_code(code)
    anfrage = {"lookup": lookup, "public_key": {"kty": "OKP", "crv": "Ed25519", "x": pub},
               "proof": mac(k_redeemer, transcript(b"machine-einloeser", lookup, pub))}
    req = urllib.request.Request(base_url.rstrip("/") + "/api/v1/zugang/redeem", data=compact(anfrage),
                                 headers={"Content-Type": "application/json"}, method="POST")
    antwort = json.load(urllib.request.urlopen(req))
    return finish_redeem(lookup, k_issuer, key, pub, base_url, antwort)


def finish_redeem(lookup, k_issuer, key, pub, base_url, a) -> dict:
    t = transcript(b"machine-aussteller", lookup, pub, a["instanz_id"], a["instanz_public_key"]["x"],
                   a["zugang_id"])
    if not hmac.compare_digest(mac(k_issuer, t), a["proof"]):
        raise ValueError("Prüfwert der Instanz passt nicht")
    roh = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                            serialization.NoEncryption())
    return {"zugang_id": a["zugang_id"], "instanz_id": a["instanz_id"], "base_url": base_url.rstrip("/"),
            "private_key": b64(roh), "public_key": pub, "instanz_public_key": a["instanz_public_key"]["x"]}


def me(cred: dict) -> dict:
    jti, now = b64(os.urandom(16)), int(time.time())
    req = urllib.request.Request(cred["base_url"] + "/api/v1/me",
                                 headers={"Authorization": sign_request(cred, "GET", "/api/v1/me", b"", now, jti)})
    with urllib.request.urlopen(req) as r:
        body = r.read()
        verify_response(cred, r.headers["Lifeline-Signature"], jti, r.status, body, now)
    return json.loads(body)


def selftest(pfad: str) -> None:
    v = json.load(open(pfad, encoding="utf-8"))
    lookup, k_redeemer, k_issuer = derive_code(v["code"])
    pub = v["client_public_key"]
    assert lookup == v["redeem_request"]["lookup"], "lookup"
    assert mac(k_redeemer, transcript(b"machine-einloeser", lookup, pub)) == v["redeem_request"]["proof"]
    key = Ed25519PrivateKey.from_private_bytes(unb64(v["client_private_key"]))
    cred = finish_redeem(lookup, k_issuer, key, pub, "https://hub.example", v["redeem_response"])
    for a in v["requests"]:
        auth = sign_request(cred, a["method"], a["path"], a["body"].encode(), a["iat"], a["jti"])
        assert auth == "Machine " + a["jws"], "JWS " + a["path"]
    r = v["response"]
    verify_response(cred, r["jws"], r["req"], r["status"], r["body"].encode(), r["iat"])
    print("Testvektoren: ok")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--selftest"]:
        selftest(args[1] if len(args) > 1 else os.path.join(os.path.dirname(__file__), "..", "..",
                                                            "machine-auth-testvektoren.json"))
    elif args[:1] == ["redeem"] and len(args) == 3:
        ziel = "lifeline-zugang.json"
        if os.path.exists(ziel):
            sys.exit(ziel + " gibt es schon; nicht überschrieben")
        cred = redeem(args[1], args[2])
        fd = os.open(ziel, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(cred, f, indent=2)
        print("Eingelöst: Zugang", cred["zugang_id"], "→", ziel)
    elif args[:1] == ["me"] and len(args) == 2:
        print(json.dumps(me(json.load(open(args[1]))), indent=2, ensure_ascii=False))
    else:
        sys.exit(__doc__)
