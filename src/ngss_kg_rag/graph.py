from __future__ import annotations

from collections import deque
from typing import Any

import networkx as nx


class KnowledgeGraph:
    def __init__(self, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]):
        self.graph = nx.MultiDiGraph()
        for node in nodes:
            self.graph.add_node(node["node_id"], **node)
        for edge in edges:
            self.graph.add_edge(edge["source_id"], edge["target_id"], key=edge["edge_id"], **edge)
        self.undirected = self.graph.to_undirected()

    def neighbors(self, node_id: str, max_hops: int = 1) -> dict[str, Any]:
        if node_id not in self.graph:
            return {"seed": node_id, "nodes": [], "edges": []}
        visited = {node_id}
        parent: dict[str, str | None] = {node_id: None}
        distance: dict[str, int] = {node_id: 0}
        queue: deque[str] = deque([node_id])
        while queue:
            current = queue.popleft()
            if distance[current] >= max_hops:
                continue
            for neighbor in self.undirected.neighbors(current):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                parent[neighbor] = current
                distance[neighbor] = distance[current] + 1
                queue.append(neighbor)

        nodes = []
        for item in visited:
            payload = dict(self.graph.nodes[item])
            payload["node_id"] = item
            payload["distance"] = distance.get(item, 0)
            path = []
            current = item
            while current is not None:
                path.append(current)
                current = parent.get(current)
            payload["path_from_seed"] = list(reversed(path))
            nodes.append(payload)

        edges = []
        for source, target, edge_payload in self.graph.edges(data=True):
            if source in visited and target in visited:
                edges.append(dict(edge_payload))
        return {"seed": node_id, "nodes": sorted(nodes, key=lambda item: (item["distance"], item["node_id"])), "edges": edges}
