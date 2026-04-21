# NGSS Knowledge Graph RAG API Reference

This document describes the HTTP API exposed by the FastAPI service in `src/ngss_kg_rag/api.py`.

## Overview

The service provides:

- health and rebuild operations
- catalog browsing for UI/client pickers
- direct node lookup by public identifier
- graph neighborhood traversal
- hybrid search over the NGSS knowledge graph
- graph-aware answer generation with citations

The runtime now uses a **canonical normalized artifact layer** generated from the raw NGSS JSON files:

1. raw JSON in `JSON/`
2. canonical exports in `data/canonical/`
3. SQLite graph store and indexes in `data/ngss_graph.sqlite3`

Canonicalization centers all exported experiences on **one canonical source-of-truth document**: `data/canonical/graph.json`. Other JSON artifacts are derived projections of sections within that same document.

## Base URL

When running locally:

```text
http://127.0.0.1:8000
```

## Content Type

- Requests with bodies use `Content-Type: application/json`
- Responses are JSON unless otherwise noted

## Authentication

There is **no authentication layer** in the current API.

## Versioning

The FastAPI app is currently initialized with:

- title: `NGSS Knowledge Graph RAG`
- version: `0.1.0`

There is no separate URL version prefix such as `/v1`.

## Error model

Most failures return a standard FastAPI error payload:

```json
{
  "detail": "Standard not found"
}
```

Common statuses:

- `200 OK` — request succeeded
- `404 Not Found` — requested node/topic/neighborhood could not be resolved
- `422 Unprocessable Entity` — request body or query parameters failed validation
- `500 Internal Server Error` — unexpected runtime failure

## Data model notes

### Public identifiers

The API generally expects and returns stable `public_id` values such as:

- performance expectations: `K-PS2-1`, `MS-PS1-2`
- topics: `HS-PS1`
- dimension concepts: `PS1.A`, `PAT`, `ETS1.A`
- crosswalk standards: `RI.5.1`

### Canonical graph objects

The service uses these core record families internally and in responses:

- `grade_band`
- `topic`
- `performance_expectation`
- `dimension_concept`
- `progression_statement`
- `evidence_statement`
- `crosswalk_standard`
- `source_page`

### Provenance

Most node, edge, and chunk payloads include provenance fields such as:

- `source_file`
- `source_pages`
- `page`
- `source_kind`

These point back to the raw NGSS source material even though runtime ingestion uses canonical artifacts.

---

# Common response objects

## Node object

Returned by direct lookup endpoints and embedded in graph/search/answer responses.

```json
{
  "node_id": "pe:K-PS2-1",
  "node_type": "performance_expectation",
  "title": "K-PS2-1",
  "family": null,
  "description": "Plan and conduct an investigation to compare the effects of different strengths or different directions of pushes and pulls on the motion of an object.",
  "payload": {
    "public_id": "K-PS2-1",
    "grade_id": "K",
    "grade_label": "Kindergarten",
    "topic_id": "K-PS2",
    "topic_title": "Motion and Stability: Forces and Interactions",
    "clarification_statement": "...",
    "assessment_boundary": "...",
    "source_pages": [19],
    "source_file": "ngssK5.json",
    "source_kind": "performance-expectation"
  }
}
```

Additional fields may appear in neighborhood/answer contexts:

- `distance`
- `path_from_seed`
- `seed_score`

## Edge object

```json
{
  "edge_id": "edge:123",
  "source_id": "pe:K-PS2-1",
  "target_id": "concept:CCC:PAT",
  "edge_type": "PE_ALIGNS_TO_DIMENSION",
  "payload": {
    "family_hint": "CCC",
    "resolved_family": "CCC",
    "raw_id": "Patterns",
    "mapping_method": "normalized-id",
    "confidence": 0.98,
    "texts": ["Patterns"],
    "source_file": "ngssK5.json",
    "source_pages": [19]
  }
}
```

## Chunk object

Chunks are retrieval/indexing units and appear in `/standards/{identifier}` and `/topics/{topic_id}`.

```json
{
  "chunk_id": "chunk:pe:K-PS2-1",
  "node_id": "pe:K-PS2-1",
  "chunk_type": "performance_expectation",
  "title": "K-PS2-1 Motion and Stability: Forces and Interactions",
  "text": "Performance Expectation K-PS2-1\n...",
  "payload": {
    "public_id": "K-PS2-1",
    "grade_id": "K",
    "topic_id": "K-PS2",
    "source_file": "ngssK5.json",
    "source_pages": [19]
  }
}
```

