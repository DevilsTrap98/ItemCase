// Shared with CollectorLevel.jsx — kept in sync so the number shown on the
// forum (see server's users.level, synced from here) always matches what
// the Level screen shows for the same collection.
export function levelFromXp(xp) {
  let level = 1;
  while (xp >= level * level * 20) level++;
  const currentFloor = (level - 1) * (level - 1) * 20;
  const nextCeil = level * level * 20;
  return { level, currentFloor, nextCeil };
}

export function computeCollectorLevel(items, categories) {
  const totalItems = items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
  const categoryCount = categories.length;
  const itemsWithImages = items.filter((i) => i.imagePath).length;
  const xp = totalItems * 10 + categoryCount * 15 + itemsWithImages * 5;
  return levelFromXp(xp).level;
}
