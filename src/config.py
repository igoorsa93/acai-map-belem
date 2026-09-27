import yaml
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
CONFIG_DIR = ROOT / "config"


def _load(filename):
    with open(CONFIG_DIR / filename, encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_settings():
    return _load("settings.yaml")


def get_bairros():
    data = _load("bairros.yaml")
    return data["bairros"]


def get_termos():
    data = _load("termos.yaml")
    return data


def build_consultas():
    """Retorna lista de dicts {bairro, termo, consulta_completa}."""
    settings = get_settings()
    bairros = get_bairros()
    termos_data = get_termos()
    termos = termos_data["termos"]
    bairros_femininos = set(termos_data.get("bairros_femininos", []))

    consultas = []
    for bairro_entry in bairros:
        bairro = bairro_entry["nome"]
        preposicao = "na" if bairro in bairros_femininos else "no"
        for termo in termos:
            consulta = f"{termo} {preposicao} {bairro}, Belém, PA"
            consultas.append({
                "bairro": bairro,
                "termo": termo,
                "consulta_completa": consulta,
            })
    return consultas
