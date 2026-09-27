"""
r4_runner.py — Orquestrador de coleta R4 via google-maps-scraper-kit.

Fase 2 da pipeline: coleta novos estabelecimentos de açaí por bairro,
valida geograficamente com geo_validator e integra ao repositório de bairros.

Fluxo por bairro:
  1. Chama scraper_client.coletar_bairro() → lista de EstabelecimentoR4
  2. Dedup com PIDs já existentes em raw.csv (evita reprocessamento)
  3. Valida cada PID novo com geo_validator
  4. Acrescenta ao raw.csv e validado.csv do bairro
  5. Regera auditoria.json e status.json
  6. Ao final: executa consolidador_master para atualizar master

Uso:
  python run_r4.py                          # coleta todos os 71 bairros
  python run_r4.py --bairros tapana pratinha  # bairros específicos
  python run_r4.py --vazios                 # apenas bairros sem DENTRO
  python run_r4.py --workers 4              # controla concorrência
  python run_r4.py --dry-run               # mostra o plano sem coletar
"""
import asyncio
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple, Optional

import aiohttp

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.orchestration.scraper_client import (
    coletar_bairro, verificar_scraper,
    ScraperOfflineError, EstabelecimentoR4,
)
from src.rodada3.geo_validator import (
    validar_bairro,
    STATUS_DENTRO, STATUS_VIZINHO, STATUS_FORA_BAIRRO,
    STATUS_FORA_BELEM, STATUS_INCERTO,
)
from src.rodada3.config_r3 import carregar_bairros

DATA   = ROOT / "data"
COLETA = DATA / "coleta" / "bairros"

RAW_FIELDNAMES = [
    "place_id", "nome", "latitude", "longitude", "rating", "review_count",
    "endereco", "bairro_pesquisa", "status_geo_orig", "bairro_detectado_orig",
    "rodadas", "r1", "r2", "g1", "g2", "g3", "r3", "r4",
]

