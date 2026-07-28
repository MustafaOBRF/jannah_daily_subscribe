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

// Site heading per language (shown one at a time on the index).
const SITE_TITLE = {
  ar: "يوميات مع الجنة",
  en: "Daily Journal with Jannah",
  ur: "جنت کے ساتھ روزنامچہ",
  fr: "Journal quotidien avec la Jannah",
  es: "Diario con Jannah",
};

// Shared language preference (index + lesson page), remembered across visits.
const LANG_KEY = "jds_lang";
function getLang() {
  try { const l = localStorage.getItem(LANG_KEY); if (l && LANGS.includes(l)) return l; } catch (_) {}
  return "en";
}
function setLang(l) { try { localStorage.setItem(LANG_KEY, l); } catch (_) {} }

const UI = {
  en: { dir: "ltr", contents: "Contents", report: "Report an error", report_body: "Please describe the error:", review: "This lesson is under review and may be corrected.", missing: "Lesson not found.", done: "Mark this lesson complete", undone: "✓ Completed — undo", done_short: "Lesson complete", save_failed: "Could not save — check your connection.", progress: (d, t) => `${d} of ${t} lessons complete` },
  ar: { dir: "rtl", contents: "المحتويات", report: "الإبلاغ عن خطأ", report_body: "يُرجى وصف الخطأ:", review: "هذا الدرس قيد المراجعة وقد يُصحَّح.", missing: "الدرس غير موجود.", done: "تم إكمال هذا الدرس", undone: "✓ مكتمل — إلغاء", done_short: "تم إكمال الدرس", save_failed: "تعذّر الحفظ. تحقّق من اتصالك.", progress: (d, t) => `أكملتَ ${d} من ${t}` },
  ur: { dir: "rtl", contents: "فہرست", report: "غلطی کی اطلاع دیں", report_body: "براہِ کرم غلطی بیان کریں:", review: "یہ سبق زیرِ نظرثانی ہے اور اس میں تصحیح ہو سکتی ہے۔", missing: "سبق نہیں ملا۔", done: "اس سبق کو مکمل نشان زد کریں", undone: "✓ مکمل — واپس لیں", done_short: "سبق مکمل", save_failed: "محفوظ نہیں ہو سکا۔ اپنا کنکشن دیکھیں۔", progress: (d, t) => `${t} میں سے ${d} اسباق مکمل` },
  fr: { dir: "ltr", contents: "Sommaire", report: "Signaler une erreur", report_body: "Veuillez décrire l’erreur :", review: "Cette leçon est en cours de révision et pourra être corrigée.", missing: "Leçon introuvable.", done: "Marquer cette leçon comme terminée", undone: "✓ Terminée — annuler", done_short: "Leçon terminée", save_failed: "Enregistrement impossible — vérifiez votre connexion.", progress: (d, t) => `${d} leçons terminées sur ${t}` },
  es: { dir: "ltr", contents: "Contenido", report: "Informar de un error", report_body: "Describa el error, por favor:", review: "Esta lección está en revisión y puede ser corregida.", missing: "Lección no encontrada.", done: "Marcar esta lección como completada", undone: "✓ Completada — deshacer", done_short: "Lección completada", save_failed: "No se pudo guardar — comprueba tu conexión.", progress: (d, t) => `${d} de ${t} lecciones completadas` },
};

// Digits per language. Arabic and Urdu read naturally in Arabic-Indic numerals.
const NUM_LOCALE = { ar: "ar-EG", ur: "ur-PK" };
function localeNum(n, lang) {
  try { return n.toLocaleString(NUM_LOCALE[lang] || "en-US"); } catch (_) { return String(n); }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- markdown helpers -----------------------------------------------------

function stripFrontmatter(md) {
  const m = md.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  return m ? md.slice(m[0].length) : md;
}

/** marked has no footnote support. Convert markdown footnotes so they render:
 *  inline  [^N]      -> superscript [N]
 *  def     [^N]: txt -> its own paragraph "**[N]** txt" (bare URLs autolink via gfm) */
function fixFootnotes(md) {
  md = md.replace(/\[\^([^\]]+)\](?!:)/g, '<sup class="fnref">[$1]</sup>');
  md = md.replace(/^[ \t]*\[\^([^\]]+)\]:[ \t]*(.*)$/gm, "\n\n**[$1]** $2\n");
  return md;
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

