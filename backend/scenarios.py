"""
scenarios.py — scenario-opdagelse og -opslag for varmeflex.dk (fase 1)

Dette modul er bagsiden af run_scenario-kontrakten, fase 1-udgaven.
Det læser modellens output/-katalog og finder de manifester, hver kørsel
har lagt der ({stem}_manifest.json). output/ ER sandheden om hvilke
scenarier der findes — der vedligeholdes ingen separat liste ved siden af.

Kontrakt: run_scenario_kontrakt_v1.md. Manifest-skemaet er beskrevet i
afsnit 3 dér; dette modul gentager det ikke, men læser det.

Designvalg, det er værd at kende:

  * Modulet er rammefrit (kun stdlib). FastAPI-laget ovenpå pakker disse
    funktioner ind, men logikken her kan testes og køres alene.

  * Den primære indgang er opslag på scenarie_id (den entydige nøgle).
    Hjemmesiden viser list_scenarier() og giver den valgte nøgle tilbage;
    så er der intet filnavn at rekonstruere.

  * Parameter-indgangen (case/periode/med_balancering/...) matcher mod
    manifesternes koersel-felter — ikke mod et genskabt filnavn. Det
    holder os fri af at duplikere modellens navngivningslogik, og det er
    nøjagtig den samme matchning, der gælder i fase 2. (Scenarie-identitet
    udledes af koersel-felterne, jf. beslutningen i STATUS_session1.)

  * Fase 2 ændrer KUN "ikke fundet"-grenen (kø + live solve). Alt andet
    her er fælles for begge faser. Derfor kasseres intet i dette modul,
    når vi senере skifter cache-bagsiden ud med solveren.
"""
from __future__ import annotations

import csv
import json
import os
from collections import defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

MANIFEST_SUFFIX = "_manifest.json"

# Hvor modellens output/ ligger. Sættes i drift via miljøvariabel, så
# backenden kan pege på det rigtige katalog uden kodeændring.
DEFAULT_OUTPUT_DIR = Path(os.environ.get("MODEL_OUTPUT_DIR", "../output"))


# --------------------------------------------------------------------------
# Typer
# --------------------------------------------------------------------------

@dataclass
class ScenarieResume:
    """Det, list_scenarier() returnerer per kørsel: kerneparametre til menuen.

    Bevidst en delmængde af manifestet — nok til at hjemmesiden kan vise
    en valgliste, og til at parameter-matchningen kan skelne scenarier."""
    scenarie_id: str
    titel: str
    beskrivelse: str
    gruppe: str | None
    rolle_i_gruppe: str | None
    case_name: str
    periode: dict[str, Any]
    med_balancering: bool
    enheder_fra: list[str]
    overrides: list[str]
    solve_status: str | None
    model_commit: str | None
    variant_label: str = ""        # afledt menu-etiket; udfyldes af list_scenarier
    # Kort, skelnende etiket udledt af de akser, der varierer i gruppen
    # (fx "med tank · uden balancemarked"). Sættes af list_scenarier, fordi
    # det kræver at se hele gruppen — ikke det enkelte manifest.
    variant_label: str = ""


# --------------------------------------------------------------------------
# Opdagelse og indlæsning
# --------------------------------------------------------------------------

def _output_dir(output_dir: str | os.PathLike | None) -> Path:
    return Path(output_dir) if output_dir is not None else DEFAULT_OUTPUT_DIR


def discover_manifest_paths(output_dir=None) -> list[Path]:
    """Alle *_manifest.json i output/. Tom liste hvis kataloget ikke findes."""
    d = _output_dir(output_dir)
    if not d.is_dir():
        return []
    return sorted(d.glob(f"*{MANIFEST_SUFFIX}"))


def load_manifest(path) -> dict:
    # UTF-8 eksplicit: manifesterne indeholder æ/ø/å. På Windows ville
    # default-encoding (cp1252) ellers fejle — samme grund som skrivesiden
    # i src/manifest.py tvinger UTF-8.
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_all_manifests(output_dir=None) -> list[dict]:
    """Læs hele kataloget. En enkelt defekt fil vælter ikke resten."""
    out: list[dict] = []
    for p in discover_manifest_paths(output_dir):
        try:
            out.append(load_manifest(p))
        except (json.JSONDecodeError, OSError):
            continue
    return out