VALIDADO_FIELDNAMES = [
    "place_id", "nome", "latitude", "longitude", "rating", "review_count",
    "endereco", "bairro_validado", "status_geo", "distancia_m", "metodo_validacao",
    "rodadas", "r1", "r2", "g1", "g2", "g3", "r3", "r4",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class R4BairroResult(NamedTuple):
    slug: str
    nome: str
    novos_coletados: int       # PIDs retornados pelo scraper (brutos)
    novos_validos: int         # PIDs DENTRO após geo_validator
    duplicatas_evitadas: int   # PIDs já existentes no raw.csv
    erros_query: list[str]
    duracao_s: float
    erro_fatal: Optional[str]


def _carregar_pids_existentes(slug: str) -> set[str]:
    """Retorna set de place_ids já presentes em raw.csv do bairro."""
    raw_path = COLETA / slug / "raw.csv"
    if not raw_path.exists():
        return set()
    with open(raw_path) as f:
        return {row["place_id"] for row in csv.DictReader(f) if row.get("place_id")}


def _ler_raw_existente(slug: str) -> list[dict]:
    raw_path = COLETA / slug / "raw.csv"
    if not raw_path.exists():
        return []
    with open(raw_path) as f:
        return list(csv.DictReader(f))


def _ler_validado_existente(slug: str) -> list[dict]:
    val_path = COLETA / slug / "validado.csv"
    if not val_path.exists():
        return []
    with open(val_path) as f:
        return list(csv.DictReader(f))


def _salvar_bairro(
    slug: str,
    nome_bairro: str,
    novos: list[EstabelecimentoR4],
    resultados_geo: list[dict],  # paralelo a novos
) -> tuple[int, int]:
    """
    Acrescenta novos PIDs ao raw.csv e (se DENTRO) ao validado.csv.
    Retorna (total_novos_raw, total_novos_dentro).
    """
    bairro_dir = COLETA / slug
    bairro_dir.mkdir(parents=True, exist_ok=True)

    raw_existente  = _ler_raw_existente(slug)
    val_existente  = _ler_validado_existente(slug)
    pids_val_exist = {r["place_id"] for r in val_existente if r.get("place_id")}

    novos_raw   = []
    novos_val   = []

    for estab, geo in zip(novos, resultados_geo):
        row_raw = {
            "place_id":            estab.place_id,
            "nome":                estab.nome,
            "latitude":            estab.latitude,
            "longitude":           estab.longitude,
            "rating":              estab.rating,
            "review_count":        estab.review_count,
            "endereco":            estab.endereco,
            "bairro_pesquisa":     estab.bairro_pesquisa,
            "status_geo_orig":     geo["status"],
            "bairro_detectado_orig": geo["bairro_detectado"],
            "rodadas":             "r4",
            "r1": False, "r2": False, "g1": False,
            "g2": False, "g3": False, "r3": False, "r4": True,
        }
        novos_raw.append(row_raw)

        if geo["status"] == STATUS_DENTRO and estab.place_id not in pids_val_exist:
            novos_val.append({
                "place_id":          estab.place_id,
                "nome":              estab.nome,
                "latitude":          estab.latitude,
                "longitude":         estab.longitude,
                "rating":            estab.rating,
                "review_count":      estab.review_count,
                "endereco":          estab.endereco,
                "bairro_validado":   geo["bairro_detectado"] or nome_bairro,
                "status_geo":        STATUS_DENTRO,
                "distancia_m":       geo["distancia_m"],
                "metodo_validacao":  geo["metodo"],
                "rodadas":           "r4",
                "r1": False, "r2": False, "g1": False,
                "g2": False, "g3": False, "r3": False, "r4": True,
            })

    # Gravar raw.csv (append)
    raw_path = COLETA / slug / "raw.csv"
    escrever_cabecalho = not raw_path.exists() or not raw_existente
    with open(raw_path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RAW_FIELDNAMES, extrasaction="ignore")
        if escrever_cabecalho:
            w.writeheader()
        w.writerows(novos_raw)

    # Gravar validado.csv (append)
    val_path = COLETA / slug / "validado.csv"
    escrever_cabecalho_v = not val_path.exists() or not val_existente
    with open(val_path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=VALIDADO_FIELDNAMES, extrasaction="ignore")
        if escrever_cabecalho_v:
            w.writeheader()
        w.writerows(novos_val)

    return len(novos_raw), len(novos_val)


def _atualizar_status(slug: str, nome: str, novos_raw: int, novos_dentro: int, erro: Optional[str]):
    st_path = COLETA / slug / "status.json"
    # Ler estado atual
    st = {}
    if st_path.exists():
        try:
            st = json.loads(st_path.read_text())
        except Exception:
            st = {}

    total_raw_anterior    = st.get("total_raw", 0)
    total_validado_anterior = st.get("total_validado", 0)

    st.update({
        "bairro":        nome,
        "estado":        "erro_r4" if erro else "validado",
        "total_raw":     total_raw_anterior + novos_raw,
        "total_validado": total_validado_anterior + novos_dentro,
        "r4_coletado":   True,
        "r4_novos_raw":  novos_raw,
        "r4_novos_dentro": novos_dentro,
        "r4_timestamp":  _now_iso(),
        "erro_r4":       erro,
    })
    st_path.write_text(json.dumps(st, ensure_ascii=False, indent=2))


async def processar_bairro_r4(
    slug: str,
    nome: str,
    semaphore: asyncio.Semaphore,
    session: aiohttp.ClientSession,
    max_results: int,
) -> R4BairroResult:
    t0 = time.monotonic()
    async with semaphore:
        print(f"  ▶ [{slug}] iniciando coleta R4…")
        try:
            # 1. Coletar via scraper
            estabelecimentos, erros_query = await coletar_bairro(
                nome, session, max_results_por_query=max_results
            )

            # 2. Filtrar duplicatas já existentes
            pids_existentes = _carregar_pids_existentes(slug)
            novos = [e for e in estabelecimentos if e.place_id not in pids_existentes]
            dups  = len(estabelecimentos) - len(novos)

            # 3. Validar geograficamente
            resultados_geo = []
            for estab in novos:
                geo = validar_bairro(
                    estab.latitude, estab.longitude,
                    nome,           # bairro_pesquisa = nome do bairro
                    estab.endereco,
                )
                resultados_geo.append(geo)

            # 4. Gravar
            n_raw, n_dentro = _salvar_bairro(slug, nome, novos, resultados_geo)

            # 5. Atualizar status
            _atualizar_status(slug, nome, n_raw, n_dentro, None)

            dur = time.monotonic() - t0
            print(f"  ✓ [{slug}] {n_raw} novos raw | {n_dentro} DENTRO | {dups} dups | {dur:.1f}s")
            return R4BairroResult(slug, nome, len(estabelecimentos), n_dentro, dups, erros_query, dur, None)

        except ScraperOfflineError as e:
            raise  # Propaga para cancelar todos os workers
        except Exception as e:
            dur = time.monotonic() - t0
            erro_str = f"{type(e).__name__}: {e}"
            _atualizar_status(slug, nome, 0, 0, erro_str)
            print(f"  ✗ [{slug}] ERRO: {erro_str}")
            return R4BairroResult(slug, nome, 0, 0, 0, [], dur, erro_str)


async def run_r4(
    filtro_slugs: Optional[list[str]] = None,
    apenas_vazios: bool = False,
    max_workers: int = 5,
    max_results_por_query: int = 60,
    dry_run: bool = False,
) -> list[R4BairroResult]:
    """
    Orquestra a coleta R4 em paralelo com Semaphore.
    """
    bairros_cfg = carregar_bairros()

    # Montar lista de (slug, nome)
    alvo: list[tuple[str, str]] = []
    for b in bairros_cfg:
        import re, unicodedata
        nome = b["bairro"]
        slug = re.sub(r"[^a-z0-9]+", "_", unicodedata.normalize("NFKD", nome).encode("ascii","ignore").decode().lower()).strip("_")

        if filtro_slugs and slug not in filtro_slugs:
            continue

        if apenas_vazios:
            st_path = COLETA / slug / "status.json"
            if st_path.exists():
                st = json.loads(st_path.read_text())
                if st.get("total_validado", 0) > 0:
                    continue

        alvo.append((slug, nome))

    print(f"\n{'='*60}")
    print(f"R4 — Coleta de {len(alvo)} bairros | workers={max_workers} | max_results={max_results_por_query}")
    if apenas_vazios:
        print("  Modo: apenas bairros sem DENTRO")
    if dry_run:
        print("\n  [DRY-RUN] Plano de coleta:")
        for slug, nome in alvo:
            pids = len(_carregar_pids_existentes(slug))
            print(f"    {slug:<25} {nome:<30} ({pids} PIDs existentes)")
        print(f"\n  Total: {len(alvo)} bairros | 0 chamadas ao scraper")
        return []
    print(f"{'='*60}\n")

    # Verificar se o scraper está online ANTES de começar
    connector = aiohttp.TCPConnector(limit=max_workers + 2)
    async with aiohttp.ClientSession(connector=connector) as session:
        print("  Verificando scraper…")
        try:
            info = await verificar_scraper(session)
            print(f"  ✓ Scraper online: {info}")
        except ScraperOfflineError as e:
            print(f"\n  ✗ SCRAPER OFFLINE: {e}")
            print("  → Inicie o google-maps-scraper-kit antes de rodar R4.")
            return []

        semaphore = asyncio.Semaphore(max_workers)
        tasks = [
            processar_bairro_r4(slug, nome, semaphore, session, max_results_por_query)
            for slug, nome in alvo
        ]

        t_total = time.monotonic()
        try:
            resultados = await asyncio.gather(*tasks, return_exceptions=False)
        except ScraperOfflineError as e:
            print(f"\n  ✗ Scraper ficou offline durante a coleta: {e}")
            return []

    dur_total = time.monotonic() - t_total

    # Sumário
    total_coletados = sum(r.novos_coletados for r in resultados)
    total_dentro    = sum(r.novos_validos for r in resultados)
    total_dups      = sum(r.duplicatas_evitadas for r in resultados)
    erros_fatais    = [r for r in resultados if r.erro_fatal]

    print(f"\n{'='*60}")
    print(f"R4 concluído em {dur_total:.1f}s")
    print(f"  Coletados (brutos):  {total_coletados}")
    print(f"  Novos DENTRO:        {total_dentro}")
    print(f"  Duplicatas evitadas: {total_dups}")
    if erros_fatais:
        print(f"  Bairros c/ erro:     {len(erros_fatais)}")
        for r in erros_fatais:
            print(f"    [{r.slug}] {r.erro_fatal}")

    return resultados
