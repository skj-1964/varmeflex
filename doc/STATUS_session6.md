# STATUS — Session 6 (varmeflex.dk)

> Primær kontekstbærer til næste session. Henviser til hoveddokumenterne
> (`varmeflex_projektkontekst.md`, `run_scenario_kontrakt_v1.md`, `CLAUDE.md`,
> `STATUS_session1.md`–`STATUS_session5.md`) frem for at gentage dem.
> Leverancer denne session: **increment 4** (sammenligning reference vs
> alternativ) bygget, testet og browser-verificeret; git-remote sat op og pushet;
> **increment 4.1** (fortegns-vending + balance-forbehold i grounding) bygget,
> testet og chat-verificeret live. Intet fra increment 1–3 rørt.

## Hvor vi er
Sammenligningen er live og fuldt afklaret. Brugeren vælger to vilkårlige kørsler
fra `output/` — en reference og et alternativ — og ser alternativets kurver
(uændret `figurer.js`) med resultaterne som differensen alternativ − reference.
Den økonomiske værdi vises nu med korrekt fortegn (omkostnings-konvention vendt),
og både frontend-badge OG chat tager nu balance-forbeholdet konsistent. De to
sidste website-relaterede usikkerheder (fortegn + chat/badge-konsistens) er
lukket. Tilbage på listen er reelt kun env-modelvalg i chatten og selve
balance-modelfejlen (model-bane), plus et lille nyt haircut-scope-spørgsmål.

## Beslutninger truffet
- **Differensen beregnes i backend** — domænelogik (differentiel/invariant/
  forbeholds-ramt) server-side, én sandhed, genbrugbar af chatten. Frontenden
  renderer kun.
- **Rammefri sammenligning:** `sammenlign_manifester()` er generisk over felterne,
  ingen A/B/C-viden. Vilkårlig parring, inkl. fremtidige kørsler.
- **Enheds-union:** differensen tager unionen af enhedsnavne; en enhed kun i den
  ene → 0 i den anden. Bærer "ekstra motor"-casen.
- **Forbehold er manifest-drevet, ikke id-drevet:** udløses af
  `koersel.med_balancering = true` på ref ELLER alt — gælder balance-Δ og
  objektiv-Δ. A − B (ingen balancering) er rent præsentabel; balancering-par
  arver forbeholdet.
- **`null`-balance = 0 i differensen** — korrekt semantik.
- **Fortegnskonvention:** `objektiv_dkk` er en **omkostning** (lavere = bedre).
  Økonomisk værdi = **−Δobjektiv**, forbedring vises positivt. Gælder kun
  penge-objektivet; fysiske Δ'er (co2, produktion, nettab) vises rå med fortegn;
  `balanceindtaegt_dkk` (indtægt) vendes ikke. Implementeret i backend (afledt
  felt `oekonomisk_vaerdi_dkk`) + frontend + grounding.
- **Balance-forbehold i grounding:** chatten må aldrig præsentere balance-kr.
  (i alt/aFRR/mFRR) som gyldigt resultat, heller ikke under pres; objektiv-Δ for
  balancering-par arver forbeholdet; mekanismen forklares kvalitativt; eksplicit
  adskilt fra foresight-haircut'et.
- **Soft sammenlignelighed:** advarsler ved forskellig case/periode/varmebehov,
  blokerer aldrig.
- **Endpoint let:** `/api/sammenlign` returnerer kun tal (ingen `_serier`);
  kurver hentes separat via `/api/scenarie/{alternativ}?inkluder_serier=true`.

## Backend (as-built)
- **`scenarios.py`:** `sammenlign_manifester()` + hjælpere (felt-diff,
  enheds-union, manifest-drevet forbehold, soft sammenlignelighed). 4.1: nyt
  afledt felt `differens.oekonomisk_vaerdi_dkk = −objektiv_dkk`; rå `objektiv_dkk`
  beholdt for sporbarhed; forbeholdet urørt.
- **`app.py`:** `GET /api/sammenlign?reference={id}&alternativ={id}` —
  skrivebeskyttet, bag gate, ikke rate-limitet, ingen `_serier`. Ukendt id → 404.
- **`grounding_da.md`:** to nye blokke (balance under validering; fortegns-
  konvention) nær foresight-haircut-forbeholdet.

## Frontend (as-built, rent additivt)
- **`api.js`:** `sammenlign(refId, altId)` → `/api/sammenlign`.
- **`app.js`:** to select-lister + "Sammenlign"-knap i menu-aside; parallel
  render-vej `vaelgSammenligning`/`tegnSammenligning`; kalder uændret
  `VarmeflexFigurer.tegn(alternativManifest)`. 4.1: leder nu med "Økonomisk værdi
  (alternativ vs reference)" + fortegn + label (positiv = besparelse), rå
  omkostnings-Δ som sekundær linje; badge på C-par uændret. Enkelt-visningen urørt.
- **`css/varmeflex.css`:** sammenlignings-styling i samme palet.

## Versionsstyring (as-built)
- **Remote:** `origin` → **https://github.com/skj-1964/varmeflex**, branch `main`.
- **Pushet (increment 4):** `584e997..3b3b2f5` (STATUS5-efterslæb + increment 4).
- **Pushet (increment 4.1):** `3b3b2f5..b15899e` — to commits, bekræftet på
  `origin/main`:
  - `b94e174` grounding: balance-forbehold + fortegnskonvention i `grounding_da.md`.
  - `b15899e` kode: fortegns-vending (`scenarios.py`, `app.js`, `test_app.py`).