# --------------------------------------------------------------------------
# list_scenarier()
# --------------------------------------------------------------------------

def _resume_from_manifest(m: dict) -> ScenarieResume:
    meta = m.get("meta", {})
    koersel = m.get("koersel", {})
    spor = m.get("sporbarhed", {})
    return ScenarieResume(
        scenarie_id=m.get("scenarie_id", ""),
        # titel falder tilbage til case_name, så menuen aldrig er tom.
        titel=meta.get("titel") or meta.get("case_name") or m.get("scenarie_id", ""),
        beskrivelse=meta.get("beskrivelse", ""),
        gruppe=meta.get("gruppe"),
        rolle_i_gruppe=meta.get("rolle_i_gruppe"),
        case_name=meta.get("case_name", ""),
        periode=koersel.get("periode", {}),
        med_balancering=bool(koersel.get("med_balancering", False)),
        enheder_fra=list(koersel.get("enheder_fra", [])),
        overrides=list(koersel.get("overrides", [])),
        solve_status=spor.get("solve_status"),
        model_commit=spor.get("model_commit"),
    )


# Pæne danske navne til kendte komponenter i menu-etiketter. Ukendte
# komponenter falder tilbage til deres rå nøgle.
_PAENE_NAVNE = {"tank_eksisterende": "tank"}


def list_scenarier(output_dir=None) -> list[ScenarieResume]:
    """Kataloget: ét resumé per tilgængelig kørsel i output/, beriget med en
    variant-etiket der adskiller scenarier i samme gruppe (fx 'med tank ·
    uden balancemarked')."""
    resumeer = [_resume_from_manifest(m) for m in load_all_manifests(output_dir)]
    _tilfoej_variant_etiketter(resumeer)
    return resumeer


def _tilfoej_variant_etiketter(resumeer: list[ScenarieResume]) -> None:
    """Sæt variant_label på hvert resumé. Etiketten beskriver KUN de akser, der
    faktisk varierer inden for gruppen — så et katalog med en pris-akse senere
    automatisk får '… · prices.natural_gas.value=500' uden kodeændring her."""
    grupper: dict[str, list[ScenarieResume]] = defaultdict(list)
    for r in resumeer:
        grupper[r.gruppe or r.case_name].append(r)
    for gruppe in grupper.values():
        _etiketter_for_gruppe(gruppe)


def _etiketter_for_gruppe(gruppe: list[ScenarieResume]) -> None:
    if len(gruppe) < 2:
        return  # alene i gruppen → titlen er nok, ingen variant-etiket

    # Standard-fravalg = enheder slået fra i HVER kørsel (støj, ikke en akse).
    fravalg = [set(r.enheder_fra) for r in gruppe]
    defaults = set.intersection(*fravalg) if fravalg else set()
    meaningful = [s - defaults for s in fravalg]

    # Hvilke akser varierer inden for gruppen?
    toggled = sorted(set().union(*meaningful)) if meaningful else []
    bal_varierer = len({r.med_balancering for r in gruppe}) > 1
    ovr_varierer = len({tuple(r.overrides) for r in gruppe}) > 1

    for r, m in zip(gruppe, meaningful):
        dele: list[str] = []
        for komp in toggled:
            navn = _PAENE_NAVNE.get(komp, komp)
            dele.append(f"uden {navn}" if komp in m else f"med {navn}")
        if bal_varierer:
            dele.append("med balancemarked" if r.med_balancering else "uden balancemarked")
        if ovr_varierer and r.overrides:
            dele.extend(r.overrides)
        r.variant_label = " · ".join(dele)


def scenarier_som_dicts(output_dir=None) -> list[dict]:
    """Som list_scenarier(), men JSON-klar — bruges af API-laget."""
    return [asdict(r) for r in list_scenarier(output_dir)]


# --------------------------------------------------------------------------
# Tidsserier (kun når en figur skal tegnes)
# --------------------------------------------------------------------------

