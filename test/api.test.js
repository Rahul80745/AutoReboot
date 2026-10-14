import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_FILE = ':memory:';
const { createApp } = await import('../server/app.js');
const { createOwner, seedDemo } = await import('../server/seed.js');

await createOwner({ email: 'boss@example.com', password: 'ownerpass1' });
await seedDemo();
const server = createApp({ demo: true }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/** minimal cookie-jar client */
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
}

const newUser = { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9123456780', password: 'secret123', city: 'Pune', state: 'Maharashtra' };
const vehicle = { category: 'mini-trucks', brand: 'Tata', model: 'Ace Gold', year: 2022, price: 450000, km: 20000, tyres: 4, city: 'Pune', state: 'Maharashtra' };

test('anonymous visitors can browse but not act', async () => {
  const c = client();
  const b = await c('GET', '/api/bootstrap');
  assert.equal(b.status, 200);
  assert.equal(b.data.user, null);
  assert.ok(b.data.listings.length > 50);
  assert.equal((await c('POST', '/api/listings', vehicle)).status, 401);
  assert.equal((await c('GET', '/api/owner/overview')).status, 401);
});

test('user signup validation, login and logout', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/register', { ...newUser, password: 'short' })).data.field, 'password');
  assert.equal((await c('POST', '/api/auth/register', { ...newUser, phone: '123' })).data.field, 'phone');
  const r = await c('POST', '/api/auth/register', newUser);
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'user');
  assert.equal((await c('GET', '/api/auth/me')).data.user.email, 'ravi@example.com');
  assert.equal((await c('POST', '/api/auth/register', newUser)).data.field, 'email');
  await c('POST', '/api/auth/logout');
  assert.equal((await c('GET', '/api/auth/me')).data.user, null);
  const bad = await c('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'wrongpass1', as: 'user' });
  assert.equal(bad.status, 401);
  const ok = await c('POST', '/api/auth/login', { id: '9123456780', password: 'secret123', as: 'user' }); // by mobile
  assert.equal(ok.status, 200);
});

