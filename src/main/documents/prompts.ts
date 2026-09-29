/**
 * Prompt round trips to the renderer: a prompt is sent as a `documents:event` and resolved by
 * `documents:answerPrompt`. Pending prompts are re-sent after a renderer reload and answered with
 * "cancel" when the window goes away or their document is closed, so no flow can hang forever.
 */
import type { DocumentEvent, Prompt, PromptAnswer } from '@shared/api/documents';
import { randomToken } from '../files/fsUtil';

export type PromptKind = Prompt['kind'];
export type PromptOf<K extends PromptKind> = Extract<Prompt, { kind: K }>;
export type AnswerOf<K extends PromptKind> = Extract<PromptAnswer, { kind: K }>;

export function cancelAnswer(kind: PromptKind): PromptAnswer {
  switch (kind) {
    case 'password':
      return { kind, password: null };
    case 'saveRisk':
      return { kind, choice: 'cancel' };
    case 'unsavedChanges':
      return { kind, choice: 'cancel' };
    case 'overwriteNewer':
      return { kind, choice: 'cancel' };
    case 'closeStuck':
      return { kind, choice: 'cancel' };
    case 'csvImport':
      return { kind, separator: null, locale: '' };
  }
}

interface Pending {
  prompt: Prompt;
  /** Document the prompt belongs to (password/CSV prompts carry no docId themselves). */
  owner?: string;
  resolve: (answer: PromptAnswer) => void;
}

export class PromptBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly send: (event: DocumentEvent) => void) {}

  ask<K extends PromptKind>(input: Omit<PromptOf<K>, 'id'> & { kind: K }, owner?: string): Promise<AnswerOf<K>> {
    const id = `p${randomToken(6)}`;
    const prompt = { ...input, id } as unknown as Prompt;
    return new Promise<AnswerOf<K>>((resolve) => {
      this.pending.set(id, { prompt, ...(owner ? { owner } : {}), resolve: resolve as (a: PromptAnswer) => void });
      this.send({ type: 'prompt', prompt });
    });
  }

  /** Resolves a pending prompt. Returns false for unknown ids or an answer of the wrong kind. */
  answer(promptId: string, answer: PromptAnswer): boolean {
    const p = this.pending.get(promptId);
    if (!p || p.prompt.kind !== answer.kind) return false;
    this.pending.delete(promptId);
    p.resolve(answer);
    return true;
  }

  /** Answers every pending prompt with "cancel" (window closed, shutdown). */
  cancelAll(): void {
    for (const [id, p] of [...this.pending]) {
      this.pending.delete(id);
      p.resolve(cancelAnswer(p.prompt.kind));
    }
  }

  /** Answers the pending prompts of one document with "cancel" (the document was closed). */
  cancelFor(docId: string): void {
    for (const [id, p] of [...this.pending]) {
      const promptDoc = 'docId' in p.prompt ? p.prompt.docId : undefined;
      if (p.owner !== docId && promptDoc !== docId) continue;
      this.pending.delete(id);
      p.resolve(cancelAnswer(p.prompt.kind));
    }
  }

  /** Re-sends pending prompts (the renderer was reloaded and lost its state). */
  resend(): void {
    for (const p of this.pending.values()) this.send({ type: 'prompt', prompt: p.prompt });
  }

  get size(): number {
    return this.pending.size;
  }
}
