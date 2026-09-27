"""Pipeline principal: geocodifica → coleta → limpa → deduplica → valida → exporta."""
import csv
import logging
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent


def setup_logger(modo_teste=False):
    logs_dir = ROOT / "logs"
    logs_dir.mkdir(exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    prefix = "teste" if modo_teste else "coleta"
    log_file = logs_dir / f"{prefix}_{today}.log"

    fmt = "%(asctime)s [%(levelname)s] %(message)s"
    logger = logging.getLogger(f"acai-map-{today}")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter(fmt))
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(logging.Formatter(fmt))
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def run(modo_teste=False):
    log = setup_logger(modo_teste)
    log.info("=" * 60)
    log.info("AÇAÍ MAP BELÉM — Início do Pipeline")
    log.info(f"Python: {sys.version.split()[0]}")
    log.info(f"Modo: {'TESTE (1 bairro, 2 termos)' if modo_teste else 'COMPLETO (10 bairros, 6 termos)'}")
    log.info("=" * 60)

    from src.config import get_settings, get_bairros, build_consultas
    from src.geocoder import geocode_todos
    from src import scraper_client
    from src.collector import collect_all
    from src.cleaner import clean_all
    from src.deduplicator import deduplicate, save_duplicates
    from src.validator import validate_all
    from src.exporter import (
        export_csv, export_excel, export_resumo, build_resumo,
        load_csv_safe, load_bairros_coordenadas
    )

    settings = get_settings()

    # 1. Verificar API
    log.info("\n[1] Verificando API em http://localhost:8080 ...")
    if not scraper_client.check_health():
        log.error("API indisponível. Inicie: docker compose up -d")
        sys.exit(1)
    log.info("    API OK.")

    # 2. Geocodificar bairros (usa cache)
    log.info("\n[2] Geocodificando bairros...")
    bairros = get_bairros()
    coords_por_bairro = geocode_todos(bairros)
    ok_coords = sum(1 for v in coords_por_bairro.values() if v.get("latitude"))
    log.info(f"    {ok_coords}/{len(bairros)} bairros geocodificados.")

    # 3. Montar consultas
    log.info("\n[3] Montando consultas...")
    todas_consultas = build_consultas()

    if modo_teste:
        todas_consultas = [
            c for c in todas_consultas
            if c["bairro"] == "Parque Verde" and c["termo"] in ["açaí", "açaíteria"]
        ]
        log.info(f"    MODO TESTE: {len(todas_consultas)} consultas.")
    else:
        log.info(f"    Total de consultas planejadas: {len(todas_consultas)}")

    # 4. Coletar
    log.info("\n[4] Iniciando coleta...")
    pausa = settings.get("coleta", {}).get("pausa_entre_jobs", 5)
    todos_raw = collect_all(todas_consultas, coords_por_bairro, settings, logger=log.info, pausa=pausa)
    log.info(f"    Coleta concluída. Registros brutos: {len(todos_raw)}")

    if not todos_raw:
        log.warning("    Nenhum registro coletado. Encerrando pipeline.")
        return None

    # 5. Limpar
    log.info("\n[5] Normalizando dados...")
    limpos = clean_all(todos_raw)
    log.info(f"    {len(limpos)} registros normalizados.")

    processed_dir = ROOT / "data" / "processed"
    processed_dir.mkdir(exist_ok=True)
    processed_file = processed_dir / "acai_processed.csv"
    with open(processed_file, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(limpos[0].keys()))
        w.writeheader()
        w.writerows(limpos)
    log.info(f"    Processados salvos: {processed_file}")

    # 6. Deduplicar
    log.info("\n[6] Deduplicando...")
    unicos, duplicatas_log = deduplicate(limpos)
    save_duplicates(duplicatas_log)
    log.info(f"    Únicos: {len(unicos)} | Duplicatas: {len(duplicatas_log)}")

    # 7. Validar
    log.info("\n[7] Validando...")
    validados, resumo_val = validate_all(unicos)
    log.info(f"    {resumo_val}")

    # 8. Verificações de qualidade
    log.info("\n[8] Verificações de qualidade...")
    place_ids = [r.get("place_id", "") for r in validados if r.get("place_id")]
    dup_pids = len(place_ids) - len(set(place_ids))
    nomes_vazios = sum(1 for r in validados if not r.get("title", "").strip())
    sem_bairro = sum(1 for r in validados if not r.get("bairro_pesquisa", "").strip())
    log.info(f"    place_id duplicados na final: {dup_pids}")
    log.info(f"    Nomes vazios: {nomes_vazios}")
    log.info(f"    Sem bairro_pesquisa: {sem_bairro}")
    sem_place_id = sum(1 for r in validados if not r.get("place_id", "").strip())
    log.info(f"    Sem place_id: {sem_place_id}")

    # 9. Exportar
    log.info("\n[9] Exportando resultados finais...")
    export_csv(validados)

    rows_controle = load_csv_safe(ROOT / "data" / "processed" / "coleta_controle.csv")
    rows_duplicates = load_csv_safe(ROOT / "data" / "processed" / "duplicates.csv")
    rows_bairros = load_bairros_coordenadas()

    # Contar consultas por status no controle
    concluidas = sum(1 for r in rows_controle if r.get("status") == "concluido")
    com_erro = sum(1 for r in rows_controle if r.get("status") == "erro")
    bairros_concluidos = len(set(r.get("bairro") for r in rows_controle if r.get("status") == "concluido"))

    resumo = build_resumo(
        bairros_processados=len(bairros) if not modo_teste else 1,
        bairros_concluidos=bairros_concluidos,
        consultas_planejadas=len(todas_consultas),
        consultas_executadas=len(rows_controle),
        consultas_concluidas=concluidas,
        consultas_com_erro=com_erro,
        resultados_brutos=len(todos_raw),
        registros_tratados=len(limpos),
        duplicidades=len(duplicatas_log),
        registros_finais=len(validados),
        sem_coordenadas=resumo_val["sem_coordenadas"],
        sem_place_id=sem_place_id,
        sem_avaliacao=resumo_val["sem_avaliacao"],
    )

    export_excel(validados, rows_controle, rows_duplicates, rows_bairros, resumo)
    export_resumo(resumo)

    log.info("\n" + "=" * 60)
    log.info("RESUMO FINAL")
    log.info("=" * 60)
    for k, v in resumo.items():
        log.info(f"  {k}: {v}")
    log.info("=" * 60)
    log.info("Pipeline concluído com sucesso.")

    return resumo
