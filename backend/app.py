"""
app.py — FastAPI-backend for varmeflex.dk (fase 1)

Dette er web-laget oven på scenarios.py. Apache står foran som offentlig
webserver (TLS, statiske filer, login-side) og videresender kun /api/* hertil
på localhost. API-nøglen lever UDELUKKENDE i denne proces' miljø — Apache ser
den aldrig og serverer den aldrig til browseren.

Ansvar her:
  * Gate: en delt medlemskode (Dansk Fjernvarme) byttes til en signeret
    session-cookie. Ingen brugerkonti — det er en demo.
  * Rate limiting: pr. session OG et globalt dagligt loft over Anthropic-kald,
    så en lækket kode ikke kan løbe regningen op.
  * Scenario-endpoints: list_scenarier / et enkelt manifest — billige, lokale
    opslag i output/ (ikke rate-limitet).
  * Chat-proxy: kører Anthropic-værktøjs-loopet med run_scenario og
    list_scenarier som værktøjer, forankret af grounding_da.md. Det er det
    eneste endpoint, der koster penge, og det eneste, rate-limiteren tæller.

To-fase-snittet: chat-proxyen og værktøjsskemaerne ændrer sig IKKE i fase 2.
Kun scenarios.run_scenario'ens "ikke fundet"-gren skifter fra cache-svar til
live solve. Intet her kasseres.

Miljøvariabler (sættes i drift, fx i systemd-unit'en):
  ANTHROPIC_API_KEY   påkrævet for /api/chat
  MODEL_OUTPUT_DIR    sti til modellens output/ (default ../output)
  VARMEFLEX_KODER      komma-separerede gyldige medlemskoder
  VARMEFLEX_SECRET     hemmelighed til at signere cookies (sæt en lang streng)
  VARMEFLEX_MODEL      Anthropic-modelstreng (default claude-sonnet-4-6)
  VARMEFLEX_SESSION_TIMER_PR_TIME   maks chat-kald pr. session pr. time (default 30)
  VARMEFLEX_GLOBALT_DAGSLOFT        maks chat-kald i alt pr. dag (default 500)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import Cookie, FastAPI, HTTPException, Response
from pydantic import BaseModel

import scenarios

# --------------------------------------------------------------------------
# Konfiguration (alt fra miljøet, med fornuftige defaults til lokal test)
# --------------------------------------------------------------------------

OUTPUT_DIR = Path(os.environ.get("MODEL_OUTPUT_DIR", str(Path(__file__).parent / "output_demo")))
KODER = {k.strip() for k in os.environ.get("VARMEFLEX_KODER", "demo").split(",") if k.strip()}
SECRET = os.environ.get("VARMEFLEX_SECRET", "skift-mig-i-drift")
MODEL = os.environ.get("VARMEFLEX_MODEL", "claude-sonnet-4-6")
SESSION_MAX_ALDER_S = 12 * 3600  # cookie gyldig 12 timer
# Secure-flag på cookien kræver HTTPS. Slå fra ved lokal HTTP-udvikling.
COOKIE_SECURE = os.environ.get("VARMEFLEX_COOKIE_SECURE", "1") == "1"
SESSION_LOFT_PR_TIME = int(os.environ.get("VARMEFLEX_SESSION_TIMER_PR_TIME", "30"))
GLOBALT_DAGSLOFT = int(os.environ.get("VARMEFLEX_GLOBALT_DAGSLOFT", "500"))
MAX_VAERKTOEJ_RUNDER = 8  # værn mod uendelige værktøjs-loops

# Input-værn: så siden ikke kan misbruges som gratis generel chatbot.
MAX_BESKED_TEGN = int(os.environ.get("VARMEFLEX_MAX_BESKED_TEGN", "2000"))
MAX_BESKEDER = int(os.environ.get("VARMEFLEX_MAX_BESKEDER", "40"))

# Relevans-tjek: billigt JA/NEJ med en lille model, FØR det dyre kald.
RELEVANSTJEK = os.environ.get("VARMEFLEX_RELEVANSTJEK", "1") == "1"
RELEVANS_MODEL = os.environ.get("VARMEFLEX_RELEVANS_MODEL", "claude-haiku-4-5-20251001")
AFVISNING = ("Jeg kan kun hjælpe med spørgsmål om dispatchmodellen og "
             "Billund-casen — fx værdien af balancemarkedet eller tanken, "
             "eller hvordan et scenarie ser ud.")

GROUNDING = (Path(__file__).parent / "grounding_da.md").read_text(encoding="utf-8")
COOKIE_NAVN = "varmeflex_session"


# --------------------------------------------------------------------------
# Signeret session-cookie (stdlib — ingen ekstra afhængighed)
# --------------------------------------------------------------------------

def _signer(payload: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    mac = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{mac}"


def _verificer(token: str) -> dict | None:
    try:
        raw, mac = token.rsplit(".", 1)
    except (ValueError, AttributeError):
        return None
    forventet = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(mac, forventet):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
    except Exception:
        return None
    if time.time() - payload.get("t", 0) > SESSION_MAX_ALDER_S:
        return None
    return payload


def _krev_session(cookie: str | None) -> dict:
    """Returnér session-payload eller kast 401. Bruges af beskyttede endpoints."""
    payload = _verificer(cookie) if cookie else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Log ind med din medlemskode.")
    return payload


# --------------------------------------------------------------------------
# Rate limiting (in-memory; nok til én proces i fase 1)
# --------------------------------------------------------------------------

class RateLimiter:
    """Pr. session: rullende time-vindue. Globalt: dagsloft, der nulstilles
    ved døgnskift. In-memory og dermed nulstillet ved genstart og ikke delt
    mellem workers — kør derfor backenden som ÉN worker i fase 1. I fase 2,
    hvor solver-job alligevel skal i kø, flyttes dette til et delt lager."""

    def __init__(self, session_loft_pr_time: int, globalt_dagsloft: int):
        self.session_loft = session_loft_pr_time
        self.globalt_loft = globalt_dagsloft
        self._laas = threading.Lock()
        self._session_hits: dict[str, deque] = defaultdict(deque)
        self._dag = ""
        self._global_taeller = 0

    def tjek_og_tael(self, sid: str) -> tuple[bool, str]:
        with self._laas:
            nu = time.time()
            dag = time.strftime("%Y-%m-%d")
            if dag != self._dag:
                self._dag, self._global_taeller = dag, 0
            if self._global_taeller >= self.globalt_loft:
                return False, "globalt_dagsloft"
            dq = self._session_hits[sid]
            while dq and nu - dq[0] > 3600:
                dq.popleft()
            if len(dq) >= self.session_loft:
                return False, "session_loft"
            dq.append(nu)
            self._global_taeller += 1
            return True, "ok"


limiter = RateLimiter(SESSION_LOFT_PR_TIME, GLOBALT_DAGSLOFT)


# --------------------------------------------------------------------------
# Værktøjer til chat-proxyen (kontrakten — uændret mellem fase 1 og 2)
# --------------------------------------------------------------------------

VAERKTOEJER = [
    {
        "name": "list_scenarier",
        "description": (
            "Returnér kataloget af forhåndsberegnede scenarier (nøgle, titel, "
            "beskrivelse, kerneparametre). Kald dette først, hvis du er i tvivl "
            "om hvilke kørsler der findes."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "run_scenario",
        "description": (
            "Hent ét scenaries resultat (manifest med nøgletal). Brug enten "
            "scenarie_id direkte (nøgle fra list_scenarier) ELLER parametre, der "
            "opløses til en kørsel. Returnerer manifestet, eller {fundet:false} "
            "med nærmeste kandidater hvis kørslen ikke er forhåndsberegnet."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "scenarie_id": {"type": "string", "description": "Direkte nøgle fra kataloget."},
                "case": {"type": "string", "description": "Hvilken case, fx 'billund_2025'."},
                "periode": {"type": "string", "description": "Navngivet periode, fx 'standard' eller '2025'."},
                "med_balancering": {"type": "boolean"},
                "enheder_fra": {"type": "array", "items": {"type": "string"},
                                "description": "Ekstra fravalgte enheder, fx ['tank_eksisterende']."},
                "overrides": {"type": "array", "items": {"type": "string"}},
            },
            "required": [],
        },
    },
]

_TILLADTE_RUN_ARGS = {"scenarie_id", "case", "periode", "med_balancering", "enheder_fra", "overrides"}


def udfoer_vaerktoej(navn: str, args: dict) -> dict:
    """Oversæt et værktøjskald fra Claude til et kald i scenario-laget."""
    if navn == "list_scenarier":
        return {"scenarier": scenarios.scenarier_som_dicts(OUTPUT_DIR)}
    if navn == "run_scenario":
        rene = {k: v for k, v in (args or {}).items() if k in _TILLADTE_RUN_ARGS}
        return scenarios.run_scenario(OUTPUT_DIR, **rene)
    return {"fejl": f"ukendt værktøj: {navn}"}


def koer_chat_loop(beskeder: list[dict]) -> dict:
    """Kør Anthropic-værktøjs-loopet til Claude er færdig med at kalde værktøjer.
    Importerer anthropic dovent, så resten af backenden kan køre/testes uden
    SDK'et og uden API-nøgle."""
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msgs = list(beskeder)
    brugte_manifester: list[dict] = []

    for _ in range(MAX_VAERKTOEJ_RUNDER):
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=GROUNDING,
            tools=VAERKTOEJER,
            messages=msgs,
        )
        if resp.stop_reason != "tool_use":
            tekst = "".join(b.text for b in resp.content if b.type == "text")
            return {"svar": tekst, "manifester": brugte_manifester}

        msgs.append({"role": "assistant", "content": resp.content})
        resultater = []
        for b in resp.content:
            if b.type == "tool_use":
                res = udfoer_vaerktoej(b.name, b.input)
                if b.name == "run_scenario" and isinstance(res, dict) and res.get("scenarie_id"):
                    brugte_manifester.append(res)
                resultater.append({
                    "type": "tool_result",
                    "tool_use_id": b.id,
                    "content": json.dumps(res, ensure_ascii=False),
                })
        msgs.append({"role": "user", "content": resultater})

    return {"svar": "Beklager — jeg kunne ikke afslutte forespørgslen.", "manifester": brugte_manifester}


