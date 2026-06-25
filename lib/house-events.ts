const listeners = new Set<() => void>()

export function subscribeToHouseMembershipChanges(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyHouseMembershipChanged() {
  listeners.forEach(listener => listener())
}
