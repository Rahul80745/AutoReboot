// Server-Sent Events hub: pushes "something changed, re-sync" and typing events to connected users.
const clients = new Map(); // userId -> Set<res>

export function subscribe(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  const set = clients.get(userId);
  if (set.size >= 5) { const oldest = set.values().next().value; oldest.end(); set.delete(oldest); } // cap tabs per user
  set.add(res);
  res.on('close', () => { set.delete(res); if (!set.size) clients.delete(userId); });
}

export function publish(userId, event, data = {}) {
  const set = clients.get(userId);
  if (!set) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(frame);
}

const heartbeat = setInterval(() => { for (const set of clients.values()) for (const res of set) res.write(': ping\n\n'); }, 25_000);
heartbeat.unref();

export const connectionCount = () => [...clients.values()].reduce((n, s) => n + s.size, 0);
export function closeAll() { for (const set of clients.values()) for (const res of set) res.end(); clients.clear(); clearInterval(heartbeat); }
