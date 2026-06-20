# CLAUDE.md — varmeflex.dk

## Hvad det er
varmeflex.dk er et offentligt demonstrationswebsite for en åben MILP-
dispatchmodel for dansk fjernvarme. Pilotcase: Billund Varmeværk. Målgruppe:
fagfolk fra fjernvarmeværker og Dansk Fjernvarmes medlemmer. Siden viser, hvad
modellen kan, og er samtidig bevis på, at en domæneekspert kan bygge avancerede
analyseværktøjer med AI-assistance.

**Dette repo er WEBSITET.** Modellen ligger i et SEPARAT repo
(`../fjernvarme-businesscase`, klonet under `/opt`). Rør aldrig modelrepoet
herfra — websitet LÆSER kun dens `output/`.

## Arbejdsdeling (læs dette)
Arkitektur- og designbeslutninger træffes i Claude-projektet "Varmeflex"
(chatten), hvor den fulde kontekst og STATUS-filerne lever. Du, Claude Code,
udfører det praktiske i det rigtige miljø: placerer filer, kører modellen,
starter backend, redigerer Apache/systemd, kører tests. Ved tvivl om en
arkitekturbeslutning: følg `doc/`, og spørg brugeren frem for at gætte.

## Den supreme regel: to faser, ét snit
Siden bygges i to faser, men arkitektureres som én. Der findes ÉN
værktøjsgrænseflade — `run_scenario` / `list_scenarier`. I fase 1 slår den op i
en cache af forhåndsberegnede scenarier (manifester i modellens `output/`). I
fase 2 kalder samme grænseflade HiGHS-solveren live.

ALDRIG byg noget i fase 1, som skal kasseres i fase 2. Kun "ikke fundet"-grenen
i `scenarios.run_scenario` skifter mellem faserne. Bryder en ændring dette snit,
så SIG det i stedet for at gøre det.

## Kontrakten
`run_scenario`/`output/`-kontrakten og manifest-skemaet er autoritativt
beskrevet i `doc/run_scenario_kontrakt_v1.md`. `output/` ER sandheden om hvilke
scenarier der findes; hver kørsel skriver en selvbeskrivende
`{stem}_manifest.json`. Gentag ikke skemaet — læs det derfra.

## Sikkerhed (fra start, ikke eftertanke)
- `ANTHROPIC_API_KEY` må ALDRIG ligge i frontend eller i git. Kun i backend-
  processens miljø (systemd-unit eller en `.env` uden for git).
- Adgang er gated: en medlemskode byttes til en signeret session-cookie.
- Rate limiting: pr. session + globalt dagligt loft. Kør backend som ÉN worker
  i fase 1 (limiteren er in-memory).
- Værktøjerne er skrivebeskyttede opslag. Tilføj ALDRIG et værktøj, der kan
  ændre, slette eller sende noget, uden eksplicit aftale.

## Faglig præcision
- Alt på dansk: kode-kommentarer, tekst, commit-beskeder, dokumenter.
- Datafigurer (revenue-split, tankniveau, dispatch) genereres ALTID
  programmatisk fra modellens faktiske output. Aldrig "tegnet" af en
  billedmodel, aldrig pyntetal.
- Forretningscasen er DIFFERENTIEL: værdi = forskel mellem parrede scenarier
  (C−A = balancemarked, A−B = tank), ikke absolutte tal.
- Perfekt forudsigelse er en ØVRE GRÆNSE, ikke en prognose; ~15% foresight-
  haircut nævnes ved balanceindtægt.
- Anlægssandhed: YAML-filerne i modellen er autoritative for anlægget — ikke
  prosa-beskrivelser. Rapporten bruges kun som metode-kontekst, aldrig til tal.

## Output-konventioner
- Arbejdsdokumenter i Markdown; formelle leverancer i Word. Sammenhængende
  prosa frem for punktopstilling i formelle tekster.
- Ved komplekse ændringer: lever komplette filer, ikke beskrevne diffs.
- Hold dokumentation minimal — henvis til `doc/` frem for at gentage.
- Brugeren har 25+ års fjernvarme-domæneviden og lidt PHP/Python. Forklar
  tekniske valg tilgængeligt; antag ikke programmeringsvaner som indforståede.

## Struktur
```
backend/   FastAPI: app.py, scenarios.py, grounding_da.md, requirements.txt, tests/
frontend/  statiske filer (Apache serverer dem direkte)
deploy/    apache-conf + systemd-unit
doc/       STATUS-filer + run_scenario_kontrakt_v1.md
```

## Kør og test
- Backend: `uvicorn app:app --host 127.0.0.1 --port 8001` (én worker).
- Miljø: `MODEL_OUTPUT_DIR` peger på `../fjernvarme-businesscase/output`;
  `VARMEFLEX_KODER` og `VARMEFLEX_SECRET` sættes uden for git.
- Tests: `VARMEFLEX_COOKIE_SECURE=0 python3 tests/test_app.py` (lokal HTTP).
- Sundhedstjek: `GET /api/sundhed` viser antal scenarier set i `output/`.

## Sessionskontinuitet
Væsentlige sessioner opsummeres i en STATUS-fil (`doc/STATUS_session*.md`) via
projekt-chatten. Når du laver større ændringer her, så notér dem, så de kan med
i næste STATUS.
