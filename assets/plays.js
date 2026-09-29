/* Song play-count tracking (Supabase RPC `log_song_play`).
 * Requires assets/config.js, the supabase-js UMD bundle, and assets/auth.js
 * (which creates window.sb) loaded first.
 *
 * The increment itself happens server-side in log_song_play() -- see
 * supabase/migrations/0012_song_plays.sql -- so this is just a fire-and-forget
 * call. A tracking failure must never affect playback, so errors are only
 * logged, never surfaced to the listener.
 */

/** Record one play of `slug` for the signed-in caller. No-ops silently on
 *  any error (including being signed out, which the RPC itself also checks). */
async function logSongPlay(slug) {
  try {
    const { error } = await window.sb.rpc("log_song_play", { p_slug: slug });
    if (error) throw error;
  } catch (e) {
    console.error("plays: log failed", e);
  }
}
