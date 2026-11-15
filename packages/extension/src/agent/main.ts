import { browser } from 'wxt/browser';
import { click, focus, hover, locate, press, scroll, type, upload } from './actions.ts';
import { annotate } from './annotate/index.ts';
import { deepActiveElement } from './dom.ts';
import { centerOf, isPoint, type Point } from './geometry.ts';
import {
  hideIndicator,
  pulseIndicator,
  showIndicator,
  tuckBadge,
  watchIndicatorStyle,
} from './indicator.ts';
import {
  AgentError,
  type AgentRequest,
  type AgentResponse,
  type AgentResults,
  isAgentRequest,
} from './messages.ts';
import { find, hasText, readText, resolveLocator, takeSnapshot } from './outline.ts';
import { showSitePrompt } from './prompt.ts';
import { resolveRef } from './refs.ts';

/** Calls that only serve the extension's own UI and don't count as using the tab. */
const PASSIVE = new Set<AgentRequest['kind']>(['prompt', 'viewport', 'hideIndicator']);

function run(request: AgentRequest): unknown {
  switch (request.kind) {
    case 'snapshot':
      return takeSnapshot(request);
    case 'find':
      return find(request.query);
    case 'text':
      return readText(request.maxChars);
    case 'viewport':
      return { width: innerWidth, height: innerHeight };
    case 'prompt':
      showSitePrompt(request.host);
      return {};
    case 'hideIndicator':
      hideIndicator();
      return {};
    case 'annotate':
      return annotate(request.title, request.marks, request.keep);
    case 'hasText':
      return hasText(request.text);
    case 'resolve':
      return resolveLocator(request.locator);
    case 'upload':
      upload(request.ref, request.files);
      return {};
    case 'locate':
      return locate(request.target, request.scroll);
    case 'click':
      click(request.target, request.button, request.count, request.modifiers);
      return {};
    case 'hover':
      hover(request.target);
      return {};
    case 'focus':
      return focus(request.ref, request.select);
    case 'type':
      type(request.ref, request.text, request.clear, request.submit);
      return {};
    case 'press':
      press(request.key, request.modifiers, request.count);
      return {};
    case 'scroll':
      return scroll(request.ref, request.direction, request.amount);
  }
}

const centerOfRef = (ref: string | undefined): Point | null => {
  const el = ref === undefined ? deepActiveElement() : resolveRef(ref);
  return el ? centerOf(el) : null;
};

/** Where the request acted and a word for what it did, for the indicator to react to. */
function describe(request: AgentRequest, result: unknown): [Point | null, string] {
  switch (request.kind) {
    case 'locate': {
      const { x, y } = result as AgentResults['locate'];
      return [{ x, y }, request.why];
    }
    case 'click':
    case 'hover': {
      const { target } = request;
      return [isPoint(target) ? target : centerOfRef(target.ref), request.kind];
    }
    case 'focus':
    case 'type':
      return [centerOfRef(request.ref), 'type'];
    case 'upload':
      return [centerOfRef(request.ref), 'upload'];
    case 'press':
      return [centerOfRef(undefined), 'key'];
    case 'scroll':
      return [{ x: innerWidth / 2, y: innerHeight / 2 }, 'scroll'];
    default:
      return [null, 'read'];
  }
}

function announce(request: AgentRequest, result: unknown): void {
  try {
    pulseIndicator(...describe(request, result));
  } catch {
    // The element can be gone by now, e.g. after a click that navigated. No pulse then.
  }
}

function respond(request: AgentRequest): AgentResponse {
  try {
    const active = !PASSIVE.has(request.kind);
    if (active) showIndicator();
    // The badge must not be where a real click is about to land, or the click presses Stop.
    if (request.kind === 'locate') tuckBadge();
    const result = run(request);
    if (active) announce(request, result);
    return { ok: true, result };
  } catch (error) {
    return error instanceof AgentError
      ? { ok: false, error: { code: error.code, message: error.message } }
      : { ok: false, error: { code: 'INTERNAL', message: String(error) } };
  }
}

/** Runs `done` after the next repaint, or shortly after if the tab isn't painting. */
function afterPaint(done: () => void): void {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    done();
  };
  requestAnimationFrame(() => requestAnimationFrame(once));
  setTimeout(once, 120);
}

export function startAgent(): void {
  // After an extension reload the old copy still sits in this world; the newest one answers.
  const scope = globalThis as { __itsmeAgent?: symbol };
  const instance = Symbol('itsme-agent');
  scope.__itsmeAgent = instance;

  watchIndicatorStyle();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (scope.__itsmeAgent !== instance || !isAgentRequest(message)) return;
    if (message.kind === 'hideIndicator') {
      hideIndicator();
      // Answer once the page has repainted without it: a screenshot follows.
      afterPaint(() => sendResponse({ ok: true, result: {} } satisfies AgentResponse));
      return true;
    }
    sendResponse(respond(message));
  });
}
