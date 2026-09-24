#!/usr/bin/env python3
"""
build_data.py - Generates web/data/dashboard_data.js from CSV sources.
Run from project root: python web/build_data.py
"""
import csv
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT  = os.path.join(BASE, "web", "data", "dashboard_data.js")

NUMERIC_ESTAB = {
    "latitude", "longitude", "review_rating", "review_count",
    "ocorrencias_total", "distancia_bairro_pesquisa_km",
    "dist_vizinho_mais_proximo_km",
    "estabelecimentos_500m", "estabelecimentos_1km", "estabelecimentos_2km",
}

def read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))

def cast_estab(row):
    out = {}
    for k, v in row.items():
        if k in NUMERIC_ESTAB:
            try:
                out[k] = float(v) if v not in ("", None) else None
            except ValueError:
                out[k] = None
        else:
            out[k] = v
    return out

def main():
    print("Reading CSVs...")
    estabs  = [cast_estab(r) for r in read_csv(os.path.join(DATA, "powerbi", "dim_estabelecimentos_pbi.csv"))]
    occs_raw = read_csv(os.path.join(DATA, "model", "fact_ocorrencias_busca.csv"))
    queries  = read_csv(os.path.join(DATA, "model", "dim_consultas.csv"))
    bairros  = read_csv(os.path.join(DATA, "model", "dim_bairros.csv"))

    # Slim occurrences
    occs = [
        {
            "place_id": r["place_id"],
            "bairro_pesquisa": r["bairro_pesquisa"],
            "termo_pesquisa": r["termo_pesquisa"],
            "consulta_id": r["consulta_id"],
        }
        for r in occs_raw
    ]

    payload = {
        "establishments": estabs,
        "occurrences": occs,
        "queries": queries,
        "neighborhoods": bairros,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    js = "window.ACAI_MAP_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)

    print(f"  establishments : {len(estabs)}")
    print(f"  occurrences    : {len(occs)}")
    print(f"  queries        : {len(queries)}")
    print(f"  neighborhoods  : {len(bairros)}")
    print(f"Written -> {OUT}")

if __name__ == "__main__":
    main()
