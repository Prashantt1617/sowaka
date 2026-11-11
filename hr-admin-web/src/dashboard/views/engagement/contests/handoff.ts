// Which contest the Contests page should open on, when another page (the
// Engagement plan) sends someone there. Read when the page mounts, then
// cleared from an effect: StrictMode runs a state initializer twice, so
// clearing on read would lose it.
let pending: string | null = null;

export function requestContest(id: string) {
  pending = id;
}

export function requestedContest(): string | null {
  return pending;
}

export function clearRequestedContest() {
  pending = null;
}
