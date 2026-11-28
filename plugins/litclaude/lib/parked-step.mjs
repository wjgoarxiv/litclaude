// A parked step that an answer can still run: a path grant, or a command not held. Read by the LIT card and by start-work's inbox.
export const canRunParked = (boundary) => Boolean(boundary) && (boundary.kind !== "command" || !boundary.hold_reason);
