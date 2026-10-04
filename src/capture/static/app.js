/* Capture web UI — vanilla JS, no build step. */
"use strict";

const $ = (sel) => document.querySelector(sel);

const els = {
  main: $("#main"),
  board: $("#board"),
  list: $("#list"),
  viewBoard: $("#view-board"),
  viewList: $("#view-list"),
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
  else renderList();
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
  els.viewBoard.classList.toggle("active", v === "board");
  els.viewList.classList.toggle("active", v === "list");
  if (changed) render();
}
els.viewBoard.addEventListener("click", () => setView("board"));
els.viewList.addEventListener("click", () => setView("list"));

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

/* ---------- init ---------- */

setView(state.view);
refresh().catch((err) => toast(err.message, { isError: true }));
