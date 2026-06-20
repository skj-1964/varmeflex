# STATUS — Session 2 (varmeflex.dk)

> Primær kontekstbærer til frontend-sessionen. Henviser til hoveddokumenterne
> (`varmeflex_projektkontekst.md`, `run_scenario_kontrakt_v1.md`, `CLAUDE.md`,
> `STATUS_session1.md`) frem for at gentage dem.
> Leverancer denne session: fase 1-backenden bygget, testet og **verificeret
> mod ægte data på serveren**; manifest-fejl fundet og rettet; variant-
> etiketter tilføjet til kataloget.

## Hvor vi er
Fase 1-backenden kører på serveren mod **ægte manifester**. `scenarios.py`
(bagsiden af `run_scenario`), `app.py` (gate, rate limiting, scenario-endpoints,
chat-proxy) og `grounding_da.md` ligger i `/opt/varmeflex/backend` og er
verificeret: tests grønne mod fiksturer, og `/api/sundhed` + `/api/login` +
`/api/scenarier` svarer korrekt mod de tre rigtige A/B/C-kørsler i
`/opt/fjernvarme-businesscase/output`. Kontrakten holdt uændret — de eneste
ændringer var data-siden (manifest-skriver) og et additivt `variant_label`-felt.
Næste store stykke er frontenden.

## Arkitektur og placering (as-built)
- Ét projektrod: **`/opt/varmeflex`** (websitet, eget git-repo). Modellen:
  **`/opt/fjernvarme-businesscase`** (søskende under `/opt`).
- Lag: Apache (TLS, statisk, login) → FastAPI på `127.0.0.1:8001` (`/api`) →
  scenario-laget (læser `output/`).
- **Kun `frontend/` er web-serveret** (Apache `DocumentRoot=/opt/varmeflex/frontend`).
  `backend/`, `doc/` og hemmeligheder ligger uden for DocumentRoot.
- API-nøgle KUN i backend-miljø; aldrig i frontend eller git.
- Mapper: `backend/` (app.py, scenarios.py, grounding_da.md, requirements.txt,
  output_demo/, tests/), `frontend/` (tom — næste session), `deploy/`
  (varmeflex.apache.conf), `doc/` (kontrakt + STATUS), `CLAUDE.md` i roden.

## Beslutninger truffet
- **Backend-sprog:** Python/FastAPI bag Apache reverse proxy. Afgørende:
  fase 2 kalder modellen (Python) live → samme økosystem, intet bro-søm.
- **Adgang:** gated for Dansk Fjernvarmes medlemmer — delt medlemskode →
  signeret session-cookie (stdlib HMAC). Ingen brugerkonti.
- **Rate limiting:** pr. session (rullende time) + globalt dagligt loft.
  In-memory → kør ÉN uvicorn-worker i fase 1.
- **Jailbreak-/emne-disciplin (lagdelt, vigtigst først):** (1) værktøjerne er
  skrivebeskyttede opslag → lille skadesradius er den reelle beskyttelse;
  (2) gate + rate limit = omkostningsloft; (3) systemprompt med emne-
  afgrænsning + instruktions-immunitet (`grounding_da.md`); (4) Haiku-
  relevansfilter foran det dyre kald (fejler ÅBENT); (5) input-værn
  (beskedlængde + antal).
- **Bisidder-workflow:** arkitektur/beslutninger i projekt-chatten; Claude Code
  på serveren udfører det praktiske. `CLAUDE.md` er grundloven (læses
  automatisk fra repo-roden, overlever `/compact`).
- **Manifest selvbeskrivende:** `enheder_fra` skal afspejle ALT der er slået fra,
  inkl. lagre (`tank_eksisterende` ligger i `cfg.storage`, ikke `cfg.units`).
  Rettet i `src/manifest.py` (commit `2b5f94e`).
- **Cert:** `kramerjensen.dk`-certifikatet er et SAN, der dækker `varmeflex.dk`
  + `www` — gyldigt, intet separat cert nødvendigt.

## Endpoints (til frontenden)
- `POST /api/login` `{kode}` → sætter cookie (403 ved forkert kode)
- `GET /api/scenarier` → `{scenarier:[…]}` med `scenarie_id`, `titel`,
  `beskrivelse`, **`variant_label`**, koersel-felter, `model_commit`
