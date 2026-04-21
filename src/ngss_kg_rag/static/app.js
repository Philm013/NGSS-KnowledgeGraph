const SVG_NS = "http://www.w3.org/2000/svg";
const BAND_ORDER = ["primary", "elementary", "middle", "high"];
const WORKSPACE_STORAGE_KEY = "ngss-kg-rag.workspace.v1";
const RUNTIME_CONFIG = window.NGSS_CONFIG || {};
const APP_SCRIPT = document.currentScript || document.querySelector('script[src$="app.js"]');
const APP_SCRIPT_URL = new URL(APP_SCRIPT?.src || window.location.href, window.location.href);
const APP_ASSET_BASE_URL = new URL(".", APP_SCRIPT_URL);
const API_BASE_URL = String(RUNTIME_CONFIG.apiBaseUrl || "").replace(/\/+$/, "");
const PAGES_DATA_URL = RUNTIME_CONFIG.pagesDataUrl ? new URL(RUNTIME_CONFIG.pagesDataUrl, APP_ASSET_BASE_URL).toString() : "";
const CATALOG_CATEGORY_LABELS = {
  all: "All items",
  performance_expectation: "Performance expectations",
  topic: "Topics",
  SEP: "Science and engineering practices",
  CCC: "Crosscutting concepts",
  DCI: "Disciplinary core ideas",
  CNS: "Nature of science",
  "C-ETAS": "Engineering / technology connections",
  other: "Other items",
};
const ANSWER_TEMPLATES = {
  "what-is": {
    needsSecondary: false,
    build: ({ primary }) => `What is ${primary.public_id}?`,
  },
  "how-shows-up": {
    needsSecondary: false,
    build: ({ primary }) => `How does ${primary.public_id} show up across the NGSS?`,
  },
  "aligned-standards": {
    needsSecondary: false,
    build: ({ primary }) => `What standards align to ${primary.public_id}?`,
  },
  "compare-two": {
    needsSecondary: true,
    build: ({ primary, secondary }) => `How are ${primary.public_id} and ${secondary.public_id} connected in the NGSS graph?`,
  },
};
const DIAGRAM_VIEWS = {
  graph: {
    title: "Interactive graph canvas",
    summary: "A full-canvas graph view for dragging, panning, zooming, and following shared neighborhood structure.",
  },
  overview: {
    title: "Mermaid overview",
    summary: "A compact Mermaid topology centered on active seeds. Mermaid nodes are auto-laid out (pan/zoom/click supported).",
  },
  relationships: {
    title: "Mermaid relationship map",
    summary: "Grouped relationship lanes show neighborhood links in Mermaid's fixed layout (pan/zoom/click supported).",
  },
  paths: {
    title: "Mermaid path flow",
    summary: "A compact path view traces selected branches in Mermaid's fixed layout (pan/zoom/click supported).",
  },
  sources: {
    title: "Mermaid provenance trace",
    summary: "A provenance-first Mermaid trace links source pages, evidence, and chunks in Mermaid's fixed layout.",
  },
};
const GUIDED_STEPS = {
  choose: {
    title: "Choose",
    summary: "Pick one or more standards, topics, or concepts from the dataset-backed controls.",
  },
  explore: {
    title: "Explore",
    summary: "Open the graph neighborhood and switch Mermaid views to see structure, paths, and provenance.",
  },
  understand: {
    title: "Understand",
    summary: "Inspect the selected node, its NGSS connection boxes, linked evidence, and relationship details.",
  },
  ask: {
    title: "Ask",
    summary: "Run guided search or answer prompts built directly from the current dataset selections.",
  },
};
const DEFAULT_WORKSPACE = {
  search: { category: "all", selectedPublicId: "K-PS2-1", limit: 8 },
  answer: {
    template: "how-shows-up",
    primaryPublicId: "K-PS2-1",
    secondaryPublicId: "MS-PS1-2",
    limit: 5,
    hops: 1,
  },
  inspectIds: ["K-PS2-1"],
  inspectId: "K-PS2-1",
  inspectHops: 1,
  viewMode: "explorer",
  diagramView: "graph",
  currentStep: "choose",
  seedCategory: "all",
};
const GOLDEN_LAYOUT_MODULE_PATH = new URL("vendor/golden-layout/dist/esm/index.js", APP_ASSET_BASE_URL).toString();
const PANEL_SOURCE_IDS = [
  "panel-seeds",
  "panel-canvas",
  "panel-inspector",
  "panel-connections",
  "panel-evidence",
  "panel-sources",
  "panel-search",
  "panel-answer",
];

const EDGE_META = {
  GRADE_HAS_TOPIC: {
    label: "belongs to grade band",
    category: "Grade context",
    explanation: "This topic sits inside the selected grade band or grade-level cluster.",
  },
  TOPIC_HAS_PE: {
    label: "contains performance expectation",
    category: "Performance expectations",
    explanation: "This topic includes the linked performance expectation.",
  },
  PE_ALIGNS_TO_DIMENSION: {
    label: "aligns to dimension",
    category: "Dimension links",
    explanation: "This performance expectation is aligned to an NGSS dimension concept such as a practice, DCI, or crosscutting concept.",
  },
  DIMENSION_HAS_PROGRESSION: {
    label: "has progression statement",
    category: "Progressions",
    explanation: "This concept is supported by a progression statement for a grade-band level.",
  },
  PE_HAS_EVIDENCE: {
    label: "is supported by evidence statement",
    category: "Evidence",
    explanation: "This performance expectation has an evidence statement describing what supporting work or reasoning should be visible.",
  },
  PE_HAS_SOURCE_PAGE: {
    label: "comes from source page",
    category: "Sources",
    explanation: "This performance expectation appears on the linked page in the original NGSS source file.",
  },
  TOPIC_CONNECTS_TO_DCI_IN_GRADE: {
    label: "connects to DCI in grade",
    category: "Related DCIs",
    explanation: "The topic is explicitly linked to another disciplinary core idea in the source data.",
  },
  TOPIC_ARTICULATES_TO_DCI_ACROSS_GRADES: {
    label: "articulates across grades",
    category: "Cross-grade articulation",
    explanation: "The topic references a related DCI connection that appears across grade bands.",
  },
  PE_CROSSWALKS_TO_STANDARD: {
    label: "crosswalks to external standard",
    category: "Crosswalks",
    explanation: "The performance expectation is connected to a Common Core ELA or Math standard.",
  },
  TOPIC_CROSSWALKS_TO_STANDARD: {
    label: "topic crosswalk",
    category: "Crosswalks",
    explanation: "The topic carries a Common Core crosswalk reference even when it is not attached to a single PE.",
  },
};

const state = {
  graph: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  currentInspectIds: [...DEFAULT_WORKSPACE.inspectIds],
  currentInspectId: null,
  currentInspectHops: 1,
  viewMode: "explorer",
  diagramView: DEFAULT_WORKSPACE.diagramView,
  currentStep: DEFAULT_WORKSPACE.currentStep,
  nodeContexts: new Map(),
  graphFilters: {
    nodeTypes: new Set(),
    edgeTypes: new Set(),
  },
  graphTransform: {
    x: 0,
    y: 0,
    scale: 1,
  },
  graphPositions: new Map(),
  graphDrag: null,
  panDrag: null,
  persistTimer: null,
  catalogItems: [],
  catalogByPublicId: new Map(),
  uiTabs: {
    inspector: "overview",
    workbench: "browse",
  },
  mermaidNodeLookup: new Map(),
  mermaidRenderNonce: 0,
  mermaidInitialized: false,
  mermaidTransform: {
    x: 0,
    y: 0,
    scale: 1,
  },
  mermaidPan: null,
  layoutManager: null,
  goldenLayoutCtor: null,
  pagesData: null,
  pagesDataPromise: null,
  localGraphIndex: null,
};

const $ = (selector) => document.querySelector(selector);

function logDebug(scope, message, payload) {
  const prefix = `[NGSS KG] ${scope}`;
  if (payload === undefined) {
    console.info(prefix, message);
    return;
  }
  console.groupCollapsed(`${prefix} ${message}`);
  console.log(payload);
  console.groupEnd();
}

function isPagesDataMode() {
  return Boolean(PAGES_DATA_URL && !API_BASE_URL);
}

async function ensurePagesData() {
  if (state.pagesData) return state.pagesData;
  if (!PAGES_DATA_URL) throw new Error("No local Pages dataset is configured.");
  if (!state.pagesDataPromise) {
    state.pagesDataPromise = fetch(PAGES_DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load Pages dataset (${response.status})`);
        return response.json();
      })
      .then((data) => {
        const nodes = data?.graph?.nodes || [];
        const chunks = data?.graph?.chunks || [];
        const edges = data?.graph?.edges || [];
        const nodesById = new Map(nodes.map((node) => [node.node_id, node]));
        const publicIdToNodeId = new Map();
        nodes.forEach((node) => {
          const publicId = node?.payload?.public_id;
          if (publicId && !publicIdToNodeId.has(publicId)) publicIdToNodeId.set(publicId, node.node_id);
        });
        const chunksByNodeId = new Map();
        chunks.forEach((chunk) => {
          const items = chunksByNodeId.get(chunk.node_id) || [];
          items.push(chunk);
          chunksByNodeId.set(chunk.node_id, items);
        });
        const neighborsByNodeId = new Map();
        edges.forEach((edge) => {
          if (!neighborsByNodeId.has(edge.source_id)) neighborsByNodeId.set(edge.source_id, new Set());
          if (!neighborsByNodeId.has(edge.target_id)) neighborsByNodeId.set(edge.target_id, new Set());
          neighborsByNodeId.get(edge.source_id).add(edge.target_id);
          neighborsByNodeId.get(edge.target_id).add(edge.source_id);
        });
        state.pagesData = data;
        state.localGraphIndex = {
          nodesById,
          publicIdToNodeId,
          chunksByNodeId,
          neighborsByNodeId,
          edges,
        };
        logDebug("pages-data", "loaded", {
          url: PAGES_DATA_URL,
          nodes: nodes.length,
          edges: edges.length,
          chunks: chunks.length,
          catalog: (data.catalog || []).length,
        });
        return data;
      });
  }
  return state.pagesDataPromise;
}

function localNodeByIdentifier(identifier) {
  if (!state.localGraphIndex) return null;
  const nodeId = state.localGraphIndex.publicIdToNodeId.get(identifier) || identifier;
  return state.localGraphIndex.nodesById.get(nodeId) || null;
}

function localNeighborhood(nodeId, maxHops = 1) {
  const index = state.localGraphIndex;
  if (!index?.nodesById.has(nodeId)) return { seed: nodeId, nodes: [], edges: [] };
  const visited = new Set([nodeId]);
  const parent = new Map([[nodeId, null]]);
  const distance = new Map([[nodeId, 0]]);
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift();
    if ((distance.get(current) || 0) >= maxHops) continue;
    for (const neighbor of index.neighborsByNodeId.get(current) || []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, current);
      distance.set(neighbor, (distance.get(current) || 0) + 1);
      queue.push(neighbor);
    }
  }
  const nodes = [...visited].map((id) => {
    const node = { ...index.nodesById.get(id) };
    const path = [];
    let current = id;
    while (current !== null) {
      path.push(current);
      current = parent.get(current) ?? null;
    }
    node.distance = distance.get(id) || 0;
    node.path_from_seed = path.reverse();
    return node;
  });
  const edges = index.edges.filter((edge) => visited.has(edge.source_id) && visited.has(edge.target_id));
  return {
    seed: nodeId,
    nodes: nodes.sort((left, right) => (left.distance - right.distance) || String(left.node_id).localeCompare(String(right.node_id))),
    edges,
  };
}

function localSearchCatalog(query, limit = 10) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  return (state.pagesData?.catalog || [])
    .map((item) => {
      const haystack = [item.public_id, item.title, item.description, item.family, item.topic_title, item.grade_label]
        .filter(Boolean)
        .join(" \n ")
        .toLowerCase();
      let score = 0;
      if (String(item.public_id || "").toLowerCase() === needle) score += 200;
      if (String(item.public_id || "").toLowerCase().includes(needle)) score += 120;
      if (String(item.title || "").toLowerCase().includes(needle)) score += 80;
      if (haystack.includes(needle)) score += 40;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || String(left.item.public_id).localeCompare(String(right.item.public_id)))
    .slice(0, limit)
    .map(({ item, score }) => ({
      ...localNodeByIdentifier(item.public_id),
      score,
      reasons: ["Matched the local Pages dataset."],
      chunk_ids: (state.localGraphIndex?.chunksByNodeId.get(localNodeByIdentifier(item.public_id)?.node_id) || []).map((chunk) => chunk.chunk_id),
    }));
}

async function localApi(path, options = {}) {
  await ensurePagesData();
  const url = new URL(path, "https://local.invalid");
  const pathname = url.pathname;
  const method = (options.method || "GET").toUpperCase();
  if (pathname === "/health") {
    const counts = state.pagesData?.manifest?.counts || {};
    return { status: "static", stats: counts };
  }
  if (pathname === "/catalog/nodes") {
    return { items: state.pagesData?.catalog || [] };
  }
  if ((pathname.startsWith("/standards/") || pathname.startsWith("/topics/")) && method === "GET") {
    const identifier = decodeURIComponent(pathname.split("/").pop() || "");
    const node = localNodeByIdentifier(identifier);
    if (!node) throw new Error(`Not found: ${identifier}`);
    return {
      node,
      neighbors: localNeighborhood(node.node_id, 1).nodes,
      chunks: state.localGraphIndex?.chunksByNodeId.get(node.node_id) || [],
    };
  }
  if (pathname.startsWith("/graph/neighbors/") && method === "GET") {
    const identifier = decodeURIComponent(pathname.split("/").pop() || "");
    const node = localNodeByIdentifier(identifier);
    if (!node) throw new Error(`Not found: ${identifier}`);
    return localNeighborhood(node.node_id, clampNumber(url.searchParams.get("max_hops"), 1, 1, 3));
  }
  if (pathname === "/search" && method === "POST") {
    const payload = JSON.parse(options.body || "{}");
    return { query: payload.query || "", results: localSearchCatalog(payload.query, payload.limit || 10) };
  }
  if (pathname === "/answer" && method === "POST") {
    const payload = JSON.parse(options.body || "{}");
    const results = localSearchCatalog(payload.query, payload.limit || 5);
    const primary = results[0];
    const citations = primary ? [publicIdFor(primary)] : [];
    const chunks = primary ? state.localGraphIndex?.chunksByNodeId.get(primary.node_id) || [] : [];
    const support = chunks[0]?.text || primary?.description || "The Pages build is using a local static dataset, so this answer is a lightweight summary instead of a server-generated RAG response.";
    return {
      query: payload.query || "",
      answer: primary
        ? `${publicIdFor(primary)}: ${support}`
        : "No local answer could be generated from the Pages dataset for that prompt.",
      citations,
      retrieved_nodes: results,
      traversal_edges: [],
      provider: "pages-static",
    };
  }
  if (pathname === "/ingest/rebuild" && method === "POST") {
    throw new Error("Rebuild is unavailable on the static GitHub Pages deployment.");
  }
  throw new Error(`Unsupported Pages request: ${pathname}`);
}

async function loadGoldenLayoutCtor() {
  if (state.goldenLayoutCtor) return state.goldenLayoutCtor;
  const module = await import(GOLDEN_LAYOUT_MODULE_PATH);
  state.goldenLayoutCtor = module.GoldenLayout;
  return state.goldenLayoutCtor;
}

function defaultDockLayout() {
  return {
    settings: {
      hasHeaders: true,
      reorderEnabled: true,
      showPopoutIcon: true,
      showCloseIcon: false,
      showMaximiseIcon: true,
      popoutWholeStack: true,
    },
    root: {
      type: "row",
      content: [
        {
          type: "stack",
          size: "18%",
          isClosable: false,
          content: [
            {
              type: "component",
              title: "Seeds and controls",
              componentType: "dom-panel",
              isClosable: false,
              componentState: { panelId: "panel-seeds" },
            },
            {
              type: "component",
              title: "Browse",
              componentType: "dom-panel",
              isClosable: false,
              componentState: { panelId: "panel-search" },
            },
          ],
        },
        {
          type: "component",
          title: "Graph canvas",
          componentType: "dom-panel",
          size: "64%",
          isClosable: false,
          componentState: { panelId: "panel-canvas" },
        },
        {
          type: "stack",
          size: "18%",
          isClosable: false,
          content: [
            {
              type: "component",
              title: "Inspector",
              componentType: "dom-panel",
              isClosable: false,
              componentState: { panelId: "panel-inspector" },
            },
            {
              type: "component",
              title: "Connections",
              componentType: "dom-panel",
              isClosable: false,
              componentState: { panelId: "panel-connections" },
            },
            {
              type: "component",
              title: "Evidence",
              componentType: "dom-panel",
              isClosable: false,
              componentState: { panelId: "panel-evidence" },
            },
            {
              type: "component",
              title: "Sources",
              componentType: "dom-panel",
              isClosable: false,
              componentState: { panelId: "panel-sources" },
            },
            {
              type: "component",
              title: "Ask",
              componentType: "dom-panel",
              isClosable: false,
              componentState: { panelId: "panel-answer" },
            },
          ],
        },
      ],
    },
  };
}

function normalizeDockSize(value, fallbackUnit) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}${fallbackUnit}`;
  }
  return value;
}

function normalizeDockItemConfig(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    size: normalizeDockSize(item.size, "%"),
    minSize: normalizeDockSize(item.minSize, "px"),
    width: normalizeDockSize(item.width, "px"),
    height: normalizeDockSize(item.height, "px"),
    content: Array.isArray(item.content) ? item.content.map((child) => normalizeDockItemConfig(child)) : item.content,
    root: item.root ? normalizeDockItemConfig(item.root) : item.root,
    openPopouts: Array.isArray(item.openPopouts) ? item.openPopouts.map((child) => normalizeDockItemConfig(child)) : item.openPopouts,
  };
}

