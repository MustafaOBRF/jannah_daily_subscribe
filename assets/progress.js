/* Per-user lesson completion (Supabase table `lesson_progress`).
 * Requires assets/config.js, the supabase-js UMD bundle, and assets/auth.js
 * (which creates window.sb) loaded first.
 *
 * Every read and write is scoped to the signed-in user by RLS -- see
 * supabase/migrations/0004_lesson_progress.sql. The client never filters by
 * user_id on SELECT; the policy does it. user_id is still sent on write
 * because the row needs an owner, and the policy's `with check` verifies it.
 */

/** Load the set of slugs this user has marked complete.
 *  Degrades to an empty set on error -- a DB hiccup should leave the archive
 *  readable with nothing ticked, not blank. */
async function loadProgress() {
  try {
    const { data, error } = await window.sb
      .from("lesson_progress")
      .select("slug, completed");
    if (error) throw error;
    return new Set((data || []).filter((r) => r.completed).map((r) => r.slug));
  } catch (e) {
    console.error("progress: load failed", e);
    return new Set();
  }
}

/** Mark a lesson complete / not complete. Returns { error } (null on success).
 *  `completed_at` is stamped only when marking done and is left untouched on
 *  un-mark, so the first-completion time survives. */
async function setProgress(userId, slug, completed) {
  const row = {
    user_id: userId,
    slug,
    completed,
    updated_at: new Date().toISOString(),
  };
  if (completed) row.completed_at = row.updated_at;
  const { error } = await window.sb
    .from("lesson_progress")
    .upsert(row, { onConflict: "user_id,slug" });
  if (error) console.error("progress: save failed", error);
  return { error: error || null };
}

/** Render the "X of Y complete" counter + bar into `mount`.
 *  `text` and `dir` are supplied by the caller (app.js owns the UI strings and
 *  the language toggle) so this file stays free of app.js globals -- it loads
 *  first, and reaching forward into them would be a load-order trap. */
function renderProgressSummary(mount, done, total, text, dir) {
  if (!mount) return;
  if (!total) { mount.innerHTML = ""; return; }
  const pct = Math.round((done / total) * 100);
  mount.innerHTML =
    `<p class="progress-line" dir="${dir || "ltr"}">${escapeText(text)}</p>` +
    `<div class="progressbar" role="progressbar" aria-valuenow="${done}" ` +
    `aria-valuemin="0" aria-valuemax="${total}"><span style="width:${pct}%"></span></div>`;
}

function escapeText(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Show a transient inline error (used when an optimistic write is reverted). */
function progressError(mount, text) {
  if (!mount) return;
  mount.textContent = text;
  mount.className = "progress-err show";
  setTimeout(() => { mount.className = "progress-err"; }, 4000);
}
