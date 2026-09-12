import "server-only";

import { getCurrentMember } from "@/features/auth/session";
import {
  sendSupabaseConversationMessage,
  type ConversationMessageRpcClient,
} from "@/features/messages/supabase-conversation-message";
import { createClient } from "@/lib/supabase/server";

import { createCourseOperations } from "./course-operations";

export async function createProductionCourseOperations() {
  const supabase = await createClient();
  let memberPromise: ReturnType<typeof getCurrentMember> | undefined;
  const currentMember = () => memberPromise ??= getCurrentMember();
  const messageClient = {
    rpc: supabase.rpc.bind(supabase) as unknown as ConversationMessageRpcClient["rpc"],
  };

  return createCourseOperations({
    getCurrentMember: currentMember,
    async getCourseCandidate(courseId) {
      const member = await currentMember();
      if (!member?.onboardingComplete) return null;
      const [{ data: course, error: courseError }, { data: term, error: termError }] =
        await Promise.all([
          supabase
            .from("courses")
            .select("id, school_id, term")
            .eq("id", courseId)
            .maybeSingle(),
          supabase
            .from("school_term_settings")
            .select("current_term")
            .eq("school_id", member.schoolId)
            .maybeSingle(),
        ]);
      if (courseError) throw courseError;
      if (termError) throw termError;
      if (!course || !term) return null;
      return {
        id: course.id,
        schoolId: course.school_id,
        term: course.term,
        currentTerm: term.current_term,
      };
    },
    async getJoinedCourse(courseId) {
      const member = await currentMember();
      if (!member?.onboardingComplete) return null;
      const { data: membership, error: membershipError } = await supabase
        .from("course_members")
        .select("course_id")
        .eq("course_id", courseId)
        .eq("user_id", member.userId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return null;

      const { data: link, error: linkError } = await supabase
        .from("course_conversations")
        .select("conversation_id")
        .eq("course_id", courseId)
        .maybeSingle();
      if (linkError) throw linkError;
      if (!link) return null;
      const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("archived_at")
        .eq("id", link.conversation_id)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) return null;
      return {
        courseId,
        conversationId: link.conversation_id,
        archived: conversation.archived_at !== null,
      };
    },
    async joinOwnCourse(courseId) {
      const { error } = await supabase
        .from("course_members")
        .insert({ course_id: courseId });
      if (error) throw error;
    },
    async leaveOwnCourse(courseId) {
      const member = await currentMember();
      if (!member) throw new Error("Member session unavailable");
      const { error } = await supabase
        .from("course_members")
        .delete()
        .eq("course_id", courseId)
        .eq("user_id", member.userId);
      if (error) throw error;
    },
    sendMessage(conversationId, clientMessageId, body) {
      return sendSupabaseConversationMessage(
        messageClient,
        conversationId,
        clientMessageId,
        body,
      );
    },
  });
}
