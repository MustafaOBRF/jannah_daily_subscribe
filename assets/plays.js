/* Song / summary play-count tracking (Supabase RPCs `log_song_play` /
 * `log_summary_play`). Requires assets/config.js, the supabase-js UMD bundle,
 * and assets/auth.js (which creates window.sb) loaded first.
 *
 * The increment itself happens server-side in log_song_play() / log_summary_play()
 * -- see supabase/migrations/0012_song_plays.sql and 0014_summary_plays.sql --
 * so these are just fire-and-forget calls. A tracking failure must never
 * affect playback, so errors are only logged, never surfaced to the listener.
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

/** Record one play of `slug`'s summary audio for the signed-in caller. */
async function logSummaryPlay(slug) {
  try {
    const { error } = await window.sb.rpc("log_summary_play", { p_slug: slug });
    if (error) throw error;
  } catch (e) {
    console.error("plays: log failed", e);
  }
}