function normalizeDockLayoutConfig(layoutConfig) {
  if (!layoutConfig || typeof layoutConfig !== "object") return defaultDockLayout();
  return normalizeDockItemConfig(layoutConfig);
}

function panelSourceById(panelId) {
  return document.getElementById(panelId);
}

function restorePanelToStash(panelId) {
  const source = panelSourceById(panelId);
  const stash = $("#panel-stash");
  if (source && stash && source.parentElement !== stash) stash.appendChild(source);
}

function persistDockLayout() {
  if (!state.layoutManager) return null;
  try {
    return state.layoutManager.saveLayout();
  } catch (_error) {
    return null;
  }
}

async function initDockLayout(layoutConfig = null) {
  const layoutRoot = $("#layout-root");
  if (!layoutRoot) return;
  const GoldenLayout = await loadGoldenLayoutCtor();
  if (state.layoutManager) {
    try {
      state.layoutManager.destroy?.();
    } catch (_error) {
      // Ignore layout teardown issues.
    }
    PANEL_SOURCE_IDS.forEach((panelId) => restorePanelToStash(panelId));
  }
  const layout = new GoldenLayout(layoutRoot);
  layout.resizeWithContainerAutomatically = true;
  layout.registerComponentFactoryFunction("dom-panel", (container, componentState) => {
    const panelId = componentState?.panelId;
    const source = panelSourceById(panelId);
    if (!source) {
      const fallback = document.createElement("div");
      fallback.className = "dock-panel";
      fallback.textContent = `Missing panel: ${panelId}`;
      container.element.appendChild(fallback);
      return { rootHtmlElement: fallback };
    }
    source.hidden = false;
    container.element.appendChild(source);
    const resize = () => {
      if (panelId === "panel-canvas") {
        renderVisualizationStage();
      } else if (panelId === "panel-inspector") {
        renderInspector();
      }
    };
    container.on("resize", resize);
    container.on("show", resize);
    container.on("destroy", () => restorePanelToStash(panelId));
    return { rootHtmlElement: source };
  });
  layout.on("stateChanged", () => scheduleWorkspacePersist(220));
  const normalizedLayoutConfig = normalizeDockLayoutConfig(layoutConfig || defaultDockLayout());
  layout.loadLayout(normalizedLayoutConfig);
  state.layoutManager = layout;
  logDebug("layout", "initialized", {
    hasSavedLayout: Boolean(layoutConfig),
    usedNormalizedLayout: normalizedLayoutConfig !== layoutConfig,
    panels: PANEL_SOURCE_IDS,
  });
}

async function api(path, options = {}) {
  if (isPagesDataMode()) {
    try {
      const data = await localApi(path, options);
      logDebug("api", "local response", { path, keys: Object.keys(data || {}), data });
      return data;
    } catch (error) {
      logDebug("api", "local error", { path, detail: error.message });
      throw error;
    }
  }
  const url = resolveApiUrl(path);
  logDebug("api", "request", {
    path: url,
    method: options.method || "GET",
    body: options.body ? JSON.parse(options.body) : null,
  });
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch (_error) {
      // Ignore plain text responses.
    }
    logDebug("api", "error", { path: url, detail });
    throw new Error(detail);
  }
  const data = await response.json();
  logDebug("api", "response", { path: url, keys: Object.keys(data || {}), data });
  return data;
}

