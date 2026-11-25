// Site Board notification scheduler. Run every 15 minutes by GitHub Actions.
// Needs the secret FIREBASE_SERVICE_ACCOUNT (the JSON key from Firebase → Project settings → Service accounts).
const admin = require('firebase-admin');
const { notesFor, istDate } = require('./notify-core');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Missing FIREBASE_SERVICE_ACCOUNT secret'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore(), fcm = admin.messaging();

(async () => {
  const now = Date.now(), stRef = db.doc('meta/pushState'), st = await stRef.get();
  let last = st.exists ? st.data().lastRunAt : now - 15 * 60000;
  if (now - last > 3 * 3600e3) last = now - 3 * 3600e3;   // never catch up more than 3 hours
  const today = istDate(now);

  const toks = await db.collection('pushTokens').get();
  if (toks.empty) { await stRef.set({ lastRunAt: now }); console.log('No devices registered.'); return; }
  const byPerson = new Map();
  toks.forEach(d => { const k = d.data().kind + '-' + d.data().refId; if (!byPerson.has(k)) byPerson.set(k, []); byPerson.get(k).push(d.id); });

  const [logins, prefs, sites, todayS, newS, asgS] = await Promise.all([
    db.collection('logins').get(), db.collection('prefs').get(), db.collection('sites').get(),
    db.collection('tasks').where('date', '==', today).get(),
    db.collection('tasks').where('createdAt', '>', last).get(),
    db.collection('tasks').where('assignedAt', '>', last).get()]);
  const P = new Map(); prefs.forEach(d => P.set(d.id, d.data()));
  const S = new Map(); sites.forEach(d => S.set(d.id, d.data().name));
  const rows = q => q.docs.map(d => ({ id: d.id, ...d.data() }));
  const data = { today, todayTasks: rows(todayS), newTasks: rows(newS), assignedTasks: rows(asgS), siteName: id => S.get(id) || 'Site' };

  let sent = 0, removed = 0;
  for (const L of logins.docs.map(d => d.data())) {
    const key = L.kind + '-' + L.refId, tokens = byPerson.get(key);
    if (!tokens) continue;
    for (const n of notesFor(L, P.get(key), data, last, now)) {
      for (const token of tokens) {
        try {
          await fcm.send({ token, data: { title: n.title, body: n.body, link: n.link, d: n.d || '', tag: n.tag },
            webpush: { headers: { Urgency: 'high', TTL: '21600' } } });
          sent++;
        } catch (e) {
          const c = e.code || (e.errorInfo && e.errorInfo.code) || '';
          if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(c)) {
            await db.doc('pushTokens/' + token).delete().catch(() => {}); removed++;
          } else console.warn('send failed', c, e.message);
        }
      }
    }
  }
  await stRef.set({ lastRunAt: now });
  console.log(`Window ${new Date(last).toISOString()} → ${new Date(now).toISOString()}: sent ${sent}, removed ${removed} old devices.`);
})().catch(e => { console.error(e); process.exit(1); });
