"""
run_orchestration.py — Ponto de entrada da pipeline paralela por bairro.

Uso:
  python run_orchestration.py                     # processa todos os 71 bairros + consolida
  python run_orchestration.py tapana pratinha     # só esses bairros (teste)
  python run_orchestration.py --so-consolidar     # apenas consolida (sem re-processar)
  python run_orchestration.py --workers 4         # limita concorrência
"""
import asyncio
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.orchestration.bairro_runner import run as bairro_run
from src.orchestration.consolidador_master import consolidar


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("bairros", nargs="*", help="Slugs de bairros (vazio=todos)")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--so-consolidar", action="store_true",
                        help="Pula o bairro_runner, só consolida")
    args = parser.parse_args()

    if not args.so_consolidar:
        asyncio.run(bairro_run(
            filtro_slugs=args.bairros or None,
            max_workers=args.workers,
        ))

    print("\n" + "="*60)
    consolidar()


if __name__ == "__main__":
    main()
