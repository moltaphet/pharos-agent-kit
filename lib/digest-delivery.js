// Delivery of a digest to the channels of lib/alerts.js (Discord, Telegram, ntfy, webhook), once per digest and channel: the period's last block is the digest's key, and the state
// remembers which channels already have it, so a retried run or a restart does not send it twice, and a channel that was down gets it on the next try.

/** state: { sent: { "<key>@<channel>": isoTime } } — kept by the caller (a file for the CLI). */
export async function deliverDigest({ digest, channels, state, link }) {
  if (!Array.isArray(channels) || channels.length === 0) throw new Error('at least one channel is required');
  state.sent ??= {};
  const key = `digest:${digest.periods.current.toBlock}`;
  const alert = { title: digest.headline, what: digest.headline, value: digest.notable.map((n) => n.text).join(' | '), block: digest.periods.current.toBlock, link, key, conditionId: 'weekly-digest', text: `${digest.text}\n\nFull report: ${link}`.slice(0, 1900) };
  const delivered = []; const skipped = []; const failed = [];
  for (const ch of channels) {
    const mark = `${key}@${ch.id}`;
    if (state.sent[mark]) { skipped.push({ channel: ch.id, sentAt: state.sent[mark] }); continue; }
    const r = await ch.send(alert);
    if (r.ok) { state.sent[mark] = new Date().toISOString(); delivered.push({ channel: ch.id, status: r.status ?? null }); } else failed.push({ channel: ch.id, error: r.error });
  }
  return { key, delivered, skipped, failed };
}
