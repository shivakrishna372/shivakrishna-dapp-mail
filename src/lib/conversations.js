// Groups mailbox rows into Gmail-style conversations.
export function groupConversations(rows, view) {
  const single = view.type === 'drafts' || view.type === 'scheduled';
  const map = new Map();
  for (const row of rows) {
    const m = row.message;
    if (!m) continue;
    const key = !single && m.thread_id ? `t:${m.thread_id}` : `m:${m.id}`;
    if (!map.has(key)) map.set(key, { key, threadId: single ? null : m.thread_id, rows: [] });
    map.get(key).rows.push(row);
  }
  const msgDate = (r) => r.message.sent_at || r.message.scheduled_at || r.message.updated_at || r.message.created_at;

  const list = [...map.values()].map((c) => {
    c.rows.sort((a, b) => new Date(msgDate(b)) - new Date(msgDate(a)));
    const latest = c.rows[0];
    const labelIds = new Set();
    c.rows.forEach((r) => (r.labels || []).forEach((l) => labelIds.add(l.label_id)));
    return {
      ...c,
      latest,
      message: latest.message,
      date: msgDate(latest),
      unread: c.rows.some((r) => !r.is_read),
      starred: c.rows.some((r) => r.is_starred),
      important: c.rows.some((r) => r.is_important),
      snoozedUntil: c.rows.find((r) => r.snoozed_until)?.snoozed_until || null,
      hasAttachment: c.rows.some((r) => r.message.attachments?.length),
      labelIds: [...labelIds],
      count: c.rows.length,
      folders: new Set(c.rows.map((r) => r.folder)),
      senderIds: [...new Set(c.rows.slice().reverse().map((r) => r.message.sender_id))],
    };
  });
  list.sort((a, b) => new Date(b.date) - new Date(a.date));
  return list;
}
