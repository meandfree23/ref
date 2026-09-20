export const dailyResearchItemTarget = 15;

export function kstDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function todayKstKey() {
  return kstDateKey();
}

export function itemsForKstDate(items = [], key = todayKstKey()) {
  return items.filter((item) => {
    const value = item?.date || item?.archivedAt;
    return value && kstDateKey(value) === key;
  });
}

export function kstDateKeyToIso(key) {
  return new Date(`${key}T23:59:59+09:00`).toISOString();
}