function resolveApiUrl(path) {
  const normalizedPath = String(path || "");
  if (!API_BASE_URL || /^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  return `${API_BASE_URL}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast${isError ? " error" : ""}`;
  setTimeout(() => {
    toast.className = "toast hidden";
  }, 3200);
}

function publicIdFor(nodeLike) {
  return nodeLike?.payload?.public_id || nodeLike?.node_id || nodeLike?.title || "unknown";
}

function uniqueSeedIds(values) {
  const seen = new Set();
  return (values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

function parseSeedInput(value) {
  return uniqueSeedIds(String(value || "").split(/[\n,]+/));
}

function categoryKeyFor(item) {
  if (!item) return "other";
  if (item.node_type === "performance_expectation") return "performance_expectation";
  if (item.node_type === "topic") return "topic";
  if (item.family) return item.family;
  return "other";
}

function optionLabelFor(item) {
  const meta = [item.family, item.grade_label, item.topic_title].filter(Boolean).join(" • ");
  return meta ? `${item.public_id} — ${item.title} (${meta})` : `${item.public_id} — ${item.title}`;
}

function itemByPublicId(publicId) {
  return state.catalogByPublicId.get(publicId) || null;
}

function filteredCatalogItems(category) {
  if (!category || category === "all") return state.catalogItems;
  return state.catalogItems.filter((item) => categoryKeyFor(item) === category);
}

function replaceSelectOptions(select, items, { includeBlank = false, blankLabel = "Select an item", selectedValue = "" } = {}) {
  const options = [];
  if (includeBlank) {
    options.push(`<option value="">${escapeHtml(blankLabel)}</option>`);
  }
  options.push(
    ...items.map(
      (item) => `<option value="${escapeHtml(item.public_id)}"${item.public_id === selectedValue ? " selected" : ""}>${escapeHtml(optionLabelFor(item))}</option>`,
    ),
  );
  select.innerHTML = options.join("");
  if (!select.value && items.length) {
    select.value = selectedValue && items.some((item) => item.public_id === selectedValue) ? selectedValue : items[0].public_id;
  }
}

function replaceCategoryOptions(select, selectedValue = "all") {
  const categories = ["all", ...new Set(state.catalogItems.map((item) => categoryKeyFor(item)))];
  select.innerHTML = categories
    .map(
      (category) =>
        `<option value="${escapeHtml(category)}"${category === selectedValue ? " selected" : ""}>${escapeHtml(CATALOG_CATEGORY_LABELS[category] || category)}</option>`,
    )
    .join("");
}

function typeClassFor(node) {
  const type = node?.node_type || node?.family || "";
  if (type === "performance_expectation") return "pe";
  if (type === "topic") return "topic";
  if (type === "dimension_concept") return "concept";
  return "other";
}

function humanizeEdgeType(value) {
  return String(value || "edge")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}

function isSeedNode(nodeId) {
  return Boolean(state.graph?.seed_node_ids?.includes(nodeId));
}

function nodeRadius(node) {
  if (isSeedNode(node.node_id)) return 28;
  if (node.node_type === "topic") return 22;
  if (node.node_type === "dimension_concept") return 22;
  if (node.node_type === "performance_expectation") return 17;
  return 16;
}

function trimLabel(text, max = 22) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function cssEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function setTabState(group, tab) {
  state.uiTabs[group] = tab;
  document.querySelectorAll(`[data-tab-group="${group}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(`[data-panel-group="${group}"]`).forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

function setCurrentStep(step, { persist = true, scroll = false } = {}) {
  if (!GUIDED_STEPS[step]) step = DEFAULT_WORKSPACE.currentStep;
  state.currentStep = step;
  document.querySelectorAll("[data-step]").forEach((button) => {
    button.classList.toggle("active", button.dataset.step === step);
  });
  const summary = $("#step-summary");
  if (summary) {
    const meta = GUIDED_STEPS[step] || GUIDED_STEPS.choose;
    summary.textContent = `${meta.title}: ${meta.summary}`;
  }
  logDebug("guided-step", "active", { step });
  if (persist) scheduleWorkspacePersist();
}

function currentTab(group) {
  return state.uiTabs[group];
}

function currentStepMeta() {
  return GUIDED_STEPS[state.currentStep] || GUIDED_STEPS[DEFAULT_WORKSPACE.currentStep];
}

function normalizeDiagramView(value) {
  if (value === "interactive") return "overview";
  return DIAGRAM_VIEWS[value] ? value : DEFAULT_WORKSPACE.diagramView;
}

function graphNodeById(nodeId) {
  return state.graph?.nodes?.find((node) => node.node_id === nodeId) || null;
}

function graphEdgeById(edgeId) {
  return state.graph?.edges?.find((edge) => edge.edge_id === edgeId) || null;
}

function setWorkspaceStatus(message) {
  const element = $("#workspace-status");
  if (element) element.textContent = message;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function publicIdFromNodeId(nodeId) {
  const node = graphNodeById(nodeId);
  return node ? publicIdFor(node) : null;
}

function resolveGraphNodeId(reference) {
  if (!reference || !state.graph) return null;
  if (graphNodeById(reference)) return reference;
  const node = (state.graph.nodes || []).find((item) => publicIdFor(item) === reference);
  return node?.node_id || null;
}

function serializeGraphPositions() {
  if (!state.graph || !state.graphPositions.size) return null;
  return {
    seeds: [...state.currentInspectIds],
    hops: state.currentInspectHops,
    nodes: Object.fromEntries(
      [...state.graphPositions.entries()].map(([nodeId, position]) => [
        nodeId,
        {
          x: Number(position.x.toFixed(2)),
          y: Number(position.y.toFixed(2)),
        },
      ]),
    ),
  };
}

function serializeWorkspaceState() {
  const inspectIds = uniqueSeedIds(state.currentInspectIds.length ? state.currentInspectIds : [state.currentInspectId || DEFAULT_WORKSPACE.inspectId]);
  return {
    version: 1,
    viewMode: state.viewMode,
    diagramView: normalizeDiagramView(state.diagramView),
    currentStep: state.currentStep,
    seedCategory: $("#seed-category")?.value || DEFAULT_WORKSPACE.seedCategory,
    inspectIds,
    inspectId: inspectIds[0] || DEFAULT_WORKSPACE.inspectId,
    inspectHops: state.currentInspectHops || DEFAULT_WORKSPACE.inspectHops,
    selectedPublicId: publicIdFromNodeId(state.selectedNodeId),
    selectedEdgeId: state.selectedEdgeId || null,
    search: {
      category: $("#search-category")?.value || DEFAULT_WORKSPACE.search.category,
      selectedPublicId: $("#search-query")?.value || DEFAULT_WORKSPACE.search.selectedPublicId,
      limit: clampNumber($("#search-limit")?.value, DEFAULT_WORKSPACE.search.limit, 1, 25),
    },
    answer: {
      template: $("#answer-template")?.value || DEFAULT_WORKSPACE.answer.template,
      primaryPublicId: $("#answer-query")?.value || DEFAULT_WORKSPACE.answer.primaryPublicId,
      secondaryPublicId: $("#answer-secondary")?.value || DEFAULT_WORKSPACE.answer.secondaryPublicId,
      limit: clampNumber($("#answer-limit")?.value, DEFAULT_WORKSPACE.answer.limit, 1, 15),
      hops: clampNumber($("#answer-hops")?.value, DEFAULT_WORKSPACE.answer.hops, 0, 3),
    },
    filters: {
      nodeTypes: [...state.graphFilters.nodeTypes],
      edgeTypes: [...state.graphFilters.edgeTypes],
    },
    transform: {
      x: Number(state.graphTransform.x.toFixed(2)),
      y: Number(state.graphTransform.y.toFixed(2)),
      scale: Number(state.graphTransform.scale.toFixed(3)),
    },
    mermaidTransform: {
      x: Number(state.mermaidTransform.x.toFixed(2)),
      y: Number(state.mermaidTransform.y.toFixed(2)),
      scale: Number(state.mermaidTransform.scale.toFixed(3)),
    },
    positions: serializeGraphPositions(),
    layout: persistDockLayout(),
  };
}

function readStoredWorkspaceState() {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function readUrlWorkspaceState() {
  const params = new URLSearchParams(window.location.search);
  const inspectIds = uniqueSeedIds((params.get("seeds") || params.get("seed") || "").split(","));
  if (!inspectIds.length) return null;
  return {
    inspectIds,
    inspectId: inspectIds[0],
    inspectHops: clampNumber(params.get("hops"), DEFAULT_WORKSPACE.inspectHops, 1, 3),
    selectedPublicId: params.get("selected") || null,
    viewMode: params.get("mode") || null,
    diagramView: normalizeDiagramView(params.get("diagram") || null),
    currentStep: params.get("step") || null,
  };
}

function mergedWorkspaceState() {
  const stored = readStoredWorkspaceState() || {};
  const shared = readUrlWorkspaceState() || {};
  const hasSharedContext = Boolean(shared.inspectId);
  return {
    ...DEFAULT_WORKSPACE,
    ...stored,
    ...shared,
    inspectIds: uniqueSeedIds(shared.inspectIds || stored.inspectIds || DEFAULT_WORKSPACE.inspectIds),
    search: {
      ...DEFAULT_WORKSPACE.search,
      ...(stored.search || {}),
    },
    answer: {
      ...DEFAULT_WORKSPACE.answer,
      ...(stored.answer || {}),
    },
    filters: hasSharedContext ? null : stored.filters || null,
    transform: hasSharedContext ? null : stored.transform || null,
    mermaidTransform: hasSharedContext ? null : stored.mermaidTransform || null,
    positions: hasSharedContext ? null : stored.positions || null,
    layout: hasSharedContext ? null : normalizeDockLayoutConfig(stored.layout || null),
    selectedEdgeId: hasSharedContext ? null : stored.selectedEdgeId || null,
    selectedPublicId: shared.selectedPublicId || stored.selectedPublicId || null,
    viewMode: shared.viewMode || stored.viewMode || DEFAULT_WORKSPACE.viewMode,
    diagramView: normalizeDiagramView(shared.diagramView || stored.diagramView || DEFAULT_WORKSPACE.diagramView),
    currentStep: shared.currentStep || stored.currentStep || DEFAULT_WORKSPACE.currentStep,
    source: hasSharedContext ? "shared" : (stored.inspectIds?.length || stored.inspectId) ? "stored" : "default",
  };
}

function syncWorkspaceUrl(snapshot) {
  const url = new URL(window.location.href);
  const inspectIds = uniqueSeedIds(snapshot.inspectIds || [snapshot.inspectId || DEFAULT_WORKSPACE.inspectId]);
  url.searchParams.delete("seed");
  url.searchParams.set("seeds", inspectIds.join(","));
  url.searchParams.set("hops", String(snapshot.inspectHops || DEFAULT_WORKSPACE.inspectHops));
  if (snapshot.selectedPublicId) url.searchParams.set("selected", snapshot.selectedPublicId);
  else url.searchParams.delete("selected");
  if (snapshot.viewMode && snapshot.viewMode !== DEFAULT_WORKSPACE.viewMode) url.searchParams.set("mode", snapshot.viewMode);
  else url.searchParams.delete("mode");
  if (snapshot.diagramView && snapshot.diagramView !== DEFAULT_WORKSPACE.diagramView) url.searchParams.set("diagram", snapshot.diagramView);
  else url.searchParams.delete("diagram");
  if (snapshot.currentStep && snapshot.currentStep !== DEFAULT_WORKSPACE.currentStep) url.searchParams.set("step", snapshot.currentStep);
  else url.searchParams.delete("step");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function persistWorkspaceState() {
  const snapshot = serializeWorkspaceState();
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
    setWorkspaceStatus("Workspace autosaved locally. Shareable URL follows the current graph view.");
  } catch (_error) {
    setWorkspaceStatus("Workspace could not be saved locally, but the current graph view still updates in the URL.");
  }
  syncWorkspaceUrl(snapshot);
}

function scheduleWorkspacePersist(delay = 140) {
  window.clearTimeout(state.persistTimer);
  state.persistTimer = window.setTimeout(() => persistWorkspaceState(), delay);
}

function hydrateControls(snapshot) {
  $("#search-limit").value = String(clampNumber(snapshot.search?.limit, DEFAULT_WORKSPACE.search.limit, 1, 25));
  $("#answer-template").value = snapshot.answer?.template || DEFAULT_WORKSPACE.answer.template;
  $("#answer-limit").value = String(clampNumber(snapshot.answer?.limit, DEFAULT_WORKSPACE.answer.limit, 1, 15));
  $("#answer-hops").value = String(clampNumber(snapshot.answer?.hops, DEFAULT_WORKSPACE.answer.hops, 0, 3));
  $("#inspect-hops").value = String(clampNumber(snapshot.inspectHops, DEFAULT_WORKSPACE.inspectHops, 1, 3));
  state.currentStep = GUIDED_STEPS[snapshot.currentStep] ? snapshot.currentStep : DEFAULT_WORKSPACE.currentStep;
  state.mermaidTransform = snapshot.mermaidTransform
    ? {
        x: Number(snapshot.mermaidTransform.x) || 0,
        y: Number(snapshot.mermaidTransform.y) || 0,
        scale: clampNumber(snapshot.mermaidTransform.scale, 1, 0.35, 3),
      }
    : { x: 0, y: 0, scale: 1 };
}

function restoredGraphPositions(snapshot, neighborhood) {
  const positions = snapshot?.positions;
  const positionSeeds = uniqueSeedIds(positions?.seeds || (positions?.seed ? [positions.seed] : []));
  const currentSeeds = uniqueSeedIds(state.currentInspectIds);
  if (
    !positions ||
    positionSeeds.join("|") !== currentSeeds.join("|") ||
    Number(positions.hops) !== Number(state.currentInspectHops)
  ) {
    return null;
  }
  const restored = new Map();
  for (const node of neighborhood.nodes || []) {
    const position = positions.nodes?.[node.node_id];
    if (!position) return null;
    restored.set(node.node_id, { x: Number(position.x), y: Number(position.y) });
  }
  return restored;
}

function groupBridgeNodes(limit = 6) {
  if (!state.graph?.nodes?.length) return [];
  return [...state.graph.nodes]
    .filter((node) => !isSeedNode(node.node_id))
    .filter((node) => (node.seed_match_count || 0) > 1)
    .sort((left, right) => {
      if ((right.seed_match_count || 0) !== (left.seed_match_count || 0)) {
        return (right.seed_match_count || 0) - (left.seed_match_count || 0);
      }
      if ((left.distance || 0) !== (right.distance || 0)) {
        return (left.distance || 0) - (right.distance || 0);
      }
      return publicIdFor(left).localeCompare(publicIdFor(right));
    })
    .slice(0, limit);
}

function graphMatchesActiveSeeds() {
  const graphSeeds = uniqueSeedIds(state.graph?.seed_public_ids || []);
  const activeSeeds = uniqueSeedIds(state.currentInspectIds);
  return graphSeeds.join("|") === activeSeeds.join("|");
}

function renderGroupOverview() {
  const seeds = uniqueSeedIds(state.currentInspectIds);
  const chips = $("#active-seed-chips");
  chips.innerHTML = seeds.length
    ? seeds
        .map(
          (seed) => `
            <span class="seed-pill">
              <span>${escapeHtml(seed)}</span>
              <button type="button" data-remove-seed="${escapeHtml(seed)}" aria-label="Remove ${escapeHtml(seed)}">×</button>
            </span>
          `,
        )
        .join("")
    : '<span class="chip">No active seeds</span>';

  const groupIsRendered = graphMatchesActiveSeeds();
  const bridges = groupIsRendered ? groupBridgeNodes() : [];
  const sharedCount = state.graph?.shared_nodes_count || 0;
  const bridgeSummary = bridges.length
    ? `Shared: ${bridges.slice(0, 3).map((node) => publicIdFor(node)).join(", ")}`
    : seeds.length > 1
      ? `${sharedCount} shared node${sharedCount === 1 ? "" : "s"} visible`
      : "Add another seed to compare overlap";
  const seedSummary = seeds.length ? `Group: ${seeds.join(" • ")}` : "No active seeds selected";
  $("#group-overview").innerHTML = `
    <span class="group-summary-pill"><strong>${escapeHtml(seeds.length === 1 ? "1 seed" : `${seeds.length} seeds`)}</strong></span>
    <span class="group-summary-pill">${escapeHtml(bridgeSummary)}</span>
    <span class="group-summary-pill">${escapeHtml(seedSummary)}</span>
  `;
  const summary = $("#step-summary");
  if (summary) {
    const meta = currentStepMeta();
    summary.textContent = `${meta.title}: ${meta.summary}`;
  }
}

function renderSelectionSpotlight() {
  const node = graphNodeById(state.selectedNodeId) || graphNodeById(state.graph?.seed);
  const context = currentContextForSelectedNode();
  const target = $("#selection-spotlight");
  if (!target) return;
  if (!node) {
    target.className = "selection-spotlight empty";
    target.innerHTML = "Load a graph neighborhood to see the current focus here.";
    return;
  }
  const payload = context?.node?.payload || node.payload || {};
  const publicId = publicIdFor(node);
  const activeSeeds = uniqueSeedIds(state.currentInspectIds);
  const nodeType = node.node_type || node.family || "node";
  const isSeed = activeSeeds.includes(publicId);
  const stats = [
    ["Type", nodeType],
    ["Active seeds", String(activeSeeds.length)],
    ["Distance", node.distance ?? 0],
    ["Shared by", node.seed_match_count || 1],
  ];
  const badges = [
    payload.grade_label || payload.grade_id,
    payload.topic_title || payload.topic_id,
    payload.dimension_group,
  ].filter(Boolean);
  target.className = "selection-spotlight";
  target.innerHTML = `
    <div class="selection-spotlight-copy">
      <div class="selection-spotlight-title">
        <div>
          <div class="stack-id">${escapeHtml(publicId)}</div>
          <h3>${escapeHtml(node.title || publicId)}</h3>
        </div>
        <span class="type-badge">${escapeHtml(nodeType)}</span>
      </div>
      <div class="detail-meta">${escapeHtml(context?.node?.description || node.description || "No description available.")}</div>
      <div class="chip-row">
        ${activeSeeds.map((seed) => `<span class="chip">${escapeHtml(`Seed: ${seed}`)}</span>`).join("")}
        ${badges.map((badge) => `<span class="chip">${escapeHtml(String(badge))}</span>`).join("")}
      </div>
    </div>
    <div class="selection-spotlight-stats">
      <div class="spotlight-stat-grid">
        ${stats
          .map(
            ([label, value]) => `
              <div class="spotlight-stat">
                <strong>${escapeHtml(String(value))}</strong>
                <div class="stack-meta">${escapeHtml(label)}</div>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="stack-meta">
        ${escapeHtml(
          activeSeeds.length > 1
            ? `${isSeed ? "This selected item is one of the active seeds." : "This selected item is not a seed; it is being viewed inside the active comparison group."} The current group includes ${activeSeeds.join(", ")}.`
            : "Use Add seed to compare this item with another standard or concept.",
        )}
      </div>
    </div>
  `;
}

function mergeNeighborhoods(neighborhoods, seedRecords) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  const seedNodeIds = [];
  const seedPublicIds = [];
  neighborhoods.forEach((neighborhood, index) => {
    const seedPublicId = seedRecords[index]?.publicId || seedRecords[index]?.identifier || neighborhood.seed;
    seedPublicIds.push(seedPublicId);
    seedNodeIds.push(neighborhood.seed);
    (neighborhood.nodes || []).forEach((node) => {
      const existing = nodeMap.get(node.node_id);
      const seedMatches = new Set(existing?.seed_matches || []);
      seedMatches.add(seedPublicId);
      const nextDistance = Math.min(existing?.distance ?? Number.POSITIVE_INFINITY, node.distance ?? Number.POSITIVE_INFINITY);
      const merged = {
        ...(existing || {}),
        ...node,
        distance: nextDistance,
        path_from_seed:
          !existing || (node.distance ?? Number.POSITIVE_INFINITY) < (existing.distance ?? Number.POSITIVE_INFINITY)
            ? node.path_from_seed
            : existing.path_from_seed,
        seed_matches: [...seedMatches].sort(),
      };
      merged.seed_match_count = merged.seed_matches.length;
      nodeMap.set(node.node_id, merged);
    });
    (neighborhood.edges || []).forEach((edge) => {
      if (!edgeMap.has(edge.edge_id)) edgeMap.set(edge.edge_id, edge);
    });
  });
  const nodes = [...nodeMap.values()].sort((left, right) => {
    if ((left.distance || 0) !== (right.distance || 0)) return (left.distance || 0) - (right.distance || 0);
    return left.node_id.localeCompare(right.node_id);
  });
  const sharedNodesCount = nodes.filter((node) => (node.seed_match_count || 0) > 1 && !seedNodeIds.includes(node.node_id)).length;
  return {
    seed: seedNodeIds[0],
    seed_node_ids: seedNodeIds,
    seed_public_ids: seedPublicIds,
    shared_nodes_count: sharedNodesCount,
    nodes,
    edges: [...edgeMap.values()],
  };
}

function setActiveSeeds(identifiers, { persist = true } = {}) {
  state.currentInspectIds = uniqueSeedIds(identifiers);
  if (!state.currentInspectIds.length) state.currentInspectIds = [...DEFAULT_WORKSPACE.inspectIds];
  state.currentInspectId = state.currentInspectIds[0];
  if ($("#seed-picker")) {
    $("#seed-picker").value = state.currentInspectIds[0];
  }
  renderGroupOverview();
  if (persist) scheduleWorkspacePersist();
}

function replaceActiveSeeds(identifier, { persist = true } = {}) {
  setActiveSeeds(identifier ? [identifier] : [], { persist });
}

function currentContextForSelectedNode() {
  const node = graphNodeById(state.selectedNodeId);
  if (!node) return null;
  return state.nodeContexts.get(publicIdFor(node)) || null;
}

function sourceBadges(payload = {}) {
  const badges = [];
  if (payload.source_file) badges.push(payload.source_file);
  if (Array.isArray(payload.source_pages)) {
    payload.source_pages.forEach((page) => badges.push(`p.${page}`));
  }
  if (payload.page !== undefined) badges.push(`p.${payload.page}`);
  return badges;
}

function topicPublicIdForNode(node) {
  if (!node) return null;
  if (node.node_type === "topic") return publicIdFor(node);
  return node.payload?.topic_id || null;
}

function topicContextForNode(node) {
  const topicPublicId = topicPublicIdForNode(node);
  return topicPublicId ? state.nodeContexts.get(topicPublicId) || null : null;
}

function topicChunkPayloadForNode(node) {
  const topicContext = topicContextForNode(node);
  return topicContext?.chunks?.find((chunk) => chunk.chunk_type === "topic")?.payload || topicContext?.chunks?.[0]?.payload || null;
}

function parseTopicConnectionText(text, selectedPublicId = null) {
  if (!text || String(text).trim().toUpperCase() === "N/A") return [];
  const parsed = String(text)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([^()]+?)(?:\s*\((.*)\))?$/);
      const code = (match?.[1] || item).trim();
      const performanceExpectations = (match?.[2] || "")
        .split(",")
        .map((value) => value.replace(/[()]/g, "").trim())
        .filter(Boolean);
      return {
        code,
        performanceExpectations,
        applies: !selectedPublicId || !performanceExpectations.length || performanceExpectations.includes(selectedPublicId),
      };
    })
    .filter((item) => item.applies);
  logDebug("connections", "parsed topic connection text", { selectedPublicId, raw: text, parsed });
  return parsed;
}

function commonCoreConnectionsForNode(node) {
  if (!node || !state.graph) return [];
  const topicPublicId = topicPublicIdForNode(node);
  const selectedIds = new Set([node.node_id]);
  const topicNodeId = topicPublicId ? resolveGraphNodeId(topicPublicId) : null;
  if (topicNodeId) selectedIds.add(topicNodeId);
  const connections = (state.graph.edges || [])
    .filter((edge) => edge.edge_type === "PE_CROSSWALKS_TO_STANDARD" || edge.edge_type === "TOPIC_CROSSWALKS_TO_STANDARD")
    .filter((edge) => selectedIds.has(edge.source_id) || selectedIds.has(edge.target_id))
    .map((edge) => {
      const targetId = selectedIds.has(edge.source_id) ? edge.target_id : edge.source_id;
      const target = graphNodeById(targetId) || { node_id: targetId, payload: {} };
      return {
        publicId: publicIdFor(target),
        title: target.title || target.payload?.title || publicIdFor(target),
        family: edge.payload?.family || target.payload?.family || "CCSS",
        text: edge.payload?.text || target.description || "",
        edgeType: edge.edge_type,
      };
    })
    .filter((item, index, items) => items.findIndex((other) => `${other.publicId}|${other.text}` === `${item.publicId}|${item.text}`) === index);
  logDebug("connections", "resolved common core links", {
    selected: publicIdFor(node),
    count: connections.length,
    ids: connections.map((item) => item.publicId),
  });
  return connections;
}

function rawSourceBlock(label, value) {
  if (!value) return "";
  return `
    <details class="raw-source">
      <summary>${escapeHtml(label)}</summary>
      <div class="code-block">${escapeHtml(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</div>
    </details>
  `;
}

function renderStackItem(item, options = {}) {
  const publicId = publicIdFor(item);
  const reasons = (item.reasons || []).slice(0, 3).join(", ");
  const path = item.path_from_seed?.join(" -> ");
  return `
    <article class="stack-item">
      <div class="stack-item-head">
        <div>
          <div class="stack-id">${escapeHtml(publicId)}</div>
          <div class="stack-title">${escapeHtml(item.title || publicId)}</div>
        </div>
        <span class="type-badge">${escapeHtml(item.node_type || item.family || "node")}</span>
      </div>
      <div class="stack-meta">${escapeHtml(item.description || "No description available.")}</div>
      ${item.score !== undefined ? `<div class="stack-meta">Score: ${item.score.toFixed(3)}</div>` : ""}
      ${reasons ? `<div class="stack-meta">Why it matched: ${escapeHtml(reasons)}</div>` : ""}
      ${path ? `<div class="stack-meta">Path: ${escapeHtml(path)}</div>` : ""}
      <div class="chip-row">
        ${sourceBadges(item.payload || {}).map((badge) => `<span class="chip">${escapeHtml(badge)}</span>`).join("")}
      </div>
      <div class="stack-actions">
        <button type="button" class="secondary small" data-inspect="${escapeHtml(publicId)}">Inspect</button>
        <button type="button" class="secondary small" data-add-seed="${escapeHtml(publicId)}">Add to group</button>
        ${options.showGraph ? `<button type="button" class="secondary small" data-graph-focus="${escapeHtml(item.node_id || publicId)}">Show in view</button>` : ""}
      </div>
    </article>
  `;
}

function loadHealth() {
  return api("/health").then((data) => {
    $("#stat-status").textContent = data.status;
    $("#stat-nodes").textContent = data.stats.nodes ?? data.stats.concepts ?? "0";
    $("#stat-edges").textContent = data.stats.edges ?? "0";
    $("#stat-chunks").textContent = data.stats.chunks ?? "0";
    logDebug("health", "loaded", data);
  });
}

async function loadCatalog() {
  const data = await api("/catalog/nodes");
  state.catalogItems = (data.items || []).map((item) => ({
    ...item,
    public_id: item.public_id || item.node_id,
  }));
  state.catalogByPublicId = new Map(state.catalogItems.map((item) => [item.public_id, item]));
  logDebug("catalog", "loaded", {
    count: state.catalogItems.length,
    sample: state.catalogItems.slice(0, 5).map((item) => item.public_id),
  });
}

function applyCatalogSelections(snapshot) {
  const seedCategory = snapshot.seedCategory || DEFAULT_WORKSPACE.seedCategory;
  replaceCategoryOptions($("#seed-category"), seedCategory);
  replaceCategoryOptions($("#search-category"), snapshot.search?.category || DEFAULT_WORKSPACE.search.category);

  replaceSelectOptions($("#seed-picker"), filteredCatalogItems(seedCategory), {
    selectedValue: state.currentInspectIds[0] || DEFAULT_WORKSPACE.inspectId,
  });
  replaceSelectOptions($("#search-query"), filteredCatalogItems($("#search-category").value), {
    selectedValue: snapshot.search?.selectedPublicId || DEFAULT_WORKSPACE.search.selectedPublicId,
  });
  replaceSelectOptions($("#answer-query"), state.catalogItems, {
    selectedValue: snapshot.answer?.primaryPublicId || DEFAULT_WORKSPACE.answer.primaryPublicId,
  });
  replaceSelectOptions($("#answer-secondary"), state.catalogItems, {
    includeBlank: true,
    blankLabel: "Optional second item",
    selectedValue: snapshot.answer?.secondaryPublicId || DEFAULT_WORKSPACE.answer.secondaryPublicId,
  });
}

function syncAnswerTemplateUi() {
  const template = ANSWER_TEMPLATES[$("#answer-template").value] || ANSWER_TEMPLATES["what-is"];
  $("#answer-secondary").disabled = !template.needsSecondary;
}

function renderNodeSummary(node, context) {
  if (!node) {
    return '<div class="detail-card empty">Nothing selected yet.</div>';
  }
  const payload = node.payload || {};
  const hierarchy = [
    ["Grade band", payload.grade_label || payload.grade_id],
    ["Topic", payload.topic_title || payload.topic_id],
    ["Standard", payload.public_id],
  ].filter(([, value]) => value);
  const fields = [
    ["Type", node.node_type || node.family],
    ["Dimension group", payload.dimension_group],
    ["Core idea", payload.core_idea],
    ["Distance from seed", node.distance],
    ["Connected seeds", node.seed_match_count ? node.seed_matches.join(", ") : null],
    ["Path", Array.isArray(node.path_from_seed) ? node.path_from_seed.join(" -> ") : null],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  const contextLabel = context ? "Source-backed context is loaded for this selection." : "This summary is coming from the current graph view.";
  return `
    <div class="detail-card">
      <div class="detail-title">
        <div>
          <div class="stack-id">${escapeHtml(publicIdFor(node))}</div>
          <h3>${escapeHtml(node.title || publicIdFor(node))}</h3>
        </div>
        <span class="type-badge">${escapeHtml(node.node_type || node.family || "node")}</span>
      </div>
      <div class="detail-meta">${escapeHtml(node.description || "No description available.")}</div>
      <div class="detail-meta">${escapeHtml(contextLabel)}</div>
      <div class="hierarchy-list">
        ${hierarchy
          .map(
            ([label, value]) => `
              <div class="hierarchy-row">
                <span class="hierarchy-key">${escapeHtml(label)}</span>
                <span>${escapeHtml(String(value))}</span>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="detail-grid">
        ${fields
          .map(
            ([label, value]) => `
              <div class="detail-block">
                <strong>${escapeHtml(label)}</strong>
                <div>${escapeHtml(String(value))}</div>
              </div>
            `,
          )
          .join("")}
      </div>
      ${state.viewMode === "evidence" ? rawSourceBlock("Raw node payload", payload) : ""}
    </div>
  `;
}

function edgeDescriptor(edge, selectedNodeId) {
  const meta = EDGE_META[edge.edge_type] || {
    label: humanizeEdgeType(edge.edge_type),
    category: "Other connections",
    explanation: "This relationship is part of the graph but does not have a custom description yet.",
  };
  const selectedIsSource = edge.source_id === selectedNodeId;
  const neighbor = graphNodeById(selectedIsSource ? edge.target_id : edge.source_id);
  let category = meta.category;
  if (edge.edge_type === "PE_ALIGNS_TO_DIMENSION") {
    const family = neighbor?.family;
    if (family === "SEP") category = "Practices";
    else if (family === "CCC") category = "Crosscutting concepts";
    else if (family === "DCI") category = "Core ideas";
    else category = "Dimension links";
  }
  return {
    edge,
    neighbor,
    label: meta.label,
    category,
    explanation: meta.explanation,
  };
}

function groupedConnections(nodeId) {
  if (!state.graph) return [];
  const groups = new Map();
  for (const edge of state.graph.edges || []) {
    if (edge.source_id !== nodeId && edge.target_id !== nodeId) continue;
    const descriptor = edgeDescriptor(edge, nodeId);
    if (!groups.has(descriptor.category)) groups.set(descriptor.category, []);
    groups.get(descriptor.category).push(descriptor);
  }
  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([category, items]) => ({ category, items }));
}

function renderConnectionGroups() {
  const groups = groupedConnections(state.selectedNodeId);
  $("#connection-groups").innerHTML = groups.length
    ? groups
        .map(
          (group) => `
            <article class="stack-item">
              <div class="connection-group-title">
                <strong>${escapeHtml(group.category)}</strong>
                <span class="stack-meta">${group.items.length} link${group.items.length === 1 ? "" : "s"}</span>
              </div>
              <div class="connection-list">
                ${group.items
                  .map((item) => {
                    const neighbor = item.neighbor;
                    const publicId = neighbor ? publicIdFor(neighbor) : item.edge.target_id;
                    const summary = `${publicIdFor(graphNodeById(state.selectedNodeId) || { node_id: state.selectedNodeId })} ${item.label} ${publicId}`;
                    return `
                      <div class="mini-card">
                        <strong>${escapeHtml(summary)}</strong>
                        <div class="stack-meta">${escapeHtml(item.explanation)}</div>
                        <div class="chip-row">
                          ${sourceBadges(item.edge.payload || {}).map((badge) => `<span class="chip">${escapeHtml(badge)}</span>`).join("")}
                        </div>
                        <div class="stack-actions">
                          <button type="button" class="secondary small" data-edge-select="${escapeHtml(item.edge.edge_id)}">Explain</button>
                          ${neighbor ? `<button type="button" class="secondary small" data-inspect="${escapeHtml(publicId)}">Inspect ${escapeHtml(publicId)}</button>` : ""}
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </article>
          `,
        )
        .join("")
    : '<div class="stack-item empty">No direct connections available for this node in the current graph view.</div>';
}

function renderConnectionBoxes() {
  const target = $("#connection-boxes");
  const node = graphNodeById(state.selectedNodeId);
  if (!target || !node) {
    if (target) target.innerHTML = '<div class="stack-item empty">No NGSS connection-box data is visible for this selection yet.</div>';
    return;
  }
  const topicPayload = topicChunkPayloadForNode(node);
  const selectedPublicId = node.node_type === "performance_expectation" ? publicIdFor(node) : null;
  const sameGrade = parseTopicConnectionText(topicPayload?.connections_to_other_dcis, selectedPublicId);
  const acrossGrades = parseTopicConnectionText(topicPayload?.articulation_of_dcis_across_grade_levels, selectedPublicId);
  const commonCore = commonCoreConnectionsForNode(node);
  logDebug("connections", "rendering boxes", {
    selected: publicIdFor(node),
    topicPublicId: topicPublicIdForNode(node),
    sameGradeCount: sameGrade.length,
    acrossGradesCount: acrossGrades.length,
    commonCoreCount: commonCore.length,
  });
  const boxes = [
    {
      title: "Connections to other DCIs in this grade level",
      subtitle: "Related disciplinary core ideas at the same grade band",
      empty: "No same-grade DCI connections are listed for this selection in the source data.",
      items: sameGrade.map((item) => ({
        title: item.code,
        meta: item.performanceExpectations.length ? `Connected PE(s): ${item.performanceExpectations.join(", ")}` : "Topic-level connection",
        details: item.performanceExpectations.length ? [["Performance expectations", item.performanceExpectations.join(", ")]] : [],
      })),
    },
    {
      title: "Articulation of DCIs across grade levels",
      subtitle: "Prior foundations and later extensions across grade bands",
      empty: "No cross-grade articulation entries are listed for this selection in the source data.",
      items: acrossGrades.map((item) => ({
        title: item.code,
        meta: item.performanceExpectations.length ? `Mapped PE(s): ${item.performanceExpectations.join(", ")}` : "Topic-level articulation",
        details: item.performanceExpectations.length ? [["Performance expectations", item.performanceExpectations.join(", ")]] : [],
      })),
    },
    {
      title: "Connections to the Common Core State Standards",
      subtitle: "ELA and Math links aligned to this neighborhood. Italicized PE names in the print standards indicate a connectable, not prerequisite, Common Core relationship; that formatting is not exposed separately in the source JSON.",
      empty: "No Common Core crosswalks are visible for this selection in the current graph neighborhood.",
      items: commonCore.map((item) => ({
        title: `${item.publicId} · ${item.family}`,
        meta: item.text || item.title,
        details: [
          ["Standard", item.publicId],
          ["Family", item.family],
          ["Connection", item.edgeType === "TOPIC_CROSSWALKS_TO_STANDARD" ? "Topic-level crosswalk" : "Performance expectation crosswalk"],
        ],
      })),
    },
  ];
  target.innerHTML = boxes
    .map(
      (box) => `
        <article class="connection-box">
          <div class="connection-box-header">
            <div>
              <strong>${escapeHtml(box.title)}</strong>
              <p>${escapeHtml(box.subtitle)}</p>
            </div>
            <span class="type-badge">${box.items.length}</span>
          </div>
          ${
            box.items.length
              ? `
                <div class="connection-box-list">
                  ${box.items
                    .map(
                      (item) => `
                        <article class="connection-entry">
                          <div class="connection-entry-head">
                            <strong>${escapeHtml(item.title)}</strong>
                          </div>
                          <div class="connection-entry-meta">${escapeHtml(item.meta)}</div>
                          ${
                            item.details.length
                              ? `
                                <div class="hierarchy-list">
                                  ${item.details
                                    .map(
                                      ([label, value]) => `
                                        <div class="hierarchy-row">
                                          <span class="hierarchy-key">${escapeHtml(label)}</span>
                                          <span>${escapeHtml(String(value))}</span>
                                        </div>
                                      `,
                                    )
                                    .join("")}
                                </div>
                              `
                              : ""
                          }
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `<div class="stack-meta">${escapeHtml(box.empty)}</div>`
          }
        </article>
      `,
    )
    .join("");
}

function renderPathSummaries() {
  const node = graphNodeById(state.selectedNodeId);
  if (!node) {
    $("#path-summaries").innerHTML = '<div class="stack-item empty">No path summaries yet.</div>';
    return;
  }
  const paths = [];
  if (Array.isArray(node.path_from_seed) && node.path_from_seed.length > 1) {
    paths.push({
      title: "Path from current seed",
      text: node.path_from_seed.map((item) => publicIdFor(graphNodeById(item) || { node_id: item })).join(" -> "),
    });
  }
  groupedConnections(node.node_id)
    .slice(0, 4)
    .forEach((group) => {
      group.items.slice(0, 1).forEach((item) => {
        paths.push({
          title: group.category,
          text: `${publicIdFor(node)} -> ${item.label} -> ${publicIdFor(item.neighbor || { node_id: item.edge.target_id })}`,
        });
      });
    });

  $("#path-summaries").innerHTML = paths.length
    ? paths
        .map(
          (path) => `
            <article class="stack-item">
              <div class="stack-title">${escapeHtml(path.title)}</div>
              <div class="stack-meta">${escapeHtml(path.text)}</div>
            </article>
          `,
        )
        .join("")
    : '<div class="stack-item empty">No paths available yet.</div>';
}

function renderProgressionTimeline() {
  const node = graphNodeById(state.selectedNodeId);
  if (!node) {
    $("#progression-timeline").innerHTML = '<div class="stack-item empty">No progression timeline loaded.</div>';
    return;
  }
  const progressions = (state.graph?.edges || [])
    .filter((edge) => edge.source_id === node.node_id && edge.edge_type === "DIMENSION_HAS_PROGRESSION")
    .map((edge) => ({
      edge,
      progression: graphNodeById(edge.target_id),
      band: edge.payload?.band || graphNodeById(edge.target_id)?.payload?.band || "unknown",
    }))
    .filter((item) => item.progression)
    .sort((left, right) => BAND_ORDER.indexOf(left.band) - BAND_ORDER.indexOf(right.band));

  $("#progression-timeline").innerHTML = progressions.length
    ? progressions
        .map(
          ({ progression, band }) => `
            <article class="timeline-item">
              <div class="timeline-band">${escapeHtml(band)}</div>
              <div class="timeline-code">${escapeHtml(progression.payload?.public_id || progression.title)}</div>
              <div>${escapeHtml(progression.description || "No progression text available.")}</div>
            </article>
          `,
        )
        .join("")
    : '<div class="stack-item empty">No progression statements are visible for this node in the current graph neighborhood.</div>';
}

function renderEvidenceCards() {
  const node = graphNodeById(state.selectedNodeId);
  const context = currentContextForSelectedNode();
  if (!node) {
    $("#evidence-cards").innerHTML = '<div class="stack-item empty">No evidence loaded yet.</div>';
    return;
  }
  const cards = [];
  const payload = context?.node?.payload || node.payload || {};
  if (node.node_type === "performance_expectation") {
    cards.push({ title: "Performance expectation", text: context?.node?.description || node.description });
    if (payload.clarification_statement) cards.push({ title: "Clarification statement", text: payload.clarification_statement });
    if (payload.assessment_boundary) cards.push({ title: "Assessment boundary", text: payload.assessment_boundary });
    if (Array.isArray(payload.evidence_statements) && payload.evidence_statements.length) {
      cards.push({ title: "Evidence statements", text: payload.evidence_statements.join("\n") });
    }
  }
  (context?.chunks || []).forEach((chunk) => {
    cards.push({
      title: `${chunk.chunk_type} chunk`,
      text: state.viewMode === "explorer" ? chunk.text.split("\n").slice(0, 5).join("\n") : chunk.text,
      raw: chunk,
    });
  });
  $("#evidence-cards").innerHTML = cards.length
    ? cards
        .map(
          (card) => `
            <article class="stack-item">
              <div class="stack-title">${escapeHtml(card.title)}</div>
              <div class="stack-meta">${escapeHtml(card.text || "No supporting text available.")}</div>
              ${card.raw && state.viewMode === "evidence" ? rawSourceBlock("Raw chunk payload", card.raw.payload) : ""}
            </article>
          `,
        )
        .join("")
    : '<div class="stack-item empty">No evidence cards are available yet for this selection.</div>';
}

function renderSourcePanel() {
  const node = graphNodeById(state.selectedNodeId);
  const context = currentContextForSelectedNode();
  const topicPayload = topicChunkPayloadForNode(node);
  const edge = graphEdgeById(state.selectedEdgeId);
  const cards = [];
  if (node) {
    cards.push({
      title: "Selected node source",
      payload: context?.node?.payload || node.payload || {},
      text: context?.node?.description || node.description || "No source description available.",
    });
  }
  if (edge) {
    const source = graphNodeById(edge.source_id) || { node_id: edge.source_id };
    const target = graphNodeById(edge.target_id) || { node_id: edge.target_id };
    const descriptor = edgeDescriptor(edge, state.selectedNodeId || edge.source_id);
    cards.push({
      title: "Selected edge provenance",
      payload: edge.payload || {},
      text: `${publicIdFor(source)} ${descriptor.label} ${publicIdFor(target)}`,
    });
  }
  if (topicPayload && (topicPayload.connections_to_other_dcis || topicPayload.articulation_of_dcis_across_grade_levels)) {
    cards.push({
      title: "Topic connection-box source",
      payload: topicPayload,
      text: "This topic-level source chunk contains the in-grade and cross-grade DCI connection text used to build the NGSS connection boxes.",
    });
  }
  (context?.chunks || []).forEach((chunk) => {
    cards.push({
      title: `Supporting ${humanizeEdgeType(chunk.chunk_type).replace(/^./, (letter) => letter.toUpperCase())} chunk`,
      payload: chunk.payload || {},
      text: state.viewMode === "explorer" ? chunk.text.split("\n")[0] : chunk.text,
      rawText: chunk.text,
    });
  });
  logDebug("sources", "rendering panel", {
    selected: node ? publicIdFor(node) : null,
    selectedEdge: edge?.edge_id || null,
    cards: cards.map((card) => card.title),
  });
  $("#source-panel").innerHTML = cards.length
    ? cards
        .map(
          (card) => `
            <article class="source-card">
              <div class="stack-title">${escapeHtml(card.title)}</div>
              <div class="stack-meta">${escapeHtml(card.text)}</div>
              <div class="chip-row">
                ${sourceBadges(card.payload).map((badge) => `<span class="chip">${escapeHtml(badge)}</span>`).join("")}
              </div>
              <div class="source-grid">
                ${Object.entries(card.payload || {})
                  .filter(([key, value]) => value !== null && value !== undefined && value !== "" && !Array.isArray(value) && typeof value !== "object")
                  .slice(0, 6)
                  .map(
                    ([key, value]) => `
                      <div class="mini-card">
                        <strong>${escapeHtml(key)}</strong>
                        <div>${escapeHtml(String(value))}</div>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
              ${state.viewMode === "evidence" ? rawSourceBlock("Raw source payload", card.payload) : ""}
              ${state.viewMode === "evidence" && card.rawText ? rawSourceBlock("Raw supporting text", card.rawText) : ""}
            </article>
          `,
        )
        .join("")
    : '<div class="stack-item empty">No source metadata is available for this selection yet.</div>';
}

function renderEdgeDetail() {
  const edge = graphEdgeById(state.selectedEdgeId);
  if (!edge) {
    $("#edge-detail").innerHTML = '<div class="detail-card empty">Click an edge in the graph or an “Explain” button to inspect a connection.</div>';
    return;
  }
  const source = graphNodeById(edge.source_id) || { node_id: edge.source_id };
  const target = graphNodeById(edge.target_id) || { node_id: edge.target_id };
  const descriptor = edgeDescriptor(edge, state.selectedNodeId);
  $("#edge-detail").innerHTML = `
    <div class="detail-card">
      <div class="detail-title">
        <div>
          <div class="stack-id">${escapeHtml(descriptor.category)}</div>
          <h3>${escapeHtml(descriptor.label)}</h3>
        </div>
        <span class="type-badge">${escapeHtml(edge.edge_type)}</span>
      </div>
      <div class="detail-meta">${escapeHtml(descriptor.explanation)}</div>
      <div class="detail-meta">${escapeHtml(`${publicIdFor(source)} ${descriptor.label} ${publicIdFor(target)}`)}</div>
      <div class="detail-grid">
        <div class="detail-block">
          <strong>Source node</strong>
          <div>${escapeHtml(publicIdFor(source))}</div>
        </div>
        <div class="detail-block">
          <strong>Target node</strong>
          <div>${escapeHtml(publicIdFor(target))}</div>
        </div>
        <div class="detail-block">
          <strong>Connection meaning</strong>
          <div>${escapeHtml(descriptor.category)}</div>
        </div>
      </div>
      <div class="chip-row">
        ${sourceBadges(edge.payload || {}).map((badge) => `<span class="chip">${escapeHtml(badge)}</span>`).join("")}
      </div>
      ${state.viewMode === "evidence" ? rawSourceBlock("Raw edge payload", edge.payload) : ""}
    </div>
  `;
}

function renderInspector() {
  renderGroupOverview();
  renderSelectionSpotlight();
  const node = graphNodeById(state.selectedNodeId);
  const context = currentContextForSelectedNode();
  $("#node-details").innerHTML = renderNodeSummary(node, context);
  renderConnectionBoxes();
  renderConnectionGroups();
  renderPathSummaries();
  renderProgressionTimeline();
  renderEvidenceCards();
  renderSourcePanel();
  renderEdgeDetail();
  renderVisualizationStage();
}

function mermaidAvailable() {
  return Boolean(window.mermaid?.render);
}

async function handleMermaidNodeClick(token) {
  const target = state.mermaidNodeLookup.get(token);
  if (!target) return;
  const nodeId = resolveGraphNodeId(target) || target;
  setTabState("inspector", "overview");
  setCurrentStep("understand", { scroll: true });
  if (graphNodeById(nodeId)) {
    await selectNode(nodeId, true);
    return;
  }
  await inspectIdentifier(target, Number($("#inspect-hops").value));
}

function ensureMermaid() {
  if (!mermaidAvailable()) return false;
  if (state.mermaidInitialized) return true;
  window.mermaidNodeClick = (token) => {
    handleMermaidNodeClick(token).catch((error) => showToast(error.message, true));
  };
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: "cardinal" },
    themeVariables: {
      primaryColor: "#ffffff",
      primaryTextColor: "#1c1c1e",
      primaryBorderColor: "#c7cad5",
      lineColor: "#555a6a",
      secondaryColor: "#ffe6cd",
      tertiaryColor: "#c3faf5",
      clusterBkg: "#fff7ec",
      clusterBorder: "#e0e2e8",
      fontFamily: '"Roobert PRO Medium", "Avenir Next", "Segoe UI", sans-serif',
    },
  });
  state.mermaidInitialized = true;
  return true;
}

function mermaidText(value, max = 72) {
  const text = String(value || "")
    .replace(/["`{}\[\]|]/g, "")
    .replaceAll("<", "")
    .replaceAll(">", "")
    .replaceAll("\n", " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Untitled";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function mermaidToken(prefix, index) {
  return `${prefix}${index}`;
}

function mermaidInteractionRow(lines, token, target, tooltip) {
  if (!target) return;
  state.mermaidNodeLookup.set(token, target);
  lines.push(`  click ${token} mermaidNodeClick "${mermaidText(tooltip || "Inspect", 64)}"`);
}

function edgeLabelFor(edgeType) {
  return mermaidText(EDGE_META[edgeType]?.label || humanizeEdgeType(edgeType), 24);
}

function mermaidClassFor(node) {
  const type = typeClassFor(node);
  if (type === "pe") return "pe";
  if (type === "topic") return "topic";
  if (type === "concept") return "concept";
  return "other";
}

function mermaidNodeRows(node, tokenMap, lines) {
  const token = tokenMap.get(node.node_id);
  const title = node.title && node.title !== publicIdFor(node) ? `<br/>${mermaidText(node.title, 42)}` : "";
  const label = `${mermaidText(publicIdFor(node), 24)}${title}`;
  lines.push(`  ${token}["${label}"]:::${mermaidClassFor(node)}`);
  mermaidInteractionRow(lines, token, publicIdFor(node), `Inspect ${publicIdFor(node)}`);
}

function mermaidClassRows(lines) {
  lines.push("  classDef pe fill:#c3faf5,stroke:#187574,color:#1c1c1e,stroke-width:1.5px;");
  lines.push("  classDef topic fill:#ffe6cd,stroke:#c97d35,color:#1c1c1e,stroke-width:1.5px;");
  lines.push("  classDef concept fill:#ffd8f4,stroke:#7b4874,color:#1c1c1e,stroke-width:1.5px;");
  lines.push("  classDef other fill:#ffc6c6,stroke:#8b4f4f,color:#1c1c1e,stroke-width:1.5px;");
  lines.push("  classDef source fill:#fff4bd,stroke:#746019,color:#1c1c1e,stroke-width:1.5px;");
  lines.push("  classDef chunk fill:#f3f6ff,stroke:#5b76fe,color:#1c1c1e,stroke-width:1.5px;");
  lines.push("  classDef selected fill:#1c1c1e,stroke:#1c1c1e,color:#ffffff,stroke-width:2px;");
}

function prioritizedVisibleGraph(limitNodes = 24, limitEdges = 36) {
  const { nodes, edges } = filteredGraph();
  const selectedNodeId = state.selectedNodeId;
  const prioritized = [...nodes].sort((left, right) => {
    const leftScore =
      (left.node_id === selectedNodeId ? 1000 : 0) +
      (isSeedNode(left.node_id) ? 800 : 0) +
      ((left.seed_match_count || 0) * 50) -
      ((left.distance || 0) * 10);
    const rightScore =
      (right.node_id === selectedNodeId ? 1000 : 0) +
      (isSeedNode(right.node_id) ? 800 : 0) +
      ((right.seed_match_count || 0) * 50) -
      ((right.distance || 0) * 10);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return publicIdFor(left).localeCompare(publicIdFor(right));
  });
  const selectedNodes = prioritized.slice(0, limitNodes);
  const selectedIds = new Set(selectedNodes.map((node) => node.node_id));
  return {
    nodes: selectedNodes,
    edges: edges.filter((edge) => selectedIds.has(edge.source_id) && selectedIds.has(edge.target_id)).slice(0, limitEdges),
  };
}

function buildOverviewDiagram() {
  const graphSlice = prioritizedVisibleGraph();
  if (!graphSlice.nodes.length) return null;
  const seeds = graphSlice.nodes.filter((node) => isSeedNode(node.node_id));
  const nearby = graphSlice.nodes.filter((node) => !isSeedNode(node.node_id)).slice(0, 14);
  const renderedNodes = [...seeds, ...nearby];
  const tokenMap = new Map(renderedNodes.map((node, index) => [node.node_id, mermaidToken("n", index)]));
  const lines = ["flowchart LR"];
  mermaidClassRows(lines);
  lines.push('  subgraph seed_cluster["Active seeds"]');
  seeds.forEach((node) => mermaidNodeRows(node, tokenMap, lines));
  lines.push("  end");
  lines.push('  subgraph nearby_cluster["Shared neighborhood"]');
  nearby.forEach((node) => mermaidNodeRows(node, tokenMap, lines));
  lines.push("  end");
  graphSlice.edges.forEach((edge) => {
    if (!tokenMap.has(edge.source_id) || !tokenMap.has(edge.target_id)) return;
    const label = edgeLabelFor(edge.edge_type);
    lines.push(`  ${tokenMap.get(edge.source_id)} ==>|${label}| ${tokenMap.get(edge.target_id)}`);
  });
  const selected = graphNodeById(state.selectedNodeId);
  if (selected && tokenMap.has(selected.node_id)) lines.push(`  class ${tokenMap.get(selected.node_id)} selected;`);
  return {
    summary: `${seeds.length || 1} seed${seeds.length === 1 ? "" : "s"} with ${nearby.length} nearby nodes in the main Mermaid overview.`,
    definition: lines.join("\n"),
  };
}

function buildRelationshipDiagram() {
  const selected = graphNodeById(state.selectedNodeId) || graphNodeById(state.graph?.seed);
  if (!selected) return null;
  const groups = groupedConnections(selected.node_id).slice(0, 4);
  const related = uniqueSeedIds(groups.flatMap((group) => group.items.slice(0, 3).map((item) => item.neighbor?.node_id)).filter(Boolean));
  const nodeIds = uniqueSeedIds([selected.node_id, ...related]);
  const nodes = nodeIds.map((nodeId) => graphNodeById(nodeId)).filter(Boolean);
  const tokenMap = new Map(nodes.map((node, index) => [node.node_id, mermaidToken("r", index)]));
  const lines = ["flowchart LR"];
  mermaidClassRows(lines);
  nodes.forEach((node) => mermaidNodeRows(node, tokenMap, lines));
  groups.forEach((group, index) => {
    lines.push(`  subgraph rel_${index}["${mermaidText(group.category, 28)}"]`);
    group.items.slice(0, 3).forEach((item) => {
      if (!item.neighbor || !tokenMap.has(item.neighbor.node_id)) return;
      lines.push(`    ${tokenMap.get(selected.node_id)} -->|${mermaidText(item.label, 22)}| ${tokenMap.get(item.neighbor.node_id)}`);
    });
    lines.push("  end");
  });
  if (tokenMap.has(selected.node_id)) lines.push(`  class ${tokenMap.get(selected.node_id)} selected;`);
  return {
    summary: `${publicIdFor(selected)} grouped into ${groups.length} relationship lane${groups.length === 1 ? "" : "s"}.`,
    definition: lines.join("\n"),
  };
}

function buildPathDiagram() {
  const selected = graphNodeById(state.selectedNodeId) || graphNodeById(state.graph?.seed);
  if (!selected) return null;
  const path = Array.isArray(selected.path_from_seed) && selected.path_from_seed.length ? selected.path_from_seed : [selected.node_id];
  const connectors = groupedConnections(selected.node_id).flatMap((group) => group.items).slice(0, 3);
  const nodeIds = uniqueSeedIds([...path, ...connectors.map((item) => item.neighbor?.node_id).filter(Boolean)]);
  const nodes = nodeIds.map((nodeId) => graphNodeById(nodeId)).filter(Boolean);
  const tokenMap = new Map(nodes.map((node, index) => [node.node_id, mermaidToken("p", index)]));
  const lines = ["flowchart LR"];
  mermaidClassRows(lines);
  nodes.forEach((node) => mermaidNodeRows(node, tokenMap, lines));
  lines.push('  subgraph path_lane["Seed path"]');
  for (let index = 0; index < path.length - 1; index += 1) {
    const source = path[index];
    const target = path[index + 1];
    if (!tokenMap.has(source) || !tokenMap.has(target)) continue;
    lines.push(`    ${tokenMap.get(source)} -->|step ${index + 1}| ${tokenMap.get(target)}`);
  }
  lines.push("  end");
  connectors.forEach((item, index) => {
    if (!item.neighbor || !tokenMap.has(item.neighbor.node_id)) return;
    lines.push(`  ${tokenMap.get(selected.node_id)} -->|branch ${index + 1}: ${mermaidText(item.label, 18)}| ${tokenMap.get(item.neighbor.node_id)}`);
  });
  if (tokenMap.has(selected.node_id)) lines.push(`  class ${tokenMap.get(selected.node_id)} selected;`);
  return {
    summary: `Path flow for ${publicIdFor(selected)} across ${Math.max(path.length - 1, 0)} seed steps and ${connectors.length} branching links.`,
    definition: lines.join("\n"),
  };
}

function buildSourceDiagram() {
  const node = graphNodeById(state.selectedNodeId);
  if (!node) return null;
  const context = currentContextForSelectedNode();
  const payload = context?.node?.payload || node.payload || {};
  const lines = ["flowchart TD"];
  mermaidClassRows(lines);
  const rootDetail = mermaidText(node.title || node.description || "Selected node", 52);
  lines.push(`  root["${mermaidText(publicIdFor(node), 24)}<br/>${rootDetail}"]:::selected`);
  mermaidInteractionRow(lines, "root", publicIdFor(node), `Inspect ${publicIdFor(node)}`);
  if (payload.source_file) {
    lines.push('  subgraph source_lane["Source record"]');
    lines.push(`    file["${mermaidText(payload.source_file, 36)}"]:::source`);
    lines.push("  end");
    lines.push("  root -->|raw source file| file");
  }
  const pages = Array.isArray(payload.source_pages) ? payload.source_pages.slice(0, 4) : payload.page !== undefined ? [payload.page] : [];
  pages.forEach((page, index) => {
    lines.push(`  page${index}["Page ${mermaidText(page, 10)}"]:::source`);
    lines.push(`  ${payload.source_file ? "file" : "root"} -->|document page| page${index}`);
  });
  const evidenceStatements = Array.isArray(payload.evidence_statements) ? payload.evidence_statements.slice(0, 3) : [];
  evidenceStatements.forEach((statement, index) => {
    lines.push(`  evidence${index}["Evidence ${index + 1}<br/>${mermaidText(statement, 46)}"]:::other`);
    lines.push(`  root -->|evidence statement| evidence${index}`);
  });
  if (payload.clarification_statement) {
    lines.push(`  clarification["Clarification<br/>${mermaidText(payload.clarification_statement, 46)}"]:::topic`);
    lines.push("  root -->|clarification text| clarification");
  }
  if (payload.assessment_boundary) {
    lines.push(`  boundary["Boundary<br/>${mermaidText(payload.assessment_boundary, 46)}"]:::concept`);
    lines.push("  root -->|assessment boundary| boundary");
  }
  (context?.chunks || []).slice(0, 4).forEach((chunk, index) => {
    lines.push(
      `  chunk${index}["${mermaidText(humanizeEdgeType(chunk.chunk_type), 18)} chunk<br/>${mermaidText(chunk.text, 40)}"]:::chunk`,
    );
    lines.push(`  root -->|retrieved chunk ${index + 1}| chunk${index}`);
  });
  return {
    summary: `Provenance trace for ${publicIdFor(node)} across source file, pages, evidence, and retrieved chunks.`,
    definition: lines.join("\n"),
  };
}

function syncDiagramUi() {
  const diagramView = DIAGRAM_VIEWS[state.diagramView] ? state.diagramView : DEFAULT_WORKSPACE.diagramView;
  const graphViewport = $("#graph-viewport");
  const mermaidStage = $("#mermaid-stage");
  const diagramSummary = $("#diagram-summary");
  document.querySelectorAll("[data-diagram-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.diagramView === diagramView);
  });
  const showingGraph = diagramView === "graph";
  graphViewport.hidden = !showingGraph;
  mermaidStage.hidden = showingGraph;
  if (diagramSummary) diagramSummary.textContent = (DIAGRAM_VIEWS[diagramView] || DIAGRAM_VIEWS.graph).summary;
}

function applyMermaidTransform() {
  const svg = $("#mermaid-diagram svg");
  if (!svg) return;
  svg.style.transform = `translate(${state.mermaidTransform.x}px, ${state.mermaidTransform.y}px) scale(${state.mermaidTransform.scale})`;
}

function resetMermaidTransform({ persist = true } = {}) {
  state.mermaidTransform = { x: 0, y: 0, scale: 1 };
  applyMermaidTransform();
  if (persist) scheduleWorkspacePersist();
}

async function renderMermaidDiagram() {
  const container = $("#mermaid-diagram");
  const empty = $("#mermaid-empty");
  if (!container || !empty) return;
  state.mermaidNodeLookup.clear();
  const builder =
    state.diagramView === "overview"
      ? buildOverviewDiagram
      : state.diagramView === "relationships"
      ? buildRelationshipDiagram
      : state.diagramView === "paths"
        ? buildPathDiagram
        : buildSourceDiagram;
  const diagram = builder();
  if (!diagram) {
    container.innerHTML = "";
    empty.textContent = "Choose a node or explore a graph neighborhood to generate this Mermaid view.";
    empty.style.display = "grid";
    $("#diagram-summary").textContent = (DIAGRAM_VIEWS[state.diagramView] || DIAGRAM_VIEWS.overview).summary;
    logDebug("mermaid", "no diagram available", { view: state.diagramView });
    return;
  }
  $("#diagram-summary").textContent = diagram.summary;
  if (!ensureMermaid()) {
    container.innerHTML = "";
    empty.textContent = "Mermaid could not be loaded, so this view is temporarily unavailable.";
    empty.style.display = "grid";
    return;
  }
  empty.style.display = "none";
  const nonce = ++state.mermaidRenderNonce;
  logDebug("mermaid", "rendering diagram", {
    view: state.diagramView,
    summary: diagram.summary,
    lines: diagram.definition.split("\n").length,
    selected: state.selectedNodeId ? publicIdFor(graphNodeById(state.selectedNodeId) || { node_id: state.selectedNodeId }) : null,
  });
  try {
    const { svg, bindFunctions } = await window.mermaid.render(`ngss-mermaid-${nonce}`, diagram.definition);
    if (nonce !== state.mermaidRenderNonce) return;
    container.innerHTML = svg;
    bindFunctions?.(container);
    applyMermaidTransform();
  } catch (_error) {
    container.innerHTML = "";
    empty.textContent = "This Mermaid view could not be rendered for the current selection.";
    empty.style.display = "grid";
  }
}

function renderVisualizationStage() {
  syncDiagramUi();
  if (state.diagramView === "graph") {
    renderGraphScene();
    return;
  }
  renderMermaidDiagram();
}

function setDiagramView(view, { persist = true } = {}) {
  state.diagramView = normalizeDiagramView(view);
  renderVisualizationStage();
  if (persist) scheduleWorkspacePersist();
}

function filteredGraph() {
  if (!state.graph) return { nodes: [], edges: [] };
  const nodes = (state.graph.nodes || []).filter((node) => state.graphFilters.nodeTypes.has(typeClassFor(node)));
  const nodeIds = new Set(nodes.map((node) => node.node_id));
  const edges = (state.graph.edges || []).filter(
    (edge) =>
      nodeIds.has(edge.source_id) &&
      nodeIds.has(edge.target_id) &&
      state.graphFilters.edgeTypes.has(edge.edge_type || "edge"),
  );
  return { nodes, edges };
}

function applyGraphTransform() {
  const camera = $("#graph-camera");
  if (!camera) return;
  camera.setAttribute(
    "transform",
    `translate(${state.graphTransform.x} ${state.graphTransform.y}) scale(${state.graphTransform.scale})`,
  );
}

function viewportPoint(event) {
  const svg = $("#graph-svg");
  const rect = svg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 1000,
    y: ((event.clientY - rect.top) / rect.height) * 640,
  };
}

function centerGraphOn(nodeId) {
  const position = state.graphPositions.get(nodeId);
  if (!position) return;
  state.graphTransform.x = 500 - position.x * state.graphTransform.scale;
  state.graphTransform.y = 320 - position.y * state.graphTransform.scale;
  applyGraphTransform();
}

function renderFilterChips() {
  if (!state.graph) return;
  const nodeTypes = ["pe", "topic", "concept", "other"];
  $("#node-filter-chips").innerHTML = nodeTypes
    .map(
      (type) => `
        <button type="button" class="filter-chip${state.graphFilters.nodeTypes.has(type) ? " active" : ""}" data-filter-kind="node" data-filter-value="${escapeHtml(type)}">
          ${escapeHtml(type)}
        </button>
      `,
    )
    .join("");

  const edgeTypes = [...new Set((state.graph.edges || []).map((edge) => edge.edge_type || "edge"))].sort();
  $("#edge-filter-chips").innerHTML = edgeTypes
    .map(
      (type) => `
        <button type="button" class="filter-chip${state.graphFilters.edgeTypes.has(type) ? " active" : ""}" data-filter-kind="edge" data-filter-value="${escapeHtml(type)}">
          ${escapeHtml(humanizeEdgeType(type))}
        </button>
      `,
    )
    .join("");
}

function computeGraphLayout(nodes) {
  const centerX = 500;
  const centerY = 320;
  const positions = new Map();
  const radiusBase = 115;
  const seedNodeIds = state.graph?.seed_node_ids || (state.graph?.seed ? [state.graph.seed] : []);
  const sorted = [...nodes].sort((left, right) => (left.distance || 0) - (right.distance || 0));
  sorted.forEach((node, index) => {
    const seedIndex = seedNodeIds.indexOf(node.node_id);
    if (seedIndex >= 0) {
      if (seedNodeIds.length === 1) {
        positions.set(node.node_id, { x: centerX, y: centerY });
      } else {
        const angle = (Math.PI * 2 * seedIndex) / seedNodeIds.length;
        positions.set(node.node_id, {
          x: centerX + Math.cos(angle) * 82,
          y: centerY + Math.sin(angle) * 82,
        });
      }
      return;
    }
    const distance = Math.max(1, Number(node.distance || 1));
    const angle = (Math.PI * 2 * index) / Math.max(1, sorted.length - 1);
    const radius = radiusBase + distance * 95;
    positions.set(node.node_id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  const nodeIndex = new Map(nodes.map((node) => [node.node_id, node]));
  const edges = state.graph?.edges || [];
  for (let iteration = 0; iteration < 220; iteration += 1) {
    const forces = new Map(nodes.map((node) => [node.node_id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const left = positions.get(nodes[i].node_id);
        const right = positions.get(nodes[j].node_id);
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distanceSq = Math.max(dx * dx + dy * dy, 1);
        const force = 12000 / distanceSq;
        const distance = Math.sqrt(distanceSq);
        const ux = dx / distance;
        const uy = dy / distance;
        forces.get(nodes[i].node_id).x -= ux * force;
        forces.get(nodes[i].node_id).y -= uy * force;
        forces.get(nodes[j].node_id).x += ux * force;
        forces.get(nodes[j].node_id).y += uy * force;
      }
    }
    for (const edge of edges) {
      const source = positions.get(edge.source_id);
      const target = positions.get(edge.target_id);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const desired = 95 + ((nodeIndex.get(edge.source_id)?.distance || 0) + (nodeIndex.get(edge.target_id)?.distance || 0)) * 28;
      const force = (distance - desired) * 0.016;
      const ux = dx / distance;
      const uy = dy / distance;
      forces.get(edge.source_id).x += ux * force;
      forces.get(edge.source_id).y += uy * force;
      forces.get(edge.target_id).x -= ux * force;
      forces.get(edge.target_id).y -= uy * force;
    }
    for (const node of nodes) {
      const position = positions.get(node.node_id);
      const force = forces.get(node.node_id);
      const seedIndex = seedNodeIds.indexOf(node.node_id);
      if (seedIndex >= 0) {
        const angle = seedNodeIds.length === 1 ? 0 : (Math.PI * 2 * seedIndex) / seedNodeIds.length;
        const anchorX = seedNodeIds.length === 1 ? centerX : centerX + Math.cos(angle) * 82;
        const anchorY = seedNodeIds.length === 1 ? centerY : centerY + Math.sin(angle) * 82;
        position.x += (anchorX - position.x) * 0.08;
        position.y += (anchorY - position.y) * 0.08;
        continue;
      }
      position.x = Math.min(940, Math.max(60, position.x + force.x));
      position.y = Math.min(580, Math.max(60, position.y + force.y));
    }
  }
  return positions;
}

function createNodeShape(group, node) {
  const radius = nodeRadius(node);
  if (node.node_type === "topic") {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(-radius));
    rect.setAttribute("y", String(-radius * 0.78));
    rect.setAttribute("width", String(radius * 2));
    rect.setAttribute("height", String(radius * 1.56));
    rect.setAttribute("rx", "12");
    group.appendChild(rect);
    return;
  }
  if (node.node_type === "dimension_concept") {
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute(
      "points",
      `${-radius},0 ${-radius / 2},${-radius * 0.88} ${radius / 2},${-radius * 0.88} ${radius},0 ${radius / 2},${radius * 0.88} ${-radius / 2},${radius * 0.88}`,
    );
    group.appendChild(polygon);
    return;
  }
  if (node.node_type === "performance_expectation") {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(radius));
    group.appendChild(circle);
    return;
  }
  const ellipse = document.createElementNS(SVG_NS, "ellipse");
  ellipse.setAttribute("rx", String(radius));
  ellipse.setAttribute("ry", String(radius * 0.78));
  group.appendChild(ellipse);
}

function renderGraphScene() {
  const svg = $("#graph-svg");
  svg.replaceChildren();
  const nodes = state.graph?.nodes || [];
  const { nodes: visibleNodes, edges: visibleEdges } = filteredGraph();
  if (!nodes.length) {
    $("#graph-empty").style.display = "grid";
    $("#graph-summary").textContent = "No graph loaded.";
    return;
  }

  $("#graph-empty").style.display = "none";
  const camera = document.createElementNS(SVG_NS, "g");
  camera.setAttribute("id", "graph-camera");
  const edgeLayer = document.createElementNS(SVG_NS, "g");
  const nodeLayer = document.createElementNS(SVG_NS, "g");
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.node_id));

  for (const edge of state.graph.edges || []) {
    const source = state.graphPositions.get(edge.source_id);
    const target = state.graphPositions.get(edge.target_id);
    if (!source || !target) continue;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", source.x);
    line.setAttribute("y1", source.y);
    line.setAttribute("x2", target.x);
    line.setAttribute("y2", target.y);
    line.setAttribute("class", `graph-edge${visibleEdges.includes(edge) ? "" : " hidden"}`);
    line.dataset.source = edge.source_id;
    line.dataset.target = edge.target_id;
    line.dataset.edgeId = edge.edge_id;
    line.addEventListener("click", (event) => {
      event.stopPropagation();
      setCurrentStep("understand", { scroll: true });
      state.selectedEdgeId = edge.edge_id;
      const focusNode = state.selectedNodeId || edge.source_id;
      if (focusNode) {
        state.selectedNodeId = focusNode;
      }
      renderInspector();
      highlightGraphSelection();
      scheduleWorkspacePersist();
    });
    edgeLayer.appendChild(line);
  }

  for (const node of nodes) {
    const position = state.graphPositions.get(node.node_id);
    const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute(
        "class",
        `graph-node ${typeClassFor(node)}${isSeedNode(node.node_id) ? " seed" : ""}${visibleNodeIds.has(node.node_id) ? "" : " hidden"}`,
      );
    group.dataset.nodeId = node.node_id;
    group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    createNodeShape(group, node);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("y", String(nodeRadius(node) + 18));
    label.textContent = trimLabel(publicIdFor(node), 20);
    group.appendChild(label);

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      setCurrentStep("understand", { scroll: true });
      selectNode(node.node_id, true);
    });
    group.addEventListener("pointerdown", startNodeDrag);
    nodeLayer.appendChild(group);
  }

  camera.append(edgeLayer, nodeLayer);
  svg.append(camera);
  applyGraphTransform();
  highlightGraphSelection();
  const seedSummary = (state.graph.seed_public_ids || [publicIdFor(graphNodeById(state.graph.seed) || { node_id: state.graph.seed })]).join(", ");
  $("#graph-summary").textContent = `${seedSummary} • ${visibleNodes.length}/${nodes.length} nodes • ${visibleEdges.length}/${(state.graph.edges || []).length} edges • ${state.currentInspectHops} hop${state.currentInspectHops === 1 ? "" : "s"} • ${state.graph.shared_nodes_count || 0} shared`;
}

function highlightGraphSelection() {
  const svg = $("#graph-svg");
  svg.querySelectorAll(".graph-node").forEach((nodeEl) => nodeEl.classList.remove("selected"));
  svg.querySelectorAll(".graph-edge").forEach((edgeEl) => edgeEl.classList.remove("active"));
  if (state.selectedNodeId) {
    const nodeEl = svg.querySelector(`.graph-node[data-node-id="${cssEscape(state.selectedNodeId)}"]`);
    if (nodeEl) nodeEl.classList.add("selected");
    svg.querySelectorAll(".graph-edge").forEach((edgeEl) => {
      if (edgeEl.dataset.source === state.selectedNodeId || edgeEl.dataset.target === state.selectedNodeId) {
        edgeEl.classList.add("active");
      }
    });
  }
  if (state.selectedEdgeId) {
    const edgeEl = svg.querySelector(`.graph-edge[data-edge-id="${cssEscape(state.selectedEdgeId)}"]`);
    if (edgeEl) edgeEl.classList.add("active");
  }
}

function renderGraph(neighborhood, options = {}) {
  state.graph = neighborhood;
  const nodes = neighborhood.nodes || [];
  if (!nodes.length) {
    $("#graph-empty").style.display = "grid";
    $("#graph-summary").textContent = "No graph loaded.";
    return;
  }
  const defaultNodeTypes = ["pe", "topic", "concept", "other"];
  const availableEdgeTypes = [...new Set((neighborhood.edges || []).map((edge) => edge.edge_type || "edge"))];
  const restoredNodeTypes = (options.filters?.nodeTypes || []).filter((type) => defaultNodeTypes.includes(type));
  const restoredEdgeTypes = (options.filters?.edgeTypes || []).filter((type) => availableEdgeTypes.includes(type));
  state.graphTransform = options.transform
    ? {
        x: Number(options.transform.x) || 0,
        y: Number(options.transform.y) || 0,
        scale: clampNumber(options.transform.scale, 1, 0.55, 2.2),
      }
    : { x: 0, y: 0, scale: 1 };
  state.graphFilters.nodeTypes = new Set(restoredNodeTypes.length ? restoredNodeTypes : defaultNodeTypes);
  state.graphFilters.edgeTypes = new Set(restoredEdgeTypes.length ? restoredEdgeTypes : availableEdgeTypes);
  state.graphPositions = restoredGraphPositions(options, neighborhood) || computeGraphLayout(nodes);
  renderFilterChips();
  renderVisualizationStage();
  const selectedNodeId =
    resolveGraphNodeId(options.selectedPublicId) ||
    (state.selectedNodeId && graphNodeById(state.selectedNodeId) ? state.selectedNodeId : neighborhood.seed);
  selectNode(selectedNodeId, false, { persist: false });
  if (options.selectedEdgeId && graphEdgeById(options.selectedEdgeId)) {
    state.selectedEdgeId = options.selectedEdgeId;
    renderInspector();
    highlightGraphSelection();
  }
}

async function loadNodeContext(publicId) {
  if (!publicId) return null;
  if (state.nodeContexts.has(publicId)) {
    logDebug("context", "cache hit", { publicId });
    return state.nodeContexts.get(publicId);
  }
  try {
    const context = await api(`/standards/${encodeURIComponent(publicId)}`);
    state.nodeContexts.set(publicId, context);
    logDebug("context", "loaded", {
      publicId,
      chunkCount: (context.chunks || []).length,
      neighborCount: (context.neighbors || []).length,
    });
    return context;
  } catch (_error) {
    logDebug("context", "failed", { publicId });
    return null;
  }
}

async function selectNode(nodeId, fetchContext = true, options = {}) {
  state.selectedNodeId = nodeId;
  state.selectedEdgeId = null;
  setTabState("inspector", "overview");
  renderInspector();
  highlightGraphSelection();
  if (options.persist !== false) scheduleWorkspacePersist();
  if (!fetchContext) return;
  const node = graphNodeById(nodeId);
  const publicId = publicIdFor(node);
  logDebug("selection", "selected node", { nodeId, publicId, fetchContext });
  const [context] = await Promise.all([
    loadNodeContext(publicId),
    (async () => {
      const topicPublicId = topicPublicIdForNode(node);
      if (!topicPublicId || topicPublicId === publicId) return null;
      return loadNodeContext(topicPublicId);
    })(),
  ]);
  if (context && state.selectedNodeId === nodeId) {
    renderInspector();
  }
}

async function inspectGroup(identifiers, hops = Number($("#inspect-hops").value || 1), options = {}) {
  const seeds = uniqueSeedIds(identifiers);
  if (!seeds.length) return;
  state.currentInspectIds = seeds;
  state.currentInspectId = seeds[0];
  state.currentInspectHops = hops;
  $("#inspect-hops").value = String(hops);
  $("#node-details").innerHTML = '<div class="detail-card empty">Loading node details…</div>';
  renderGroupOverview();
  logDebug("inspect-group", "loading neighborhoods", { seeds, hops });
  const responses = await Promise.all(
    seeds.map(async (identifier) => {
      const [standard, graph] = await Promise.all([
        api(`/standards/${encodeURIComponent(identifier)}`),
        api(`/graph/neighbors/${encodeURIComponent(identifier)}?max_hops=${encodeURIComponent(hops)}`),
      ]);
      return { identifier, standard, graph, publicId: publicIdFor(standard.node) };
    }),
  );
  responses.forEach((item) => {
    state.nodeContexts.set(publicIdFor(item.standard.node), item.standard);
  });
  const mergedGraph = mergeNeighborhoods(
    responses.map((item) => item.graph),
    responses,
  );
  logDebug("inspect-group", "merged neighborhood", {
    seeds,
    nodes: mergedGraph.nodes.length,
    edges: mergedGraph.edges.length,
    sharedNodes: mergedGraph.shared_nodes_count,
  });
  renderGraph(mergedGraph, options.restore || {});
  const selectedNodeId =
    resolveGraphNodeId(options.restore?.selectedPublicId) ||
    resolveGraphNodeId(responses[0].publicId) ||
    responses[0].standard.node.node_id;
  await selectNode(selectedNodeId, true, { persist: false });
  if (options.restore?.selectedEdgeId && graphEdgeById(options.restore.selectedEdgeId)) {
    state.selectedEdgeId = options.restore.selectedEdgeId;
    renderInspector();
    highlightGraphSelection();
  }
  if (options.persist !== false) scheduleWorkspacePersist();
}

async function inspectIdentifier(identifier, hops = Number($("#inspect-hops").value || 1), options = {}) {
  const seeds = parseSeedInput(identifier);
  if (!seeds.length && identifier) seeds.push(String(identifier).trim());
  return inspectGroup(seeds, hops, options);
}

async function runSearch(event) {
  event.preventDefault();
  setCurrentStep("ask", { scroll: true });
  setTabState("workbench", "browse");
  const selectedPublicId = $("#search-query").value;
  const limit = Number($("#search-limit").value);
  const selected = itemByPublicId(selectedPublicId);
  if (!selected) return;
  logDebug("search", "running", { selectedPublicId, limit });
  $("#search-results").innerHTML = '<div class="stack-item empty">Searching…</div>';
  const data = await api("/search", {
    method: "POST",
    body: JSON.stringify({ query: selected.public_id, limit }),
  });
  const results = data.results || [];
  logDebug("search", "results", {
    count: results.length,
    ids: results.slice(0, 10).map((item) => publicIdFor(item)),
  });
  $("#search-results").innerHTML = results.length
    ? results.map((item) => renderStackItem(item, { showGraph: true })).join("")
    : '<div class="stack-item empty">No results found.</div>';
}

async function runAnswer(event) {
  event.preventDefault();
  setCurrentStep("ask", { scroll: true });
  setTabState("workbench", "ask");
  const templateKey = $("#answer-template").value;
  const template = ANSWER_TEMPLATES[templateKey] || ANSWER_TEMPLATES["what-is"];
  const primary = itemByPublicId($("#answer-query").value);
  const secondary = itemByPublicId($("#answer-secondary").value);
  const limit = Number($("#answer-limit").value);
  const expand_hops = Number($("#answer-hops").value);
  if (!primary) return;
  if (template.needsSecondary && !secondary) {
    showToast("Choose a second item for this question type.", true);
    return;
  }
  const query = template.build({ primary, secondary });
  logDebug("answer", "running", { templateKey, query, limit, expand_hops });
  $("#answer-output").textContent = "Generating answer…";
  $("#answer-citations").innerHTML = "";
  $("#answer-nodes").innerHTML = '<div class="stack-item empty">Loading retrieval metadata…</div>';
  const data = await api("/answer", {
    method: "POST",
    body: JSON.stringify({ query, limit, expand_hops }),
  });
  $("#answer-output").textContent = data.answer || "No answer returned.";
  logDebug("answer", "received", {
    citations: data.citations || [],
    retrievedCount: (data.retrieved_nodes || []).length,
  });
  $("#answer-citations").innerHTML = (data.citations || [])
    .map((citation) => `<button type="button" class="chip" data-inspect="${escapeHtml(citation)}">${escapeHtml(citation)}</button>`)
    .join("");
  $("#answer-nodes").innerHTML = (data.retrieved_nodes || []).length
    ? data.retrieved_nodes.slice(0, 10).map((item) => renderStackItem(item, { showGraph: true })).join("")
    : '<div class="stack-item empty">No retrieval metadata returned.</div>';
}

async function rebuildIndex() {
  showToast("Rebuilding index…");
  const data = await api("/ingest/rebuild", { method: "POST" });
  state.nodeContexts.clear();
  await loadCatalog();
  applyCatalogSelections(serializeWorkspaceState());
  syncAnswerTemplateUi();
  await loadHealth();
  showToast(`Index rebuilt: ${data.nodes} nodes, ${data.edges} edges.`);
  if (state.currentInspectIds.length) {
    await inspectGroup(state.currentInspectIds, state.currentInspectHops);
  }
}

function startNodeDrag(event) {
  event.stopPropagation();
  const nodeId = event.currentTarget.dataset.nodeId;
  state.graphDrag = { nodeId, pointerId: event.pointerId };
  event.currentTarget.classList.add("dragging");
  event.currentTarget.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (state.graphDrag) {
    const point = viewportPoint(event);
    const position = state.graphPositions.get(state.graphDrag.nodeId);
    if (!position) return;
    position.x = (point.x - state.graphTransform.x) / state.graphTransform.scale;
    position.y = (point.y - state.graphTransform.y) / state.graphTransform.scale;
    renderGraphScene();
    highlightGraphSelection();
    return;
  }
  if (state.panDrag) {
    const dx = event.clientX - state.panDrag.startX;
    const dy = event.clientY - state.panDrag.startY;
    state.graphTransform.x = state.panDrag.originX + (dx / $("#graph-svg").clientWidth) * 1000;
    state.graphTransform.y = state.panDrag.originY + (dy / $("#graph-svg").clientHeight) * 640;
    applyGraphTransform();
  }
}

function endPointerInteraction(event) {
  if (state.graphDrag) {
    const node = document.querySelector(`.graph-node[data-node-id="${cssEscape(state.graphDrag.nodeId)}"]`);
    if (node) {
      node.classList.remove("dragging");
      try {
        node.releasePointerCapture(state.graphDrag.pointerId);
      } catch (_error) {
        // Ignore capture release issues.
      }
    }
    state.graphDrag = null;
    scheduleWorkspacePersist();
  }
  if (state.panDrag) {
    $("#graph-viewport").classList.remove("panning");
    state.panDrag = null;
    scheduleWorkspacePersist();
  }
}

function adjustCanvasZoom(delta) {
  if (state.diagramView === "graph") {
    state.graphTransform.scale = Math.max(0.55, Math.min(2.2, state.graphTransform.scale + delta));
    applyGraphTransform();
  } else {
    state.mermaidTransform.scale = Math.max(0.35, Math.min(3, state.mermaidTransform.scale + delta));
    applyMermaidTransform();
  }
  scheduleWorkspacePersist();
}

function fitCanvasToSelection() {
  if (state.diagramView === "graph") {
    const focusNodeId = state.selectedNodeId || state.graph?.seed;
    if (!focusNodeId) return;
    centerGraphOn(focusNodeId);
  } else {
    resetMermaidTransform({ persist: false });
  }
  scheduleWorkspacePersist();
}

function wireMermaidInteractions() {
  const surface = $("#mermaid-diagram");
  if (!surface) return;
  surface.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".node")) return;
    state.mermaidPan = {
      startX: event.clientX,
      startY: event.clientY,
      originX: state.mermaidTransform.x,
      originY: state.mermaidTransform.y,
    };
    surface.classList.add("panning");
  });
  surface.addEventListener("pointermove", (event) => {
    if (!state.mermaidPan) return;
    const dx = event.clientX - state.mermaidPan.startX;
    const dy = event.clientY - state.mermaidPan.startY;
    state.mermaidTransform.x = state.mermaidPan.originX + dx;
    state.mermaidTransform.y = state.mermaidPan.originY + dy;
    applyMermaidTransform();
  });
  const stopPanning = () => {
    if (!state.mermaidPan) return;
    state.mermaidPan = null;
    surface.classList.remove("panning");
    scheduleWorkspacePersist();
  };
  surface.addEventListener("pointerup", stopPanning);
  surface.addEventListener("pointerleave", stopPanning);
  surface.addEventListener(
    "wheel",
    (event) => {
      if (state.diagramView === "graph") return;
      event.preventDefault();
      adjustCanvasZoom(event.deltaY > 0 ? -0.08 : 0.08);
    },
    { passive: false },
  );
}