## Neighborhood response

Used by `/graph/neighbors/{node_id}` and nested in direct lookup responses.

```json
{
  "seed": "pe:K-PS2-1",
  "nodes": [
    {
      "node_id": "pe:K-PS2-1",
      "node_type": "performance_expectation",
      "title": "K-PS2-1",
      "distance": 0,
      "path_from_seed": ["pe:K-PS2-1"],
      "payload": {
        "public_id": "K-PS2-1"
      }
    }
  ],
  "edges": [
    {
      "edge_id": "edge:123",
      "source_id": "pe:K-PS2-1",
      "target_id": "concept:CCC:PAT",
      "edge_type": "PE_ALIGNS_TO_DIMENSION",
      "payload": {}
    }
  ]
}
```

## Catalog item

Returned by `/catalog/nodes` for native-picker clients.

```json
{
  "node_id": "pe:K-PS2-1",
  "node_type": "performance_expectation",
  "title": "K-PS2-1",
  "family": null,
  "description": "Plan and conduct an investigation ...",
  "public_id": "K-PS2-1",
  "grade_label": "Kindergarten",
  "topic_title": "Motion and Stability: Forces and Interactions"
}
```

## Search result

```json
{
  "node_id": "pe:K-PS2-1",
  "title": "K-PS2-1",
  "node_type": "performance_expectation",
  "family": null,
  "description": "Plan and conduct an investigation ...",
  "score": 8.731,
  "reasons": [
    "exact public id match",
    "identifier mention: K-PS2-1",
    "keyword retrieval"
  ],
  "chunk_ids": ["chunk:pe:K-PS2-1"],
  "payload": {
    "public_id": "K-PS2-1",
    "source_file": "ngssK5.json"
  }
}
```

## Answer response

```json
{
  "query": "What is K-PS2-1?",
  "answer": "Top match: K-PS2-1 - ... [K-PS2-1]",
  "citations": ["K-PS2-1"],
  "retrieved_nodes": [
    {
      "node_id": "pe:K-PS2-1",
      "seed_score": 8.731,
      "distance": 0,
      "path_from_seed": ["pe:K-PS2-1"],
      "payload": {
        "public_id": "K-PS2-1"
      }
    }
  ],
  "traversal_edges": [
    {
      "edge_id": "edge:123",
      "source_id": "pe:K-PS2-1",
      "target_id": "concept:CCC:PAT",
      "edge_type": "PE_ALIGNS_TO_DIMENSION",
      "payload": {}
    }
  ],
  "provider": "extractive"
}
```

`provider` is:

- `extractive` when using the built-in answer synthesizer
- `openai-compatible` when an external OpenAI-compatible model is configured

---

# Endpoint reference

## `GET /`

Serves the built-in browser UI.

### Response

- `200 OK`
- content type: HTML

This is not a JSON API route.

---

## `GET /health`

Returns process/database health plus graph/index metadata stored in the `settings` table.

### Response

```json
{
  "status": "ok",
  "database": "/absolute/path/to/data/ngss_graph.sqlite3",
  "stats": {
    "grades": 10,
    "topics": 61,
    "performance_expectations": 208,
    "concepts": 70,
    "source_files": [
      "ngss3DElements.json",
      "ngss68.json",
      "ngss912.json",
      "ngssK5.json"
    ],
    "embedding_dimensions": 512,
    "embedding_idf": {
      "pattern": 3.12
    }
  }
}
```

### Notes

- `stats` may include large embedding metadata such as `embedding_idf`
- this endpoint currently returns raw stored settings rather than a reduced operational summary

---

## `GET /catalog/nodes`

Returns a flattened, UI-friendly list of canonical graph nodes that have `public_id` values.

### Purpose

Designed for native picker UIs and browse flows.

### Response

```json
{
  "items": [
    {
      "node_id": "pe:K-PS2-1",
      "node_type": "performance_expectation",
      "title": "K-PS2-1",
      "family": null,
      "description": "Plan and conduct an investigation ...",
      "public_id": "K-PS2-1",
      "grade_label": "Kindergarten",
      "topic_title": "Motion and Stability: Forces and Interactions"
    }
  ]
}
```

### Sorting

Items are sorted by:

1. node type priority
2. family
3. `public_id`
4. title

### Node type priority

- `performance_expectation`
- `topic`
- `dimension_concept`
- everything else

---

