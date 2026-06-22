# STATUS — Session 7 (varmeflex.dk)

> Primær kontekstbærer til næste session. Henviser til hoveddokumenterne
> (`varmeflex_projektkontekst.md`, `run_scenario_kontrakt_v1.md`, `CLAUDE.md`,
> `STATUS_session1.md`–`STATUS_session6.md`) frem for at gentage dem.
> Leverancer denne session: **åbent punkt 1** (env-styret modelvalg) og
> **åbent punkt 3** (foresight-haircut-scope på tankværdi) fra session 6 — begge
> bygget, testet og verificeret live. Intet fra increment 1–4 rørt; to-fase-
> snittet uberørt.

## Hvor vi er
De to website-relaterede åbne punkter fra session 6 er lukket. Chat- og
filtermodel kan nu skiftes uden kodeændring (env + genstart), og grounding'en
skelner nu skarpt mellem foresight-haircut (kun balanceindtægt) og tankværdi
(ren øvre grænse, intet nedslag). Tilbage er reelt kun model-banen
(balance-modelfejlen) plus de gamle valgfrie punkter. Ingen frontend-ændring
denne session.

## Beslutninger truffet
- **Modelvalg via env, læst ved modulindlæsning (ikke pr. request):**
  `VARMEFLEX_CHAT_MODEL` (default `claude-sonnet-4-6`) og
  `VARMEFLEX_FILTER_MODEL` (default `claude-haiku-4-5-20251001`) → to
  modul-konstanter i `app.py`. Defaults er præcis de tidligere hårdkodede
  strenge, så adfærd er uændret når intet sættes. Genstart er den rette måde at
  skifte model på (systemd sætter miljøet ved opstart). De valgte modeller
  logges på én linje ved opstart (`print(..., flush=True)` → journalctl).
  *NB: navnene var allerede env-drevne, men under de gamle navne `VARMEFLEX_MODEL`
  / `VARMEFLEX_RELEVANS_MODEL` — omdøbt til de aftalte navne.*
- **Env-variablerne sat eksplicit i `/etc/varmeflex/varmeflex.env`** (til defaults,
  med eksempel-kommentar). De er konfiguration, ikke hemmeligheder; sat til
  defaults, så adfærd er uændret. Filen ligger uden for git.
- **Foresight-haircut-scope (åbent punkt 3):** valgt løsning = tankværdien
  præsenteres som **ren perfekt-forudsigelses-øvre-grænse uden de 15 %** (ikke et
  eget tank-haircut). De ~15 % er kalibreret til balanceindtægt og overføres
  ikke. Et tank-specifikt haircut ville kræve et imperfekt-foresight-kør
  (rullende horisont), som ikke findes endnu — indtil da opfindes intet nedslag.

## Backend (as-built)
- **`app.py`:** `MODEL = os.environ.get("VARMEFLEX_CHAT_MODEL", "claude-sonnet-4-6")`
  og `RELEVANS_MODEL = os.environ.get("VARMEFLEX_FILTER_MODEL",
  "claude-haiku-4-5-20251001")`; opstartslog-linje; docstring-blok opdateret.
- **`grounding_da.md`:** nyt afsnit "Foresight-haircut: gælder balanceindtægt,
  ikke tankværdi" ved siden af "balance under validering"-blokken; foresight-
  linjen i "Absolutte regler om tal" strammet, så de to afsnit udgør én
  sammenhængende behandling uden modsigelse (kun én version af hvad haircut'et
  gælder).
- **`tests/test_app.py`:** ny ren konfigurationstest (intet API-kald): konstanterne
  falder tilbage til defaults uden env og tager env-værdien ved (gen)indlæsning
  (`importlib.reload`), rydder op bagefter.

## Versionsstyring (as-built)
- **Remote:** `origin` → https://github.com/skj-1964/varmeflex, branch `main`.
- **Pushet:** `81cef51..e37a251` — to commits på `origin/main`:
  - `2eefd7d` backend: modelvalg via env (`app.py`, `test_app.py`).
  - `e37a251` grounding: foresight-haircut gælder kun balanceindtægt, ikke tankværdi.
- Hemmeligheder + env fortsat kun i `/etc/varmeflex`.

## Verificeret
- **Testsuite grøn** inkl. de to nye konfigurations-assertions (default-fallback +
  env-override).
- **Service genstartet**, `/api/sundhed` → 3 scenarier OK.
- **journalctl ved opstart:** `varmeflex: chat-model=claude-sonnet-4-6
  filter-model=claude-haiku-4-5-20251001`.
- **Chat-gentest (ægte Anthropic-kald, mod genstartet service), 3 prompts inkl.
  den pressende "skal der ikke trækkes 15 % fra"-type (prompt-5-typen fra
  session 6, som tidligere fejlede):**
  - Tankværdi holdes på **~6,0 mio. DKK/år som øvre grænse** — **intet 15 %
    fradrag** (rettelse af session 6's ~5,1 mio).
  - Forklarer kvalitativt hvorfor balance-haircut'et ikke overføres til tanken
    (prognose-robust spotpris-arbitrage vs. timing-følsom balanceaktivering).
  - Holder "balance under validering" adskilt; nægter balance-kr. som facit.

## Lukket denne session
- **Åbent punkt 1 (modelvalg env-styret):** bygget, testet, verificeret, pushet,
  og env-vars sat i `/etc/varmeflex`. LUKKET.
- **Åbent punkt 3 (foresight-haircut-scope på tankværdi):** grounding-fix bygget
  og chat-verificeret live. LUKKET.

## Åbne punkter (videreført fra session 6)
1. **Balance-modelfejl** (fra session 1, uændret) — skal fixes, før balance-
   indtægt præsenteres som resultat. Diagnose i `STATUS_session1.md`. (Model-bane,
   uden for website-sporet.)
2. **Fra tidligere, stadig uafklaret:** aktiveringspris-figur (valgfri); hvilke
   scenarier ud over A/B/C i cachen (pris-akse via `--set`); video-omfang;
   `[BEKRÆFT]`-værdier i `billund_2025.yaml`.

## Referencetal
Uændret katalog og tal fra session 6 (tre A/B/C-manifester). Tankværdi A − B =
**+6,0 mio. DKK/år (perfekt forudsigelse — øvre grænse, intet haircut)**;
C-par bærer fortsat "under validering"-forbeholdet.

## Kommandoer til reference
```bash
# Skift model: ret /etc/varmeflex/varmeflex.env og genstart
sudo systemctl restart varmeflex
journalctl -u varmeflex --since "1 min ago" | grep chat-model

# Testsuite — brug venv'en (fastapi ligger der)
cd /opt/varmeflex/backend && VARMEFLEX_COOKIE_SECURE=0 PYTHONPATH=. venv/bin/python tests/test_app.py

# Git (alt pushet til origin/main; seneste HEAD = e37a251)
cd /opt/varmeflex && git status && git log --oneline -6

# Service
systemctl status varmeflex.service
curl -s https://varmeflex.dk/api/sundhed
```