def load_hourly_series(stem, output_dir=None) -> dict[str, list]:
    """Læs {stem}_hourly.csv som kolonner: {kolonnenavn: [værdier]}.

    Vedhæftes kun når inkluder_serier=True; ellers refereres CSV'en blot
    via filsti i manifestets filer-sektion, så den kan hentes ved behov."""
    d = _output_dir(output_dir)
    path = d / f"{stem}_hourly.csv"
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        return {}
    header, *data = rows
    cols: dict[str, list] = {h: [] for h in header}
    for r in data:
        for h, v in zip(header, r):
            cols[h].append(v)
    return cols


def _maybe_attach_series(m: dict, output_dir: Path, inkluder_serier: bool) -> dict:
    if not inkluder_serier:
        return m
    filer = m.get("filer", {})
    hourly = filer.get("hourly_csv", "")
    if hourly.endswith("_hourly.csv"):
        stem = hourly[: -len("_hourly.csv")]
    else:
        stem = m.get("scenarie_id", "")
    m = dict(m)  # kopi, så vi ikke muterer noget genbrugt
    m["_serier"] = load_hourly_series(stem, output_dir)
    return m


# --------------------------------------------------------------------------
# Direkte opslag på nøgle
# --------------------------------------------------------------------------

def get_manifest_by_id(scenarie_id, output_dir=None, inkluder_serier=False) -> dict | None:
    """Find ét manifest via scenarie_id. Prøver filnavnet direkte; falder
    tilbage til at scanne manifesternes scenarie_id-felt, hvis nøglen og
    filstammen skulle afvige."""
    d = _output_dir(output_dir)
    path = d / f"{scenarie_id}{MANIFEST_SUFFIX}"
    if path.is_file():
        return _maybe_attach_series(load_manifest(path), d, inkluder_serier)
    for m in load_all_manifests(d):
        if m.get("scenarie_id") == scenarie_id:
            return _maybe_attach_series(m, d, inkluder_serier)
    return None


# --------------------------------------------------------------------------
# Parameter-matchning
# --------------------------------------------------------------------------

def _meaningful_disables(case_name: str, manifests: list[dict]) -> dict[str, set[str]]:
    """Pr. scenarie_id i samme case: enheder_fra MINUS de enheder, der er
    slået fra i hver eneste kørsel for casen (dem regner vi som modellens
    standard-fra, fx overskudsvarme).

    Det gør, at enheder_fra=[] betyder 'ingen ekstra fravalg' frem for
    'præcis tom liste'. Så A og B kan skelnes på det, brugeren faktisk
    ændrede (om tanken er slået fra), uden at standard-fravalg forstyrrer."""
    group = [m for m in manifests if m.get("meta", {}).get("case_name") == case_name]
    if not group:
        return {}
    sets = [set(m.get("koersel", {}).get("enheder_fra", [])) for m in group]
    defaults = set.intersection(*sets) if sets else set()
    return {
        m.get("scenarie_id", ""): set(m.get("koersel", {}).get("enheder_fra", [])) - defaults
        for m in group
    }


def _periode_match(requested, manifest_periode: dict) -> bool:
    # "standard"/None/"": ingen begrænsning på periode.
    if requested in (None, "standard", ""):
        return True
    if isinstance(requested, dict):
        return (requested.get("start") == manifest_periode.get("start")
                and requested.get("slut") == manifest_periode.get("slut"))
    # streng, fx "2025": match hvis den optræder i start eller slut.
    s = str(requested)
    return (s in str(manifest_periode.get("start", ""))
            or s in str(manifest_periode.get("slut", "")))


def _resume_dict(m: dict) -> dict:
    return asdict(_resume_from_manifest(m))


def _ikke_fundet(manifests, case=None, scenarie_id=None) -> dict:
    """Ærligt 'ikke fundet'-svar med de nærmeste kandidater, så fortolknings-
    laget kan sige 'den kørsel er ikke forhåndsberegnet — det nærmeste er …'.
    I fase 2 erstattes netop denne gren af kø + live solve."""
    pool = manifests
    if case:
        pool = [m for m in manifests if m.get("meta", {}).get("case_name") == case] or manifests
    return {
        "fundet": False,
        "aarsag": "ingen_match",
        "scenarie_id": scenarie_id,
        "foreslaaede_naermeste": [_resume_dict(m) for m in pool[:5]],
    }


