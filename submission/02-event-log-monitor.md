# 2. Event/Log Monitor

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/event-log-monitor/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/event-log-monitor
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/event-log-monitor
- **What the proof shows:** Live Transfer/Approval log watcher with block cursor, duplicate suppression and a run log.

## Requirements it was built against (the Arena’s own list)

1. Uses Chain MCP log queries filtered by contract address and event signature.
   - Met by: Every poll calls get_logs filtered by the contract address and the event’s topic0.
2. Runs continuously (polling or block-by-block) and reports only new events, with no duplicates.
   - Met by: Only blocks after the last scanned one are read (windows of ≤ 1,000 blocks) and each log is de-duplicated by txHash:logIndex.
3. Decodes each event into readable fields (from, to, amount, tx hash, block).
   - Met by: Each event is decoded into from, to, amount (decimals and symbol applied), tx hash, block and block time.
4. Demonstrated catching at least one live or test event.
   - Met by: Busy mainnet contracts emit events within seconds, so you can watch live events arrive above. A CLI run is in the README.

Code and notes: [agents/event-log-monitor/README.md](../agents/event-log-monitor/README.md)
