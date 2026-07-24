/* Jannah Daily Stories — client-side archive renderer.
 * Data (manifest.json + lesson markdown) is synced into this public site from the
 * private vault by scripts/sync_lessons.py. This script fetches it same-origin and
 * renders it: index list, and per-lesson language toggle + TOC + collapsible sections
 * + Report Error. Markdown is rendered with `marked` (loaded via CDN in the HTML).
 */

const LANGS = ["ar", "en", "ur", "fr", "es"];
const LANG_LABEL = { ar: "العربية", en: "English", ur: "اردو", fr: "Français", es: "Español" };
const RTL = new Set(["ar", "ur"]);
const REPORT_TO = "fusha.adventures@gmail.com";

const UI = {
  en: { dir: "ltr", contents: "Contents", report: "Report an error", report_body: "Please describe the error:", review: "This lesson is under review and may be corrected.", missing: "Lesson not found." },
  ar: { dir: "rtl", contents: "المحتويات", report: "الإبلاغ عن خطأ", report_body: "يُرجى وصف الخطأ:", review: "هذا الدرس قيد المراجعة وقد يُصحَّح.", missing: "الدرس غير موجود." },
  ur: { dir: "rtl", contents: "فہرست", report: "غلطی کی اطلاع دیں", report_body: "براہِ کرم غلطی بیان کریں:", review: "یہ سبق زیرِ نظرثانی ہے اور اس میں تصحیح ہو سکتی ہے۔", missing: "سبق نہیں ملا۔" },
  fr: { dir: "ltr", contents: "Sommaire", report: "Signaler une erreur", report_body: "Veuillez décrire l’erreur :", review: "Cette leçon est en cours de révision et pourra être corrigée.", missing: "Leçon introuvable." },
  es: { dir: "ltr", contents: "Contenido", report: "Informar de un error", report_body: "Describa el error, por favor:", review: "Esta lección está en revisión y puede ser corregida.", missing: "Lección no encontrada." },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- markdown helpers -----------------------------------------------------

function stripFrontmatter(md) {
  const m = md.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  return m ? md.slice(m[0].length) : md;
}

/** Split a lesson body into sections keyed by its `## ` headings.
 * The leading `# Title` line is dropped (the page shows the title itself).
 * Any text before the first `##` is kept as an untitled preface section. */
function splitSections(body) {
  body = body.replace(/^#\s+.*\n/, ""); // drop the H1 title line
  const lines = body.split("\n");
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      cur = { heading: h[1].trim(), md: "" };
      sections.push(cur);
    } else {
      if (!cur) { cur = { heading: "", md: "" }; sections.push(cur); }
      cur.md += line + "\n";
    }
  }
  return sections.filter((s) => s.heading || s.md.trim());
}

// ---- index page -----------------------------------------------------------