test('owner and user sign-ins are separate', async () => {
  const c = client();
  const asUser = await c('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'user' });
  assert.equal(asUser.status, 401);
  assert.match(asUser.data.error, /owner account/i);
  assert.equal((await c('GET', '/api/auth/me')).data.user, null);
  const asUserPw = await c('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'secret123', as: 'owner' });
  assert.equal(asUserPw.status, 401);
  assert.equal((await c('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' })).status, 200);
  assert.equal((await c('GET', '/api/auth/me')).data.user.role, 'owner');
  // owners cannot use user-only features
  assert.equal((await c('POST', '/api/listings', vehicle)).status, 403);
  // demo dealer accounts cannot be signed into
  const d = await client()('POST', '/api/auth/login', { id: 'u_venk@seller.spidy.in', password: '!', as: 'user' });
  assert.equal(d.status, 401);
});

test('users cannot reach owner endpoints', async () => {
  const c = client();
  await c('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'secret123', as: 'user' });
  for (const u of ['/api/owner/overview', '/api/owner/users', '/api/owner/listings', '/api/owner/finance']) {
    assert.equal((await c('GET', u)).status, 403, u);
  }
});

test('listing lifecycle and ownership checks', async () => {
  const seller = client(), other = client();
  await seller('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'secret123', as: 'user' });
  await other('POST', '/api/auth/register', { ...newUser, name: 'Other Person', email: 'other@example.com', phone: '9234567891' });
  assert.equal((await seller('POST', '/api/listings', { ...vehicle, price: 5 })).data.field, 'price');
  const created = await seller('POST', '/api/listings', vehicle);
  assert.equal(created.status, 201);
  const id = created.data.listing.id;
  assert.match(id, /^MIN\d{6}$/);
  assert.equal((await other('PATCH', `/api/listings/${id}`, { price: 1 })).status, 403);
  assert.equal((await other('DELETE', `/api/listings/${id}`)).status, 403);
  assert.equal((await seller('PATCH', `/api/listings/${id}`, { price: 400000 })).data.listing.price, 400000);
  assert.equal((await seller('POST', `/api/listings/${id}/status`, { status: 'sold' })).data.listing.status, 'sold');
  // photos must be real image data URLs
  assert.equal((await seller('PATCH', `/api/listings/${id}`, { photos: ['javascript:alert(1)'] })).status, 400);
  // visible to a stranger
  const pub = await client()('GET', '/api/bootstrap');
  assert.ok(pub.data.listings.some((l) => l.id === id));
});

test('chat between two users, unread tracking, hide', async () => {
  const seller = client(), buyer = client();
  await seller('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'secret123', as: 'user' });
  await buyer('POST', '/api/auth/login', { id: 'other@example.com', password: 'secret123', as: 'user' });
  const lid = (await seller('GET', '/api/bootstrap')).data.listings.find((l) => l.sellerId && l.title === 'Tata Ace Gold' && l.price === 400000).id;
  assert.equal((await seller('POST', '/api/chats', { listingId: lid })).status, 400); // own listing
  const { data: { id: chatId } } = await buyer('POST', '/api/chats', { listingId: lid });
  assert.equal((await buyer('POST', `/api/chats/${chatId}/messages`, { text: 'Is it available?' })).status, 201);
  const sb = (await seller('GET', '/api/bootstrap')).data;
  assert.equal(sb.chats.length, 1);
  assert.equal(sb.messages[0].text, 'Is it available?');
  assert.equal(sb.notifications[0].title, 'New message from Other Person');
  // a third user cannot read or post
  const spy = client(); await spy('POST', '/api/auth/register', { ...newUser, email: 'spy@example.com', phone: '9345678912' });
  assert.equal((await spy('POST', `/api/chats/${chatId}/messages`, { text: 'hi' })).status, 404);
  assert.equal((await spy('GET', '/api/bootstrap')).data.messages.length, 0);
  assert.equal((await buyer('DELETE', `/api/chats/${chatId}`)).status, 200);
  assert.equal((await buyer('GET', '/api/bootstrap')).data.chats.length, 0);
  assert.equal((await seller('GET', '/api/bootstrap')).data.chats.length, 1);
});

test('demo dealer auto-replies', async () => {
  const c = client();
  await c('POST', '/api/auth/login', { id: 'demo@spidy.in', password: 'demo1234', as: 'user' });
  const { data: { id } } = await c('POST', '/api/chats', { listingId: 'LOR123456' });
  await c('POST', `/api/chats/${id}/messages`, { text: 'Is it still available?' });
  await new Promise((r) => setTimeout(r, 2600));
  const { data } = await c('GET', '/api/bootstrap');
  const msgs = data.messages.filter((m) => m.chatId === id);
  assert.ok(msgs.some((m) => m.senderId === 'u_venk' && /still available/i.test(m.text)));
});

test('finance request → owner follow-up notifies the user', async () => {
  const u = client(), o = client();
  await u('POST', '/api/auth/login', { id: 'other@example.com', password: 'secret123', as: 'user' });
  const body = { name: 'Other Person', age: 34, mobile: '9234567891', city: 'Pune', state: 'Maharashtra', pincode: '411001', listingId: 'LOR123456' };
  assert.equal((await u('POST', '/api/finance', { ...body, pincode: '12' })).data.field, 'pincode');
  assert.equal((await u('POST', '/api/finance', body)).status, 201);
  assert.equal((await u('POST', '/api/finance', body)).status, 400); // duplicate same day
  await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
  const { data: { requests } } = await o('GET', '/api/owner/finance');
  assert.equal(requests.length, 1);
  assert.equal((await o('PATCH', `/api/owner/finance/${requests[0].id}`, { status: 'contacted' })).status, 200);
  const mine = (await u('GET', '/api/bootstrap')).data;
  assert.equal(mine.finance[0].status, 'contacted');
  assert.ok(mine.notifications.some((n) => n.title === 'Finance team has reached out'));
});

test('owner moderation: remove listing, suspend and delete user', async () => {
  const o = client(), seller = client(), anon = client();
  await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
  await seller('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'secret123', as: 'user' });
  const ov = (await o('GET', '/api/owner/overview')).data;
  assert.ok(ov.users >= 3 && ov.listingsActive > 50);
  const { data: { listings } } = await o('GET', '/api/owner/listings?q=Ace%20Gold');
  const mine = listings.find((l) => l.price === 400000 || l.status === 'sold');
  await o('PATCH', `/api/owner/listings/${mine.id}`, { status: 'removed' });
  assert.ok(!(await anon('GET', '/api/bootstrap')).data.listings.some((l) => l.id === mine.id));
  const own = (await seller('GET', '/api/bootstrap')).data.listings.find((l) => l.id === mine.id);
  assert.equal(own.status, 'removed');
  assert.equal((await seller('PATCH', `/api/listings/${mine.id}`, { price: 1000000 })).status, 403);
  assert.ok((await seller('GET', '/api/bootstrap')).data.notifications.some((n) => n.title === 'Listing removed'));

  const { data: { users } } = await o('GET', '/api/owner/users?q=ravi%40example.com');
  assert.equal(users.length, 1);
  await o('PATCH', `/api/owner/users/${users[0].id}`, { status: 'suspended' });
  assert.equal((await seller('GET', '/api/auth/me')).data.user, null); // sessions revoked
  assert.equal((await client()('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'secret123', as: 'user' })).status, 403);
  assert.equal((await o('DELETE', `/api/owner/users/${users[0].id}`)).status, 200);
  // owners are protected from the console
  const me = (await o('GET', '/api/auth/me')).data.user;
  assert.equal((await o('DELETE', `/api/owner/users/${me.id}`)).status, 403);
});

test('cross-origin writes are rejected', async () => {
  const res = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('owner controls the sell form: add, require, hide, reorder, delete fields', async () => {
  const o = client(), u = client(), anon = client();
  await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
  await u('POST', '/api/auth/register', { ...newUser, email: 'form@example.com', phone: '9456789123' });

  // everyone gets the form definition; ownership is no longer part of it
  const defs = (await anon('GET', '/api/bootstrap')).data.formFields;
  assert.ok(defs.some((f) => f.key === 'brand' && f.locked));
  assert.ok(!defs.some((f) => /owner/i.test(f.key)));

  // only the owner can change it
  assert.equal((await u('POST', '/api/owner/form-fields', { label: 'X', type: 'text' })).status, 403);

  // add a required custom dropdown
  const add = await o('POST', '/api/owner/form-fields', { label: 'Permit type', type: 'select', group: 'details', required: true, options: ['National', 'State'] });
  assert.equal(add.status, 201);
  const custom = add.data.fields.find((f) => f.label === 'Permit type');
  assert.equal(custom.builtin, false);
  assert.equal((await o('POST', '/api/owner/form-fields', { label: 'Bad', type: 'select', options: ['only one'] })).status, 400);

  const base = { ...vehicle, regNo: '', price: 450000 };
  const missing = await u('POST', '/api/listings', base);
  assert.equal(missing.status, 400);
  assert.equal(missing.data.field, custom.key);
  assert.equal((await u('POST', '/api/listings', { ...base, extras: { [custom.key]: 'Other' } })).status, 400); // not in options
  const ok = await u('POST', '/api/listings', { ...base, extras: { [custom.key]: 'National' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.listing.extras[custom.key], 'National');

  // make an optional built-in required, then hide it again
  await o('PATCH', '/api/owner/form-fields/regNo', { required: true });
  assert.equal((await u('POST', '/api/listings', { ...base, extras: { [custom.key]: 'State' } })).data.field, 'regNo');
  await o('PATCH', '/api/owner/form-fields/regNo', { enabled: false });
  assert.equal((await u('POST', '/api/listings', { ...base, extras: { [custom.key]: 'State' } })).status, 201);

  // locked fields can't be hidden / made optional / deleted; built-ins can't be deleted
  assert.equal((await o('PATCH', '/api/owner/form-fields/brand', { enabled: false })).status, 403);
  assert.equal((await o('PATCH', '/api/owner/form-fields/price', { required: false })).status, 403);
  assert.equal((await o('DELETE', '/api/owner/form-fields/regNo')).status, 403);
  assert.equal((await o('PATCH', '/api/owner/form-fields/brand', { label: 'Make' })).data.fields.find((f) => f.key === 'brand').label, 'Make');

  // reorder within a section
  const before = (await o('GET', '/api/owner/form-fields')).data.fields.filter((f) => f.group === 'details').map((f) => f.key);
  const after = (await o('POST', '/api/owner/form-fields/fuel/move', { dir: -1 })).data.fields.filter((f) => f.group === 'details').map((f) => f.key);
  assert.equal(after.indexOf('fuel'), before.indexOf('fuel') - 1);

  // deleting the custom field stops requiring it
  assert.equal((await o('DELETE', `/api/owner/form-fields/${custom.key}`)).status, 200);
  assert.equal((await u('POST', '/api/listings', base)).status, 201);
});
