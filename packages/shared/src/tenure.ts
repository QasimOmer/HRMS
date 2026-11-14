/** "Member for 1 year 2 months" (B5). Dates are YYYY-MM-DD strings. */
export function tenureLabel(joiningDate: string, today: string = new Date().toISOString().slice(0, 10)): string {
  const [jy, jm, jd] = joiningDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let months = (ty - jy) * 12 + (tm - jm);
  if (td < jd) months -= 1;
  if (months < 1) {
    const days = Math.max(0, Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(jy, jm - 1, jd)) / 86_400_000));
    return days <= 1 ? 'Joined recently' : `Member for ${days} days`;
  }
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} year${y > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} month${m > 1 ? 's' : ''}`);
  return `Member for ${parts.join(' ')}`;
}

/** "Joined 13 November 2026": the one wording for joining dates everywhere (profile, employee page, directory). */
export function joinedLabel(joiningDate: string): string {
  const [y, m, d] = joiningDate.slice(0, 10).split('-').map(Number) as [number, number, number];
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
  return `Joined ${d} ${month} ${y}`;
}
