"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SEND_TIMEOUT_MS = 15_000;

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
  retryable?: boolean;
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
  const pending = attempts.some((attempt) => attempt.status === "sending");
  const requestVersions = useRef(new Map<string, number>());
  const timeoutHandles = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    for (const timeoutHandle of timeoutHandles.current) {
      clearTimeout(timeoutHandle);
    }
  }, []);

  const formAction = useCallback((formData: FormData) => {
    const clientMessageId = String(
      formData.get("clientMessageId") || crypto.randomUUID(),
    );
    const body = String(formData.get("body") ?? "");
    formData.set("clientMessageId", clientMessageId);
    const requestVersion = (requestVersions.current.get(clientMessageId) ?? 0) + 1;
    requestVersions.current.set(clientMessageId, requestVersion);
    setAttempts((current) => [
      ...current.filter((attempt) => attempt.clientMessageId !== clientMessageId),
      { clientMessageId, body, status: "sending" },
    ]);
    onStart();
    const timeoutHandle = setTimeout(() => {
      timeoutHandles.current.delete(timeoutHandle);
      if (requestVersions.current.get(clientMessageId) !== requestVersion) return;
      setAttempts((current) => current.map((attempt) =>
        attempt.clientMessageId === clientMessageId
          ? { ...attempt, status: "failed", retryable: true }
          : attempt,
      ));
    }, SEND_TIMEOUT_MS);
    timeoutHandles.current.add(timeoutHandle);
    const clearWatchdog = () => {
      clearTimeout(timeoutHandle);
      timeoutHandles.current.delete(timeoutHandle);
    };
    void action(state, formData)
      .then((result) => {
        clearWatchdog();
        const currentVersion = requestVersions.current.get(clientMessageId);
        if (currentVersion === undefined) return;
        if (result.status === "sent" && result.savedMessage) {
          requestVersions.current.delete(clientMessageId);
          setState(result);
          onSaved(result.savedMessage);
          setAttempts((current) => current.filter(
            (attempt) => attempt.clientMessageId !== clientMessageId,
          ));
          return;
        }
        if (currentVersion !== requestVersion) return;
        setState(result);
        setAttempts((current) => current.map((attempt) =>
          attempt.clientMessageId === clientMessageId
            ? {
                ...attempt,
                status: "failed",
                retryable: ["temporarily_unavailable", "unavailable"].includes(
                  result.status,
                ),
              }
            : attempt,
        ));
      })
      .catch(() => {
        clearWatchdog();
        if (requestVersions.current.get(clientMessageId) !== requestVersion) return;
        setAttempts((current) => current.map((attempt) =>
          attempt.clientMessageId === clientMessageId
            ? {
                ...attempt,
                status: "failed",
                retryable: true,
              }
            : attempt,
        ));
      });
  }, [action, onSaved, onStart, state]);

  const retry = useCallback((clientMessageId: string) => {
    const attempt = attempts.find(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (
      !attempt ||
      !attempt.retryable ||
      pending
    ) return;
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
