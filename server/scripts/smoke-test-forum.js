const BASE = 'http://localhost:5100/api';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  const rand = Date.now();
  const alice = await api('/auth/register', { method: 'POST', body: { name: 'Alice Feed', username: `alice_feed_${rand}`, email: `alice.feed.${rand}@example.com`, password: 'correcthorse123' } });
  const bob = await api('/auth/register', { method: 'POST', body: { name: 'Bob Feed', username: `bob_feed_${rand}`, email: `bob.feed.${rand}@example.com`, password: 'correcthorse123' } });

  const created = await api('/forum/threads', {
    method: 'POST', token: alice.token,
    body: { title: 'Seltene Karte gefunden!', body: 'Schaut mal was ich gefunden habe', category: 'rare_find', level: 12 }
  });
  assert(created.id, 'thread created with level sync');

  const feed = await api('/forum/threads', { token: bob.token });
  const card = feed.find((f) => f.id === created.id);
  assert(card.authorLevel === 12, 'feed card carries the synced author level');
  assert(card.body === 'Schaut mal was ich gefunden habe', 'feed card shows first-post body inline');
  assert(card.commentCount === 0, 'fresh thread has 0 comments');
  assert(card.category === 'rare_find', 'category stored correctly');

  const filtered = await api('/forum/threads?category=rare_find', { token: bob.token });
  assert(filtered.some((f) => f.id === created.id), 'category filter works with new taxonomy');
  const wrongFilter = await api('/forum/threads?category=trade', { token: bob.token });
  assert(!wrongFilter.some((f) => f.id === created.id), 'thread absent from unrelated category filter');

  await api(`/forum/threads/${created.id}/posts`, { method: 'POST', token: bob.token, body: { body: 'Glückwunsch!', level: 5 } });
  const feed2 = await api('/forum/threads', { token: alice.token });
  assert(feed2.find((f) => f.id === created.id).commentCount === 1, 'comment count increments for replies (not the root post)');

  await api(`/forum/posts/${card.firstPostId}/like`, { method: 'POST', token: bob.token });
  const feed3 = await api('/forum/threads', { token: bob.token });
  const liked = feed3.find((f) => f.id === created.id);
  assert(liked.likeCount === 1 && liked.likedByMe === true, 'like on the root post reflected in feed card');

  const trending = await api('/forum/trending', { token: alice.token });
  assert(trending.some((t) => t.category === 'rare_find'), 'trending includes the category we just posted in');

  const leaderboard = await api('/forum/leaderboard', { token: alice.token });
  assert(leaderboard.some((l) => l.id === alice.user.id && l.level === 12), 'alice (level 12) appears on the leaderboard');

  const activity = await api('/forum/activity', { token: alice.token });
  assert(activity.some((a) => a.type === 'post' && a.actorName === 'Bob Feed'), 'activity feed shows bob\'s reply');
  assert(activity.some((a) => a.type === 'like' && a.actorName === 'Bob Feed'), 'activity feed shows bob\'s like');

  console.log('\nALL FORUM FEED SMOKE TESTS PASSED');
}

main().catch((e) => {
  console.error('\nSMOKE TEST FAILED:', e.message);
  process.exit(1);
});
