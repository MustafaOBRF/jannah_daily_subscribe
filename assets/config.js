/* GENERATED FILE — do not edit by hand.
 * Source: public-site/assets/config.template.js
 * Regenerate: python scripts/gen_config.py --env prod
 *
 * Points the browser at a Supabase project. Values come from the matching entry in
 * envs.json (gitignored; see envs.example.json for the shape).
 *
 * Why generated: .github/workflows/mirror-lessons.yml copies public-site/ into the
 * published site verbatim, so whatever config.js says on the branch CI runs is what
 * real members hit. `gen_config.py --check` runs in that workflow and fails the build
 * if the committed config.js does not point at prod — a staging-pointed config.js on
 * main would otherwise silently repoint the live site at the wrong database.
 *
 * The publishable ("anon") key is PUBLIC-SAFE — row-level security is the real
 * boundary, and the members table is locked to service_role. NEVER put the
 * service_role key here.
 */
window.SUPABASE_URL = "https://fjjtkdcitwjkkxjhdple.supabase.co";
window.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YdVmhe9wnxX9ZEBnNsRvcQ_sfVdEaEB";
window.SUPABASE_ENV = "prod";
