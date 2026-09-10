import type { SyncedCourseMessage } from "./message-sync";

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
  insertOwnMessage(
    conversationId: string,
    body: string,
  ): Promise<SyncedCourseMessage>;
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

    async sendCourseMessage(courseId: string, rawBody: string) {
      const member = await dependencies.getCurrentMember();
      if (!member?.onboardingComplete) {
        return { status: "unauthenticated" } as const;
      }

      const body = rawBody.trim();
      if (!body || Array.from(body).length > 4_000) {
        return { status: "invalid" } as const;
      }

      const course = await dependencies.getJoinedCourse(courseId);
      if (!course || course.archived) {
        return { status: "not_available" } as const;
      }

      try {
        const message = await dependencies.insertOwnMessage(
          course.conversationId,
          body,
        );
        return { status: "sent", message } as const;
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
    },
  };
}
