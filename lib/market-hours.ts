const US_TIMEZONE = "America/New_York";

/**
 * US equity regular session: 9:30am-4:00pm Eastern, Monday-Friday.
 * Market holidays are not modelled, so a holiday reads as "open" — the
 * indicator is a session hint, not a trading calendar.
 */
export function isUsMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: US_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  if (weekday === "Sat" || weekday === "Sun") return false;

  const minutesNow = hour * 60 + minute;
  return minutesNow >= 9 * 60 + 30 && minutesNow < 16 * 60;
}
