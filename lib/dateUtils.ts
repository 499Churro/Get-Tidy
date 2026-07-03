export function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Shifts a YYYY-MM-DD string by ±days using UTC arithmetic.
// UTC avoids DST clock-change edge cases when adding/subtracting days.
export function offsetDate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const result = new Date(Date.UTC(y, m - 1, d + days))
  return result.toISOString().slice(0, 10)
}