async function renderIndex(mount, session) {
  const userId = session?.user?.id || null;

  // Manifest and the user's completed set are independent -- fetch together so
  // the progress query costs no extra round-trip.
  const [manifest, doneSet] = await Promise.all([
    fetch("lessons/manifest.json", { cache: "no-cache" })
      .then((res) => { if (!res.ok) throw new Error("manifest " + res.status); return res.json(); })
      .catch(() => null),
    userId && typeof loadProgress === "function" ? loadProgress() : Promise.resolve(new Set()),
  ]);

  if (!manifest) {
    mount.innerHTML = '<p class="status-msg">Could not load lessons. Please try again later.</p>';
    return;
  }

  const lessons = (manifest.lessons || []).slice().sort((a, b) => a.order - b.order);
  const titleEl = document.getElementById("sitetitle");
  const toggleEl = document.getElementById("langtoggle");
  const summaryEl = document.getElementById("progress-summary");
  const errEl = document.getElementById("progress-err");

  // Completion is tracked only for signed-in members with progress.js loaded.
  const tracking = !!userId && typeof renderProgressSummary === "function";
  let done = lessons.filter((L) => doneSet.has(L.slug)).length;

  /** Paint the counter in `lang`. app.js owns the strings; progress.js just draws. */
  const paintSummary = (lang) => {
    const ui = UI[lang] || UI.en;
    renderProgressSummary(summaryEl, done, lessons.length,
      ui.progress(localeNum(done, lang), localeNum(lessons.length, lang)), ui.dir);
  };

  /** Title for a lesson in the chosen language, falling back sensibly. */
  const lessonTitle = (L, lang) =>
    (L.titles && (L.titles[lang] || L.titles.en || L.titles[L.langs && L.langs[0]])) || L.slug;

  function paint(lang) {
    setLang(lang);
    // Site heading in the selected language.
    if (titleEl) { titleEl.textContent = SITE_TITLE[lang] || SITE_TITLE.en; titleEl.dir = RTL.has(lang) ? "rtl" : "ltr"; }
    // Language toggle (all 5), active = current.
    if (toggleEl) {
      toggleEl.innerHTML = LANGS.map((l) =>
        `<button class="langbtn${l === lang ? " active" : ""}" data-showlang="${l}">${LANG_LABEL[l]}</button>`
      ).join("");
      toggleEl.querySelectorAll(".langbtn").forEach((b) => b.onclick = () => paint(b.dataset.showlang));
    }
    // Progress counter, in the selected language.
    if (tracking) paintSummary(lang);
    // Lesson list — single title line in the selected language.
    const dir = RTL.has(lang) ? "rtl" : "ltr";
    const items = lessons.map((L) => {
      const num = String(L.order).padStart(3, "0");
      const isDone = doneSet.has(L.slug);
      // The checkbox is a SIBLING of the link, not inside it -- nesting an input
      // in the <a> would navigate away on every tick.
      const box = tracking
        ? `<input type="checkbox" class="donebox" data-slug="${esc(L.slug)}"${isDone ? " checked" : ""}` +
          ` aria-label="${esc(UI[lang]?.done_short || UI.en.done_short)}">`
        : "";
      return `<li class="lrow${isDone ? " done" : ""}">${box}` +
        `<a href="lesson.html?slug=${encodeURIComponent(L.slug)}">` +
        `<span class="d">${esc(num)}</span>` +
        `<span class="titles"><span class="tline" dir="${dir}">${esc(lessonTitle(L, lang))}</span></span></a></li>`;
    });
    mount.innerHTML = items.length
      ? `<ul class="lessons">${items.join("")}</ul>`
      : '<p class="status-msg">No lessons published yet.</p>';

    // paint() rebuilds the list on every language switch, so the listener is
    // attached here rather than once outside -- the old <ul> is discarded.
    const list = mount.querySelector("ul.lessons");
    if (tracking && list) list.addEventListener("change", (e) => onToggle(e, lang));
  }

  async function onToggle(e, lang) {
    const box = e.target.closest(".donebox");
    if (!box) return;
    const slug = box.dataset.slug;
    const want = box.checked;

    // Optimistic: paint the new state now, revert if the write fails. A lost
    // reading checkbox is cheap; a spinner on every tap is not.
    doneSet[want ? "add" : "delete"](slug);   // keep in sync across language switches
    box.closest("li").classList.toggle("done", want);
    done += want ? 1 : -1;
    paintSummary(lang);

    box.disabled = true;
    const { error } = await setProgress(userId, slug, want);
    box.disabled = false;
    if (error) {
      doneSet[want ? "delete" : "add"](slug);
      box.checked = !want;
      box.closest("li").classList.toggle("done", !want);
      done += want ? -1 : 1;
      paintSummary(lang);
      progressError(errEl, UI[lang]?.save_failed || UI.en.save_failed);
    }
  }

  paint(getLang());
}

// ---- lesson page ----------------------------------------------------------

