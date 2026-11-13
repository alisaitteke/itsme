import { browser } from 'wxt/browser';
import { click, focus, hover, locate, press, scroll, type } from './actions.ts';
import { AgentError, type AgentRequest, type AgentResponse, isAgentRequest } from './messages.ts';
import { find, readText, takeSnapshot } from './outline.ts';

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

function respond(request: AgentRequest): AgentResponse {
  try {
    return { ok: true, result: run(request) };
  } catch (error) {
    return error instanceof AgentError
      ? { ok: false, error: { code: error.code, message: error.message } }
      : { ok: false, error: { code: 'INTERNAL', message: String(error) } };
  }
}

export function startAgent(): void {
  // After an extension reload the old copy still sits in this world; the newest one answers.
  const scope = globalThis as { __itsmeAgent?: symbol };
  const instance = Symbol('itsme-agent');
  scope.__itsmeAgent = instance;

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (scope.__itsmeAgent !== instance || !isAgentRequest(message)) return;
    sendResponse(respond(message));
  });
}
