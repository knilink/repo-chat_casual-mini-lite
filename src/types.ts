import type {
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources';

export type FirstMessageItem =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'file';
      filePath: string;
      fileContent: string;
    };

export type ChatEvent = { requestId: string } & (
  | { type: 'cloning'; inProgress: boolean }
  | { type: 'retrieving'; inProgress: boolean }
  | { type: 'prompt_processing'; inProgress: boolean }
  | { type: 'streaming'; chunk: string | null }
  | { type: 'initial_message'; content: FirstMessageItem[]; formatted: string }
  | { type: 'append_message'; message: { role: string; content: string } }
  | { type: 'error'; errorMessage?: string }
);

export type ChatCompletionMessageParam = ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam;

export interface SendMessageRequest {
  requestId: string;
  repoUrl: string;
  chatHistory: ChatCompletionMessageParam[];
  messageToBeSent: string;
}

export type RepochatMessage =
  | {
      action: 'sendMessage';
      request: SendMessageRequest;
      completionParams: Pick<ChatCompletionCreateParamsStreaming, 'model'>;
    }
  | {
      action: 'listModels';
    };