function qs(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

async function renderLesson(root, session) {
  const slug = qs("slug");
  const titleEl = document.getElementById("lesson-title");
  const toggleEl = document.getElementById("langtoggle");
  const blocksEl = document.getElementById("blocks");
  const reportEl = document.getElementById("reportlink");

  if (!slug) { blocksEl.innerHTML = '<p class="status-msg">No lesson specified.</p>'; return; }

  // Kick the progress query off now; it resolves while the markdown loads.
  const userId = session?.user?.id || null;
  const donePromise = userId && typeof loadProgress === "function"
    ? loadProgress() : Promise.resolve(new Set());

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
  // Default to the visitor's remembered language when this lesson has it.
  const pref = getLang();
  const dflt = present.includes(pref) ? pref : (present.includes("en") ? "en" : present[0]);

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
      `<div class="secbody">${marked.parse(fixFootnotes(s.md))}</div></details>`).join("");
    return `<div class="lang-block" data-lang="${l}" dir="${ui.dir}" hidden>` +
      `<nav class="toc" aria-label="${esc(ui.contents)}"><p class="toctitle">${esc(ui.contents)}</p><ul>${toc}</ul></nav>` +
      `${secs}</div>`;
  }).join("");

  const reportTitles = {}; present.forEach((l) => { reportTitles[l] = titles[l] || pageTitle; });

  // ---- "mark complete" toggle ---------------------------------------------
  // Writes the same (user_id, slug) row the index checkbox does, so marking
  // here and going back shows the row ticked with no extra sync.
  const doneMount = document.getElementById("lesson-done");
  const errEl = document.getElementById("progress-err");
  let isDone = (await donePromise).has(slug);
  let doneBtn = null;
  let currentLang = dflt;   // kept in sync by showLang(); labels follow it

  if (userId && doneMount && typeof setProgress === "function") {
    doneMount.innerHTML = '<button type="button" id="donebtn" class="donebtn"></button>';
    doneBtn = document.getElementById("donebtn");
    doneBtn.onclick = async () => {
      const want = !isDone;
      isDone = want;                       // optimistic, reverted below on error
      paintDone(currentLang);
      doneBtn.disabled = true;
      const { error } = await setProgress(userId, slug, want);
      doneBtn.disabled = false;
      if (error) {
        isDone = !want;
        paintDone(currentLang);
        progressError(errEl, UI[currentLang]?.save_failed || UI.en.save_failed);
      }
    };
  }

  function paintDone(l) {
    if (!doneBtn) return;
    const ui = UI[l] || UI.en;
    doneBtn.textContent = isDone ? ui.undone : ui.done;
    doneBtn.classList.toggle("is-done", isDone);
    doneBtn.setAttribute("aria-pressed", String(isDone));
  }

  function setReport(l) {
    const ui = UI[l];
    const subj = encodeURIComponent(reportTitles[l] || pageTitle);
    const body = encodeURIComponent((ui.report_body || "") + "\n\n" + location.href);
    // Open a Gmail compose window in the browser (new tab).
    reportEl.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(REPORT_TO)}&su=${subj}&body=${body}`;
    reportEl.target = "_blank";
    reportEl.rel = "noopener";
    reportEl.textContent = ui.report;
  }
  function showLang(l) {
    setLang(l);       // remember choice; syncs with the lessons list
    currentLang = l;  // the complete button reads this on save failure
    blocksEl.querySelectorAll(".lang-block").forEach((b) => { b.hidden = b.dataset.lang !== l; });
    toggleEl.querySelectorAll(".langbtn").forEach((x) => x.classList.toggle("active", x.dataset.showlang === l));
    titleEl.textContent = titles[l] || pageTitle;   // title follows the selected language
    titleEl.dir = RTL.has(l) ? "rtl" : "ltr";
    if (doneMount) doneMount.dir = RTL.has(l) ? "rtl" : "ltr";
    setReport(l);
    paintDone(l);   // the complete button follows the selected language too
  }
  toggleEl.querySelectorAll(".langbtn").forEach((b) => b.onclick = () => showLang(b.dataset.showlang));
  blocksEl.querySelectorAll(".toc a").forEach((a) => a.addEventListener("click", function () {
    const el = document.getElementById(this.getAttribute("href").slice(1));
    if (el) el.open = true;
  }));
  showLang(dflt);
}

// ---- bootstrap ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  // Members-only gate: if auth.js is present, require a session before rendering
  // (redirects to login.html when signed out and paints the account bar when in).
  // The session is threaded into the renderers so progress needs no second
  // getSession() call.
  let session = null;
  if (typeof requireSession === "function") {
    session = await requireSession();
    if (!session) return; // redirected to login
  }
  const list = document.getElementById("lesson-list");
  if (list) { renderIndex(list, session); return; }
  const lesson = document.getElementById("lesson");
  if (lesson) { renderLesson(lesson, session); }
});
