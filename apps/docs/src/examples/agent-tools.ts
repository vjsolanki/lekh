import { agentTools, type Editor } from "lekh";

/**
 * Run one turn of your agent against the editor.
 *
 * `askModel` stands for your model SDK. Pass it the tools, and it gives back
 * the tool calls the model made.
 */
export async function runTurn(editor: Editor, prompt: string): Promise<void> {
  const tools = agentTools(editor, { focus: editor.getSelection() });

  const calls = await askModel(prompt, tools.definitions);
  for (const call of calls) {
    const result = tools.call(call.name, call.input);
    // Send the result back to the model as the call's answer.
    await answerModel(call.id, JSON.stringify(result.content), result.isError);
  }
}

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

declare function askModel(
  prompt: string,
  tools: ReturnType<typeof agentTools>["definitions"],
): Promise<readonly ToolCall[]>;

declare function answerModel(
  id: string,
  content: string,
  isError: boolean,
): Promise<void>;
