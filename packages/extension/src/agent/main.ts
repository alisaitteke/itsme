import { browser } from 'wxt/browser';
import { click, focus, locate, type } from './actions.ts';
import { AgentError, type AgentRequest, type AgentResponse, isAgentRequest } from './messages.ts';
import { takeSnapshot } from './snapshot.ts';

function run(request: AgentRequest): unknown {
  switch (request.kind) {
    case 'snapshot':
      return takeSnapshot(request.maxTextLength);
    case 'click':
      click(request.ref);
      return {};
    case 'type':
      type(request.ref, request.text, request.clear, request.submit);
      return {};
    case 'locate':
      return locate(request.ref);
    case 'focus':
      return focus(request.ref, request.select);
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
