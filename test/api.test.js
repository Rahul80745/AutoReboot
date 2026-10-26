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
function client(origin = base) {
  let cookie = '';
  const f = async (method, url, body) => {
    const res = await fetch(origin + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
  f.cookie = () => cookie;
  return f;
}

const newUser = { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9123456780', password: 'secret123', city: 'Pune', state: 'Maharashtra' };
const vehicle = { category: 'mini-trucks', brand: 'Tata', model: 'Ace Gold', title: 'Tata Ace Gold', year: 2022, price: 450000, km: 20000, tyres: 4, city: 'Pune', state: 'Maharashtra' };

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
  assert.doesNotMatch(asUser.data.error, /owner/i); // the user form never reveals an owner sign-in exists
  assert.equal((await c('GET', '/api/auth/me')).data.user, null);
  const asUserPw = await c('POST', '/api/auth/login', { id: 'ravi@example.com', password: 'secret123', as: 'owner' });
  assert.equal(asUserPw.status, 401);
  assert.equal((await c('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' })).status, 200);
  assert.equal((await c('GET', '/api/auth/me')).data.user.role, 'owner');
  // owners cannot use user-only features
  assert.equal((await c('POST', '/api/listings', vehicle)).status, 403);
  // demo dealer accounts cannot be signed into
  const d = await client()('POST', '/api/auth/login', { id: 'u_venk@seller.autoreboot.in', password: '!', as: 'user' });
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
  await c('POST', '/api/auth/login', { id: 'demo@autoreboot.in', password: 'demo1234', as: 'user' });
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
  const body = { name: 'Other Person', age: 34, mobile: '9234567891', email: 'other@gmail.com', city: 'Pune', state: 'Maharashtra', pincode: '411001', listingId: 'LOR123456' };
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

test('ad title becomes the listing title', async () => {
  const u = client(), o = client();
  await u('POST', '/api/auth/register', { ...newUser, email: 'title@example.com', phone: '9567891234' });
  const { title, ...noTitle } = vehicle;
  assert.equal((await u('POST', '/api/listings', noTitle)).data.field, 'title'); // required by default
  const made = await u('POST', '/api/listings', { ...vehicle, title: 'Single-owner Ace, new tyres' });
  assert.equal(made.data.listing.title, 'Single-owner Ace, new tyres');
  const id = made.data.listing.id;
  assert.equal((await u('PATCH', `/api/listings/${id}`, { title: 'Ace Gold – price cut' })).data.listing.title, 'Ace Gold – price cut');
  // owner makes it optional → falls back to Brand + Model
  await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
  await o('PATCH', '/api/owner/form-fields/title', { required: false });
  assert.equal((await u('POST', '/api/listings', noTitle)).data.listing.title, 'Tata Ace Gold');
  await o('PATCH', '/api/owner/form-fields/title', { required: true });
  // colour picker field is gone
  assert.ok(!(await u('GET', '/api/bootstrap')).data.formFields.some((f) => f.key === 'color'));
});

test('owner can hide or make optional the model number', async () => {
  const u = client(), o = client();
  await u('POST', '/api/auth/register', { ...newUser, email: 'model@example.com', phone: '9678912345' });
  await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
  const { model, title, ...bare } = vehicle;
  assert.equal((await u('POST', '/api/listings', bare)).data.field, 'model'); // required by default
  const hid = await o('PATCH', '/api/owner/form-fields/model', { enabled: false });
  assert.equal(hid.status, 200);
  assert.equal(hid.data.fields.find((f) => f.key === 'model').enabled, false);
  const made = await u('POST', '/api/listings', { ...bare, title: '' });
  // title is still required unless provided
  assert.equal(made.data.field, 'title');
  const ok = await u('POST', '/api/listings', { ...bare, title: 'Pickup in great shape' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.listing.model, '');
  await o('PATCH', '/api/owner/form-fields/title', { required: false });
  assert.equal((await u('POST', '/api/listings', bare)).data.listing.title, 'Tata');
  await o('PATCH', '/api/owner/form-fields/title', { required: true });
  await o('PATCH', '/api/owner/form-fields/model', { enabled: true });
});

test('owner has a private URL and banners can be managed', async () => {
  const res = await fetch(base + '/owner', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/owner/login');
  const o = client(), u = client(), anon = client();
  await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
  await u('POST', '/api/auth/register', { ...newUser, email: 'ban@example.com', phone: '9789123456' });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  assert.equal((await u('POST', '/api/owner/banners', { title: 'x' })).status, 403);
  assert.equal((await o('POST', '/api/owner/banners', { title: 'A' })).data.field, 'title');
  assert.equal((await o('POST', '/api/owner/banners', { title: 'Sale', link: 'javascript:alert(1)' })).data.field, 'link');
  assert.equal((await o('POST', '/api/owner/banners', { title: 'Sale', image: 'http://evil/x.png' })).data.field, 'image');
  const add = await o('POST', '/api/owner/banners', { title: 'Festival offers', description: 'Up to 10% off', image: png, buttonText: 'View tippers', link: '#/list/trucks/tippers' });
  assert.equal(add.status, 201);
  const b = add.data.banners[0];
  assert.equal(b.hasImage, true);
  const pub = (await anon('GET', '/api/bootstrap')).data.banners;
  assert.equal(pub.length, 1);
  assert.equal(pub[0].title, 'Festival offers');
  assert.ok(!('image' in pub[0]));
  const img = await fetch(`${base}/api/banners/${b.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  await o('PATCH', `/api/owner/banners/${b.id}`, { enabled: false });
  assert.equal((await anon('GET', '/api/bootstrap')).data.banners.length, 0);
  await o('PATCH', `/api/owner/banners/${b.id}`, { enabled: true, image: '' });
  assert.equal((await o('GET', '/api/owner/banners')).data.banners[0].hasImage, false);
  assert.equal((await o('DELETE', `/api/owner/banners/${b.id}`)).data.banners.length, 0);
});

test('health check endpoint', async () => {
  const res = await fetch(base + '/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

/* ---------------- Google sign-in (token verified with a locally generated key) ---------------- */
test('continue with Google creates, links and protects accounts', async () => {
  const crypto = await import('node:crypto');
  const { verifyGoogleIdToken } = await import('../server/google.js');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };
  const getKeys = async () => [jwk];
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mint = (claims, key = privateKey) => {
    const body = `${b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })}.${b64({ iss: 'https://accounts.google.com', aud: 'client-123', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...claims })}`;
    return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
  };
  // the verifier itself
  const good = await verifyGoogleIdToken(mint({ sub: '1', email: 'A@Gmail.com', name: 'Asha' }), { clientId: 'client-123', getKeys });
  assert.deepEqual(good, { sub: '1', email: 'a@gmail.com', name: 'Asha' });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  for (const bad of [mint({ sub: '1', email: 'a@gmail.com' }, other), mint({ sub: '1', email: 'a@gmail.com', aud: 'someone-else' }), mint({ sub: '1', email: 'a@gmail.com', exp: 1 }), mint({ sub: '1', email: 'a@gmail.com', email_verified: false }), mint({ sub: '1', email: 'a@gmail.com', iss: 'https://evil.example' }), 'not.a.jwt']) {
    await assert.rejects(verifyGoogleIdToken(bad, { clientId: 'client-123', getKeys }));
  }

  // the endpoint, with a verifier backed by the test key
  process.env.GOOGLE_CLIENT_ID = 'client-123';
  const gserver = createApp({ demo: false, googleVerifier: (t, o) => verifyGoogleIdToken(t, { ...o, getKeys }) }).listen(0);
  const gbase = `http://127.0.0.1:${gserver.address().port}`;
  try {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(gbase + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      for (const c of r.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
      return { status: r.status, data: await r.json().catch(() => null) };
    };
    assert.equal((await call('GET', '/api/bootstrap')).data.googleClientId, 'client-123');
    assert.equal((await call('POST', '/api/auth/google', { credential: 'junk' })).status, 401);
    const first = await call('POST', '/api/auth/google', { credential: mint({ sub: 'g-100', email: 'newbie@gmail.com', name: 'New Bie' }) });
    assert.equal(first.status, 200);
    assert.equal(first.data.user.role, 'user');
    assert.equal(first.data.user.email, 'newbie@gmail.com');
    assert.equal((await call('GET', '/api/auth/me')).data.user.name, 'New Bie');
    // a Google-only account has no usable password
    const pw = await client()('POST', '/api/auth/login', { id: 'newbie@gmail.com', password: '!', as: 'user' });
    assert.equal(pw.status, 401);
    // phone can be added later (and left empty)
    assert.equal((await call('PATCH', '/api/auth/me', { phone: '9890123456' })).data.user.phone, '9890123456');
    // signing in again reuses the same account
    cookie = '';
    const again = await call('POST', '/api/auth/google', { credential: mint({ sub: 'g-100', email: 'newbie@gmail.com' }) });
    assert.equal(again.data.user.id, first.data.user.id);
    // an existing password account with the same verified e-mail is linked, not duplicated
    cookie = '';
    const reg = await call('POST', '/api/auth/register', { ...newUser, email: 'link@example.com', phone: '9890000001' });
    cookie = '';
    const linked = await call('POST', '/api/auth/google', { credential: mint({ sub: 'g-200', email: 'link@example.com' }) });
    assert.equal(linked.status, 200);
    assert.equal(linked.data.user.id, reg.data.user.id);
    // owner accounts can never sign in through Google
    cookie = '';
    assert.equal((await call('POST', '/api/auth/google', { credential: mint({ sub: 'g-300', email: 'boss@example.com' }) })).status, 403);
    assert.equal((await call('GET', '/api/auth/me')).data.user, null);
  } finally { gserver.close(); delete process.env.GOOGLE_CLIENT_ID; }
});

/* ---------------- realtime chat ---------------- */
async function openStream(cookie) {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/events', { headers: { cookie }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader(); let buf = '';
  const waitFor = async (re, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (re.test(buf)) { const hit = buf; buf = ''; return hit; }
      const r = await Promise.race([reader.read(), new Promise((r2) => setTimeout(() => r2(null), 200))]);
      if (r && r.value) buf += Buffer.from(r.value).toString();
    }
    throw new Error('timed out waiting for ' + re + ' — got: ' + JSON.stringify(buf));
  };
  return { waitFor, close: () => ctrl.abort() };
}

test('chat is realtime: instant push, typing indicator and seen receipts', async () => {
  const seller = client(), buyer = client(), anon = client();
  await seller('POST', '/api/auth/register', { ...newUser, email: 'rt-seller@example.com', phone: '9111111101' });
  await buyer('POST', '/api/auth/register', { ...newUser, email: 'rt-buyer@example.com', phone: '9111111102' });
  assert.equal((await anon('GET', '/api/events')).status, 401); // stream needs a login
  const listing = (await seller('POST', '/api/listings', { ...vehicle, title: 'Realtime Ace' })).data.listing;
  const { data: { id: chatId } } = await buyer('POST', '/api/chats', { listingId: listing.id });

  const sellerStream = await openStream(seller.cookie());
  await sellerStream.waitFor(/event: hello/);
  const buyerStream = await openStream(buyer.cookie());
  await buyerStream.waitFor(/event: hello/);
  try {
    // buyer → seller arrives without polling
    await buyer('POST', `/api/chats/${chatId}/messages`, { text: 'Hi, is this still available?' });
    await sellerStream.waitFor(/event: sync/);
    const seen0 = (await seller('GET', '/api/bootstrap')).data;
    assert.equal(seen0.messages.at(-1).text, 'Hi, is this still available?');
    // typing indicator goes to the other person only
    await seller('POST', `/api/chats/${chatId}/typing`);
    const typing = await buyerStream.waitFor(/event: typing/);
    assert.match(typing, new RegExp(chatId));
    // seller reads → buyer is told, and the buyer's chat shows the read time
    const before = (await buyer('GET', '/api/bootstrap')).data.chats[0].otherRead;
    await new Promise((r) => setTimeout(r, 5));
    await seller('POST', `/api/chats/${chatId}/read`);
    await buyerStream.waitFor(/event: sync/);
    const after = (await buyer('GET', '/api/bootstrap')).data.chats[0].otherRead;
    assert.ok(after > before);
    assert.ok(after >= seen0.messages.at(-1).createdAt);
    // reply goes back the other way
    await seller('POST', `/api/chats/${chatId}/messages`, { text: 'Yes, come and see it.' });
    await buyerStream.waitFor(/event: sync/);
    assert.equal((await buyer('GET', '/api/bootstrap')).data.messages.at(-1).text, 'Yes, come and see it.');
    // outsiders cannot inject typing events
    const spy = client(); await spy('POST', '/api/auth/register', { ...newUser, email: 'rt-spy@example.com', phone: '9111111103' });
    assert.equal((await spy('POST', `/api/chats/${chatId}/typing`)).status, 404);
  } finally { sellerStream.close(); buyerStream.close(); }
});

test('finance request: email field, owner e-mail alert with details, live owner update', async () => {
  const sent = [];
  const mailer = { enabled: true, send: async (m) => { sent.push(m); return 'sent'; } };
  process.env.NOTIFY_EMAIL = 'shop@gmail.com, second@gmail.com';
  const srv2 = createApp({ demo: false, mailer }).listen(0);
  const o2 = `http://127.0.0.1:${srv2.address().port}`;
  const u = client(o2), o = client(o2);
  try {
    await u('POST', '/api/auth/register', { ...newUser, email: 'fin@example.com', phone: '9677000001' });
    await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
    const body = { name: 'Fin Buyer', age: 40, mobile: '9677000001', email: 'fin.buyer@gmail.com', city: 'Hyderabad', state: 'Telangana', pincode: '500001', listingId: 'TIP123450' };
    assert.equal((await u('POST', '/api/finance', { ...body, email: 'nope' })).data.field, 'email');
    assert.equal((await u('POST', '/api/finance', { ...body, email: '' })).data.field, 'email');

    // owner's dashboard is told instantly
    const stream = await (async () => { const c = new AbortController(); const r = await fetch(o2 + '/api/events', { headers: { cookie: o.cookie() }, signal: c.signal }); const rd = r.body.getReader(); let buf = ''; return { c, wait: async (re) => { const end = Date.now() + 3000; while (Date.now() < end) { if (re.test(buf)) return; const x = await Promise.race([rd.read(), new Promise((r2) => setTimeout(() => r2(null), 150))]); if (x && x.value) buf += Buffer.from(x.value).toString(); } throw new Error('no sync event: ' + buf); } }; })();
    await stream.wait(/event: hello/);
    const made = await u('POST', '/api/finance', body);
    assert.equal(made.status, 201);
    assert.equal(made.data.request.email, 'fin.buyer@gmail.com');
    await stream.wait(/event: sync/);
    stream.c.abort();
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(sent.length, 2); // one to the owner(s), one confirmation to the customer
    const ownerMail = sent.find((m) => Array.isArray(m.to));
    assert.deepEqual(ownerMail.to, ['shop@gmail.com', 'second@gmail.com']);
    assert.match(ownerMail.subject, /New finance request/);
    for (const needle of ['Fin Buyer', '9677000001', 'fin.buyer@gmail.com', 'Hyderabad', '500001', 'TIP123450']) assert.ok(ownerMail.text.includes(needle), needle);
    assert.equal(ownerMail.replyTo, 'fin.buyer@gmail.com');
    assert.equal(sent.find((m) => m.to === 'fin.buyer@gmail.com').subject.includes('finance request'), true);

    const list = (await o('GET', '/api/owner/finance')).data.requests;
    const row = list.find((r) => r.email === 'fin.buyer@gmail.com');
    assert.equal(row.mailStatus, 'sent');
    assert.ok((await o('GET', '/api/bootstrap')).data.ownerCounts.financeNew >= 1);

    // a failing mail provider never breaks the request, and the owner can see it failed
    mailer.send = async () => { throw new Error('provider down'); };
    const u2 = client(o2); await u2('POST', '/api/auth/register', { ...newUser, email: 'fin2@example.com', phone: '9677000002' });
    assert.equal((await u2('POST', '/api/finance', { ...body, listingId: 'LOR123456', mobile: '9677000002' })).status, 201);
    await new Promise((r) => setTimeout(r, 150));
    assert.ok((await o('GET', '/api/owner/finance')).data.requests.some((r) => r.mailStatus === 'failed'));
  } finally { srv2.close(); delete process.env.NOTIFY_EMAIL; }
});

test('owner chooses which blocks of the vehicle page are shown', async () => {
  const o = client(), u = client(), anon = client();
  await o('POST', '/api/auth/login', { id: 'boss@example.com', password: 'ownerpass1', as: 'owner' });
  await u('POST', '/api/auth/register', { ...newUser, email: 'lay@example.com', phone: '9677000003' });
  assert.deepEqual((await anon('GET', '/api/bootstrap')).data.layoutHidden, []);
  assert.equal((await u('PUT', '/api/owner/layout', { hidden: ['views'] })).status, 403);
  const defs = (await o('GET', '/api/owner/layout')).data;
  assert.ok(defs.blocks.some((b) => b.key === 'spec_engine') && defs.blocks.some((b) => b.key === 'finance'));
  assert.equal((await o('PUT', '/api/owner/layout', { hidden: ['nonsense'] })).status, 400);
  assert.deepEqual((await o('PUT', '/api/owner/layout', { hidden: ['views', 'row_regno_typo'.replace('_regno_typo', '_reg'), 'views'] })).data.hidden, ['views', 'row_reg']);
  assert.deepEqual((await anon('GET', '/api/bootstrap')).data.layoutHidden, ['views', 'row_reg']);
  await o('PUT', '/api/owner/layout', { hidden: [] });
  assert.deepEqual((await anon('GET', '/api/bootstrap')).data.layoutHidden, []);
});

test('brand assets: logo files, favicon, share image URL', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<link rel="icon" type="image\/png" href="\/brand\/favicon.png">/);
  assert.match(html, new RegExp(`og:image" content="${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/brand/og-image.png"`));
  assert.ok(!html.includes('__ORIGIN__'));
  for (const f of ['logo.png', 'logo-dark.png', 'logo-full.png', 'icon.png', 'favicon.png', 'apple-touch-icon.png', 'og-image.png']) {
    const r = await fetch(`${base}/brand/${f}`);
    assert.equal(r.status, 200, f);
    assert.equal(r.headers.get('content-type'), 'image/png', f);
  }
  assert.equal((await fetch(base + '/favicon.ico')).status, 200);
  const manifest = await (await fetch(base + '/site.webmanifest')).json();
  assert.equal(manifest.short_name, 'Autoreboot');
});

test('vehicle photos and intro animation are served', async () => {
  for (const f of ['lorry', 'mini-truck', 'tractor', 'bus', 'excavator', 'harvester', 'three-wheeler']) {
    const r = await fetch(`${base}/brand/vehicles/${f}.webp`);
    assert.equal(r.status, 200, f);
    assert.equal(r.headers.get('content-type'), 'image/webp', f);
  }
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /id="intro"/);
  assert.match(html, /\/brand\/logo-dark-full\.png/);
});
