"""Offline-test af app.py — alt undtagen det live Anthropic-kald."""
import os
os.environ.setdefault("VARMEFLEX_KODER", "demo,dansk-fjernvarme")
os.environ.setdefault("VARMEFLEX_SECRET", "test-hemmelighed")
os.environ.setdefault("VARMEFLEX_SESSION_TIMER_PR_TIME", "3")  # lavt loft for at teste

from fastapi.testclient import TestClient
import app as backend

c = TestClient(backend.app)


def vis(navn, betingelse):
    print(("  OK  " if betingelse else "  FEJL") + "  " + navn)
    assert betingelse, navn


print("=== Sundhed (ubeskyttet) ===")
r = c.get("/api/sundhed")
vis(f"sundhed svarer 200, ser {r.json().get('antal_scenarier')} scenarier", r.status_code == 200 and r.json()["antal_scenarier"] == 3)

print("\n=== Gate ===")
vis("scenarier uden cookie -> 401", c.get("/api/scenarier").status_code == 401)
vis("forkert kode -> 403", c.post("/api/login", json={"kode": "forkert"}).status_code == 403)
r = c.post("/api/login", json={"kode": "demo"})
vis("rigtig kode -> 200 + cookie", r.status_code == 200 and backend.COOKIE_NAVN in r.cookies)

print("\n=== Beskyttede endpoints med gyldig session ===")
r = c.get("/api/scenarier")
vis("scenarier med cookie -> 200, 3 poster", r.status_code == 200 and len(r.json()["scenarier"]) == 3)
r = c.get("/api/scenarie/billund_2025__gh__2025__no-tank")
vis("enkelt manifest -> 200, rigtig nøgle", r.status_code == 200 and r.json()["scenarie_id"].endswith("no-tank"))
vis("ukendt manifest -> 404", c.get("/api/scenarie/findes_ikke").status_code == 404)

print("\n=== Forfalsket cookie afvises ===")
c2 = TestClient(backend.app)
c2.cookies.set(backend.COOKIE_NAVN, "snydt.deadbeef")
vis("manipuleret cookie -> 401", c2.get("/api/scenarier").status_code == 401)

print("\n=== Rate limit (loft = 3/time, men intet API-kald) ===")
# Vi rammer limiteren direkte, så vi ikke kalder Anthropic.
sid = "test-session"
resultater = [backend.limiter.tjek_og_tael(sid)[0] for _ in range(4)]
vis(f"3 tilladt, 4. afvist -> {resultater}", resultater == [True, True, True, False])

print("\n=== Værktøjs-dispatch (uden Anthropic) ===")
kat = backend.udfoer_vaerktoej("list_scenarier", {})
vis("list_scenarier -> 3 scenarier", len(kat["scenarier"]) == 3)
res = backend.udfoer_vaerktoej("run_scenario", {"med_balancering": True})
vis("run_scenario(bal=True) -> C", res.get("scenarie_id", "").endswith("bal-av"))
res = backend.udfoer_vaerktoej("run_scenario", {"scenarie_id": "findes_ikke"})
vis("run_scenario(ukendt) -> fundet:false", res.get("fundet") is False)
res = backend.udfoer_vaerktoej("run_scenario", {"farlig_arg": "drop table"})
vis("ukendte argumenter filtreres væk (ingen crash)", "scenarie_id" in res or res.get("fundet") is not None)

print("\n=== Input-værn og relevans (chat) ===")
# Frisk klient med gyldig session
cc = TestClient(backend.app)
cc.post("/api/login", json={"kode": "demo"})

# For lang besked -> 413
lang = {"role": "user", "content": "x" * (backend.MAX_BESKED_TEGN + 1)}
vis("for lang besked -> 413", cc.post("/api/chat", json={"beskeder": [lang]}).status_code == 413)

# For mange beskeder -> 413
mange = [{"role": "user", "content": "hej"} for _ in range(backend.MAX_BESKEDER + 1)]
vis("for mange beskeder -> 413", cc.post("/api/chat", json={"beskeder": mange}).status_code == 413)

# Off-topic -> fast afvisning (uden Anthropic): tving relevans_ok til False
backend.relevans_ok = lambda tekst: False
r = cc.post("/api/chat", json={"beskeder": [{"role": "user", "content": "skriv et digt om katte"}]})
vis("off-topic -> afvisning, intet model-kald", r.status_code == 200 and r.json()["svar"] == backend.AFVISNING)

# On-topic -> når frem til chat-loopet (stubbet, så vi ikke kalder Anthropic)
backend.relevans_ok = lambda tekst: True
backend.koer_chat_loop = lambda beskeder: {"svar": "STUB-SVAR", "manifester": []}
r = cc.post("/api/chat", json={"beskeder": [{"role": "user", "content": "hvad er værdien af tanken?"}]})
vis("on-topic -> chat-loopet nås", r.status_code == 200 and r.json()["svar"] == "STUB-SVAR")

print("\nAlle tests bestået.")
