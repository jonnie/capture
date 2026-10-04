/* Capture web UI — vanilla JS, no build step. */
"use strict";

const $ = (sel) => document.querySelector(sel);

const els = {
  main: $("#main"),
  board: $("#board"),
  list: $("#list"),
  viewBoard: $("#view-board"),
  viewList: $("#view-list"),
  viewGraph: $("#view-graph"),
  graph: $("#graph"),
  graphCanvas: $("#graph-canvas"),
  graphTooltip: $("#graph-tooltip"),
  graphStats: $("#graph-stats"),
  graphEmpty: $("#graph-empty"),
  search: $("#search"),
  newBtn: $("#new-capture"),
  overlay: $("#overlay"),
  overlayTitle: $("#overlay-title"),
  overlaySubtitle: $("#overlay-subtitle"),
  input: $("#capture-input"),
  tagPicker: $("#tag-picker"),
  autoNote: $("#auto-tag-note"),
  saveBtn: $("#overlay-save"),
  cancelBtn: $("#overlay-cancel"),
  confirm: $("#confirm"),
  confirmCancel: $("#confirm-cancel"),
  confirmDelete: $("#confirm-delete"),
  toasts: $("#toasts"),
  saveKbd: $("#save-kbd"),
};

const state = {
  active: [],
  archived: [],
  tags: [],
  view: localStorage.getItem("capture.view") || "board",
  q: "",
  filterTag: "",
  editingId: null,
  selectedTags: new Set(),
  pendingDeleteId: null,
  expanded: new Set(), // tag sections expanded past the first 10
};

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
els.saveKbd.textContent = isMac ? "⌘ ⏎" : "Ctrl ⏎";

/* ---------- helpers ---------- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const KNOWN_TAG_COLORS = {
  inbox: "#98a2b3",
  todo: "#6fa8dc",
  idea: "#d9a860",
  urgent: "#d97a8c",
};

function tagColor(tag) {
  if (KNOWN_TAG_COLORS[tag]) return KNOWN_TAG_COLORS[tag];
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h} 42% 64%)`;
}

function tagChip(tag) {
  return `<span class="tag-chip" style="--c:${tagColor(tag)}">${esc(tag)}</span>`;
}

function relTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function fetchJSON(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

/* ---------- data ---------- */

async function refresh() {
  const q = state.q ? `&q=${encodeURIComponent(state.q)}` : "";
  const [a, b, t] = await Promise.all([
    fetchJSON(`/api/captures?archived=false${q}`),
    fetchJSON(`/api/captures?archived=true${q}`),
    fetchJSON("/api/tags"),
  ]);
  state.active = a.captures;
  state.archived = b.captures;
  state.tags = t.tags;
  render();
}

/* ---------- rendering ---------- */

function render() {
  if (state.view === "board") renderBoard();
  else if (state.view === "list") renderList();
  else if (state.view === "graph") renderGraph();
}

function orderTags() {
  const present = new Set(state.active.flatMap((c) => c.tags));
  const ordered = state.tags.filter((t) => present.has(t));
  const extra = [...present].filter((t) => !state.tags.includes(t));
  return [...ordered, ...extra];
}

function emptyState() {
  if (state.q) {
    return `<div class="empty"><h3>No matches</h3><p>Nothing found for “${esc(state.q)}”.</p></div>`;
  }
  return `<div class="empty">
    <h3>Nothing captured yet</h3>
    <p>Press <kbd>N</kbd> or hit <b>New</b> to capture your first thought.</p>
  </div>`;
}

