import type { Handlers } from '../router.ts';
import { automationHandlers } from './automations.ts';
import { pageHandlers } from './page.ts';
import { tabHandlers } from './tabs.ts';

export const handlers: Handlers = { ...tabHandlers, ...pageHandlers, ...automationHandlers };
