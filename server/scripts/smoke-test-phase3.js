const { io } = require('socket.io-client');

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
  const alice = await api('/auth/register', { method: 'POST', body: { name: 'Alice P3', email: `alice.p3.${rand}@example.com`, password: 'correcthorse123' } });
  const bob = await api('/auth/register', { method: 'POST', body: { name: 'Bob P3', email: `bob.p3.${rand}@example.com`, password: 'correcthorse123' } });
  const carol = await api('/auth/register', { method: 'POST', body: { name: 'Carol P3', email: `carol.p3.${rand}@example.com`, password: 'correcthorse123' } });
  console.log('registered 3 users');

  // --- Friends (prereq for direct conversation) ---
  const req = await api('/friends/requests', { method: 'POST', token: alice.token, body: { toEmail: bob.user.email } });
  await api(`/friends/requests/${req.id}/accept`, { method: 'POST', token: bob.token });
  console.log('alice + bob are now friends');

  // --- Sockets: connect bob & carol, listen for events ---
  const bobSocket = io('http://localhost:5100', { auth: { token: bob.token } });
  const events = [];
  bobSocket.on('message:new', (m) => events.push(['message:new', m]));
  bobSocket.on('notification:new', (n) => events.push(['notification:new', n]));
  await new Promise((resolve, reject) => {
    bobSocket.on('connect', resolve);
    bobSocket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });
  console.log('bob socket connected');

  // --- Direct conversation + message + word filter ---
  const conv = await api('/conversations/direct', { method: 'POST', token: alice.token, body: { friendId: bob.user.id } });
  assert(conv.id, 'direct conversation created');

  const msg = await api(`/conversations/${conv.id}/messages`, { method: 'POST', token: alice.token, body: { body: 'Hallo Bob, das ist ein Test!' } });
  assert(msg.body === 'Hallo Bob, das ist ein Test!', 'plain message stored unmodified');

  const maskedMsg = await api(`/conversations/${conv.id}/messages`, { method: 'POST', token: alice.token, body: { body: 'du bist ein Arschloch' } });
  assert(maskedMsg.filtered === true, 'mild profanity gets masked, flagged filtered=true');
  assert(!maskedMsg.body.toLowerCase().includes('arschloch'), 'masked word no longer present: ' + maskedMsg.body);

  let blockedRejected = false;
  try {
    await api(`/conversations/${conv.id}/messages`, { method: 'POST', token: alice.token, body: { body: 'du bist ein hurensohn' } });
  } catch (e) {
    blockedRejected = e.message.includes('422');
  }
  assert(blockedRejected, 'severe profanity is rejected outright (422)');

  await new Promise((r) => setTimeout(r, 400));
  const gotMessage = events.some(([type, payload]) => type === 'message:new' && payload.body.includes('Test'));
  assert(gotMessage, 'bob received message:new via socket in real time');

  const history = await api(`/conversations/${conv.id}/messages`, { token: bob.token });
  assert(history.length === 2, `history has exactly the 2 accepted messages (got ${history.length})`);

  // --- Blocking prevents new friend requests and messaging ---
  await api('/blocks', { method: 'POST', token: bob.token, body: { userId: carol.user.id } });
  let blockedFriendReq = false;
  try {
    await api('/friends/requests', { method: 'POST', token: carol.token, body: { toEmail: bob.user.email } });
  } catch (e) {
    blockedFriendReq = e.message.includes('403');
  }
  assert(blockedFriendReq, 'blocked user cannot send a friend request');

  // --- Groups & roles ---
  const group = await api('/groups', { method: 'POST', token: alice.token, body: { name: 'Test Collectors', visibility: 'public' } });
  assert(group.role === 'owner', 'group creator is owner');

  await api(`/groups/${group.id}/join`, { method: 'POST', token: bob.token });
  const detail = await api(`/groups/${group.id}`, { token: alice.token });
  assert(detail.members.length === 2, 'group has 2 members after join');

  await api(`/groups/${group.id}/members/${bob.user.id}`, { method: 'PATCH', token: alice.token, body: { role: 'moderator' } });
  const detail2 = await api(`/groups/${group.id}`, { token: alice.token });
  assert(detail2.members.find((m) => m.id === bob.user.id).role === 'moderator', 'owner promoted bob to moderator');

  let cannotSelfPromote = false;
  try {
    await api(`/groups/${group.id}/members/${bob.user.id}`, { method: 'PATCH', token: bob.token, body: { role: 'admin' } });
  } catch (e) {
    cannotSelfPromote = e.message.includes('403');
  }
  assert(cannotSelfPromote, 'moderator cannot grant a role equal/higher than their own');

  const groupMsg = await api(`/conversations/${group.conversationId}/messages`, { method: 'POST', token: bob.token, body: { body: 'Hi Gruppe!' } });
  assert(groupMsg.body === 'Hi Gruppe!', 'group chat message sent via the group conversation');

  await api(`/groups/${group.id}/ban/${bob.user.id}`, { method: 'POST', token: alice.token });
  let cannotRejoin = false;
  try {
    await api(`/groups/${group.id}/join`, { method: 'POST', token: bob.token });
  } catch (e) {
    cannotRejoin = e.message.includes('403');
  }
  assert(cannotRejoin, 'banned member cannot rejoin the public group');

  // --- Notifications ---
  const notifs = await api('/notifications', { token: bob.token });
  assert(notifs.some((n) => n.type === 'friend_request'), 'bob has a persisted friend_request notification');

  bobSocket.close();
  console.log('\nALL PHASE 3 SMOKE TESTS PASSED');

  // cleanup
  const cleanupPool = require('mysql2/promise').createPool(process.env.MYSQL_URL || require('dotenv').config().parsed.MYSQL_URL);
}

main().catch((e) => {
  console.error('\nSMOKE TEST FAILED:', e.message);
  process.exit(1);
});
