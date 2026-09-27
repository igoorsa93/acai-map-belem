"""Orquestra a coleta por bairro/termo, com retomada e controle de estado."""
import csv
import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path

from src import scraper_client
from src.config import get_settings

ROOT = Path(__file__).parent.parent
STATE_FILE = ROOT / ".pipeline_state.json"
RAW_DIR = ROOT / "data" / "raw"
CONTROL_FILE = ROOT / "data" / "processed" / "coleta_controle.csv"

CONTROL_FIELDS = [
    "bairro", "termo", "consulta_completa", "status",
    "inicio", "fim", "quantidade_resultados",
    "quantidade_validos", "quantidade_duplicados",
    "job_id", "arquivo_raw", "erro", "observacao",
]


def _load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {"concluidos": [], "com_erro": [], "lote_id": str(uuid.uuid4())[:8]}


def _save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _load_control():
    rows = []
    if CONTROL_FILE.exists():
        with open(CONTROL_FILE, encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
    return rows


def _append_control(row):
    CONTROL_FILE.parent.mkdir(parents=True, exist_ok=True)
    exists = CONTROL_FILE.exists()
    with open(CONTROL_FILE, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CONTROL_FIELDS)
        if not exists:
            w.writeheader()
        w.writerow(row)


def _consulta_key(bairro, termo):
    return f"{bairro}|{termo}"


def run_consulta(consulta: dict, coords: dict, settings: dict, lote_id: str, logger=None) -> list:
    """
    Executa um job para uma consulta (bairro + termo).
    Retorna lista de dicts brutos com campos extras do projeto.
    """
    bairro = consulta["bairro"]
    termo = consulta["termo"]
    query = consulta["consulta_completa"]
    lat = coords.get("latitude", "")
    lon = coords.get("longitude", "")

    inicio = datetime.now().isoformat()
    log = logger or print

    if not lat or not lon:
        msg = f"Coordenadas ausentes para {bairro} — consulta pulada"
        log(f"  [collector] AVISO: {msg}")
        _append_control({
            "bairro": bairro, "termo": termo, "consulta_completa": query,
            "status": "pulado", "inicio": inicio, "fim": datetime.now().isoformat(),
            "quantidade_resultados": 0, "quantidade_validos": 0,
            "quantidade_duplicados": 0, "job_id": "", "arquivo_raw": "",
            "erro": msg, "observacao": "",
        })
        return []

    coleta_cfg = settings.get("scraper", {})
    depth = coleta_cfg.get("depth", 5)
    max_time = coleta_cfg.get("max_time", 300)
    email = coleta_cfg.get("email", False)

    log(f"  [collector] Job: '{query}' @ {lat},{lon} depth={depth}")

    try:
        job_id = scraper_client.create_job(
            keywords=[query], lat=lat, lon=lon,
            depth=depth, max_time=max_time, email=email,
        )
        log(f"  [collector] Job criado: {job_id}")

        scraper_client.poll_job(job_id, max_attempts=int(max_time / 8) + 20, interval=8)

        rows = scraper_client.download_results(job_id)
        log(f"  [collector] Download: {len(rows)} registros")

        # Enriquecer com campos do projeto
        agora = datetime.now()
        for row in rows:
            row["projeto"] = "Acai Map Belem"
            row["estado"] = "PA"
            row["cidade_padronizada"] = "Belem"
            row["bairro_pesquisa"] = bairro
            row["termo_pesquisa"] = termo
            row["consulta_completa"] = query
            row["data_coleta"] = agora.strftime("%Y-%m-%d")
            row["hora_coleta"] = agora.strftime("%H:%M:%S")
            row["lote_coleta"] = lote_id
            row["fonte"] = "Google Maps via google-maps-scraper-kit"
            row["status_validacao"] = "novo"

        # Salvar raw
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        ts = agora.strftime("%Y%m%d_%H%M%S")
        safe_bairro = bairro.replace(" ", "_").replace("/", "_")
        safe_termo = termo.replace(" ", "_").replace("/", "_")
        raw_file = RAW_DIR / f"raw_{safe_bairro}_{safe_termo}_{ts}.csv"

        if rows:
            fieldnames = list(rows[0].keys())
            with open(raw_file, "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=fieldnames)
                w.writeheader()
                w.writerows(rows)

        fim = datetime.now().isoformat()
        _append_control({
            "bairro": bairro, "termo": termo, "consulta_completa": query,
            "status": "concluido", "inicio": inicio, "fim": fim,
            "quantidade_resultados": len(rows), "quantidade_validos": len(rows),
            "quantidade_duplicados": 0, "job_id": job_id,
            "arquivo_raw": str(raw_file), "erro": "", "observacao": "",
        })

        scraper_client.delete_job(job_id)
        return rows

    except Exception as e:
        fim = datetime.now().isoformat()
        log(f"  [collector] ERRO em '{query}': {e}")
        _append_control({
            "bairro": bairro, "termo": termo, "consulta_completa": query,
            "status": "erro", "inicio": inicio, "fim": fim,
            "quantidade_resultados": 0, "quantidade_validos": 0,
            "quantidade_duplicados": 0, "job_id": "",
            "arquivo_raw": "", "erro": str(e), "observacao": "",
        })
        return []


def collect_all(consultas: list, coords_por_bairro: dict, settings: dict, logger=None, pausa=5) -> list:
    """
    Executa todas as consultas em sequência, com retomada automática.
    Retorna todos os registros brutos coletados.
    """
    log = logger or print
    state = _load_state()
    lote_id = state["lote_id"]
    concluidos = set(state["concluidos"])

    todos_os_registros = []
    total = len(consultas)

    for i, consulta in enumerate(consultas, 1):
        key = _consulta_key(consulta["bairro"], consulta["termo"])

        if key in concluidos:
            log(f"[{i}/{total}] PULANDO (já concluído): {consulta['consulta_completa']}")
            continue

        log(f"\n[{i}/{total}] Iniciando: {consulta['consulta_completa']}")
        bairro = consulta["bairro"]
        coords = coords_por_bairro.get(bairro, {})

        rows = run_consulta(consulta, coords, settings, lote_id, logger=log)
        todos_os_registros.extend(rows)

        if rows is not None:
            concluidos.add(key)
            state["concluidos"] = list(concluidos)
            _save_state(state)

        if i < total:
            log(f"  [collector] Pausa de {pausa}s antes da próxima consulta...")
            time.sleep(pausa)

    return todos_os_registros
