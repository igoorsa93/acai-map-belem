"""
consolidador_master.py — Consolida todos os validado.csv em master_consolidado.csv.

Fluxo:
  1. Lê cada data/coleta/bairros/{slug}/validado.csv
  2. Verifica status.json (só processa bairros com estado="validado")
  3. Dedup por place_id com prioridade de status
  4. Auditoria de consistência geográfica final
  5. Grava data/reports/master_consolidado.csv
  6. Grava data/reports/master_auditoria.json com métricas completas

Execução:
  python run_orchestration.py --consolidar
  ou diretamente:
  python -m src.orchestration.consolidador_master
"""
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT   = Path(__file__).resolve().parents[2]
DATA   = ROOT / "data"
COLETA = DATA / "coleta" / "bairros"

STATUS_PRIORITY = {
    "DENTRO":         0,
    "BAIRRO_VIZINHO": 1,
    "FORA_BAIRRO":    2,
    "FORA_BELEM":     3,
    "INCERTO":        4,
}

MASTER_FIELDNAMES = [
    "place_id", "nome", "latitude", "longitude", "rating", "review_count",
    "bairro_validado", "status_geo", "distancia_m", "metodo_validacao",
    "rodadas", "n_rodadas", "r1", "r2", "g1", "g2", "g3", "r3",
    "fonte_bairros",  # quais bairros contribuíram para este PID
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def consolidar(verbose: bool = True) -> dict:
    """
    Lê todos os validado.csv aprovados e gera o master.
    Retorna o dict de auditoria final.
    """
    if verbose:
        print(f"[{_now_iso()}] ── Consolidador Master iniciando ──")

    master: dict[str, dict] = {}  # place_id → melhor registro
    fontes: dict[str, list[str]] = defaultdict(list)  # place_id → [bairros]

    bairros_processados = []
    bairros_pulados     = []
    total_linhas_lidas  = 0

    # Iterar todos os diretórios de bairro
    slugs = sorted(d.name for d in COLETA.iterdir() if d.is_dir())

    for slug in slugs:
        bairro_dir  = COLETA / slug
        status_file = bairro_dir / "status.json"
        val_file    = bairro_dir / "validado.csv"

        # Verificar status
        if not status_file.exists():
            bairros_pulados.append((slug, "sem status.json"))
            continue

        with open(status_file) as f:
            st = json.load(f)

        if st.get("estado") != "validado":
            bairros_pulados.append((slug, f"estado={st.get('estado','?')}"))
            continue

        if not val_file.exists():
            bairros_pulados.append((slug, "sem validado.csv"))
            continue

        nome_bairro = st.get("bairro", slug)

        # Ler validado.csv
        with open(val_file) as f:
            rows = list(csv.DictReader(f))

        total_linhas_lidas += len(rows)
        bairros_processados.append(nome_bairro)

        for row in rows:
            pid = row.get("place_id", "")
            if not pid:
                continue

            sg_new = row.get("status_geo", "INCERTO")
            fontes[pid].append(nome_bairro)

            if pid not in master:
                master[pid] = dict(row)
                continue

            # Conflito: mesmo PID em múltiplos bairros — prioridade de status
            sg_cur = master[pid].get("status_geo", "INCERTO")
            pri_new = STATUS_PRIORITY.get(sg_new, 99)
            pri_cur = STATUS_PRIORITY.get(sg_cur, 99)

            if pri_new < pri_cur:
                master[pid] = dict(row)

    if verbose:
        print(f"  Bairros processados: {len(bairros_processados)}")
        print(f"  Bairros pulados:     {len(bairros_pulados)}")
        print(f"  Linhas lidas (raw):  {total_linhas_lidas}")
        print(f"  PIDs únicos:         {len(master)}")

    # ── Auditoria de consistência ─────────────────────────────────────────────
    issues = []

    # 1. PIDs em múltiplos bairros (geograficamente ambíguo)
    multi_bairro = {pid: bairros for pid, bairros in fontes.items() if len(bairros) > 1}
    if multi_bairro:
        issues.append({
            "tipo":  "PID_MULTI_BAIRRO",
            "count": len(multi_bairro),
            "descricao": "PIDs que apareceram como DENTRO em mais de um bairro",
            "exemplos": list(multi_bairro.items())[:5],
        })

    # 2. PIDs sem coordenadas
    sem_coord = [pid for pid, r in master.items()
                 if not r.get("latitude") or not r.get("longitude")]
    if sem_coord:
        issues.append({
            "tipo":  "SEM_COORDENADA",
            "count": len(sem_coord),
            "descricao": "PIDs sem latitude/longitude",
            "exemplos": sem_coord[:5],
        })

    # 3. Bairros com zero DENTRO
    bairros_vazios = [slug for slug in slugs
                      if (COLETA / slug / "status.json").exists()
                      and json.loads((COLETA / slug / "status.json").read_text()).get("total_validado", 0) == 0
                      and json.loads((COLETA / slug / "status.json").read_text()).get("estado") == "validado"]
    if bairros_vazios:
        issues.append({
            "tipo":  "BAIRRO_SEM_ESTABELECIMENTO",
            "count": len(bairros_vazios),
            "descricao": "Bairros validados mas sem nenhum estabelecimento DENTRO",
            "exemplos": bairros_vazios[:10],
        })

    # ── Distribuição final ────────────────────────────────────────────────────
    dist_status    = Counter(r["status_geo"] for r in master.values())
    dist_bairro    = Counter(r.get("bairro_validado","") for r in master.values())
    dist_metodo    = Counter(r.get("metodo_validacao","") for r in master.values())

    # ── Gravar master_consolidado.csv ─────────────────────────────────────────
    out_path = DATA / "reports" / "master_consolidado.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MASTER_FIELDNAMES, extrasaction="ignore")
        w.writeheader()
        for pid, row in master.items():
            rodadas_list = [r for r in row.get("rodadas","").split("|") if r]
            w.writerow({
                **row,
                "n_rodadas":    len(rodadas_list),
                "fonte_bairros": "|".join(sorted(set(fontes.get(pid, [])))),
            })

    if verbose:
        print(f"\n  ✓ master_consolidado.csv → {len(master)} PIDs")

    # ── Gravar master_auditoria.json ─────────────────────────────────────────
    auditoria = {
        "timestamp":            _now_iso(),
        "total_pids":           len(master),
        "total_linhas_lidas":   total_linhas_lidas,
        "bairros_processados":  len(bairros_processados),
        "bairros_pulados":      bairros_pulados,
        "distribuicao_status":  dict(dist_status),
        "distribuicao_bairro":  dict(dist_bairro.most_common(30)),
        "distribuicao_metodo":  dict(dist_metodo),
        "pids_multi_bairro":    len(multi_bairro),
        "issues":               issues,
        "consistencia": "OK" if not issues else f"{len(issues)} issue(s) detectado(s)",
    }
    aud_path = DATA / "reports" / "master_auditoria.json"
    aud_path.write_text(json.dumps(auditoria, ensure_ascii=False, indent=2))

    if verbose:
        print(f"  ✓ master_auditoria.json gravado")
        print(f"\n── Distribuição final ───────────────────────────────────────")
        total = len(master)
        for s in ["DENTRO","BAIRRO_VIZINHO","FORA_BAIRRO","FORA_BELEM","INCERTO"]:
            n = dist_status.get(s, 0)
            print(f"  {s:<20} {n:>5}  ({n/total*100:.1f}%)" if total else f"  {s}: 0")
        print(f"  {'TOTAL':<20} {total:>5}")
        print(f"\n── Top 10 bairros ───────────────────────────────────────────")
        for b, n in dist_bairro.most_common(10):
            print(f"  {b:<30} {n:>4}")
        if issues:
            print(f"\n⚠  {len(issues)} issue(s) de consistência — ver master_auditoria.json")
        else:
            print(f"\n✓  Sem issues de consistência")

    return auditoria


if __name__ == "__main__":
    consolidar()
