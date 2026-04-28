/**
 * Time-aware greeting for the dashboard hero card.
 *
 * Hour boundaries (browser-local time, not server UTC):
 *   5-11   → "Good morning"
 *   12-17  → "Good afternoon"
 *   18-4   → "Good evening" (covers late-night/early-AM as still-evening so
 *           the agency team grinding past midnight doesn't get told it's
 *           "morning" at 2am)
 *
 * Falls back to "Welcome back" when no first name is available — keeps the
 * pre-greeting render identical to the legacy string so there's no
 * flash-of-wrong-content while authApi.me() is pending.
 */
export function greeting(hour: number, firstName?: string | null): string {
  const name = firstName?.trim();
  if (!name) return 'Welcome back';

  let timeOfDay: string;
  if (hour >= 5 && hour < 12) timeOfDay = 'Good morning';
  else if (hour >= 12 && hour < 18) timeOfDay = 'Good afternoon';
  else timeOfDay = 'Good evening';

  return `${timeOfDay}, ${name}`;
}
