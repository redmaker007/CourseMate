export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      conversation_members: {
        Row: {
          cleared_through_message_id: string | null
          conversation_id: string
          joined_at: string
          last_read_message_id: string | null
          user_id: string
        }
        Insert: {
          cleared_through_message_id?: string | null
          conversation_id: string
          joined_at?: string
          last_read_message_id?: string | null
          user_id: string
        }
        Update: {
          cleared_through_message_id?: string | null
          conversation_id?: string
          joined_at?: string
          last_read_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_cleared_message_fkey"
            columns: ["conversation_id", "cleared_through_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["conversation_id", "id"]
          },
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_last_read_message_fkey"
            columns: ["conversation_id", "last_read_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["conversation_id", "id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          kind: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          kind: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          kind?: string
        }
        Relationships: []
      }
      course_catalog: {
        Row: {
          code: string
          code_normalized: string | null
          credits: string | null
          department: string | null
          description: string | null
          id: string
          number: string
          requisites: string | null
          school_id: string
          source_course_id: string | null
          source_term: string | null
          subject: string
          title: string
          typically_offered: string | null
          updated_at: string
        }
        Insert: {
          code: string
          code_normalized?: string | null
          credits?: string | null
          department?: string | null
          description?: string | null
          id?: string
          number: string
          requisites?: string | null
          school_id: string
          source_course_id?: string | null
          source_term?: string | null
          subject: string
          title: string
          typically_offered?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          code_normalized?: string | null
          credits?: string | null
          department?: string | null
          description?: string | null
          id?: string
          number?: string
          requisites?: string | null
          school_id?: string
          source_course_id?: string | null
          source_term?: string | null
          subject?: string
          title?: string
          typically_offered?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_catalog_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      course_conversations: {
        Row: {
          conversation_id: string
          course_id: string
        }
        Insert: {
          conversation_id: string
          course_id: string
        }
        Update: {
          conversation_id?: string
          course_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_conversations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_members: {
        Row: {
          course_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          joined_at?: string
          user_id?: string
        }
        Update: {
          course_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_members_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string
          code_normalized: string | null
          created_at: string
          created_by: string | null
          id: string
          school_id: string
          term: string
          title: string
        }
        Insert: {
          code: string
          code_normalized?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          school_id: string
          term: string
          title: string
        }
        Update: {
          code?: string
          code_normalized?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          school_id?: string
          term?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "courses_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_conversations: {
        Row: {
          conversation_id: string
          member_high: string | null
          member_low: string | null
        }
        Insert: {
          conversation_id: string
          member_high?: string | null
          member_low?: string | null
        }
        Update: {
          conversation_id?: string
          member_high?: string | null
          member_low?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversations_member_high_fkey"
            columns: ["member_high"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "direct_conversations_member_low_fkey"
            columns: ["member_low"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      friend_preferences: {
        Row: {
          hidden: boolean
          note: string | null
          owner_id: string
          pair_high: string
          pair_low: string
        }
        Insert: {
          hidden?: boolean
          note?: string | null
          owner_id: string
          pair_high: string
          pair_low: string
        }
        Update: {
          hidden?: boolean
          note?: string | null
          owner_id?: string
          pair_high?: string
          pair_low?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_preferences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "friend_preferences_pair_low_pair_high_fkey"
            columns: ["pair_low", "pair_high"]
            isOneToOne: false
            referencedRelation: "friendships"
            referencedColumns: ["pair_low", "pair_high"]
          },
        ]
      }
      friend_rate_limit_buckets: {
        Row: {
          action_kind: string
          actor_id: string
          request_count: number
          window_seconds: number
          window_start: number
        }
        Insert: {
          action_kind: string
          actor_id: string
          request_count: number
          window_seconds: number
          window_start: number
        }
        Update: {
          action_kind?: string
          actor_id?: string
          request_count?: number
          window_seconds?: number
          window_start?: number
        }
        Relationships: [
          {
            foreignKeyName: "friend_rate_limit_buckets_action_kind_fkey"
            columns: ["action_kind"]
            isOneToOne: false
            referencedRelation: "friend_rate_limit_config"
            referencedColumns: ["action_kind"]
          },
          {
            foreignKeyName: "friend_rate_limit_buckets_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      friend_rate_limit_config: {
        Row: {
          action_kind: string
          hour_limit: number
          minute_limit: number
        }
        Insert: {
          action_kind: string
          hour_limit: number
          minute_limit: number
        }
        Update: {
          action_kind?: string
          hour_limit?: number
          minute_limit?: number
        }
        Relationships: []
      }
      friend_request_active_pairs: {
        Row: {
          pair_high: string
          pair_low: string
          request_id: string
        }
        Insert: {
          pair_high: string
          pair_low: string
          request_id: string
        }
        Update: {
          pair_high?: string
          pair_low?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_request_active_pairs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "friend_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_requests: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          message: string
          pair_high: string
          pair_low: string
          recipient_id: string | null
          requester_id: string | null
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          message: string
          pair_high: string
          pair_low: string
          recipient_id?: string | null
          requester_id?: string | null
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          message?: string
          pair_high?: string
          pair_low?: string
          recipient_id?: string | null
          requester_id?: string | null
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_requests_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "friend_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      friendships: {
        Row: {
          active: boolean
          created_at: string
          ended_at: string | null
          pair_high: string
          pair_low: string
          reactivated_at: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          ended_at?: string | null
          pair_high: string
          pair_low: string
          reactivated_at?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          ended_at?: string | null
          pair_high?: string
          pair_low?: string
          reactivated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "friendships_pair_high_fkey"
            columns: ["pair_high"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "friendships_pair_low_fkey"
            columns: ["pair_low"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      member_accounts: {
        Row: {
          created_at: string
          school_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          school_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          school_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      member_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "member_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          sender_id: string | null
          source_friend_request_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: never
          sender_id?: string | null
          source_friend_request_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: never
          sender_id?: string | null
          source_friend_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "messages_source_friend_request_id_fkey"
            columns: ["source_friend_request_id"]
            isOneToOne: false
            referencedRelation: "friend_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          grad_year: number | null
          id: string
          major: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          grad_year?: number | null
          id: string
          major?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          grad_year?: number | null
          id?: string
          major?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "member_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      school_email_domains: {
        Row: {
          created_at: string
          domain: string
          school_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          school_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_email_domains_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_term_settings: {
        Row: {
          current_term: string
          school_id: string
          updated_at: string
        }
        Insert: {
          current_term: string
          school_id: string
          updated_at?: string
        }
        Update: {
          current_term?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_term_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name_en: string
          name_zh: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id: string
          name_en: string
          name_zh: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name_en?: string
          name_zh?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_course_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      can_send_to_course_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      consume_friend_rate_limit: {
        Args: { target_action: string }
        Returns: boolean
      }
      current_school_id: { Args: never; Returns: string }
      enabled_school_id_for_email_domain: {
        Args: { candidate_domain: string }
        Returns: string
      }
      find_member_by_email: {
        Args: { candidate_email: string }
        Returns: {
          avatar_url: string
          block_status: string
          display_name: string
          grad_year: number
          incoming_request_id: string
          major: string
          member_id: string
          relationship_status: string
          result_status: string
          shared_courses: Json
        }[]
      }
      friend_relationship_status: {
        Args: { target_member_id: string }
        Returns: string
      }
      get_own_profile: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          grad_year: number
          id: string
          major: string
          updated_at: string
        }[]
      }
      has_completed_onboarding: { Args: never; Returns: boolean }
      hook_restrict_user_to_enabled_school: {
        Args: { event: Json }
        Returns: Json
      }
      is_course_member: { Args: { target_course: string }; Returns: boolean }
      list_friend_requests: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          direction: string
          display_name: string
          expires_at: string
          message: string
          other_member_id: string
          request_id: string
          resolved_at: string
          status: string
        }[]
      }
      list_blocked_members: {
        Args: never
        Returns: {
          active_friendship: boolean
          avatar_url: string
          conversation_id: string
          display_name: string
          member_id: string
        }[]
      }
      list_friends: {
        Args: { include_hidden?: boolean }
        Returns: {
          avatar_url: string
          block_status: string
          conversation_id: string
          display_name: string
          effective_name: string
          grad_year: number
          hidden: boolean
          major: string
          member_id: string
          send_status: string
          shared_courses: Json
        }[]
      }
      materialize_catalog_courses: {
        Args: { target_school: string }
        Returns: {
          created_count: number
          existing_count: number
          invalid_count: number
          materialized_term: string
        }[]
      }
      members_are_blocked: {
        Args: { first_member: string; second_member: string }
        Returns: boolean
      }
      member_block_status: {
        Args: { target_member_id: string }
        Returns: string
      }
      remove_friend: { Args: { target_member_id: string }; Returns: string }
      respond_to_friend_request: {
        Args: { decision: string; target_request_id: string }
        Returns: {
          conversation_id: string
          result_status: string
        }[]
      }
      send_friend_request: {
        Args: { request_message: string; target_member_id: string }
        Returns: {
          request_id: string
          result_status: string
        }[]
      }
      set_friend_hidden: {
        Args: { requested_hidden: boolean; target_member_id: string }
        Returns: string
      }
      set_friend_note: {
        Args: { requested_note: string; target_member_id: string }
        Returns: string
      }
      set_member_blocked: {
        Args: { requested_blocked: boolean; target_member_id: string }
        Returns: string
      }
      shares_course_with: { Args: { target_user: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