function wireViewportInteractions() {
  const viewport = $("#graph-viewport");
  viewport.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".graph-node")) return;
    state.panDrag = {
      startX: event.clientX,
      startY: event.clientY,
      originX: state.graphTransform.x,
      originY: state.graphTransform.y,
    };
    viewport.classList.add("panning");
  });
  viewport.addEventListener("pointermove", handlePointerMove);
  viewport.addEventListener("pointerup", endPointerInteraction);
  viewport.addEventListener("pointerleave", endPointerInteraction);
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -0.08 : 0.08;
      state.graphTransform.scale = Math.max(0.55, Math.min(2.2, state.graphTransform.scale + direction));
      applyGraphTransform();
      scheduleWorkspacePersist();
    },
    { passive: false },
  );
}

function wireGraphControls() {
  $("#seed-category").addEventListener("change", () => {
    setCurrentStep("choose");
    replaceSelectOptions($("#seed-picker"), filteredCatalogItems($("#seed-category").value), {
      selectedValue: $("#seed-picker").value || state.currentInspectIds[0] || DEFAULT_WORKSPACE.inspectId,
    });
    scheduleWorkspacePersist();
  });
  $("#add-seed-button").addEventListener("click", async () => {
    const selectedPublicId = $("#seed-picker").value;
    if (!selectedPublicId) {
      showToast("Pick a standard or concept to add.", true);
      return;
    }
    const nextSeeds = uniqueSeedIds([...state.currentInspectIds, selectedPublicId]);
    setActiveSeeds(nextSeeds);
    setCurrentStep("choose", { persist: false });
    showToast(`${selectedPublicId} added to the active group.`);
  });
  $("#replace-seed-button").addEventListener("click", async () => {
    const selectedPublicId = $("#seed-picker").value;
    if (!selectedPublicId) {
      showToast("Pick a standard or concept to use as the only seed.", true);
      return;
    }
    replaceActiveSeeds(selectedPublicId);
    setCurrentStep("choose", { persist: false });
    showToast(`${selectedPublicId} is now the only active seed.`);
  });
  $("#inspect-submit").addEventListener("click", async () => {
    try {
      await inspectGroup(state.currentInspectIds, Number($("#inspect-hops").value));
      setCurrentStep("explore", { scroll: true });
    } catch (error) {
      showToast(error.message, true);
    }
  });
  document.querySelectorAll("[data-diagram-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentStep("explore", { persist: false });
      setDiagramView(button.dataset.diagramView);
    });
  });
  document.querySelectorAll("[data-canvas-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.canvasAction;
      if (action === "zoom-in") adjustCanvasZoom(0.12);
      else if (action === "zoom-out") adjustCanvasZoom(-0.12);
      else if (action === "fit-selection") fitCanvasToSelection();
      else if (action === "reset") {
        if (state.diagramView === "graph") {
          state.graphTransform = { x: 0, y: 0, scale: 1 };
          applyGraphTransform();
          scheduleWorkspacePersist();
        } else {
          resetMermaidTransform();
        }
      }
    });
  });
  document.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => setCurrentStep(button.dataset.step, { scroll: true }));
  });
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewMode === mode);
  });
  renderInspector();
  scheduleWorkspacePersist();
}

