"use client";

import { useCallback, useState, useTransition } from "react";

type SendState<T> = {
  status: string;
  message: string;
  clientMessageId?: string;
  attemptedBody?: string;
  savedMessage?: T;
};

type SendAction<S> = (previousState: S, formData: FormData) => Promise<S>;

export type MessageSendAttempt = {
  clientMessageId: string;
  body: string;
  status: "sending" | "failed";
};

export function useMessageSend<T, S extends SendState<T>>({
  action,
  fixedFields,
  initialState,
  onSaved,
  onStart,
}: {
  action: SendAction<S>;
  fixedFields: Record<string, string>;
  initialState: S;
  onSaved(message: T): void;
  onStart(): void;
}) {
  const [attempt, setAttempt] = useState<MessageSendAttempt | null>(null);
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();
  const formAction = useCallback((formData: FormData) => {
    const clientMessageId = String(
      formData.get("clientMessageId") || crypto.randomUUID(),
    );
    const body = String(formData.get("body") ?? "");
    formData.set("clientMessageId", clientMessageId);
    setAttempt({ clientMessageId, body, status: "sending" });
    onStart();
    startTransition(async () => {
      try {
        const result = await action(state, formData);
        setState(result);
        if (result.status === "sent" && result.savedMessage) {
          onSaved(result.savedMessage);
          setAttempt(null);
        } else {
          setAttempt({ clientMessageId, body, status: "failed" });
        }
      } catch {
        setAttempt({ clientMessageId, body, status: "failed" });
      }
    });
  }, [action, onSaved, onStart, state]);

  const retry = useCallback(() => {
    if (!attempt || pending) return;
    const formData = new FormData();
    for (const [name, value] of Object.entries(fixedFields)) {
      formData.set(name, value);
    }
    formData.set("clientMessageId", attempt.clientMessageId);
    formData.set("body", attempt.body);
    formAction(formData);
  }, [attempt, fixedFields, formAction, pending]);

  return { attempt, formAction, pending, retry, state };
}
