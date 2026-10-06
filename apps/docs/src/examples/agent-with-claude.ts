import Anthropic from "@anthropic-ai/sdk";
import { agentTools, type Editor } from "lekh-editor";

const client = new Anthropic();

/**
 * Answer one message from your users with Claude.
 *
 * Every change Claude makes lands on the Canvas as a Suggestion. Your users
 * accept it or reject it. Nothing is stored until they do.
 */
export async function askClaude(
  editor: Editor,
  message: string,
): Promise<string> {
  // Made fresh for each message, so `focus` is the Block selected now.
  const tools = agentTools(editor, { focus: editor.getSelection() });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: message },
  ];

  for (;;) {
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16_000,
      system: "You edit marketing emails. Read the email before you change it.",
      tools: tools.definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    // No more tool calls: what Claude said is the reply for your chat.
    if (response.stop_reason !== "tool_use") {
      return response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
    }

    // Run every tool call, and send all the results back in one message.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = tools.call(block.name, block.input);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result.content),
        is_error: result.isError,
      });
    }
    messages.push({ role: "user", content: results });
  }
}