function cardHtml(c, archived) {
  const actions = `
    <button class="icon-btn" data-act="edit" title="Edit" aria-label="Edit">${ICONS.edit}</button>
    ${archived
      ? `<button class="icon-btn" data-act="restore" title="Restore" aria-label="Restore">${ICONS.restore}</button>`
      : `<button class="icon-btn" data-act="archive" title="Archive" aria-label="Archive">${ICONS.archive}</button>`}
    <button class="icon-btn danger" data-act="delete" title="Delete" aria-label="Delete">${ICONS.trash}</button>`;
  if (archived) {
    // list-row context (grid areas)
    return `<div class="list-row" data-id="${c.id}">
      <span class="list-content" title="${esc(c.content)}">${esc(c.content)}</span>
      <span class="list-tags">${c.tags.map(tagChip).join("")}</span>
      <time class="list-time" datetime="${esc(c.created_at)}">${relTime(c.created_at)}</time>
      <span class="card-actions">${actions}</span>
    </div>`;
  }
  return `<article class="card" data-id="${c.id}">
    <p class="card-content">${esc(c.content)}</p>
    <div class="card-foot">
      <div class="card-tags">${c.tags.map(tagChip).join("")}</div>
      <div class="card-meta">
        <time datetime="${esc(c.created_at)}" title="${esc(c.created_at)}">${relTime(c.created_at)}</time>
        <span class="card-actions">${actions}</span>
      </div>
    </div>
  </article>`;
}

function sectionHtml(label, color, items, isArchived) {
  const limit = 10;
  const expanded = !isArchived && state.expanded.has(label);
  const shown = expanded || items.length <= limit ? items : items.slice(0, limit);
  const more =
    !expanded && items.length > limit
      ? `<button class="show-more" data-more="${esc(label)}">Show all ${items.length}</button>`
      : "";
  const style = `style="--c:${color}"`;
  return `<section class="tag-section">
    <header class="section-head">
      <span class="section-title" ${style}><i class="dot"></i>${esc(label)}</span>
      <span class="section-count">${items.length}</span>
    </header>
    <div class="section-body">
      ${shown.map((c) => cardHtml(c, isArchived)).join("")}
      ${more}
    </div>
  </section>`;
}

function renderBoard() {
  const groups = orderTags().map((tag) => ({
    tag,
    items: state.active.filter((c) => c.tags.includes(tag)),
  }));
  let html = groups
    .filter((g) => g.items.length)
    .map((g) => sectionHtml(g.tag, tagColor(g.tag), g.items, false))
    .join("");
  if (state.archived.length) {
    html += sectionHtml("archived", "var(--text-faint)", state.archived, true);
  }
  els.board.innerHTML = html || emptyState();
}

function renderList() {
  const inTag = (c) => !state.filterTag || c.tags.includes(state.filterTag);
  const rows = state.active.filter(inTag);
  const arch = state.archived.filter(inTag);

  const counts = new Map();
  for (const c of state.active) for (const t of c.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const options = [
    `<option value="">All tags</option>`,
    ...orderTags()
      .map((t) => `<option value="${esc(t)}"${t === state.filterTag ? " selected" : ""}>${esc(t)} (${counts.get(t) || 0})</option>`)
      .join(""),
  ].join("");

  const head = `<div class="list-row head">
    <span class="list-content">Capture</span>
    <span class="list-tags">Tags</span>
    <span class="list-time">Created</span>
    <span class="card-actions"></span>
  </div>`;

  els.list.innerHTML = `
    <div class="list-controls">
      <label>Tag <select id="tag-filter" aria-label="Filter by tag">${options}</select></label>
      <span class="shown-count">${rows.length} active${state.q ? ` matching “${esc(state.q)}”` : ""}</span>
    </div>
    <div class="list">${head}${rows.map((c) => cardHtml(c, false)).join("")}</div>
    ${arch.length
      ? `<div class="archived-divider">Archived (${arch.length})</div>
         <div class="list">${head}${arch.map((c) => cardHtml(c, true)).join("")}</div>`
      : ""}`;
}

/* ---------- overlay (new + edit) ---------- */

function renderTagPicker() {
  els.tagPicker.innerHTML = state.tags
    .map(
      (t) =>
        `<button class="chip${state.selectedTags.has(t) ? " on" : ""}" data-tag="${esc(t)}" style="--c:${tagColor(t)}">${esc(t)}</button>`
    )
    .join("");
  els.autoNote.style.display = state.editingId == null ? "" : "none";
}

function openOverlay(mode, capture = null) {
  state.editingId = mode === "edit" ? capture.id : null;
  state.selectedTags = new Set(capture ? capture.tags : []);
  els.overlayTitle.textContent = mode === "edit" ? "Editing capture" : "New capture";
  els.overlaySubtitle.textContent =
    mode === "edit"
      ? `Editing #${capture.id} — changes are saved in place; the archive state is untouched.`
      : "A thought, an idea, a task — anything worth keeping. Enter adds a new line; Ctrl/⌘+Enter saves.";
  els.input.value = capture ? capture.content : "";
  renderTagPicker();
  els.overlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => {
    els.input.focus();
    els.input.setSelectionRange(els.input.value.length, els.input.value.length);
  });
}

