// Decides which notifications are due for whom. Pure logic, no database access.
const IST = 330 * 60000; // India Standard Time, UTC+05:30 (no daylight saving)
const PDEF = { morning: '09:00', afternoon: '14:00', evening: '18:00',
  on: { morning: true, afternoon: true, evening: true, newTask: true, reminders: true } };

const istDate = ms => new Date(ms + IST).toISOString().slice(0, 10);
const istAt = (dateStr, hhmm) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const mm = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!mm) return NaN;
  return Date.UTC(y, m - 1, d, Number(mm[1]), Number(mm[2])) - IST;
};
const short = dateStr => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return d + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1];
};
const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const prefsFor = p => { const x = p || {}; return { ...PDEF, ...x, on: { ...PDEF.on, ...(x.on || {}) } }; };

/**
 * @param login   {kind, refId, role, sites}
 * @param prefs   the person's saved notification settings (or null)
 * @param data    {today, todayTasks, newTasks, assignedTasks, siteName(id)}
 * @param last,now  window (ms) – only things due in (last, now] are sent
 */
function notesFor(login, prefs, data, last, now) {
  const p = prefsFor(prefs), out = [], role = login.role, isC = role === 'contractor', me = login.refId;
  const allSites = ['owner', 'office', 'accountant'].includes(role);
  const visible = t => isC ? t.contractorId === me : (allSites || (login.sites || []).includes(t.siteId));
  const due = ms => ms > last && ms <= now;
  const tdy = data.today, todayT = data.todayTasks.filter(visible), pendT = todayT.filter(t => t.status !== 'done');

  if (p.on.newTask) {
    if (isC) {
      data.assignedTasks.filter(t => t.contractorId === me && due(t.assignedAt || 0)).forEach(t =>
        out.push({ tag: 'as-' + t.id + '-' + t.assignedAt, title: 'New work assigned to you',
          body: `${t.title} · ${data.siteName(t.siteId)} · ${short(t.date)}`, link: 'day', d: t.date }));
    } else {
      const nt = data.newTasks.filter(t => visible(t) && due(t.createdAt || 0) && !(t.createdBy && t.createdBy.id === me));
      if (nt.length === 1) { const t = nt[0];
        out.push({ tag: 'n-' + t.id, title: 'New task · ' + data.siteName(t.siteId),
          body: `${t.title} · for ${short(t.date)}${t.createdBy ? ' · added by ' + t.createdBy.name : ''}`, link: 'site-' + t.siteId, d: t.date });
      } else if (nt.length > 1) {
        out.push({ tag: 'n-batch-' + now, title: pl(nt.length, 'new task'),
          body: nt.slice(0, 3).map(t => `${t.title} (${data.siteName(t.siteId)})`).join(', ') + (nt.length > 3 ? '…' : ''), link: 'dashboard', d: '' });
      }
    }
  }
  if (p.on.morning && due(istAt(tdy, p.morning)) && todayT.length)
    out.push({ tag: 'm-' + tdy, title: "Good morning · today's tasks",
      body: isC ? `${pl(todayT.length, 'task')} assigned to you today. Tap to see them.`
                : `${pl(todayT.length, 'task')} today across ${pl(new Set(todayT.map(t => t.siteId)).size, 'site')}. Review and assign them.`,
      link: 'day', d: tdy });
  if (p.on.afternoon && due(istAt(tdy, p.afternoon)) && pendT.length)
    out.push({ tag: 'a-' + tdy, title: 'Afternoon follow-up',
      body: `${pl(pendT.length, 'task')} of today ${pendT.length === 1 ? 'is' : 'are'} still pending.`, link: 'day', d: tdy });
  if (p.on.evening && due(istAt(tdy, p.evening))) {
    const dueR = todayT.filter(t => t.contractorId && !(t.progress && t.progress.status));
    if (isC) { if (dueR.length) out.push({ tag: 'e-' + tdy, title: 'Evening status update',
      body: `Please report today's progress on ${pl(dueR.length, 'task')}.`, link: 'day', d: tdy }); }
    else if (dueR.length || pendT.length) out.push({ tag: 'e-' + tdy, title: 'Evening status update',
      body: `${pl(dueR.length, 'task')} awaiting the daily report · ${pendT.length} still pending.`, link: 'report', d: tdy });
  }
  if (p.on.reminders) todayT.forEach(t => {
    if (!t.notifyAt || t.status === 'done' || !due(istAt(tdy, t.notifyAt))) return;
    const mine = (t.createdBy && t.createdBy.id === me) || t.contractorId === me || ['manager', 'coord', 'siteowner'].includes(role);
    if (mine) out.push({ tag: 'r-' + t.id + '-' + tdy + '-' + t.notifyAt, title: 'Reminder · ' + t.notifyAt,
      body: `${t.title} · ${data.siteName(t.siteId)}`, link: isC ? 'day' : 'site-' + t.siteId, d: tdy });
  });
  return out;
}
module.exports = { notesFor, istDate, istAt, IST };
