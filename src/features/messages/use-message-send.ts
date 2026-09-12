"use client";

import { useCallback, useState } from "react";

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
  const [attempts, setAttempts] = useState<MessageSendAttempt[]>([]);
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const formAction = useCallback((formData: FormData) => {
    const clientMessageId = String(
      formData.get("clientMessageId") || crypto.randomUUID(),
    );
    const body = String(formData.get("body") ?? "");
    formData.set("clientMessageId", clientMessageId);
    setAttempts((current) => [
      ...current.filter((attempt) => attempt.clientMessageId !== clientMessageId),
      { clientMessageId, body, status: "sending" },
    ]);
    onStart();
    setPending(true);
    void action(state, formData)
      .then((result) => {
        setState(result);
        if (result.status === "sent" && result.savedMessage) {
          onSaved(result.savedMessage);
          setAttempts((current) => current.filter(
            (attempt) => attempt.clientMessageId !== clientMessageId,
          ));
        } else {
          setAttempts((current) => current.map((attempt) =>
            attempt.clientMessageId === clientMessageId
              ? { ...attempt, status: "failed" }
              : attempt,
          ));
        }
      })
      .catch(() => {
        setAttempts((current) => current.map((attempt) =>
          attempt.clientMessageId === clientMessageId
            ? { ...attempt, status: "failed" }
            : attempt,
        ));
      })
      .finally(() => setPending(false));
  }, [action, onSaved, onStart, state]);

  const retry = useCallback((clientMessageId: string) => {
    const attempt = attempts.find(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (!attempt || pending) return;
    const formData = new FormData();
    for (const [name, value] of Object.entries(fixedFields)) {
      formData.set(name, value);
    }
    formData.set("clientMessageId", attempt.clientMessageId);
    formData.set("body", attempt.body);
    formAction(formData);
  }, [attempts, fixedFields, formAction, pending]);

  return { attempts, formAction, pending, retry, state };
}
