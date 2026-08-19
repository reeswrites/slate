const $ = (s) => document.querySelector(s);
let state = null;
let filter = "";

async function api(body) {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error ?? "something went wrong");
  state = data;
  if (data.message) toast(data.message);
  render();
}

async function refresh() {
  state = await (await fetch("/api/state")).json();
  render();
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 1800);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.onclick = onClick;
  return b;
}

// --- today -------------------------------------------------------------

function renderDue() {
  const box = $("#due-list");
  box.replaceChildren();
  const day = state.window.find((d) => d.isToday);
  const todos = day ? day.todos : [];

  if (!todos.length) {
    box.append(
      el("p", "empty", "Nothing owed today. Pick something off the shelf if you feel like it."),
    );
    return;
  }

  for (const t of todos) {
    const card = el("div", "card");
    const body = el("div", "body");
    body.append(el("div", "label", t.label));
    const paced = state.paced.find((p) => p.id === t.commitmentId);
    if (paced && paced.kind === "series") {
      body.append(
        el(
          "div",
          "meta",
          `${Math.round(paced.fraction * 100)}% · ${paced.rate} ${paced.unit}/session · finishing ~${paced.projectedEnd ?? "—"}`,
        ),
      );
    }
    const acts = el("div", "acts");
    acts.append(
      button("Done", "primary", () => api({ action: "done", ref: t.commitmentId })),
      button("Not tonight", "", () => deferWithReason(t.commitmentId)),
    );
    card.append(body, acts);
    box.append(card);
  }
}

function deferWithReason(ref) {
  const reason = prompt("Push it. Why not tonight? (optional — this is the signal that compounds)");
  if (reason === null) return;
  api({ action: "defer", ref, days: 1, reason: reason.trim() });
}

// --- week --------------------------------------------------------------

function renderWeek() {
  const box = $("#week");
  box.replaceChildren();
  for (const d of state.window) {
    const day = el("div", `day${d.isToday ? " today" : ""}`);
    day.append(el("h3", null, `${d.day} ${d.date.slice(8)}`));
    for (const t of d.todos) {
      // Series labels carry their own " — Title"; point labels already name the thing.
      const text = t.kind === "series" ? `${t.label.replace(/ — .*$/, "")}\n${t.title}` : t.label;
      day.append(el("div", `chip${t.due ? " due" : ""}`, text));
    }
    box.append(day);
  }
}

// --- in progress -------------------------------------------------------

function renderPaced() {
  const box = $("#paced");
  box.replaceChildren();
  if (!state.paced.length) {
    box.append(el("p", "empty", "Nothing paced yet."));
    return;
  }
  for (const p of state.paced) {
    const card = el("div", "card");
    const body = el("div", "body");
    body.append(el("div", "label", p.title));
    if (p.kind === "series") {
      const late = p.projectedEnd && p.projectedEnd > p.plannedEnd;
      body.append(
        el(
          "div",
          "meta",
          `${p.progress}/${p.total} ${p.unit} · ${p.rate}/session · ${p.days} · ` +
            (late ? `now finishing ~${p.projectedEnd}` : `finishing ~${p.projectedEnd}`) +
            (p.hardDeadline ? " · hard deadline" : ""),
        ),
      );
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.width = `${Math.min(100, p.fraction * 100)}%`;
      bar.append(fill);
      body.append(bar);
    } else {
      body.append(el("div", "meta", `one sitting · ${p.plannedFor}`));
    }

    const acts = el("div", "acts");
    if (p.kind === "series") {
      acts.append(
        button("Where am I?", "", () => {
          const v = prompt(`Where are you actually? (${p.unit})`, p.progress);
          if (v === null) return;
          api({ action: "resync", ref: p.id, progress: Number(v) });
        }),
      );
    }
    acts.append(button("Shelve", "ghost", () => api({ action: "shelve", ref: p.id })));
    card.append(body, acts);
    box.append(card);
  }
}

// --- shelf -------------------------------------------------------------

function renderShelf() {
  const box = $("#shelf");
  box.replaceChildren();
  const items = state.shelf.filter((i) =>
    !filter ? true : `${i.title} ${i.creator ?? ""} ${i.format}`.toLowerCase().includes(filter),
  );
  $("#shelf-count").textContent = items.length ? `(${items.length})` : "";

  if (!items.length) {
    box.append(el("p", "empty", "Empty. Paste a list below."));
    return;
  }

  for (const i of items) {
    const tile = el("div", "tile");
    const t = el("div", "t");
    t.append(el("div", "name", i.title));
    const bits = [i.format];
    if (i.creator) bits.push(i.creator);
    if (i.minutes) bits.push(`${i.minutes} min`);
    if (i.deferred) bits.push(`pushed ${i.deferred}×`);
    if (i.prior === "expired") bits.push("drifted");
    if (i.prior === "done") bits.push("done");
    t.append(el("div", "meta", bits.join(" · ")));
    tile.append(t, button("Pace", "", () => openPace(i)));
    box.append(tile);
  }
}

// --- pace dialog -------------------------------------------------------

const dialog = $("#pace-dialog");
const form = $("#pace-form");
let paceItem = null;
let paceMode = "habit";

function setMode(mode) {
  paceMode = mode;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("on", tab.dataset.mode === mode);
  }
  for (const n of document.querySelectorAll(".habit-only")) n.classList.toggle("hidden", mode !== "habit");
  for (const n of document.querySelectorAll(".deadline-only"))
    n.classList.toggle("hidden", mode !== "deadline");
  const seriesOnly = mode !== "point";
  form.total.closest(".field").classList.toggle("hidden", !seriesOnly);
  form.days.closest(".field").classList.toggle("hidden", !seriesOnly);
  form.chapters.closest(".field").classList.toggle("hidden", !seriesOnly);
  form.at.closest(".field").classList.toggle("hidden", !seriesOnly);
}

function openPace(item) {
  paceItem = item;
  $("#pace-title").textContent = item.title;
  form.reset();
  form.days.value = "daily";
  setMode(item.format === "book" || item.format === "tv" || item.format === "course" ? "habit" : "point");
  dialog.showModal();
}

for (const tab of document.querySelectorAll(".tab")) tab.onclick = () => setMode(tab.dataset.mode);
$("#pace-cancel").onclick = () => dialog.close();
$("#pace-go").onclick = () => {
  const body = { action: "pace", ref: paceItem.id };
  if (paceMode === "point") {
    body.kind = "point";
  } else {
    body.kind = "series";
    body.total = form.total.value || undefined;
    body.days = form.days.value || "daily";
    body.chapters = form.chapters.value || undefined;
    body.at = form.at.value || undefined;
    if (paceMode === "habit") body.rate = form.rate.value || undefined;
    else {
      body.endDate = form.endDate.value || undefined;
      body.hardDeadline = form.hardDeadline.checked;
    }
  }
  dialog.close();
  api(body);
};

// --- add ---------------------------------------------------------------

$("#paste-btn").onclick = () => {
  const text = $("#paste").value.trim();
  if (!text) return;
  $("#paste").value = "";
  api({ action: "import", text });
};

$("#filter").oninput = (e) => {
  filter = e.target.value.trim().toLowerCase();
  renderShelf();
};

function render() {
  renderDue();
  renderWeek();
  renderPaced();
  renderShelf();
}

refresh();