# --------------------------------------------------------------------------
# run_scenario()
# --------------------------------------------------------------------------

def run_scenario(
    output_dir=None,
    *,
    scenarie_id: str | None = None,
    case: str = "billund_2025",
    periode: dict | str = "standard",
    med_balancering: bool = False,
    enheder_fra=(),
    overrides=(),
    inkluder_serier: bool = False,
) -> dict:
    """Peg på én kørsel — enten via nøgle (scenarie_id) eller via parametre,
    der opløses til en kørsel ved at matche manifesternes koersel-felter.

    Returnerer manifestet (dict). Ved manglende/tvetydigt match returneres
    {"fundet": false, ...} med nærmeste kandidater — aldrig et gæt."""
    d = _output_dir(output_dir)

    # 1) Direkte nøgle — den primære vej (nøglen kom fra kataloget).
    if scenarie_id:
        m = get_manifest_by_id(scenarie_id, d, inkluder_serier)
        if m is not None:
            return m
        return _ikke_fundet(load_all_manifests(d), scenarie_id=scenarie_id)

    # 2) Parameter-vej — match mod koersel.
    manifests = load_all_manifests(d)
    req_disables = set(enheder_fra)
    req_overrides = set(overrides)
    meaningful = _meaningful_disables(case, manifests)

    candidates: list[dict] = []
    for m in manifests:
        ko = m.get("koersel", {})
        if m.get("meta", {}).get("case_name") != case:
            continue
        if bool(ko.get("med_balancering", False)) != bool(med_balancering):
            continue
        if meaningful.get(m.get("scenarie_id", ""), set()) != req_disables:
            continue
        if set(ko.get("overrides", [])) != req_overrides:
            continue
        if not _periode_match(periode, ko.get("periode", {})):
            continue
        candidates.append(m)

    if len(candidates) == 1:
        return _maybe_attach_series(candidates[0], d, inkluder_serier)
    if len(candidates) > 1:
        # Tvetydigt — vær ærlig, lad laget ovenfor vælge eller spørge.
        return {
            "fundet": False,
            "aarsag": "flere_match",
            "foreslaaede_naermeste": [_resume_dict(c) for c in candidates],
        }
    return _ikke_fundet(manifests, case=case)


# --------------------------------------------------------------------------
# sammenlign() — differens mellem to vilkårlige kørsler (kontraktens §2.3)
# --------------------------------------------------------------------------
#
# Differensen beregnes "ovenpå" ved at parre to manifester — ikke i værktøjet
# og ikke i frontenden. Det realiserer §2.3: én sammenligning kræver kun to
# manifester, uanset om de kom fra cache (fase 1) eller live solver (fase 2).
# Derfor er der intet at kassere i fase 2 — denne funktion rører kun nøgletal.
#
# Bevidst GENERISK over felterne: ingen viden om A/B/C eller faste roller.
# Enhver kørsel kan være reference eller alternativ, også fremtidige (fx en
# kørsel med en ekstra motor). Det er unionen af enheder, der gør "installér en
# ekstra enhed og sammenlign"-casen mulig uden kodeændring senere.

# Lille tolerance på varmebehovet (MWh): under denne regnes to kørsler som
# havende "samme" varmebehov. Behovet er en model-INPUT og bør være identisk
# for parrede scenarier; en lille tolerance dækker afrundingsstøj.
_VARMEBEHOV_TOLERANCE_MWH = 1.0


def _balance_som_tal(bal) -> dict:
    """Normalisér balanceindtaegt_dkk til tal. Feltet er null uden balancering
    (jf. TRIN 0: A og B har null) — null behandles som 0, så differensen kan
    beregnes ensartet uanset om den ene side mangler balancemarked."""
    bal = bal or {}
    return {
        "i_alt": float(bal.get("i_alt") or 0.0),
        "afrr": float(bal.get("afrr") or 0.0),
        "mfrr": float(bal.get("mfrr") or 0.0),
    }


