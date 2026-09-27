"""
bairro_runner.py — Orquestrador paralelo de sub-agentes por bairro.

Fase 1 (reprocessamento): distribui dados existentes (R1/R2/R3) pelos 71
repositórios de bairro e valida geograficamente com geo_validator.

Fase 2 (futura — R4): troca _carregar_dados_existentes() por chamada
ao scraper localhost:8080 para novos dados frescos por bairro.

Estrutura gerada por bairro:
  data/coleta/bairros/{slug}/
    raw.csv         — PIDs associados ao bairro (antes da validação)
    validado.csv    — PIDs confirmados DENTRO do bairro
    auditoria.json  — métricas da execução
    status.json     — estado do worker

Execução:
  python run_orchestration.py            # reprocessa todos os 71 bairros
  python run_orchestration.py tapana     # apenas um bairro (teste)
"""
import asyncio
import csv
import json
import time
import unicodedata
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT   = Path(__file__).resolve().parents[2]
DATA   = ROOT / "data"
COLETA = DATA / "coleta" / "bairros"

# ── Importar geo_validator ────────────────────────────────────────────────────
import sys
sys.path.insert(0, str(ROOT))

from src.rodada3.geo_validator import (
    validar_bairro,
    STATUS_DENTRO, STATUS_VIZINHO, STATUS_FORA_BAIRRO,
    STATUS_FORA_BELEM, STATUS_INCERTO,
)
from src.rodada3.config_r3 import carregar_bairros

