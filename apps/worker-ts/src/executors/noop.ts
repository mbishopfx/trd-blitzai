import type { ActionExecutor } from "../types";

export class NoopActionExecutor implements ActionExecutor {
  async execute(input: { action: { payload: Record<string, unknown>; actionType: string } }) {
    return {
      output: {
        status: "ok",
        actionType: input.action.actionType,
        objective: input.action.payload.objective ?? null,
        executedAt: new Date().toISOString()
      }
    };
  }

  async rollback(input: { action: { id: string } }) {
    return {
      output: {
        status: "rolled_back",
        actionId: input.action.id,
        rolledBackAt: new Date().toISOString()
      }
    };
  }
}