function wireForms() {
  document.querySelectorAll("[data-tab-group]").forEach((button) => {
    button.addEventListener("click", () => setTabState(button.dataset.tabGroup, button.dataset.tab));
  });

  $("#search-form").addEventListener("submit", async (event) => {
    try {
      await runSearch(event);
    } catch (error) {
      showToast(error.message, true);
      $("#search-results").innerHTML = '<div class="stack-item empty">Search failed.</div>';
    }
  });

  $("#answer-form").addEventListener("submit", async (event) => {
    try {
      await runAnswer(event);
    } catch (error) {
      showToast(error.message, true);
      $("#answer-output").textContent = "Answer generation failed.";
    }
  });

  $("#refresh-health").addEventListener("click", async () => {
    try {
      await loadHealth();
      showToast("Stats refreshed.");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  $("#rebuild-index").addEventListener("click", async () => {
    try {
      await rebuildIndex();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    button.addEventListener("click", () => setViewMode(button.dataset.viewMode));
  });

  $("#search-category").addEventListener("change", () => {
    replaceSelectOptions($("#search-query"), filteredCatalogItems($("#search-category").value), {
      selectedValue: $("#search-query").value || DEFAULT_WORKSPACE.search.selectedPublicId,
    });
    scheduleWorkspacePersist();
  });
  $("#answer-template").addEventListener("change", () => {
    syncAnswerTemplateUi();
    scheduleWorkspacePersist();
  });

  ["#seed-category", "#seed-picker", "#inspect-hops", "#search-category", "#search-query", "#search-limit", "#answer-template", "#answer-query", "#answer-secondary", "#answer-limit", "#answer-hops"].forEach((selector) => {
    $(selector).addEventListener("input", () => scheduleWorkspacePersist());
    $(selector).addEventListener("change", () => scheduleWorkspacePersist());
  });

  $("#copy-view-link").addEventListener("click", async () => {
    persistWorkspaceState();
    try {
      await navigator.clipboard.writeText(window.location.href);
      setWorkspaceStatus("Current view link copied. It opens to the same graph seed, selection, and mode.");
      showToast("View link copied.");
    } catch (_error) {
      setWorkspaceStatus("Clipboard access is unavailable here. Use the URL in the address bar to share the current view.");
      showToast("Clipboard unavailable.", true);
    }
  });

  $("#reset-workspace").addEventListener("click", async () => {
    try {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } catch (_error) {
      // Ignore local storage cleanup issues.
    }
    window.history.replaceState({}, "", window.location.pathname);
    state.nodeContexts.clear();
    hydrateControls(DEFAULT_WORKSPACE);
    state.currentInspectIds = [...DEFAULT_WORKSPACE.inspectIds];
    state.viewMode = DEFAULT_WORKSPACE.viewMode;
    state.diagramView = DEFAULT_WORKSPACE.diagramView;
    state.currentStep = DEFAULT_WORKSPACE.currentStep;
    state.mermaidTransform = { x: 0, y: 0, scale: 1 };
    state.uiTabs = { inspector: "overview", workbench: "browse" };
    applyCatalogSelections(DEFAULT_WORKSPACE);
    syncAnswerTemplateUi();
    await initDockLayout();
    setTabState("inspector", "overview");
    setTabState("workbench", "browse");
    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewMode === DEFAULT_WORKSPACE.viewMode);
    });
    document.querySelectorAll("[data-diagram-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.diagramView === DEFAULT_WORKSPACE.diagramView);
    });
    setCurrentStep(DEFAULT_WORKSPACE.currentStep, { persist: false });
    setWorkspaceStatus("Workspace reset. Default graph view restored.");
    try {
      await inspectGroup(DEFAULT_WORKSPACE.inspectIds, DEFAULT_WORKSPACE.inspectHops, { persist: false });
      persistWorkspaceState();
      showToast("Workspace reset.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function configureRuntimeUi() {
  if (!isPagesDataMode()) return;
  const rebuildButton = $("#rebuild-index");
  if (rebuildButton) {
    rebuildButton.disabled = true;
    rebuildButton.title = "Rebuild is only available when the FastAPI backend is running.";
  }
  const status = $("#workspace-status");
  if (status) {
    status.textContent = "Static Pages mode is active. Browsing, graph exploration, and lightweight local search work from the bundled dataset.";
  }
}

function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    if (event.key === "/" && !typing) {
      event.preventDefault();
      $("#search-query")?.focus();
      return;
    }
    if (typing) return;
    if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      $("#seed-picker")?.focus();
      return;
    }
    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      setViewMode("evidence");
      return;
    }
    if (event.key.toLowerCase() === "x") {
      event.preventDefault();
      setViewMode("explorer");
    }
  });
}