- `GET /api/scenarie/{id}?inkluder_serier=bool` → manifestet (+ `_serier` hvis sat)
- `POST /api/chat` `{beskeder:[{role,content}]}` → `{svar, manifester}`
  (kræver session; rate-limitet; kræver `ANTHROPIC_API_KEY`)
- `GET /api/sundhed` → `{ok, antal_scenarier}`

## Referencetal
Tre ægte A/B/C-manifester i `output/` (alle: billund_2025, hele 2025, github):
- **C** `billund_2025__gh__2025__bal-av` — med tank, med balancemarked — commit `f6a54f2`
- **A** `billund_2025__gh__2025` — med tank, uden balancemarked — commit `f6a54f2`
- **B** `billund_2025__gh__2025__off-tank_eksisterende` — uden tank, uden
  balancemarked — commit `2b5f94e` (efter manifest-fix)

**Balance-tallene er stadig urimeligt høje (modelfejl fra session 1, uændret).
Brug dem IKKE i kommunikation eller figurer endnu — kun rørene er valideret,
ikke tallene.**

## Åbne punkter
1. **Balance-indtægt modelfejl (model-bane, fra session 1)** — uændret.
   Diagnose i `STATUS_session1.md`. Skal fixes før tal præsenteres.
2. **`ANTHROPIC_API_KEY` ikke sat på serveren endnu** → `/api/chat` og
   relevansfilteret er ikke live-testet. Sæt nøgle (uden for git) og kør én
   rigtig chat-runde.
3. **Valgfri manifest-forbedring:** state-baseret `enheder_fra` fra
   `cfg.storage` (i stedet for `args.disable`-foreningen). Identisk output for
   nuværende scenarier; ren robusthed. Måske ikke anvendt endnu.
4. **A og C på commit `f6a54f2`** (før storage-fix). Output er identisk (de
   fravælger ikke lager), men kan køres om på fixet commit for provenans-renhed.
   Minor.
5. **Secrets/systemd + Apache-aktivering** afventer frontenden (vhost ligger
   klar i `deploy/`, ikke aktiveret endnu).
6. **Fra projektkontekst, stadig uafklaret:** hvilke scenarier ud over A/B/C i
   cachen (pris-akse via `--set` senere), video-omfang.

## Næste skridt (frontend-sessionen)
1. **Byg `frontend/`** — rent statisk site (HTML/CSS/vanilla JS), serveret af
   Apache fra `frontend/`. Anbefalet frem for SPA: passer arkitekturen, ingen
   byggekæde, Claude Code bygger direkte i `frontend/`.
   - **Login-side:** medlemskode → `POST /api/login`.
   - **Chat-grænseflade:** send fuld beskedhistorik til `POST /api/chat`; render
     `svar` + evt. `manifester`.
   - **Figurvisning:** figurer kommer fra ægte output — `dispatch.png` via
     manifestets `filer`-felt, eller tegnet programmatisk fra `hourly.csv`
     (`inkluder_serier=True`). ALDRIG tegnet af billedmodel, aldrig pyntetal.
   - **Scenario-menu:** vis `titel` + `variant_label` fra `/api/scenarier`.
2. **Sæt secrets + aktivér deploy** — `ANTHROPIC_API_KEY` + `VARMEFLEX_SECRET`
   + `VARMEFLEX_KODER` (rigtig medlemskode) i `/etc/varmeflex/varmeflex.env`;
   systemd-unit til uvicorn; `a2enmod proxy proxy_http rewrite ssl`; aktivér
   vhost → end-to-end gated demo over HTTPS.
3. **Live chat-test** mod ægte manifester, når nøglen er sat.

## Kommandoer til reference
```bash
# Backend lokalt mod ægte output (én worker)
cd /opt/varmeflex/backend && source venv/bin/activate
MODEL_OUTPUT_DIR=/opt/fjernvarme-businesscase/output VARMEFLEX_COOKIE_SECURE=0 \
  uvicorn app:app --host 127.0.0.1 --port 8001

# Tests mod fiksturer
VARMEFLEX_COOKIE_SECURE=0 PYTHONPATH=. python3 tests/test_app.py

# A/B/C i modellen
cd /opt/fjernvarme-businesscase
python run_case.py cases/billund_2025.yaml --data-source github --with-balancing               # C
python run_case.py cases/billund_2025.yaml --data-source github                                 # A
python run_case.py cases/billund_2025.yaml --data-source github --disable tank_eksisterende     # B
```