## `POST /ingest/rebuild`

Rebuilds canonical artifacts, regenerates the SQLite store, refreshes retriever state, and rebuilds the in-memory graph.

### Request body

None.

### Response

```json
{
  "status": "rebuilt",
  "nodes": 4448,
  "edges": 6214,
  "aliases": 1876,
  "chunks": 339
}
```

### Side effects

- regenerates `data/canonical/graph.json`
- regenerates `data/canonical/manifest.json`
- regenerates `data/canonical/supplements.json`
- regenerates `data/canonical/audit.json`
- regenerates `data/canonical/info/*.json`
- recreates the SQLite graph/index store
- refreshes retrieval and answer services in memory

### Usage

Use this after changing raw JSON, normalization logic, or canonical export logic.

---

## `GET /standards/{identifier}`

Returns a canonical node by public identifier plus a one-hop neighborhood and directly attached chunks.

### Path parameter

- `identifier` — public ID such as `K-PS2-1`, `MS-PS1-2`, `HS-PS1`, `PS1.A`, `PAT`

### Response

```json
{
  "node": {
    "node_id": "pe:K-PS2-1",
    "node_type": "performance_expectation",
    "title": "K-PS2-1",
    "description": "...",
    "payload": {
      "public_id": "K-PS2-1",
      "source_file": "ngssK5.json"
    }
  },
  "neighbors": {
    "seed": "pe:K-PS2-1",
    "nodes": [],
    "edges": []
  },
  "chunks": [
    {
      "chunk_id": "chunk:pe:K-PS2-1",
      "chunk_type": "performance_expectation",
      "text": "..."
    }
  ]
}
```

### Errors

- `404 Not Found` — identifier could not be resolved

### Notes

- despite the route name, this can resolve multiple canonical node families, not only performance expectations

---

## `GET /topics/{topic_id}`

Returns a topic node plus a one-hop neighborhood and its chunks.

### Path parameter

- `topic_id` — canonical topic public ID such as `HS-PS1`

### Response

Same shape as `GET /standards/{identifier}`.

### Errors

- `404 Not Found` — topic not found
- `404 Not Found` — resolved identifier exists but is not a `topic`

---

## `POST /search`

Runs hybrid retrieval over aliases, exact public IDs, FTS lexical search, and hashed-vector similarity.

### Request body

```json
{
  "query": "K-PS2-1",
  "limit": 10
}
```

### Fields

- `query` — required, minimum length 1
- `limit` — optional, default `10`, minimum `1`, maximum `25`

### Response

```json
{
  "query": "K-PS2-1",
  "results": [
    {
      "node_id": "pe:K-PS2-1",
      "title": "K-PS2-1",
      "node_type": "performance_expectation",
      "family": null,
      "description": "Plan and conduct an investigation ...",
      "score": 8.731,
      "reasons": [
        "exact public id match",
        "identifier mention: K-PS2-1",
        "keyword retrieval"
      ],
      "chunk_ids": ["chunk:pe:K-PS2-1"],
      "payload": {
        "public_id": "K-PS2-1",
        "source_file": "ngssK5.json"
      }
    }
  ]
}
```

### Retrieval behavior

Search scoring combines:

- exact alias matches
- exact `public_id` matches
- identifier extraction from the query
- SQLite FTS lexical retrieval
- deterministic hashed-vector similarity over chunk text

### Errors

- `422 Unprocessable Entity` — invalid request body

---

## `POST /answer`

Runs search + graph expansion + answer synthesis.

### Request body

```json
{
  "query": "How does Patterns show up across the NGSS?",
  "limit": 5,
  "expand_hops": 1
}
```

### Fields

- `query` — required, minimum length 1
- `limit` — optional, default `5`, minimum `1`, maximum `15`
- `expand_hops` — optional, default `1`, minimum `0`, maximum `3`

### Response

```json
{
  "query": "How does Patterns show up across the NGSS?",
  "answer": "Top match: ... [PAT]",
  "citations": ["PAT", "MS-PS1-2"],
  "retrieved_nodes": [],
  "traversal_edges": [],
  "provider": "extractive"
}
```

### Processing pipeline

1. hybrid retrieval finds top candidate nodes
2. top seed nodes are expanded through graph neighborhoods
3. retrieved nodes and edges are merged
4. either:
   - the built-in extractive synthesizer generates an answer, or
   - an external OpenAI-compatible model is called
5. citations are derived from bracketed IDs in the final answer where possible

