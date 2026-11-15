import { loadAutomations } from '../../shared/automations.ts';
import { deleteAutomation } from '../automations/scheduler.ts';
import { createAutomation, pauseAutomation } from '../automations/store.ts';
import type { Handlers } from '../router.ts';

// There is no handler that switches an automation on: that takes the user, in the
// extension's own page.
export const automationHandlers: Handlers = {
  'automation.create': async (input) => ({ automation: await createAutomation(input) }),

  'automation.list': async () => ({ automations: await loadAutomations() }),

  'automation.pause': async ({ id }) => ({
    automation: await pauseAutomation(id, 'Paused by the AI app'),
  }),

  'automation.remove': async ({ id }) => {
    await deleteAutomation(id);
    return {};
  },
};