# --------------------------------------------------------------------------
# Relevans-tjek (billigt filter foran det dyre kald)
# --------------------------------------------------------------------------

def _seneste_brugertekst(beskeder: list[dict]) -> str:
    """Træk teksten ud af den seneste user-besked. content kan være en streng
    eller en liste af blokke; vi samler tekst-delene."""
    for b in reversed(beskeder):
        if b.get("role") != "user":
            continue
        c = b.get("content", "")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            return " ".join(d.get("text", "") for d in c if isinstance(d, dict) and d.get("type") == "text")
    return ""


def relevans_ok(seneste_tekst: str) -> bool:
    """Billigt JA/NEJ-tjek på, om beskeden hører til emnet. Fejler ÅBENT
    (returnerer True) ved tvivl eller fejl — det er en støj-/omkostningsbremse,
    ikke en sikkerhedsgrænse. Den rigtige grænse er de skrivebeskyttede
    værktøjer og rate-limiteren."""
    if not RELEVANSTJEK or not seneste_tekst.strip():
        return True
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        r = client.messages.create(
            model=RELEVANS_MODEL,
            max_tokens=5,
            system=(
                "Svar KUN med 'JA' eller 'NEJ'. Svar JA hvis brugerens besked handler "
                "om fjernvarme, energimarkeder, balancemarkeder, denne dispatchmodel, "
                "Billund-casen, et scenarie eller hvordan værktøjet/siden virker — eller "
                "blot er en kort opfølgning eller bekræftelse. Svar NEJ kun hvis beskeden "
                "tydeligt handler om noget helt andet."
            ),
            messages=[{"role": "user", "content": seneste_tekst[:MAX_BESKED_TEGN]}],
        )
        svar = "".join(b.text for b in r.content if b.type == "text").strip().upper()
        return not svar.startswith("NEJ")
    except Exception:
        return True  # fejl åbent — usability frem for falske afvisninger


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