def _enheds_produktion(m: dict) -> dict[str, float]:
    """navn -> produktion_mwh for ét manifest. Bruges til union på tværs."""
    ud: dict[str, float] = {}
    for e in m.get("enheder", []) or []:
        navn = e.get("navn")
        if navn is None:
            continue
        ud[navn] = float(e.get("produktion_mwh") or 0.0)
    return ud


def _scenarie_ref(m: dict, variant_label: str) -> dict:
    meta = m.get("meta", {})
    return {
        "scenarie_id": m.get("scenarie_id", ""),
        "titel": meta.get("titel") or meta.get("case_name") or m.get("scenarie_id", ""),
        "variant_label": variant_label,
    }


def _variant_label_index(output_dir) -> dict[str, str]:
    """scenarie_id -> variant_label. Etiketten beregnes kun i kataloget (den
    kræver at se hele gruppen), så vi slår den op dér frem for at genberegne."""
    return {r.scenarie_id: r.variant_label for r in list_scenarier(output_dir)}


def sammenlign_manifester(ref: dict, alt: dict, output_dir=None) -> dict:
    """Byg et purpose-built 'sammenligning'-objekt: differensen alternativ −
    reference, beregnet generisk over nøgletallene. Forudsætter at begge
    manifester allerede er slået op (app-laget oversætter ukendt id til 404).

    Ingen _serier her — kurverne henter frontenden separat via
    /api/scenarie/{alternativ}?inkluder_serier=true. Vi rører kun tal."""
    labels = _variant_label_index(output_dir)
    ref_label = labels.get(ref.get("scenarie_id", ""), "")
    alt_label = labels.get(alt.get("scenarie_id", ""), "")

    nref = ref.get("noegletal", {})
    nalt = alt.get("noegletal", {})

    def f(d, k):  # robust float-aflæsning, manglende -> 0
        return float(d.get(k) or 0.0)

    def diff(k, decimaler=1):
        return round(f(nalt, k) - f(nref, k), decimaler)

    # --- Balanceindtægt (forbeholds-ramt) -------------------------------------
    bref = _balance_som_tal(nref.get("balanceindtaegt_dkk"))
    balt = _balance_som_tal(nalt.get("balanceindtaegt_dkk"))

    # --- Forbehold: trigges af manifestet (med_balancering), ikke af id ------
    ref_bal = bool(ref.get("koersel", {}).get("med_balancering", False))
    alt_bal = bool(alt.get("koersel", {}).get("med_balancering", False))
    balance_under_validering = ref_bal or alt_bal

    # --- Enheds-union (kernen i "vilkårlig parring") --------------------------
    prod_ref = _enheds_produktion(ref)
    prod_alt = _enheds_produktion(alt)
    alle_navne = sorted(set(prod_ref) | set(prod_alt))
    enheder = []
    for navn in alle_navne:
        p_ref = prod_ref.get(navn, 0.0)
        p_alt = prod_alt.get(navn, 0.0)
        enheder.append({
            "navn": navn,
            "produktion_ref": round(p_ref, 1),
            "produktion_alt": round(p_alt, 1),
            "diff": round(p_alt - p_ref, 1),
        })

    # --- Sammenlignelighed (soft — bloker ALDRIG) ----------------------------
    ko_ref = ref.get("koersel", {})
    ko_alt = alt.get("koersel", {})
    case_ref = ref.get("meta", {}).get("case_name")
    case_alt = alt.get("meta", {}).get("case_name")
    per_ref = ko_ref.get("periode", {})
    per_alt = ko_alt.get("periode", {})

    samme_case = case_ref == case_alt
    samme_periode = (per_ref.get("start") == per_alt.get("start")
                     and per_ref.get("slut") == per_alt.get("slut"))
    vb_ref = f(nref, "varmeefterspoergsel_mwh")
    vb_alt = f(nalt, "varmeefterspoergsel_mwh")
    samme_varmebehov = abs(vb_alt - vb_ref) <= _VARMEBEHOV_TOLERANCE_MWH

    advarsler: list[str] = []
    if not samme_case:
        advarsler.append("Forskellig case — differensen er muligvis ikke direkte sammenlignelig.")
    if not samme_periode:
        advarsler.append("Forskellig periode — differensen er muligvis ikke direkte sammenlignelig.")
    if not samme_varmebehov:
        advarsler.append("Forskelligt varmebehov — differensen er muligvis ikke direkte sammenlignelig.")

    note = None
    if balance_under_validering:
        note = ("En af kørslerne bruger balancemarkedet. Balance-tallene er ramt "
                "af en kendt modelfejl (urimeligt høje) — både balanceindtægts- og "
                "objektiv-differensen er derfor under validering og må ikke bruges "
                "som resultat.")

    return {
        "reference": _scenarie_ref(ref, ref_label),
        "alternativ": _scenarie_ref(alt, alt_label),

        "sammenlignelighed": {
            "samme_case": samme_case,
            "samme_periode": samme_periode,
            "samme_varmebehov": samme_varmebehov,
            "advarsler": advarsler,
        },

        "forbehold": {
            "balance_under_validering": balance_under_validering,
            "note": note,
        },

        "differens": {
            "objektiv_dkk": diff("objektiv_dkk", 0),
            "co2_ton": diff("co2_ton", 1),
            "samlet_produktion_mwh": diff("samlet_produktion_mwh", 1),
            "nettab_mwh": diff("nettab_mwh", 1),
            "nettab_pct_point": diff("nettab_pct", 1),
            "balanceindtaegt_dkk": {
                "i_alt": round(balt["i_alt"] - bref["i_alt"], 0),
                "afrr": round(balt["afrr"] - bref["afrr"], 0),
                "mfrr": round(balt["mfrr"] - bref["mfrr"], 0),
                "under_validering": balance_under_validering,
            },
        },

        "invariant": {
            "varmeefterspoergsel_mwh": {
                "reference": round(vb_ref, 1),
                "alternativ": round(vb_alt, 1),
                "diff": round(vb_alt - vb_ref, 1),
            },
        },

        "enheder": enheder,
    }