STATUS_PRIORITY = {
    STATUS_DENTRO:      0,
    STATUS_VIZINHO:     1,
    STATUS_FORA_BAIRRO: 2,
    STATUS_FORA_BELEM:  3,
    STATUS_INCERTO:     4,
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def slugify(nome: str) -> str:
    nfkd = unicodedata.normalize("NFKD", nome)
    ascii_ = nfkd.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", ascii_.lower()).strip("_")


def _float(v):
    try:
        return float(v) if v else 0.0
    except (TypeError, ValueError):
        return 0.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Carregar todos os dados existentes ────────────────────────────────────────
RAW_FIELDNAMES = [
    "place_id", "nome", "latitude", "longitude", "rating", "review_count",
    "endereco", "bairro_pesquisa", "status_geo_orig", "bairro_detectado_orig",
    "rodadas", "r1", "r2", "g1", "g2", "g3", "r3",
]

VALIDADO_FIELDNAMES = [
    "place_id", "nome", "latitude", "longitude", "rating", "review_count",
    "endereco", "bairro_validado", "status_geo", "distancia_m", "metodo_validacao",
    "rodadas", "r1", "r2", "g1", "g2", "g3", "r3",
]


def carregar_dados_existentes() -> dict[str, dict]:
    """
    Carrega auditoria_consolidada_v2.csv como fonte principal.
    Complementa com endereço de dim_estabelecimentos e r3.
    Retorna {place_id: dict com todos os campos necessários}.
    """
    pids: dict[str, dict] = {}

    # Base: v2 tem status_geo já calculado, bairro_detectado, rodadas
    v2_path = DATA / "reports" / "auditoria_consolidada_v2.csv"
    if v2_path.exists():
        with open(v2_path) as f:
            for row in csv.DictReader(f):
                pid = row.get("place_id", "")
                if not pid:
                    continue
                pids[pid] = {
                    "place_id":            pid,
                    "nome":                row.get("nome", ""),
                    "latitude":            row.get("latitude", ""),
                    "longitude":           row.get("longitude", ""),
                    "rating":              row.get("rating", ""),
                    "review_count":        row.get("review_count", ""),
                    "endereco":            "",   # complementar abaixo
                    "bairro_pesquisa":     "",
                    "status_geo_orig":     row.get("status_geo", ""),
                    "bairro_detectado_orig": row.get("bairro_detectado", ""),
                    "rodadas":             row.get("rodadas", ""),
                    "r1": row.get("r1", ""),
                    "r2": row.get("r2", ""),
                    "g1": row.get("g1", ""),
                    "g2": row.get("g2", ""),
                    "g3": row.get("g3", ""),
                    "r3": row.get("r3", ""),
                }

    # Complementar endereço de dim_estabelecimentos
    dim_path = DATA / "model" / "dim_estabelecimentos.csv"
    if dim_path.exists():
        with open(dim_path) as f:
            for row in csv.DictReader(f):
                pid = row.get("place_id", "")
                if pid in pids:
                    pids[pid]["endereco"]       = pids[pid]["endereco"] or row.get("endereco", "")
                    pids[pid]["bairro_pesquisa"] = pids[pid]["bairro_pesquisa"] or row.get("bairro_pesquisa", "")

    # Complementar endereço de recuperados_r2
    rec_path = DATA / "model" / "recuperacao_r2" / "estabelecimentos_recuperados.csv"
    if rec_path.exists():
        with open(rec_path) as f:
            for row in csv.DictReader(f):
                pid = row.get("place_id", "")
                if pid in pids and not pids[pid]["endereco"]:
                    pids[pid]["endereco"]       = row.get("endereco", "")
                    pids[pid]["bairro_pesquisa"] = pids[pid]["bairro_pesquisa"] or row.get("bairro_pesquisa", "")

    # Complementar endereço de R3
    r3_path = DATA / "processed" / "rodada_3" / "dim_estabelecimentos_r3.csv"
    if r3_path.exists():
        with open(r3_path) as f:
            for row in csv.DictReader(f):
                pid = row.get("place_id", "")
                if pid in pids and not pids[pid]["endereco"]:
                    pids[pid]["endereco"]       = row.get("endereco", "")
                    pids[pid]["bairro_pesquisa"] = pids[pid]["bairro_pesquisa"] or row.get("bairro_pesquisa_primeiro", "")

    return pids


# ── Worker por bairro ─────────────────────────────────────────────────────────
class BairroResult(NamedTuple):
    slug:        str
    nome:        str
    total_raw:   int
    total_dentro: int
    total_vizinho: int
    total_fora:  int
    total_fora_belem: int
    total_incerto: int
    duracao_s:   float
    erro:        str | None


async def processar_bairro(
    slug: str,
    nome: str,
    pids_bairro: list[dict],
    semaphore: asyncio.Semaphore,
) -> BairroResult:
    """
    Worker assíncrono para um bairro.
    - Roda geo_validator em cada PID da lista
    - Grava raw.csv, validado.csv, auditoria.json, status.json
    """
    async with semaphore:
        t0 = time.perf_counter()
        bairro_dir = COLETA / slug
        bairro_dir.mkdir(parents=True, exist_ok=True)

        # Atualizar status → coletando
        _write_status(bairro_dir, nome, slug, "coletando", len(pids_bairro), 0)

        raw_rows     = []
        validado_rows = []
        contadores   = {s: 0 for s in [STATUS_DENTRO, STATUS_VIZINHO,
                                         STATUS_FORA_BAIRRO, STATUS_FORA_BELEM,
                                         STATUS_INCERTO]}

        try:
            for p in pids_bairro:
                lat = _float(p["latitude"])
                lon = _float(p["longitude"])
                end = p.get("endereco", "")
                bp  = nome  # bairro pesquisado = este bairro

                # Re-validar com geo_validator v2
                try:
                    r = validar_bairro(lat, lon, bp, end)
                except Exception as e:
                    r = {
                        "status": STATUS_INCERTO,
                        "bairro_detectado": "",
                        "distancia_m": -1,
                        "metodo": f"ERRO:{e}",
                    }

                sg  = r["status"]
                bd  = r["bairro_detectado"]
                dm  = r["distancia_m"]
                met = r["metodo"]
                contadores[sg] = contadores.get(sg, 0) + 1

                raw_row = {k: p.get(k, "") for k in RAW_FIELDNAMES}
                raw_rows.append(raw_row)

                # DENTRO do bairro pesquisado → entra direto no validado
                # BAIRRO_VIZINHO → entra no validado do bairro detectado (bd),
                #   se bd for um bairro válido e diferente de nome (tratado no runner)
                if sg == STATUS_DENTRO:
                    validado_rows.append({
                        "place_id":         p["place_id"],
                        "nome":             p["nome"],
                        "latitude":         p["latitude"],
                        "longitude":        p["longitude"],
                        "rating":           p["rating"],
                        "review_count":     p["review_count"],
                        "endereco":         end,
                        "bairro_validado":  bd or nome,
                        "status_geo":       sg,
                        "distancia_m":      dm,
                        "metodo_validacao": met,
                        "rodadas":          p["rodadas"],
                        "r1": p["r1"], "r2": p["r2"],
                        "g1": p["g1"], "g2": p["g2"],
                        "g3": p["g3"], "r3": p["r3"],
                    })
                elif sg == STATUS_VIZINHO and bd:
                    # Registrar para segunda passagem (será adicionado ao bairro bd)
                    p["_vizinho_para"] = bd
                    p["_vizinho_dist"] = dm
                    p["_vizinho_met"]  = met

            # Gravar raw.csv
            _write_csv(bairro_dir / "raw.csv", RAW_FIELDNAMES, raw_rows)

            # Gravar validado.csv
            _write_csv(bairro_dir / "validado.csv", VALIDADO_FIELDNAMES, validado_rows)

            # Gravar auditoria.json
            duracao = round(time.perf_counter() - t0, 3)
            auditoria = {
                "bairro":        nome,
                "slug":          slug,
                "timestamp":     _now_iso(),
                "duracao_s":     duracao,
                "total_raw":     len(raw_rows),
                "total_validado": len(validado_rows),
                "distribuicao": {k: contadores.get(k, 0) for k in
                                  [STATUS_DENTRO, STATUS_VIZINHO,
                                   STATUS_FORA_BAIRRO, STATUS_FORA_BELEM,
                                   STATUS_INCERTO]},
                "taxa_dentro_pct": round(len(validado_rows) / len(raw_rows) * 100, 1)
                                   if raw_rows else 0.0,
            }
            (bairro_dir / "auditoria.json").write_text(
                json.dumps(auditoria, ensure_ascii=False, indent=2)
            )

            _write_status(bairro_dir, nome, slug, "validado", len(raw_rows), len(validado_rows))

            return BairroResult(
                slug=slug, nome=nome,
                total_raw=len(raw_rows), total_dentro=contadores[STATUS_DENTRO],
                total_vizinho=contadores[STATUS_VIZINHO],
                total_fora=contadores[STATUS_FORA_BAIRRO],
                total_fora_belem=contadores[STATUS_FORA_BELEM],
                total_incerto=contadores[STATUS_INCERTO],
                duracao_s=duracao, erro=None,
            )

        except Exception as e:
            _write_status(bairro_dir, nome, slug, "erro", len(pids_bairro), 0)
            return BairroResult(
                slug=slug, nome=nome,
                total_raw=len(pids_bairro), total_dentro=0,
                total_vizinho=0, total_fora=0, total_fora_belem=0,
                total_incerto=0,
                duracao_s=round(time.perf_counter() - t0, 3),
                erro=str(e),
            )


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def _write_status(dir_: Path, nome: str, slug: str, estado: str,
                  total_raw: int, total_validado: int):
    (dir_ / "status.json").write_text(json.dumps({
        "bairro":           nome,
        "slug":             slug,
        "estado":           estado,
        "total_raw":        total_raw,
        "total_validado":   total_validado,
        "ultima_atualizacao": _now_iso(),
    }, ensure_ascii=False, indent=2))


# ── Orquestrador principal ────────────────────────────────────────────────────
async def run(filtro_slugs: list[str] | None = None, max_workers: int = 6):
    """
    Ponto de entrada assíncrono.

    Args:
        filtro_slugs: se fornecido, só processa estes bairros (teste)
        max_workers:  semáforo de concorrência (padrão 6)
    """
    t_inicio = time.perf_counter()
    print(f"[{_now_iso()}] ── Bairro Runner iniciando ──")

    # Carregar configuração de bairros
    bairros_cfg = carregar_bairros()
    bairros_map = {slugify(b["bairro"]): b for b in bairros_cfg}

    if filtro_slugs:
        bairros_map = {k: v for k, v in bairros_map.items() if k in filtro_slugs}
        print(f"  Modo filtrado: {len(bairros_map)} bairro(s)")
    else:
        print(f"  Total bairros: {len(bairros_map)}")

    # Carregar todos os PIDs
    print("  Carregando dados existentes…")
    todos_pids = carregar_dados_existentes()
    print(f"  PIDs carregados: {len(todos_pids)}")

    # Distribuir PIDs por bairro:
    #   1ª prioridade: bairro_pesquisa (onde foi buscado — define o raw.csv)
    #   2ª prioridade: bairro_detectado_orig (para PIDs de G-round sem bairro_pesquisa)
    #   Sem bairro: FORA_BELEM / Ananindeua / etc. sem mapeamento
    distribuicao: dict[str, list[dict]] = {slug: [] for slug in bairros_map}
    sem_bairro = []

    for pid, p in todos_pids.items():
        # Tentar bairro_pesquisa primeiro
        bp = p.get("bairro_pesquisa", "")
        slug_bp = slugify(bp) if bp else ""
        if slug_bp in bairros_map:
            distribuicao[slug_bp].append(p)
            continue

        # Fallback: bairro_detectado_orig (G-rounds ou sem bairro_pesquisa)
        bd_orig = p.get("bairro_detectado_orig", "")
        slug_bd = slugify(bd_orig) if bd_orig else ""
        if slug_bd in bairros_map:
            distribuicao[slug_bd].append(p)
        else:
            sem_bairro.append(pid)

    atribuidos = sum(len(v) for v in distribuicao.values())
    print(f"  PIDs atribuídos a bairros: {atribuidos}")
    print(f"  PIDs sem bairro mapeável:  {len(sem_bairro)}")
    if sem_bairro[:5]:
        print(f"    Exemplos: {sem_bairro[:5]}")

    # Disparar workers em paralelo
    semaphore = asyncio.Semaphore(max_workers)
    tasks = [
        processar_bairro(slug, bairros_map[slug]["bairro"],
                         distribuicao[slug], semaphore)
        for slug in bairros_map
    ]

    print(f"\n  Iniciando {len(tasks)} workers (max {max_workers} simultâneos)…\n")
    resultados: list[BairroResult] = await asyncio.gather(*tasks)

    # ── Segunda passagem: PIDs VIZINHO que são DENTRO em outro bairro ─────────
    # Coleta todos os PIDs marcados com _vizinho_para e os adiciona ao
    # validado.csv do bairro correto (evitando duplicatas por place_id).
    vizinhos_extras: dict[str, list[dict]] = {slug: [] for slug in bairros_map}
    for pid, p in todos_pids.items():
        bd_dest = p.get("_vizinho_para", "")
        if not bd_dest:
            continue
        slug_dest = slugify(bd_dest)
        if slug_dest not in bairros_map:
            continue
        vizinhos_extras[slug_dest].append(p)

    total_extras = 0
    for slug, extras in vizinhos_extras.items():
        if not extras:
            continue
        bairro_dir = COLETA / slug
        val_path   = bairro_dir / "validado.csv"

        # Ler PIDs já no validado (evitar duplicata)
        pids_existentes: set[str] = set()
        if val_path.exists():
            with open(val_path) as f:
                pids_existentes = {r["place_id"] for r in csv.DictReader(f) if r.get("place_id")}

        novos_extras = []
        for p in extras:
            if p["place_id"] in pids_existentes:
                continue
            novos_extras.append({
                "place_id":         p["place_id"],
                "nome":             p["nome"],
                "latitude":         p["latitude"],
                "longitude":        p["longitude"],
                "rating":           p["rating"],
                "review_count":     p["review_count"],
                "endereco":         p.get("endereco", ""),
                "bairro_validado":  p["_vizinho_para"],
                "status_geo":       STATUS_DENTRO,
                "distancia_m":      p.get("_vizinho_dist", -1),
                "metodo_validacao": p.get("_vizinho_met", "centroide"),
                "rodadas":          p["rodadas"],
                "r1": p["r1"], "r2": p["r2"],
                "g1": p["g1"], "g2": p["g2"],
                "g3": p["g3"], "r3": p["r3"],
            })

        if novos_extras:
            # Append ao validado.csv existente
            escrever_header = not val_path.exists()
            with open(val_path, "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=VALIDADO_FIELDNAMES, extrasaction="ignore")
                if escrever_header:
                    w.writeheader()
                w.writerows(novos_extras)
            total_extras += len(novos_extras)

            # Atualizar status.json com novo total_validado
            st_path = bairro_dir / "status.json"
            if st_path.exists():
                st = json.loads(st_path.read_text())
                st["total_validado"] = st.get("total_validado", 0) + len(novos_extras)
                st["ultima_atualizacao"] = _now_iso()
                st_path.write_text(json.dumps(st, ensure_ascii=False, indent=2))

    if total_extras > 0:
        print(f"\n  ✓ Segunda passagem: {total_extras} PIDs VIZINHO adicionados ao bairro correto")

    # Resumo
    duracao_total = round(time.perf_counter() - t_inicio, 2)
    total_raw     = sum(r.total_raw for r in resultados)
    total_dentro  = sum(r.total_dentro for r in resultados)
    erros         = [r for r in resultados if r.erro]

    print("\n── Resultado por bairro ─────────────────────────────────────────────────")
    print(f"{'BAIRRO':<30} {'RAW':>5} {'DENTRO':>7} {'VIZINHO':>8} {'FORA_B':>7} {'FB':>6} {'INC':>5} {'s':>5}")
    print("-"*82)
    for r in sorted(resultados, key=lambda x: -x.total_raw):
        print(f"{r.nome:<30} {r.total_raw:>5} {r.total_dentro:>7} {r.total_vizinho:>8} "
              f"{r.total_fora:>7} {r.total_fora_belem:>6} {r.total_incerto:>5} {r.duracao_s:>5.2f}"
              + (f" ⚠ {r.erro}" if r.erro else ""))

    print(f"\n── Totais ───────────────────────────────────────────────────────────────")
    print(f"  Total RAW processado:  {total_raw}")
    print(f"  Total DENTRO (válidos): {total_dentro}")
    print(f"  PIDs sem bairro:       {len(sem_bairro)}")
    print(f"  Workers com erro:      {len(erros)}")
    print(f"  Duração total:         {duracao_total}s")

    return resultados


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Bairro Runner — processa bairros em paralelo")
    parser.add_argument("bairros", nargs="*", help="Slugs de bairros a processar (vazio = todos)")
    parser.add_argument("--workers", type=int, default=6, help="Workers simultâneos (padrão 6)")
    args = parser.parse_args()
    asyncio.run(run(filtro_slugs=args.bairros or None, max_workers=args.workers))
