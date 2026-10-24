import { effect, signal } from '@preact/signals';
import { CAR_ENTRANCES, type CarEntranceId } from '../data-next/car-entrances';
import { ENTRANCES, setEntranceOpen } from '../routing/garage';

/**
 * Which of the new vehicle entrances are open, starting from car-entrances.ts (owner). Like the
 * restrooms' status, a change stays on the supervisor's device, in this page, until a server
 * shares it with every visitor.
 */
export const entranceOpen = signal<Record<CarEntranceId, boolean>>(Object.fromEntries(CAR_ENTRANCES.map((e) => [e.id, e.open])) as Record<CarEntranceId, boolean>);

export function toggleEntrance(id: CarEntranceId): void {
  entranceOpen.value = { ...entranceOpen.value, [id]: !entranceOpen.value[id] };
}

// Every entrance the route planner knows (Omar ibn al-Khattab street, Sultana, Qurban) follows the
// supervisor's button: closed, no route goes in or out through it (owner, 2026-10-23 for Qurban,
// 2026-10-24 for the other two). Quba and the east one are not in the planner.
effect(() => {
  for (const e of ENTRANCES) setEntranceOpen(e.id, entranceOpen.value[e.id]);
});
