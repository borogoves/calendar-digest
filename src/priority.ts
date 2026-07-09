import type { ResolvedEvent } from "./types.js";

export interface PriorityOptions {
  /**
   * Priority weight per tag, e.g. `{ travel: 3, medical: 2 }`. An event's
   * effective priority is the max of its own `priority` and the weights of
   * its tags.
   */
  tagPriorities?: Record<string, number>;
}

/** The effective priority of an event: its own, or its heaviest tag. */
export function eventPriority(
  event: ResolvedEvent,
  tagPriorities?: Record<string, number>,
): number {
  let priority = event.source.priority ?? 0;
  for (const tag of event.source.tags ?? []) {
    const weight = tagPriorities?.[tag];
    if (weight !== undefined && weight > priority) priority = weight;
  }
  return priority;
}
