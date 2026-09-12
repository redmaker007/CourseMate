import type { SyncedCourseMessage } from "./message-sync";
import type { ConversationMessageSendResult } from "@/features/messages/supabase-conversation-message";

export type CourseOperationMember = {
  userId: string;
  schoolId: string;
  onboardingComplete: boolean;
};

export type CourseCandidate = {
  id: string;
  schoolId: string;
  term: string;
  currentTerm: string;
};

export type JoinedCourseAccess = {
  courseId: string;
  conversationId: string;
  archived: boolean;
};

export interface CourseOperationDependencies {
  getCurrentMember(): Promise<CourseOperationMember | null>;
  getCourseCandidate(courseId: string): Promise<CourseCandidate | null>;
  getJoinedCourse(courseId: string): Promise<JoinedCourseAccess | null>;
  joinOwnCourse(courseId: string): Promise<void>;
  leaveOwnCourse(courseId: string): Promise<void>;
  sendMessage(
    conversationId: string,
    clientMessageId: string,
    body: string,
  ): Promise<ConversationMessageSendResult>;
}

export function createCourseOperations(
  dependencies: CourseOperationDependencies,
) {
  return {
    async joinCourse(courseId: string) {
      const member = await dependencies.getCurrentMember();
      if (!member?.onboardingComplete) {
        return { status: "unauthenticated" } as const;
      }

      const course = await dependencies.getCourseCandidate(courseId);
      if (
        !course ||
        course.schoolId !== member.schoolId ||
        course.term !== course.currentTerm
      ) {
        return { status: "not_available" } as const;
      }

      try {
        await dependencies.joinOwnCourse(course.id);
        return { status: "joined" } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async leaveCourse(courseId: string) {
      const member = await dependencies.getCurrentMember();
      if (!member?.onboardingComplete) {
        return { status: "unauthenticated" } as const;
      }

      const course = await dependencies.getJoinedCourse(courseId);
      if (!course || course.archived) {
        return { status: "not_available" } as const;
      }

      try {
        await dependencies.leaveOwnCourse(course.courseId);
        return { status: "left" } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },

    async sendCourseMessage(
      conversationId: string,
      clientMessageId: string,
      rawBody: string,
    ) {
      const body = rawBody.trim();
      if (!body || Array.from(body).length > 4_000) {
        return { status: "invalid" } as const;
      }

      try {
        const result = await dependencies.sendMessage(
          conversationId,
          clientMessageId,
          body,
        );
        if (result.status === "sent" && "message" in result) {
          return {
            status: "sent",
            message: {
              id: result.message.id,
              clientMessageId: result.message.clientMessageId,
              senderId: result.message.senderId,
              senderName: result.message.senderDisplayName,
              body: result.message.body,
              createdAt: result.message.createdAt,
            } satisfies SyncedCourseMessage,
          } as const;
        }
        if (result.status === "onboarding_required") {
          return { status: "unauthenticated" } as const;
        }
        if (result.status === "invalid_body" || result.status === "invalid_request") {
          return { status: "invalid" } as const;
        }
        if (result.status === "not_available") {
          return { status: "not_available" } as const;
        }
        return { status: "temporarily_unavailable" } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },
  };
}