app = FastAPI(title="varmeflex.dk backend", version="1.0")


class LoginInd(BaseModel):
    kode: str


class ChatInd(BaseModel):
    beskeder: list[dict]  # [{role, content}, ...] — fuld historik sendes hver gang


@app.post("/api/login")
def login(krop: LoginInd, response: Response):
    if krop.kode not in KODER:
        raise HTTPException(status_code=403, detail="Ukendt kode.")
    payload = {"sid": secrets.token_hex(8), "t": int(time.time())}
    response.set_cookie(
        COOKIE_NAVN, _signer(payload),
        max_age=SESSION_MAX_ALDER_S, httponly=True, samesite="strict", secure=COOKIE_SECURE,
    )
    return {"ok": True}


@app.get("/api/scenarier")
def get_scenarier(varmeflex_session: str | None = Cookie(default=None)):
    _krev_session(varmeflex_session)
    return {"scenarier": scenarios.scenarier_som_dicts(OUTPUT_DIR)}


@app.get("/api/scenarie/{scenarie_id}")
def get_scenarie(scenarie_id: str, inkluder_serier: bool = False,
                 varmeflex_session: str | None = Cookie(default=None)):
    _krev_session(varmeflex_session)
    m = scenarios.get_manifest_by_id(scenarie_id, OUTPUT_DIR, inkluder_serier)
    if m is None:
        raise HTTPException(status_code=404, detail="Scenarie ikke fundet.")
    return m


@app.post("/api/chat")
def chat(krop: ChatInd, varmeflex_session: str | None = Cookie(default=None)):
    session = _krev_session(varmeflex_session)

    # Input-værn: bremser misbrug som generel chatbot.
    if len(krop.beskeder) > MAX_BESKEDER:
        raise HTTPException(status_code=413, detail="Samtalen er for lang. Start en ny.")
    for b in krop.beskeder:
        if isinstance(b.get("content"), str) and len(b["content"]) > MAX_BESKED_TEGN:
            raise HTTPException(status_code=413, detail="Beskeden er for lang.")

    ok, aarsag = limiter.tjek_og_tael(session["sid"])
    if not ok:
        besked = ("Dagens samlede grænse er nået — prøv igen i morgen."
                  if aarsag == "globalt_dagsloft"
                  else "Du har nået grænsen for antal spørgsmål i denne time.")
        raise HTTPException(status_code=429, detail=besked)

    # Relevans-filter foran det dyre kald.
    seneste = _seneste_brugertekst(krop.beskeder)
    if not relevans_ok(seneste):
        return {"svar": AFVISNING, "manifester": []}

    return koer_chat_loop(krop.beskeder)


@app.get("/api/sundhed")
def sundhed():
    """Letvægts-tjek: kører backenden, og hvor mange scenarier ser den?"""
    return {"ok": True, "antal_scenarier": len(scenarios.discover_manifest_paths(OUTPUT_DIR))}