# --------------------------------------------------------------------------
# Røgtest — kør modulet direkte mod et fikstur-katalog
# --------------------------------------------------------------------------

if __name__ == "__main__":
    fixtures = Path(__file__).parent / "output_demo"
    print(f"Katalog: {fixtures}\n")

    print("=== list_scenarier() (med variant-etiket) ===")
    etiketter = []
    for r in list_scenarier(fixtures):
        print(f"  {r.scenarie_id:42s} | {r.variant_label}")
        etiketter.append(r.variant_label)
    assert len(set(etiketter)) == len(etiketter), "variant-etiketter skal være entydige!"
    print("  -> alle tre etiketter er forskellige")

    print("\n=== run_scenario(med_balancering=True) -> forvent C ===")
    r = run_scenario(fixtures, med_balancering=True)
    print(" ->", r.get("scenarie_id", r))

    print("\n=== run_scenario(med_balancering=False) -> forvent A ===")
    r = run_scenario(fixtures, med_balancering=False)
    print(" ->", r.get("scenarie_id", r))

    print("\n=== run_scenario(med_balancering=False, enheder_fra=['tank_eksisterende']) -> forvent B ===")
    r = run_scenario(fixtures, med_balancering=False, enheder_fra=["tank_eksisterende"])
    print(" ->", r.get("scenarie_id", r))

    print("\n=== run_scenario(scenarie_id='...__no-tank') -> direkte opslag ===")
    r = run_scenario(fixtures, scenarie_id="billund_2025__gh__2025__no-tank")
    print(" ->", r.get("scenarie_id", r))

    print("\n=== run_scenario(med_balancering=True, case='findes_ikke') -> ikke fundet ===")
    r = run_scenario(fixtures, case="findes_ikke", med_balancering=True)
    print(" -> fundet:", r.get("fundet"), "| nærmeste:",
          [c["scenarie_id"] for c in r.get("foreslaaede_naermeste", [])])