function wireDelegatedActions() {
  document.body.addEventListener("click", async (event) => {
    const inspectButton = event.target.closest("[data-inspect]");
    if (inspectButton) {
      try {
        const identifier = inspectButton.getAttribute("data-inspect");
        const existingNodeId = resolveGraphNodeId(identifier);
        setTabState("inspector", "overview");
        if (existingNodeId) {
          setCurrentStep("understand", { scroll: true });
          centerGraphOn(existingNodeId);
          await selectNode(existingNodeId, true);
        } else {
          setCurrentStep("explore", { scroll: true });
          await inspectIdentifier(identifier, Number($("#inspect-hops").value));
        }
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }

    const addSeedButton = event.target.closest("[data-add-seed]");
    if (addSeedButton) {
      const identifier = addSeedButton.getAttribute("data-add-seed");
      setActiveSeeds([...state.currentInspectIds, identifier]);
      setCurrentStep("choose", { persist: false });
      showToast(`${identifier} added to the active group.`);
      return;
    }

    const removeSeedButton = event.target.closest("[data-remove-seed]");
    if (removeSeedButton) {
      const identifier = removeSeedButton.getAttribute("data-remove-seed");
      const nextSeeds = state.currentInspectIds.filter((seed) => seed !== identifier);
      setActiveSeeds(nextSeeds.length ? nextSeeds : DEFAULT_WORKSPACE.inspectIds);
      setCurrentStep("choose", { persist: false });
      if (state.graph?.nodes?.length) {
        try {
          await inspectGroup(state.currentInspectIds, Number($("#inspect-hops").value));
        } catch (error) {
          showToast(error.message, true);
        }
      }
      return;
    }

    const focusButton = event.target.closest("[data-graph-focus]");
    if (focusButton) {
      const nodeId = focusButton.getAttribute("data-graph-focus");
      if (graphNodeById(nodeId)) {
        setCurrentStep("explore", { scroll: true });
        setDiagramView("graph", { persist: false });
        selectNode(nodeId, true);
      }
      return;
    }

    const filterChip = event.target.closest("[data-filter-kind]");
    if (filterChip) {
      const kind = filterChip.getAttribute("data-filter-kind");
      const value = filterChip.getAttribute("data-filter-value");
      const targetSet = kind === "node" ? state.graphFilters.nodeTypes : state.graphFilters.edgeTypes;
      if (targetSet.has(value) && targetSet.size > 1) targetSet.delete(value);
      else targetSet.add(value);
      renderFilterChips();
      renderVisualizationStage();
      scheduleWorkspacePersist();
      return;
    }

    const edgeButton = event.target.closest("[data-edge-select]");
    if (edgeButton) {
      setCurrentStep("understand", { scroll: true });
      setTabState("inspector", "connections");
      state.selectedEdgeId = edgeButton.getAttribute("data-edge-select");
      renderEdgeDetail();
      highlightGraphSelection();
      scheduleWorkspacePersist();
    }
  });
}

async function bootstrap() {
  configureRuntimeUi();
  wireForms();
  wireDelegatedActions();
  wireGraphControls();
  wireViewportInteractions();
  wireMermaidInteractions();
  wireKeyboardShortcuts();
  setTabState("inspector", currentTab("inspector"));
  setTabState("workbench", currentTab("workbench"));
  try {
    await loadCatalog();
    await loadHealth();
  } catch (error) {
    showToast(error.message, true);
  }
  const restored = mergedWorkspaceState();
  hydrateControls(restored);
  state.currentInspectIds = uniqueSeedIds(restored.inspectIds || [restored.inspectId || DEFAULT_WORKSPACE.inspectId]);
  state.currentInspectId = state.currentInspectIds[0];
  applyCatalogSelections(restored);
  syncAnswerTemplateUi();
  state.viewMode = restored.viewMode;
  state.diagramView = normalizeDiagramView(restored.diagramView || DEFAULT_WORKSPACE.diagramView);
  state.currentStep = GUIDED_STEPS[restored.currentStep] ? restored.currentStep : DEFAULT_WORKSPACE.currentStep;
  await initDockLayout(restored.layout || null);
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewMode === restored.viewMode);
  });
  document.querySelectorAll("[data-diagram-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.diagramView === state.diagramView);
  });
  renderGroupOverview();
  syncDiagramUi();
  setCurrentStep(state.currentStep, { persist: false });
  setWorkspaceStatus(
    restored.source === "shared"
      ? "Loaded a shared workspace view from the URL."
        : restored.source === "stored"
          ? "Restored your last workspace context and synced it with the current URL."
        : "Workspace autosaves locally and syncs the current view into the URL.",
  );
  try {
    await inspectGroup(state.currentInspectIds, restored.inspectHops, {
      restore: restored,
      persist: false,
    });
    setCurrentStep(state.currentStep, { persist: false });
    persistWorkspaceState();
  } catch (error) {
    showToast(error.message, true);
  }
}

bootstrap();
