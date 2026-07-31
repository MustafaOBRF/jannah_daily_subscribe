/* Admin dashboard (public-site/admin.html).
 *
 * All data comes from the admin-report Edge Function, which verifies the caller's
 * JWT and checks it against an allowlist before reading anything. This file holds
 * NO privileged key and makes no direct table queries -- a non-admin loading this
 * page simply receives 403 and nothing to render.
 *
 * Requires assets/config.js, the supabase-js UMD bundle, and assets/auth.js
 * (for window.sb, requireSession and renderAuthBar). It deliberately does NOT
 * load app.js: that file's bootstrap dispatches on #lesson-list / #lesson and
 * would do nothing here, so the few helpers needed are small and local.
 */

const TABS = [
  { key: "members",     label: "Members" },
  { key: "lessons",     label: "Lessons" },
  { key: "logins",      label: "Logins" },
  { key: "subscribers", label: "Subscribers" },
];

let DATA = null;          // the whole payload from the function
let activeTab = "members";
let sortKey = null;
let sortDir = 1;          // 1 asc, -1 desc
let lessonTotal = 0;      // total published lessons, from the manifest

// ---- helpers ---------------------------------------------------------------

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** "2h ago" / "3d ago" / "never" — compact enough for a table cell. */
function ago(iso) {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const d = Math.floor(hr / 24);
  if (d < 30) return d + "d ago";
  const mo = Math.floor(d / 30);
  return mo < 12 ? mo + "mo ago" : Math.floor(mo / 12) + "y ago";
}

function date(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "—" : d.toISOString().slice(0, 10);
}

function bar(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `<span class="minibar" title="${pct}%"><span style="width:${pct}%"></span></span>`;
}

/** Truncate a user agent to something readable in a cell. */
function shortUA(ua) {
  if (!ua) return "—";
  const m = ua.match(/(Chrome|Firefox|Safari|Edg|Mobile|Android|iPhone|iPad|curl|Postman)/g);
  return m ? [...new Set(m)].join(" / ") : ua.slice(0, 28);
}

// ---- column definitions ----------------------------------------------------
// `get` pulls the sort/filter value; `cell` renders. Keeping them separate means
// sorting works on the raw value (a timestamp) while the cell shows "2h ago".

const COLUMNS = {
  members: [
    { key: "email",           label: "Email",     get: r => r.email || "",
      cell: r => `${esc(r.email)}${r.never_signed_in ? ' <span class="warn" title="Invited but never signed in">not activated</span>' : ""}` },
    { key: "lessons_done",    label: "Progress",  get: r => Number(r.lessons_done || 0), num: true,
      cell: r => `<span class="nums">${Number(r.lessons_done || 0)}${lessonTotal ? "/" + lessonTotal : ""}</span> ${bar(Number(r.lessons_done || 0), lessonTotal)}` },
    { key: "last_activity",   label: "Last read", get: r => Date.parse(r.last_activity || 0) || 0, num: true,
      cell: r => `<span class="nums">${ago(r.last_activity)}</span>` },
    { key: "last_sign_in_at", label: "Last login", get: r => Date.parse(r.last_sign_in_at || 0) || 0, num: true,
      cell: r => `<span class="nums">${ago(r.last_sign_in_at)}</span>` },
    { key: "created_at",      label: "Joined",    get: r => Date.parse(r.created_at || 0) || 0, num: true,
      cell: r => `<span class="nums">${date(r.created_at)}</span>` },
    { key: "active",          label: "Member",    get: r => (r.active === true ? 1 : r.active === false ? 0 : -1), num: true,
      cell: r => r.active === true ? "yes"
               : r.active === false ? '<span class="warn">inactive</span>'
               : '<span class="warn" title="Auth account with no members row">no record</span>' },
    { key: "source",          label: "Source",    get: r => r.source || "",
      cell: r => esc(r.source || "—") },
  ],
  lessons: [
    { key: "slug",              label: "Lesson",    get: r => r.slug || "",
      cell: r => esc(r.slug) },
    { key: "completions",       label: "Completed", get: r => Number(r.completions || 0), num: true,
      cell: r => `<span class="nums">${Number(r.completions || 0)}</span> ${bar(Number(r.completions || 0), DATA?.totals?.members || 0)}` },
    { key: "distinct_members",  label: "Members",   get: r => Number(r.distinct_members || 0), num: true,
      cell: r => `<span class="nums">${Number(r.distinct_members || 0)}</span>` },
    { key: "last_completed_at", label: "Last",      get: r => Date.parse(r.last_completed_at || 0) || 0, num: true,
      cell: r => `<span class="nums">${ago(r.last_completed_at)}</span>` },
  ],
  logins: [
    { key: "created_at", label: "When",   get: r => Date.parse(r.created_at || 0) || 0, num: true,
      cell: r => `<span class="nums" title="${esc(r.created_at)}">${ago(r.created_at)}</span>` },
    { key: "email",      label: "Account", get: r => r.email || "",
      cell: r => esc(r.email || "—") },
    { key: "action",     label: "Event",  get: r => r.action || "",
      cell: r => esc(r.action || "—") },
    { key: "ip",         label: "IP",     get: r => r.ip || "",
      cell: r => `<span class="nums">${esc(r.ip || "—")}</span>` },
    { key: "country",    label: "Country", get: r => r.country || "",
      cell: r => esc(r.country || "—") },
    { key: "user_agent", label: "Device", get: r => r.user_agent || "",
      cell: r => `<span title="${esc(r.user_agent)}">${esc(shortUA(r.user_agent))}</span>` },
  ],
  subscribers: [
    { key: "email",      label: "Email",     get: r => r.email || "",
      cell: r => esc(r.email) },
    { key: "name",       label: "Name",      get: r => r.name || "",
      cell: r => esc(r.name || "—") },
    { key: "lang",       label: "Languages", get: r => (r.lang || []).join(","),
      cell: r => esc((r.lang || []).join(", ") || "—") },
    { key: "subscribed", label: "Status",    get: r => (r.subscribed ? 1 : 0), num: true,
      cell: r => r.subscribed ? "subscribed" : '<span class="warn">unsubscribed</span>' },
    { key: "created_at", label: "Joined",    get: r => Date.parse(r.created_at || 0) || 0, num: true,
      cell: r => `<span class="nums">${date(r.created_at)}</span>` },
  ],
};

