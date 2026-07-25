/* Auth helpers for the members-only gate (Supabase Auth, email + password).
 * Requires assets/config.js and the supabase-js UMD bundle loaded first.
 * Accounts are invite-only (created by the ghl-member function on purchase); this
 * layer signs users in, guards pages, and handles password reset. The gate is a
 * soft gate — it controls access to the UI, not the underlying public lesson files.
 */
(function () {
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY ||
      window.SUPABASE_ANON_KEY === "REPLACE_WITH_ANON_KEY") {
    console.error("Supabase not configured — set assets/config.js");
  }
  window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
})();

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
  bar.innerHTML =
    `<span class="authuser">${email}</span>` +
    `<button id="logoutbtn" class="linkbtn" type="button">تسجيل الخروج</button>`;
  document.getElementById("logoutbtn").onclick = async () => {
    await window.sb.auth.signOut();
    location.replace("login.html");
  };
}

/** Wire the login form (login.html). */
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
    const { error } = await window.sb.auth.signInWithPassword({ email, password });
    if (error) return show("err", "فشل تسجيل الدخول. تحقّق من بريدك الإلكتروني وكلمة المرور.");
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