function closeOverlay() {
  els.overlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  state.editingId = null;
  state.selectedTags = new Set();
}

async function saveOverlay() {
  const content = els.input.value.trim();
  if (!content) {
    els.input.focus();
    els.input.classList.add("shake");
    setTimeout(() => els.input.classList.remove("shake"), 400);
    return;
  }
  const body = { content };
  if (state.editingId != null) body.tags = [...state.selectedTags];
  else if (state.selectedTags.size) body.tags = [...state.selectedTags];
  try {
    if (state.editingId == null) {
      const c = await fetchJSON("/api/captures", { method: "POST", body });
      await refresh();
      toast(
        c.tags.length ? `Capture saved — tagged “${c.tags.join(", ")}”` : "Capture saved"
      );
    } else {
      await fetchJSON(`/api/captures/${state.editingId}`, { method: "PATCH", body });
      await refresh();
      toast("Capture updated");
    }
    closeOverlay();
  } catch (err) {
    toast(err.message, { isError: true });
  }
}

/* ---------- archive / restore / delete ---------- */

async function setArchived(capture, archived) {
  try {
    await fetchJSON(`/api/captures/${capture.id}`, { method: "PATCH", body: { archived } });
    await refresh();
    if (archived) {
      toast("Capture archived", {
        label: "Undo",
        timeout: 6000,
        onAction: () => setArchived(capture, false),
      });
    } else {
      toast("Capture restored");
    }
  } catch (err) {
    toast(err.message, { isError: true });
  }
}

function askDelete(capture) {
  state.pendingDeleteId = capture.id;
  els.confirm.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.confirmCancel.focus();
}

function closeConfirm() {
  els.confirm.classList.add("hidden");
  if (els.overlay.classList.contains("hidden")) document.body.classList.remove("modal-open");
  state.pendingDeleteId = null;
}

async function doDelete() {
  const id = state.pendingDeleteId;
  closeConfirm();
  try {
    await fetchJSON(`/api/captures/${id}`, { method: "DELETE" });
    await refresh();
    toast("Capture deleted");
  } catch (err) {
    toast(err.message, { isError: true });
  }
}

/* ---------- toasts ---------- */

function toast(message, { isError = false, label = null, onAction = null, timeout = 4500 } = {}) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = message;
  el.appendChild(msg);
  if (label) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = label;
    el.appendChild(btn);
    btn.addEventListener("click", () => {
      dismiss();
      if (onAction) onAction();
    });
  }
  els.toasts.appendChild(el);
  const t = setTimeout(dismiss, timeout);
  function dismiss() {
    clearTimeout(t);
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }
}

/* ---------- events ---------- */

els.newBtn.addEventListener("click", () => openOverlay("new"));
els.saveBtn.addEventListener("click", saveOverlay);
els.cancelBtn.addEventListener("click", closeOverlay);
els.confirmCancel.addEventListener("click", closeConfirm);
els.confirmDelete.addEventListener("click", doDelete);

els.overlay.querySelector("[data-close-overlay]").addEventListener("click", closeOverlay);
els.confirm.querySelector("[data-close-confirm]").addEventListener("click", closeConfirm);

els.tagPicker.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const t = chip.dataset.tag;
  if (state.selectedTags.has(t)) state.selectedTags.delete(t);
  else state.selectedTags.add(t);
  renderTagPicker();
});

els.main.addEventListener("click", (e) => {
  const more = e.target.closest("[data-more]");
  if (more) {
    state.expanded.add(more.dataset.more);
    render();
    return;
  }
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const row = e.target.closest("[data-id]");
  if (!row) return;
  const id = Number(row.dataset.id);
  const capture =
    state.active.find((c) => c.id === id) || state.archived.find((c) => c.id === id);
  if (!capture) return;
  const act = btn.dataset.act;
  if (act === "edit") openOverlay("edit", capture);
  else if (act === "archive") setArchived(capture, true);
  else if (act === "restore") setArchived(capture, false);
  else if (act === "delete") askDelete(capture);
});