- Hemmeligheder fortsat kun i `/etc/varmeflex`; `venv/` + `*.env` i `.gitignore`.

## Verificeret
- **Testsuite: 27/27 OK** (inkl. to nye fortegns-assertions).
- **`/api/sammenlign` live:** A vs B → `oekonomisk_vaerdi_dkk` +6.018.402, rå
  `objektiv_dkk` −6.018.402; C vs A → +220.219.554, rå −220.219.554,
  `balance_under_validering=true`. Matcher acceptkriterierne.
- **Future-proof union:** alternativ med `gasmotor_2` kun i den ene → ref=0,
  diff=produktion, ingen crash.
- **Chat-gentest (5 prompts, mod genstartet service, ægte Anthropic-kald):**
  alle fem består.
  - 1–4: holder balance-forbeholdet konsekvent, også under direkte pres; ingen
    balance-kr./aFRR/mFRR som facit; skelner eksplicit fra haircut.
  - 5: tankværdi ~6,0 mio. DKK/år som "ren besparelse" (korrekt positivt fortegn),
    intet balance-forbehold. (Anvendte ~15 % haircut → ~5,1 mio — se åbent punkt 3.)
- **Browser (increment 4 + 4.1):** lister, ref+alt-valg, kurver via eksisterende
  `tegn()`, periodevælger, Δ-tal, badge, advarsler samt den vendte økonomisk-
  værdi-overskrift (positiv ved besparelse) — bekræftet af bruger.

## Referencetal
Uændret katalog: tre ægte A/B/C-manifester i `output/` (C `…__bal-av`,
A `…__2025`, B `…__off-tank_eksisterende`).

| Par | Rå Δobjektiv (omkostning) | Økonomisk værdi (−Δ) | Δbalance | Forbehold |
| --- | --- | --- | --- | --- |
| C − A (balancemarked) | −220.219.554 | +220.219.554 | 292.123.161 | under validering |
| A − B (tank) | −6.018.402 | **+6.018.402** | — | rent |

**Balance-tallene er stadig urimeligt høje (modelfejl fra session 1, uændret).
A − B er ikke ramt (ingen balancering) og er rent præsentabel: tankværdi
+6,0 mio. (perfekt forudsigelse — øvre grænse). C-par bærer fortsat
"under validering"-forbeholdet.**

## Lukket denne session
- **Fortegn (tidl. åbent punkt 1):** afklaret + implementeret (backend/frontend/
  grounding) + verificeret. LUKKET.
- **Chat/badge-konsistens (tidl. åbent punkt 4):** grounding-fix bygget og
  chat-verificeret (5/5). LUKKET.
- **Git-remote + commit increment 4:** sat op og pushet. LUKKET.
- **Push af 4.1-commits (tidl. åbent punkt 4):** `b94e174` (grounding) + `b15899e`
  (kode) bekræftet på `origin/main`; lokal i sync. LUKKET.
- **Bruger-browser-tjek af sammenlignings-overskriften (tidl. åbent punkt):**
  økonomisk værdi vist positiv ved besparelse, badge uændret på C-par — bekræftet
  i browser af bruger. LUKKET.

## Åbne punkter
1. **Modelvalg i chat env-styret** (udskudt fra session 5, uændret):
   `VARMEFLEX_CHAT_MODEL` (default `claude-sonnet-4-6`) + `VARMEFLEX_FILTER_MODEL`
   (default `claude-haiku-4-5-20251001`) læst i `app.py` med defaults.
2. **Balance-modelfejl** (fra session 1, uændret) — skal fixes, før
   balance-indtægt præsenteres som resultat. Diagnose i `STATUS_session1.md`.
3. **Foresight-haircut på tankværdi — scope (NY, lille):** chatten lagde de ~15 %
   (anbefalet til *balanceindtægt*) oven på tankværdien. Tankværdien er en blandet
   størrelse (prognose-robust fleksibilitet + foresight-følsom arbitrage), så
   balance-tallet overføres ikke nødvendigvis 1:1. Beslut: enten præsentér
   tankværdien som perfekt-forudsigelses-øvre-grænse *uden* de 15 %, eller giv
   tanken sit eget haircut-tal. Én linje i `grounding_da.md`.
4. **Fra tidligere, stadig uafklaret:** aktiveringspris-figur (valgfri); hvilke
   scenarier ud over A/B/C i cachen (pris-akse via `--set`); video-omfang;
   `[BEKRÆFT]`-værdier i `billund_2025.yaml`.

## Næste skridt
1. **Beslut haircut-scope for tankværdi** (åbent punkt 3) → evt. én grounding-linje.
2. **Modelvalg env-styret** (åbent punkt 1) — brief klar fra session 5.
3. **Model-bane (uden for website-sporet):** balance-indtægt-fejlen.

## Kommandoer til reference
```bash
# Sammenlign to kørsler (nu med oekonomisk_vaerdi_dkk)
curl -s "https://varmeflex.dk/api/sammenlign?reference=billund_2025__gh__2025&alternativ=billund_2025__gh__2025__bal-av" \
  --cookie "<session-cookie>"

# Testsuite (27/27)
cd /opt/varmeflex/backend && VARMEFLEX_COOKIE_SECURE=0 PYTHONPATH=. python3 tests/test_app.py

# Git
cd /opt/varmeflex && git status && git log --oneline -6
git push origin main          # hvis 4.1-commits ikke er pushet

# Service
systemctl status varmeflex.service
journalctl -u varmeflex.service -f
curl -s https://varmeflex.dk/api/sundhed
```