// ---- rendering -------------------------------------------------------------

function renderStats() {
  const t = DATA.totals || {};
  const tiles = [
    ["Members", t.members],
    ["Active", t.active],
    ["Avg read", lessonTotal ? `${t.avg_lessons_done} / ${lessonTotal}` : t.avg_lessons_done],
    ["Login 7d", t.signed_in_this_week],
    ["Not activated", t.never_signed_in],
    ["Subscribers", `${t.subscribers_active} / ${t.subscribers}`],
  ];
  document.getElementById("stats").innerHTML = tiles.map(([label, v]) =>
    `<div class="stat"><span class="statv">${esc(v ?? "—")}</span>` +
    `<span class="statl">${esc(label)}</span></div>`).join("");
}

function renderTabs() {
  const el = document.getElementById("tabs");
  el.innerHTML = TABS.map((t) => {
    const n = (DATA[t.key] || []).length;
    return `<button class="langbtn${t.key === activeTab ? " active" : ""}" data-tab="${t.key}">` +
           `${t.label} <span class="tabn">${n}</span></button>`;
  }).join("");
  el.querySelectorAll(".langbtn").forEach((b) => b.onclick = () => {
    activeTab = b.dataset.tab;
    sortKey = null;          // each tab starts in its natural order
    renderTabs();
    renderTable();
  });
}

function renderTable() {
  const cols = COLUMNS[activeTab];
  const q = (document.getElementById("filter").value || "").trim().toLowerCase();
  let rows = (DATA[activeTab] || []).slice();

  if (q) {
    rows = rows.filter((r) => cols.some((c) => String(c.get(r)).toLowerCase().includes(q)));
  }
  if (sortKey) {
    const col = cols.find((c) => c.key === sortKey);
    if (col) {
      rows.sort((a, b) => {
        const x = col.get(a), y = col.get(b);
        if (col.num) return (Number(x) - Number(y)) * sortDir;
        return String(x).localeCompare(String(y)) * sortDir;
      });
    }
  }

  const head = cols.map((c) =>
    `<th data-sort="${c.key}" class="${sortKey === c.key ? "sorted" : ""}">${esc(c.label)}` +
    `${sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}</th>`).join("");
  // An empty Logins tab is usually configuration, not absence of activity:
  // auth.audit_log_entries only fills after events occur, and a project can be
  // set to stop writing it to Postgres entirely. Say so instead of "No rows".
  const emptyMsg = q
    ? "No rows match that filter."
    : activeTab === "logins"
      ? "No login events recorded yet. Supabase writes these to " +
        "auth.audit_log_entries as members sign in. If it stays empty after real " +
        "logins, check Authentication → Configuration → Audit Logs for " +
        "&ldquo;Disable writing auth audit logs to project database&rdquo;."
      : "No rows.";
  const body = rows.length
    ? rows.map((r) => `<tr>${cols.map((c) => `<td>${c.cell(r)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${cols.length}" class="status-msg">${emptyMsg}</td></tr>`;

  const el = document.getElementById("table");
  el.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  el.querySelectorAll("th[data-sort]").forEach((th) => th.onclick = () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
    renderTable();
  });

  const err = DATA.errors
    ? ` — could not load: ${esc(Object.keys(DATA.errors).join(", "))}`
    : "";
  document.getElementById("meta").innerHTML =
    `${rows.length} row(s) shown · generated ${esc(date(DATA.generated_at))} ` +
    `${esc(ago(DATA.generated_at))} · signed in as ${esc(DATA.as || "")}${err}`;
}

function showStatus(html) {
  document.getElementById("admin-status").innerHTML = html;
  document.getElementById("admin-body").hidden = true;
}

// ---- bootstrap -------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  const session = typeof requireSession === "function" ? await requireSession() : null;
  if (!session) return;   // redirected to login

  // Total published lessons, for the "x / N" denominators. Non-fatal.
  try {
    const r = await fetch("lessons/manifest.json", { cache: "no-cache" });
    if (r.ok) lessonTotal = ((await r.json()).lessons || []).length;
  } catch (_) { /* denominators just omit the total */ }

  let res;
  try {
    res = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-report`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": window.SUPABASE_ANON_KEY,
        "content-type": "application/json",
      },
      body: "{}",
    });
  } catch (e) {
    showStatus('<p class="msg err">Could not reach the admin service. Check your connection.</p>');
    return;
  }

  if (res.status === 403) {
    showStatus('<p class="msg err">This account is not an administrator.</p>' +
               '<p class="status-msg">If that is unexpected, check the ADMIN_EMAILS ' +
               'function secret in Supabase. See docs/admin-dashboard.md.</p>');
    return;
  }
  if (!res.ok) {
    showStatus(`<p class="msg err">Admin service error (HTTP ${res.status}).</p>`);
    return;
  }

  try {
    DATA = await res.json();
  } catch (_) {
    showStatus('<p class="msg err">Admin service returned an unreadable response.</p>');
    return;
  }

  document.getElementById("admin-status").innerHTML = "";
  document.getElementById("admin-body").hidden = false;
  document.getElementById("filter").addEventListener("input", renderTable);
  renderStats();
  renderTabs();
  renderTable();
});
