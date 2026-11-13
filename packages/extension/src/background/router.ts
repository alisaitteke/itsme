import {
  BridgeError,
  type CommandName,
  type CommandParams,
  type CommandResult,
  commands,
  isCommandName,
} from '@itsme/protocol';

export type Handlers = {
  [N in CommandName]?: (params: CommandParams<N>) => Promise<CommandResult<N>>;
};

export interface Router {
  /** Advertised to the server in the hello, so it can refuse the rest up front. */
  commands: string[];
  dispatch(command: string, params: unknown): Promise<unknown>;
}

export function createRouter(handlers: Handlers): Router {
  return {
    commands: Object.keys(handlers),
    async dispatch(command, params) {
      if (!isCommandName(command)) {
        throw new BridgeError('UNKNOWN_COMMAND', `Unknown command "${command}"`);
      }
      const handler = handlers[command] as ((params: unknown) => Promise<unknown>) | undefined;
      if (!handler) {
        throw new BridgeError('UNSUPPORTED', `This browser does not support ${command}`);
      }
      return handler(commands[command].params.parse(params ?? {}));
    },
  };
}