els.main.addEventListener("change", (e) => {
  if (e.target.id === "tag-filter") {
    state.filterTag = e.target.value;
    render();
  }
});

let searchTimer;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = els.search.value.trim();
    refresh().catch((err) => toast(err.message, { isError: true }));
  }, 250);
});

function setView(v) {
  const changed = v !== state.view;
  state.view = v;
  localStorage.setItem("capture.view", v);
  els.board.classList.toggle("hidden", v !== "board");
  els.list.classList.toggle("hidden", v !== "list");
  els.graph.classList.toggle("hidden", v !== "graph");
  els.viewBoard.classList.toggle("active", v === "board");
  els.viewList.classList.toggle("active", v === "list");
  els.viewGraph.classList.toggle("active", v === "graph");
  if (v !== "graph") {
    graphStop();
    hideTooltip();
  }
  if (changed) render();
}
els.viewBoard.addEventListener("click", () => setView("board"));
els.viewList.addEventListener("click", () => setView("list"));
els.viewGraph.addEventListener("click", () => setView("graph"));

// Keyboard shortcuts: N = new capture, / = search, Esc = close, Ctrl/⌘+Enter = save.
document.addEventListener("keydown", (e) => {
  const overlayOpen = !els.overlay.classList.contains("hidden");
  const confirmOpen = !els.confirm.classList.contains("hidden");

  if (e.key === "Escape") {
    if (overlayOpen) closeOverlay();
    else if (confirmOpen) closeConfirm();
    return;
  }
  if (overlayOpen) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveOverlay();
    }
    return;
  }
  const inField = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "");
  if (inField || confirmOpen) return;
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    openOverlay("new");
  } else if (e.key === "/") {
    e.preventDefault();
    els.search.focus();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (!els.overlay.classList.contains("hidden") && els.input.value.trim()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------- icons ---------- */

const ICONS = {
  edit:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  archive:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>',
  restore:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 7"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
};

/* ---------- graph view (tag-based force graph) ---------- */

// Captures are nodes; the tags they carry are hub nodes. A capture links to
// each of its tag hubs, so captures that share a tag visibly connect through
// it. Hub size/label encode how many captures use the tag (concentration).
const graph = {
  nodes: [],
  edges: [],
  running: false,
  raf: 0,
  alpha: 0,
  t: { x: 0, y: 0, k: 1 }, // world -> screen transform (pan + zoom)
  hover: null,
  focus: null, // focused tag name, or null
  drag: null, // { node, ox, oy }
  pan: null, // { sx, sy, ox, oy }
  down: null,
  moved: false,
  cache: new Map(), // stable positions across re-layouts, keyed by node
};

function graphVisible() {
  return !els.graph.classList.contains("hidden");
}

function buildGraph() {
  const captures = state.active;
  const tagCounts = new Map();
  for (const c of captures) for (const t of c.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);

  const W = els.graph.clientWidth || 800;
  const H = els.graph.clientHeight || 600;
  const cx = W / 2;
  const cy = H / 2;
  const hubR = Math.min(W, H) * 0.3;

  const nodes = [];
  const tagIndex = new Map();
  const hubList = [...tagCounts.keys()];

  hubList.forEach((tag, i) => {
    const count = tagCounts.get(tag);
    const a = (i / Math.max(1, hubList.length)) * Math.PI * 2 - Math.PI / 2;
    const cached = graph.cache.get(`t:${tag}`);
    const n = {
      kind: "tag",
      tag,
      count,
      r: 9 + Math.sqrt(count) * 4,
      color: tagColor(tag),
      x: cached ? cached.x : cx + Math.cos(a) * hubR,
      y: cached ? cached.y : cy + Math.sin(a) * hubR,
      vx: 0,
      vy: 0,
    };
    tagIndex.set(tag, nodes.length);
    nodes.push(n);
  });

  const edges = [];
  for (const c of captures) {
    const firstTag = c.tags[0] || "inbox";
    const hub = nodes[tagIndex.get(firstTag)];
    const cached = graph.cache.get(`c:${c.id}`);
    const n = {
      kind: "capture",
      id: c.id,
      content: c.content,
      tags: c.tags,
      created_at: c.created_at,
      r: 4 + c.tags.length * 1.5,
      color: tagColor(firstTag),
      x: cached ? cached.x : hub.x + (Math.random() - 0.5) * 90,
      y: cached ? cached.y : hub.y + (Math.random() - 0.5) * 90,
      vx: 0,
      vy: 0,
    };
    const ci = nodes.length;
    nodes.push(n);
    for (const t of c.tags) edges.push({ a: ci, b: tagIndex.get(t), tag: t });
  }

  graph.nodes = nodes;
  graph.edges = edges;
  graph.alpha = 1; // reheat the simulation
  graph.hover = null;
  graph.focus = null;
  graph.t = { x: 0, y: 0, k: 1 };
}

function graphTick() {
  if (!graphVisible()) {
    graph.running = false;
    return;
  }
  const nodes = graph.nodes;
  const W = els.graph.clientWidth || 800;
  const H = els.graph.clientHeight || 600;
  const cx = W / 2;
  const cy = H / 2;
  const a = graph.alpha;

  // Centre gravity.
  for (const n of nodes) {
    n.vx += (cx - n.x) * 0.01 * a;
    n.vy += (cy - n.y) * 0.01 * a;
  }
  // Pairwise repulsion (cutoff keeps it local and cheap).
  for (let i = 0; i < nodes.length; i++) {
    const ni = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const nj = nodes[j];
      let dx = nj.x - ni.x;
      let dy = nj.y - ni.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 300 * 300) continue;
      if (d2 < 1) d2 = 1;
      const d = Math.sqrt(d2);
      let f = ((ni.r + nj.r) * 26) / d2;
      const minD = (ni.r + nj.r) * 1.7;
      if (d < minD) f += (minD - d) * 0.5;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      ni.vx -= fx * a;
      ni.vy -= fy * a;
      nj.vx += fx * a;
      nj.vy += fy * a;
    }
  }
  // Springs pull captures toward their tag hubs.
  for (const e of graph.edges) {
    const s = nodes[e.a];
    const t = nodes[e.b];
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = 30 + t.r;
    const f = (d - rest) * 0.03;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    s.vx += fx * a;
    s.vy += fy * a;
    t.vx -= fx * a * 0.35; // hubs are "heavier"
    t.vy -= fy * a * 0.35;
  }
  // Integrate + damp.
  for (const n of nodes) {
    if (graph.drag && n === graph.drag.node) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= 0.82;
    n.vy *= 0.82;
    n.x += n.vx;
    n.y += n.vy;
  }

  graph.alpha += (0 - graph.alpha) * 0.022;
  if (graph.alpha < 0.003) graph.alpha = 0;
  for (const n of nodes) {
    graph.cache.set(n.kind === "tag" ? `t:${n.tag}` : `c:${n.id}`, { x: n.x, y: n.y });
  }

  graphDraw();
  if (graph.alpha > 0.003 || graph.drag) graph.raf = requestAnimationFrame(graphTick);
  else graph.running = false;
}

