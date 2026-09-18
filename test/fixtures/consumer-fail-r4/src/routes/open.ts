// R4 violation: talks to env.DB directly outside kodekraft.dbCompositionRoot
// (src/db/client.ts). Only the composition root may name the raw binding.
export async function handleOpen(env, guestId) {
  const row = await env.DB.prepare("update guests set opened_at = ? where id = ?").bind(Date.now(), guestId).run();
  return row;
}
