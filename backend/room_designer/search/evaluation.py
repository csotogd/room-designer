from math import log2


def evaluate_hits(hits, relevant, k):
    relevant = set(relevant)
    positions = [i for i, hit in enumerate(hits[:k]) if hit["id"] in relevant]
    dcg = sum(1 / log2(i + 2) for i in positions)
    ideal = sum(1 / log2(i + 2) for i in range(min(len(relevant), k)))
    return {
        "recallAtK": len(positions) / len(relevant) if relevant else 1,
        "reciprocalRank": 1 / (positions[0] + 1) if positions else 0,
        "ndcgAtK": dcg / ideal if ideal else 1,
    }


async def evaluate_search(search, cases, k=5):
    if k <= 0:
        raise ValueError("k debe ser positivo")
    results = []
    for case in cases:
        hits = await search(case["query"], k)
        results.append({"query": case["query"], "top": hits, **evaluate_hits(hits, case["relevant"], k)})
    return {
        "k": k,
        "perQuery": results,
        **{
            name: sum(r[key] for r in results) / len(results) if results else 0
            for name, key in (
                ("meanRecallAtK", "recallAtK"),
                ("meanReciprocalRank", "reciprocalRank"),
                ("meanNdcgAtK", "ndcgAtK"),
            )
        },
    }