function graphDraw() {
  const canvas = els.graphCanvas;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = els.graph.clientWidth || 1;
  const H = els.graph.clientHeight || 1;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const k = graph.t.k;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.translate(graph.t.x, graph.t.y);
  ctx.scale(k, k);

  const nodes = graph.nodes;
  const focus = graph.focus;
  const hover = graph.hover;

  // Edges (under nodes).
  ctx.lineCap = "round";
  for (const e of graph.edges) {
    const s = nodes[e.a];
    const t = nodes[e.b];
    const active = !focus || e.tag === focus;
    const hot = hover && (hover === s || hover === t);
    ctx.globalAlpha = active ? (focus ? 0.55 : hot ? 0.7 : 0.28) : 0.05;
    ctx.lineWidth = (active && (hot || focus) ? 1.8 : 1) / k;
    ctx.strokeStyle = t.color;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Nodes.
  for (const n of nodes) {
    const inFocus = !focus || (n.kind === "tag" ? n.tag === focus : n.tags.includes(focus));
    ctx.globalAlpha = inFocus ? 1 : 0.15;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = n.color;
    ctx.fill();
    ctx.lineWidth = 1.5 / k;
    ctx.strokeStyle = "rgba(8,12,18,0.55)";
    ctx.stroke();
    if (n === hover || (n.kind === "tag" && n.tag === focus)) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 4 / k, 0, Math.PI * 2);
      ctx.lineWidth = 2 / k;
      ctx.strokeStyle = n.kind === "tag" ? n.color : "#ffffff";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Tag labels + counts (constant screen size).
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const n of nodes) {
    if (n.kind !== "tag") continue;
    const inFocus = !focus || n.tag === focus;
    ctx.globalAlpha = inFocus ? 1 : 0.15;
    const fsName = 12.5 / k;
    const fsCount = 10 / k;
    const nameY = n.y - n.r - 6 / k;
    ctx.font = `${fsCount}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(141,151,168,1)";
    ctx.fillText(String(n.count), n.x, nameY - fsName - 2 / k);
    ctx.font = `600 ${fsName}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "#e8ecf3";
    ctx.fillText(n.tag, n.x, nameY);
    ctx.globalAlpha = 1;
  }
}