### Provider selection

The service uses the external provider only if all of these are set:

- `NGSS_LLM_BASE_URL`
- `NGSS_LLM_API_KEY`
- `NGSS_LLM_MODEL`

Otherwise it falls back to the internal extractive answer path.

### Errors

- `422 Unprocessable Entity` — invalid request body

---

## `GET /graph/neighbors/{node_id}`

Returns a graph neighborhood around a resolved node.

### Path parameter

- `node_id` — either a canonical public ID or an internal `node_id`

Examples:

- `K-PS2-1`
- `HS-PS1`
- `concept:DCI:PS1.A`

### Query parameters

- `max_hops` — optional, default `1`

### Response

```json
{
  "seed": "pe:K-PS2-1",
  "nodes": [
    {
      "node_id": "pe:K-PS2-1",
      "distance": 0,
      "path_from_seed": ["pe:K-PS2-1"],
      "payload": {
        "public_id": "K-PS2-1"
      }
    },
    {
      "node_id": "concept:CCC:PAT",
      "distance": 1,
      "path_from_seed": ["pe:K-PS2-1", "concept:CCC:PAT"],
      "payload": {
        "public_id": "PAT"
      }
    }
  ],
  "edges": [
    {
      "edge_id": "edge:123",
      "source_id": "pe:K-PS2-1",
      "target_id": "concept:CCC:PAT",
      "edge_type": "PE_ALIGNS_TO_DIMENSION",
      "payload": {}
    }
  ]
}
```

### Behavior

- if a public ID is supplied, it is resolved first
- if resolution fails, the service tries the value as an internal `node_id`
- the traversal uses the in-memory undirected graph for neighborhood expansion

### Errors

- `404 Not Found` — node could not be resolved or neighborhood is empty

---

# Canonical artifact outputs

These are not currently exposed as HTTP endpoints, but they are part of the API platform’s operational contract.

## `data/canonical/manifest.json`

Contains:

- canonical schema name/version
- source directory
- source file list
- exported counts

## `data/canonical/graph.json`

Contains:

- canonical node records
- canonical edge records
- alias records
- chunk records
- graph metadata
- manifest metadata
- supplemental normalized records
- audit findings
- information projections

This is the single canonical source-of-truth artifact used as the primary runtime ingestion source.

## `data/canonical/supplements.json`

Contains normalized supplemental records projected from `graph.json`:

- `topic_connections`
- `crosswalk_records`
- `dimension_mappings`

## `data/canonical/audit.json`

Contains audit data projected from `graph.json`:

- validation results
- audit summary
- synthetic node findings
- low-confidence dimension mappings
- crosswalk text variant findings

## `data/canonical/info/`

Contains entity-oriented information projections derived from `graph.json`:

- `index.json`
- `grades.json`
- `topics.json`
- `performance_expectations.json`
- `concepts.json`
- `crosswalks.json`

---

# Operational examples

## Check health

```bash
curl http://127.0.0.1:8000/health
```

## Rebuild runtime data

```bash
curl -X POST http://127.0.0.1:8000/ingest/rebuild
```

## Browse catalog nodes

```bash
curl http://127.0.0.1:8000/catalog/nodes
```

## Lookup a standard

```bash
curl http://127.0.0.1:8000/standards/K-PS2-1
```

## Search

```bash
curl -X POST http://127.0.0.1:8000/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"Patterns","limit":8}'
```

## Answer

```bash
curl -X POST http://127.0.0.1:8000/answer \
  -H 'Content-Type: application/json' \
  -d '{"query":"How does Patterns show up across the NGSS?","limit":5,"expand_hops":1}'
```

## Graph neighbors

```bash
curl 'http://127.0.0.1:8000/graph/neighbors/K-PS2-1?max_hops=2'
```

---

# Known limitations

- no authentication or authorization
- no pagination on catalog/search responses
- no explicit versioned endpoint namespace
- `GET /health` currently returns full settings metadata, including embedding metadata that may be larger than ideal
- canonical artifacts are file outputs, not directly served over HTTP
- no dedicated OpenAPI schema customization beyond FastAPI defaults

---

# Implementation source

Primary implementation files:

- `src/ngss_kg_rag/api.py`
- `src/ngss_kg_rag/answering.py`
- `src/ngss_kg_rag/retrieval.py`
- `src/ngss_kg_rag/storage.py`
- `src/ngss_kg_rag/graph.py`
- `src/ngss_kg_rag/canonical.py`
