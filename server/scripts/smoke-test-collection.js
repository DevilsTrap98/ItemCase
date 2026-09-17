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
  const alice = await api('/auth/register', { method: 'POST', body: { name: 'Alice Coll', username: `alice_coll_${rand}`, email: `alice.coll.${rand}@example.com`, password: 'correcthorse123' } });
  const bob = await api('/auth/register', { method: 'POST', body: { name: 'Bob Coll', username: `bob_coll_${rand}`, email: `bob.coll.${rand}@example.com`, password: 'correcthorse123' } });

  const initial = await api('/collection', { token: alice.token });
  assert(initial.items.length === 0, 'alice starts with an empty collection');
  assert(initial.categories.length === 5, 'default categories are seeded');

  const afterSave = await api('/collection/items', {
    method: 'POST', token: alice.token,
    body: { name: 'Charizard Karte', category: 'Trading Cards', condition: 'nearMint', quantity: 1, value: 100, purchasePrice: 50 }
  });
  assert(afterSave.items.length === 1, 'item created');
  assert(afterSave.categories.includes('Trading Cards'), 'new category auto-added');
  const itemId = afterSave.items[0].id;

  const bobState = await api('/collection', { token: bob.token });
  assert(bobState.items.length === 0, 'bob (different account) does NOT see alice\'s item — the core leak fix');

  const afterUpdate = await api('/collection/items', {
    method: 'POST', token: alice.token,
    body: { id: itemId, name: 'Charizard Karte', category: 'Trading Cards', condition: 'nearMint', quantity: 1, value: 150, purchasePrice: 50 }
  });
  const updatedItem = afterUpdate.items.find((i) => i.id === itemId);
  assert(updatedItem.value == 150, 'value updated');
  assert(updatedItem.valueHistory.length === 1 && updatedItem.valueHistory[0].value == 100, 'old value recorded in history');

  await api('/collection/categories', { method: 'POST', token: alice.token, body: { category: 'Retro Konsolen' } });
  const withNewCat = await api('/collection', { token: alice.token });
  assert(withNewCat.categories.includes('Retro Konsolen'), 'manually added category persisted');

  await api('/collection/categories/rename', { method: 'POST', token: alice.token, body: { oldName: 'Retro Konsolen', newName: 'Konsolen' } });
  const afterRename = await api('/collection', { token: alice.token });
  assert(afterRename.categories.includes('Konsolen') && !afterRename.categories.includes('Retro Konsolen'), 'category renamed');

  await api(`/collection/categories/${encodeURIComponent('Konsolen')}/target`, { method: 'PUT', token: alice.token, body: { target: 10 } });
  const afterTarget = await api('/collection', { token: alice.token });
  assert(afterTarget.categoryTargets['Konsolen'] === 10, 'category target set');

  await api(`/collection/items/${itemId}`, { method: 'DELETE', token: alice.token });
  const afterDelete = await api('/collection', { token: alice.token });
  assert(afterDelete.items.length === 0, 'item deleted');

  console.log('\nALL COLLECTION SMOKE TESTS PASSED');
}

main().catch((e) => {
  console.error('\nSMOKE TEST FAILED:', e.message);
  process.exit(1);
});