function graphStart() {
  if (graph.running) return;
  graph.running = true;
  graph.raf = requestAnimationFrame(graphTick);
}

function graphStop() {
  graph.running = false;
  if (graph.raf) cancelAnimationFrame(graph.raf);
  graph.raf = 0;
}

function renderGraph() {
  const captures = state.active;
  const tagSet = new Set(captures.flatMap((c) => c.tags));
  els.graphStats.textContent = `${captures.length} capture${captures.length === 1 ? "" : "s"} · ${tagSet.size} tag${tagSet.size === 1 ? "" : "s"}`;
  const empty = captures.length === 0;
  els.graphEmpty.classList.toggle("hidden", !empty);
  els.graphCanvas.style.display = empty ? "none" : "block";
  if (empty) {
    els.graphEmpty.innerHTML = state.q
      ? `<h3>No matches</h3><p>Nothing found for “${esc(state.q)}”.</p>`
      : `<h3>Nothing to graph yet</h3><p>Captures appear here as they connect through shared tags.</p>`;
    graph.nodes = [];
    graph.edges = [];
    graphStop();
    hideTooltip();
    return;
  }
  buildGraph();
  graphStart();
}

function toWorld(clientX, clientY) {
  const rect = els.graphCanvas.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return { x: (sx - graph.t.x) / graph.t.k, y: (sy - graph.t.y) / graph.t.k, sx, sy };
}

function nodeAt(wx, wy) {
  const nodes = graph.nodes;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = wx - n.x;
    const dy = wy - n.y;
    const r = n.r + 3 / graph.t.k;
    if (dx * dx + dy * dy <= r * r) return n;
  }
  return null;
}

function updateTooltip(clientX, clientY, n) {
  const tt = els.graphTooltip;
  if (!n) {
    hideTooltip();
    return;
  }
  const rect = els.graph.getBoundingClientRect();
  if (n.kind === "capture") {
    const preview = n.content.length > 160 ? `${n.content.slice(0, 160)}…` : n.content;
    tt.innerHTML =
      `<p class="tt-title" style="white-space:pre-wrap">${esc(preview)}</p>` +
      `<p class="tt-sub">#${n.id} · ${relTime(n.created_at)}</p>` +
      `<div class="tt-tags">${n.tags.map(tagChip).join("")}</div>`;
  } else {
    tt.innerHTML =
      `<p class="tt-title">${esc(n.tag)}</p>` +
      `<p class="tt-sub">${n.count} capture${n.count === 1 ? "" : "s"} · click to focus</p>`;
  }
  tt.classList.remove("hidden");
  let x = clientX - rect.left + 14;
  let y = clientY - rect.top + 14;
  const tw = tt.offsetWidth;
  const th = tt.offsetHeight;
  if (x + tw > rect.width - 8) x = clientX - rect.left - tw - 14;
  if (y + th > rect.height - 8) y = clientY - rect.top - th - 14;
  tt.style.left = `${Math.max(8, x)}px`;
  tt.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  els.graphTooltip.classList.add("hidden");
}