async function renderIndex(mount) {
  let manifest;
  try {
    const res = await fetch("lessons/manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("manifest " + res.status);
    manifest = await res.json();
  } catch (e) {
    mount.innerHTML = '<p class="status-msg">Could not load lessons. Please try again later.</p>';
    return;
  }
  const items = (manifest.lessons || []).map((L) => {
    const tEn = L.titles.en || L.titles[L.langs[0]] || L.slug;
    const tAr = L.titles.ar || "";
    const rev = L.under_review ? ' <span class="rev">under review</span>' : "";
    const num = String(L.order).padStart(3, "0");
    return `<li><a href="lesson.html?slug=${encodeURIComponent(L.slug)}">` +
      `<span class="d">${esc(num)}</span>` +
      `<span class="t">${esc(tEn)}</span>` +
      `<span class="ta" dir="rtl">${esc(tAr)}</span></a>${rev}</li>`;
  });
  mount.innerHTML = items.length
    ? `<ul class="lessons">${items.join("")}</ul>`
    : '<p class="status-msg">No lessons published yet.</p>';
}

// ---- lesson page ----------------------------------------------------------

function qs(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

async function renderLesson(root) {
  const slug = qs("slug");
  const titleEl = document.getElementById("lesson-title");
  const toggleEl = document.getElementById("langtoggle");
  const blocksEl = document.getElementById("blocks");
  const reportEl = document.getElementById("reportlink");

  if (!slug) { blocksEl.innerHTML = '<p class="status-msg">No lesson specified.</p>'; return; }

  // Read the manifest entry (titles, langs, under_review). Fall back to probing files.
  let entry = null;
  try {
    const res = await fetch("lessons/manifest.json", { cache: "no-cache" });
    if (res.ok) {
      const manifest = await res.json();
      entry = (manifest.lessons || []).find((L) => L.slug === slug) || null;
    }
  } catch (_) { /* fall through to probe */ }

  const langs = entry ? entry.langs.slice() : LANGS.slice();
  const titles = entry ? entry.titles : {};
  const underReview = entry ? entry.under_review : false;

  // Fetch each language's markdown (only those that exist).
  const fetched = {};
  await Promise.all(langs.map(async (l) => {
    try {
      const r = await fetch(`lessons/${encodeURIComponent(slug)}/${l}.md`, { cache: "no-cache" });
      if (r.ok) fetched[l] = await r.text();
    } catch (_) { /* skip */ }
  }));

  const present = LANGS.filter((l) => fetched[l]);
  if (present.length === 0) {
    blocksEl.innerHTML = '<p class="status-msg">Lesson not found.</p>';
    return;
  }
  const dflt = present.includes("en") ? "en" : present[0];

  // Title (page + <title>), from manifest with markdown fallback.
  const pageTitle = titles[dflt] || titles.en || slug;
  titleEl.textContent = pageTitle;
  document.title = pageTitle + " — Jannah Daily Stories";

  // Language toggle
  toggleEl.innerHTML = present.map((l) =>
    `<button class="langbtn${l === dflt ? " active" : ""}" data-showlang="${l}">${LANG_LABEL[l]}</button>`
  ).join("");

  // Language blocks: TOC + collapsible sections
  blocksEl.innerHTML = present.map((l) => {
    const ui = UI[l];
    const sections = splitSections(stripFrontmatter(fetched[l]));
    const toc = sections.map((s, i) =>
      `<li><a href="#${l}-${i}">${esc(s.heading || ui.contents)}</a></li>`).join("");
    const secs = sections.map((s, i) =>
      `<details class="sec" id="${l}-${i}"><summary>${esc(s.heading || ui.contents)}</summary>` +
      `<div class="secbody">${marked.parse(s.md)}</div></details>`).join("");
    const banner = underReview ? `<div class="banner">⚠ ${esc(ui.review)}</div>` : "";
    return `<div class="lang-block" data-lang="${l}" dir="${ui.dir}" hidden>${banner}` +
      `<nav class="toc" aria-label="${esc(ui.contents)}"><p class="toctitle">${esc(ui.contents)}</p><ul>${toc}</ul></nav>` +
      `${secs}</div>`;
  }).join("");

  const reportTitles = {}; present.forEach((l) => { reportTitles[l] = titles[l] || pageTitle; });

  function setReport(l) {
    const ui = UI[l];
    const subj = encodeURIComponent(reportTitles[l] || pageTitle);
    const body = encodeURIComponent((ui.report_body || "") + "\n\n" + location.href);
    reportEl.href = `mailto:${REPORT_TO}?subject=${subj}&body=${body}`;
    reportEl.textContent = ui.report;
  }
  function showLang(l) {
    blocksEl.querySelectorAll(".lang-block").forEach((b) => { b.hidden = b.dataset.lang !== l; });
    toggleEl.querySelectorAll(".langbtn").forEach((x) => x.classList.toggle("active", x.dataset.showlang === l));
    setReport(l);
  }
  toggleEl.querySelectorAll(".langbtn").forEach((b) => b.onclick = () => showLang(b.dataset.showlang));
  blocksEl.querySelectorAll(".toc a").forEach((a) => a.addEventListener("click", function () {
    const el = document.getElementById(this.getAttribute("href").slice(1));
    if (el) el.open = true;
  }));
  showLang(dflt);
}

// ---- bootstrap ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const list = document.getElementById("lesson-list");
  if (list) { renderIndex(list); return; }
  const lesson = document.getElementById("lesson");
  if (lesson) { renderLesson(lesson); }
});
