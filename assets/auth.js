/* Auth helpers for the members-only gate (Supabase Auth, email + password).
 * Requires assets/config.js and the supabase-js UMD bundle loaded first.
 * Accounts are invite-only (created by the ghl-member function on purchase); this
 * layer signs users in, guards pages, and handles password reset. The gate is a
 * soft gate — it controls access to the UI, not the underlying public lesson files.
 */
(function () {
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY ||
      window.SUPABASE_PUBLISHABLE_KEY === "REPLACE_WITH_PUBLISHABLE_KEY") {
    console.error("Supabase not configured — set assets/config.js");
  }
  window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
})();

/** Escape for interpolation into innerHTML. app.js has its own copy (esc); this file
 *  loads first and must not depend on it. */
function escAttr(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function currentSession() {
  const { data } = await window.sb.auth.getSession();
  return data.session;
}

/** Redirect to the login page if there is no active session. Returns the session or null. */
async function requireSession() {
  const session = await currentSession();
  if (!session) { location.replace("login.html"); return null; }
  renderAuthBar(session);
  return session;
}

/** Render an "email · Log out" control into #authbar, if present. */
function renderAuthBar(session) {
  const bar = document.getElementById("authbar");
  if (!bar) return;
  const email = session?.user?.email || "";
  // Any non-prod environment gets a visible badge -- staging and production look
  // identical otherwise, and mistaking one for the other is how test data ends up
  // in the live database.
  const env = window.SUPABASE_ENV || "";
  const badge = env && env !== "prod"
    ? `<span class="envbadge">${escAttr(env)}</span>` : "";
  bar.innerHTML = badge +
    `<span class="authuser">${escAttr(email)}</span>` +
    `<button id="logoutbtn" class="linkbtn" type="button">تسجيل الخروج</button>`;
  document.getElementById("logoutbtn").onclick = async () => {
    await window.sb.auth.signOut();
    location.replace("login.html");
  };
}

/** Wire the login form (login.html). */
/** Tell the backend a sign-in happened, so the admin dashboard has a login
 *  history with a real client IP (the server reads it from request headers).
 *
 *  Fire-and-forget by design: the caller redirects immediately afterwards, so
 *  `keepalive` is what lets the request survive the page unload -- a plain fetch
 *  would be cancelled mid-flight. Every failure is swallowed: a missing
 *  analytics row is nothing, a login delayed or broken by a logging call is a
 *  real outage. */
function recordLogin(session) {
  try {
    if (!session?.access_token || !window.SUPABASE_URL) return;
    fetch(`${window.SUPABASE_URL}/functions/v1/record-login`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": window.SUPABASE_PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: "{}",          // the function ignores the body; identity is the token
      keepalive: true,
    }).catch(() => {});
  } catch (_) { /* never let this affect signing in */ }
}

function initLogin() {
  const f = document.getElementById("loginform");
  const msg = document.getElementById("msg");
  const show = (kind, text) => { msg.className = "msg " + kind; msg.textContent = text; };

  // Already signed in → go straight to the archive.
  currentSession().then((s) => { if (s) location.replace("index.html"); });

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = f.email.value.trim().toLowerCase();
    const password = f.password.value;
    show("", "");
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
    if (error) return show("err", "فشل تسجيل الدخول. تحقّق من بريدك الإلكتروني وكلمة المرور.");
    recordLogin(data?.session);   // fire-and-forget; never blocks the redirect
    location.replace("index.html");
  });

  document.getElementById("forgot").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = (f.email.value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return show("err", "أدخل بريدك الإلكتروني في الحقل أعلاه أولاً، ثم اضغط «نسيت كلمة المرور».");
    const redirectTo = location.href.replace(/login\.html.*$/, "reset.html");
    const { error } = await window.sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) return show("err", "تعذّر إرسال رسالة إعادة التعيين. حاول مرة أخرى لاحقاً.");
    show("ok", "إذا كان لهذا البريد حساب، فسيصلك رابط إعادة تعيين كلمة المرور.");
  });
}

/** Wire the reset-password form (reset.html). Supabase parses the recovery token
 *  from the URL automatically and emits a PASSWORD_RECOVERY event. */
function initReset() {
  const f = document.getElementById("resetform");
  const msg = document.getElementById("msg");
  const show = (kind, text) => { msg.className = "msg " + kind; msg.textContent = text; };
  let ready = false;

  window.sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") { ready = true; show("ok", "اختر كلمة مرور جديدة."); }
  });
  // Fallback: if a session already exists from the link, allow the update.
  currentSession().then((s) => { if (s) ready = true; });

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = f.password.value;
    if (pw.length < 8) return show("err", "يجب أن تتكوّن كلمة المرور من 8 أحرف على الأقل.");
    if (!ready) return show("err", "افتح هذه الصفحة من رابط إعادة التعيين في بريدك الإلكتروني.");
    const { error } = await window.sb.auth.updateUser({ password: pw });
    if (error) return show("err", "تعذّر تحديث كلمة المرور. اطلب رابطاً جديداً.");
    show("ok", "تم تحديث كلمة المرور. جارٍ تحويلك إلى تسجيل الدخول…");
    setTimeout(() => location.replace("login.html"), 1500);
  });
}
