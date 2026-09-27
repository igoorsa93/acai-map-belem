"""
run_r4.py — Ponto de entrada da Fase 2 (coleta R4 via google-maps-scraper-kit).

Pré-requisito:
  O google-maps-scraper-kit deve estar rodando em localhost:8080.
  Inicie com: cd google-maps-scraper-kit && python server.py (ou ./start.sh)

Uso:
  python run_r4.py                            # coleta todos os 71 bairros
  python run_r4.py --bairros tapana pratinha  # bairros específicos
  python run_r4.py --vazios                   # apenas os 13 bairros sem DENTRO
  python run_r4.py --workers 4               # limita concorrência (padrão: 5)
  python run_r4.py --max-results 80          # resultados por query (padrão: 60)
  python run_r4.py --dry-run                 # mostra plano sem coletar
  python run_r4.py --so-consolidar           # apenas regera o master (sem coletar)
"""
import asyncio
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.orchestration.r4_runner import run_r4
from src.orchestration.consolidador_master import consolidar


def main():
    parser = argparse.ArgumentParser(
        description="Fase 2: Coleta R4 de açaí em Belém via google-maps-scraper-kit"
    )
    parser.add_argument("--bairros", nargs="*", default=[], metavar="SLUG",
                        help="Slugs de bairros a coletar (vazio = todos)")
    parser.add_argument("--vazios", action="store_true",
                        help="Coleta apenas bairros com 0 estabelecimentos DENTRO")
    parser.add_argument("--workers", type=int, default=5,
                        help="Número de workers paralelos (padrão: 5)")
    parser.add_argument("--max-results", type=int, default=60, dest="max_results",
                        help="Máximo de resultados por query por bairro (padrão: 60)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Mostra o plano de coleta sem executar")
    parser.add_argument("--so-consolidar", action="store_true",
                        help="Pula a coleta e apenas regera master_consolidado.csv")
    args = parser.parse_args()

    if not args.so_consolidar:
        asyncio.run(run_r4(
            filtro_slugs=args.bairros or None,
            apenas_vazios=args.vazios,
            max_workers=args.workers,
            max_results_por_query=args.max_results,
            dry_run=args.dry_run,
        ))

        if args.dry_run:
            return

    print("\n" + "=" * 60)
    print("Atualizando master_consolidado.csv…")
    auditoria = consolidar()

    total = auditoria.get("total_pids", 0)
    dist  = auditoria.get("distribuicao_status", {})
    print(f"\n✓ Master atualizado: {total} PIDs únicos DENTRO")
    issues = auditoria.get("issues", [])
    if issues:
        print(f"⚠  {len(issues)} issue(s) de consistência — ver master_auditoria.json")


if __name__ == "__main__":
    main()