els.graphCanvas.addEventListener("pointerdown", (e) => {
  if (els.graphEmpty && !els.graphEmpty.classList.contains("hidden")) return;
  const p = toWorld(e.clientX, e.clientY);
  const n = nodeAt(p.x, p.y);
  graph.moved = false;
  graph.down = { sx: e.clientX, sy: e.clientY };
  if (n) {
    graph.drag = { node: n, ox: n.x - p.x, oy: n.y - p.y };
    graph.alpha = Math.max(graph.alpha, 0.4);
    graphStart();
  } else {
    graph.pan = { sx: e.clientX, sy: e.clientY, ox: graph.t.x, oy: graph.t.y };
  }
  els.graphCanvas.classList.add("grabbing");
  try {
    els.graphCanvas.setPointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
  e.preventDefault();
});

els.graphCanvas.addEventListener("pointermove", (e) => {
  if (graph.drag) {
    const p = toWorld(e.clientX, e.clientY);
    graph.drag.node.x = p.x + graph.drag.ox;
    graph.drag.node.y = p.y + graph.drag.oy;
    graph.drag.node.vx = 0;
    graph.drag.node.vy = 0;
    graph.alpha = Math.max(graph.alpha, 0.3);
    graph.moved = true;
    graphStart();
    return;
  }
  if (graph.pan) {
    graph.t.x = graph.pan.ox + (e.clientX - graph.pan.sx);
    graph.t.y = graph.pan.oy + (e.clientY - graph.pan.sy);
    if (
      Math.abs(e.clientX - graph.pan.sx) > 3 ||
      Math.abs(e.clientY - graph.pan.sy) > 3
    )
      graph.moved = true;
    if (!graph.running) graphDraw();
    return;
  }
  const p = toWorld(e.clientX, e.clientY);
  const n = nodeAt(p.x, p.y);
  if (n !== graph.hover) {
    graph.hover = n;
    els.graphCanvas.classList.toggle("node-hover", !!n);
    updateTooltip(e.clientX, e.clientY, n);
    if (!graph.running) graphDraw();
  } else if (n) {
    updateTooltip(e.clientX, e.clientY, n);
  }
});

els.graphCanvas.addEventListener("pointerup", (e) => {
  const moved = graph.moved;
  const dragNode = graph.drag ? graph.drag.node : null;
  graph.drag = null;
  graph.pan = null;
  els.graphCanvas.classList.remove("grabbing");
  try {
    els.graphCanvas.releasePointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
  if (!moved && graph.down) {
    const p = toWorld(e.clientX, e.clientY);
    const n = nodeAt(p.x, p.y);
    if (n && n.kind === "capture") {
      const capture = state.active.find((c) => c.id === n.id);
      if (capture) openOverlay("edit", capture);
    } else if (n && n.kind === "tag") {
      graph.focus = graph.focus === n.tag ? null : n.tag;
      if (!graph.running) graphDraw();
    } else {
      graph.focus = null;
      if (!graph.running) graphDraw();
    }
  }
  graph.down = null;
  void dragNode;
});

els.graphCanvas.addEventListener("pointerleave", () => {
  if (graph.hover) {
    graph.hover = null;
    hideTooltip();
    els.graphCanvas.classList.remove("node-hover");
    if (!graph.running) graphDraw();
  }
});

els.graphCanvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = els.graphCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const k0 = graph.t.k;
    const k1 = Math.min(4, Math.max(0.3, k0 * Math.exp(-e.deltaY * 0.0015)));
    graph.t.x = sx - ((sx - graph.t.x) / k0) * k1;
    graph.t.y = sy - ((sy - graph.t.y) / k0) * k1;
    graph.t.k = k1;
    graphDraw();
  },
  { passive: false },
);

window.addEventListener("resize", () => {
  if (!graphVisible() || !graph.nodes.length) return;
  graph.alpha = Math.max(graph.alpha, 0.25);
  graphStart();
});

/* ---------- init ---------- */

setView(state.view);
refresh().catch((err) => toast(err.message, { isError: true }));
