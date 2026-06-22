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

print("\n=== Sammenlign (differens, increment 4) ===")
C = "billund_2025__gh__2025__bal-av"      # med balancering
A = "billund_2025__gh__2025"              # uden balancering, med tank
B = "billund_2025__gh__2025__no-tank"     # uden balancering, uden tank

# C som alternativ, A som reference -> balancemarkedets værdi; forbehold rejst.
r = c.get(f"/api/sammenlign?reference={A}&alternativ={C}")
j = r.json()
vis("C vs A -> 200 + forbehold (balancering indgår)",
    r.status_code == 200 and j["forbehold"]["balance_under_validering"] is True
    and j["differens"]["balanceindtaegt_dkk"]["under_validering"] is True)
vis("C vs A -> differens-felter til stede",
    all(k in j["differens"] for k in
        ("objektiv_dkk", "co2_ton", "samlet_produktion_mwh", "nettab_mwh", "nettab_pct_point")))
vis("C vs A -> reference/alternativ-id korrekt",
    j["reference"]["scenarie_id"] == A and j["alternativ"]["scenarie_id"] == C)
vis("C vs A -> varmeefterspørgsel invariant (Δ≈0)",
    abs(j["invariant"]["varmeefterspoergsel_mwh"]["diff"]) <= 1)
vis("C vs A -> økonomisk værdi = −objektiv_dkk (fortegns-vending)",
    j["differens"]["oekonomisk_vaerdi_dkk"] == -j["differens"]["objektiv_dkk"])

# A vs B: begge uden balancering -> intet forbehold; rent præsentabel.
r = c.get(f"/api/sammenlign?reference={B}&alternativ={A}")
j = r.json()
vis("A vs B -> 200 + intet balance-forbehold",
    r.status_code == 200 and j["forbehold"]["balance_under_validering"] is False)
vis("A vs B -> økonomisk værdi = −objektiv_dkk (positiv ved besparelse)",
    j["differens"]["oekonomisk_vaerdi_dkk"] == -j["differens"]["objektiv_dkk"])

# Enheds-union: en konstrueret enhed kun i alternativet -> 0 i reference, ingen crash.
import scenarios as _scen
_ref = _scen.get_manifest_by_id(B, backend.OUTPUT_DIR)
_alt = _scen.get_manifest_by_id(A, backend.OUTPUT_DIR)
_alt = dict(_alt); _alt["enheder"] = list(_alt.get("enheder", [])) + [
    {"navn": "gasmotor_2", "produktion_mwh": 1234.5}]
_smp = _scen.sammenlign_manifester(_ref, _alt, backend.OUTPUT_DIR)
_g2 = [e for e in _smp["enheder"] if e["navn"] == "gasmotor_2"]
vis("enheds-union: ny enhed kun i alt -> 0 i ref, diff = produktion",
    len(_g2) == 1 and _g2[0]["produktion_ref"] == 0 and _g2[0]["diff"] == 1234.5)

# Ukendt id -> 404 med dansk detalje.
r = c.get(f"/api/sammenlign?reference={A}&alternativ=findes_ikke")
vis("ukendt id -> 404 dansk", r.status_code == 404 and "Ukendt scenarie" in r.json()["detail"])

# Samme i begge -> triviel 0-differens (sanity).
r = c.get(f"/api/sammenlign?reference={A}&alternativ={A}")
j = r.json()
vis("samme i begge -> 0-differens",
    r.status_code == 200 and j["differens"]["objektiv_dkk"] == 0
    and j["differens"]["samlet_produktion_mwh"] == 0)

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

# Rolle-scoped længdespærre: et langt ASSISTENT-svar i historikken (modellens
# eget output, > brugerloft men < svarloft) må IKKE fælde spærren, når en kort
# user-besked følger efter. (relevans_ok + koer_chat_loop er stubbet ovenfor.)
langt_svar = {"role": "assistant", "content": "y" * (backend.MAX_BESKED_TEGN + 500)}
kort_spm   = {"role": "user", "content": "og hvad med balancemarkedet?"}
r = cc.post("/api/chat", json={"beskeder": [kort_spm, langt_svar, kort_spm]})
vis("langt assistent-svar i historik -> ikke 413 (fortsat samtale)",
    r.status_code == 200 and r.json()["svar"] == "STUB-SVAR")

# Men et assistent-svar over svarloftet afvises stadig (værn mod oppustet historik).
kæmpe_svar = {"role": "assistant", "content": "z" * (backend.MAX_SVAR_TEGN + 1)}
r = cc.post("/api/chat", json={"beskeder": [kort_spm, kæmpe_svar, kort_spm]})
vis("assistent-svar over svarloft -> 413", r.status_code == 413)

print("\n=== Modelkonfiguration (env -> modul-konstant) ===")
# Ren konfigurationstest: intet API-kald. Konstanterne læses ved modulindlæsning,
# så env-overstyring testes via importlib.reload.
import importlib

# Uden env (intet sat i testmiljøet) -> defaults gælder, adfærd uændret.
vis("chat-model falder tilbage til default", backend.MODEL == "claude-sonnet-4-6")
vis("filter-model falder tilbage til default", backend.RELEVANS_MODEL == "claude-haiku-4-5-20251001")

# Med env sat -> konstanterne tager env-værdien ved (gen)indlæsning.
os.environ["VARMEFLEX_CHAT_MODEL"] = "test-chat-model"
os.environ["VARMEFLEX_FILTER_MODEL"] = "test-filter-model"
importlib.reload(backend)
vis("chat-model tager env-værdi", backend.MODEL == "test-chat-model")
vis("filter-model tager env-værdi", backend.RELEVANS_MODEL == "test-filter-model")

# Ryd op og genindlæs, så modultilstanden er uændret for evt. senere brug.
del os.environ["VARMEFLEX_CHAT_MODEL"]
del os.environ["VARMEFLEX_FILTER_MODEL"]
importlib.reload(backend)

print("\nAlle tests bestået.")
