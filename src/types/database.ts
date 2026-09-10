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
          cleared_through_message_id: number | null
          conversation_id: string
          joined_at: string
          last_read_message_id: number | null
          user_id: string
        }
        Insert: {
          cleared_through_message_id?: number | null
          conversation_id: string
          joined_at?: string
          last_read_message_id?: number | null
          user_id: string
        }
        Update: {
          cleared_through_message_id?: number | null
          conversation_id?: string
          joined_at?: string
          last_read_message_id?: number | null
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
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: number
          sender_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: never
          sender_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: never
          sender_id?: string | null
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
      current_school_id: { Args: never; Returns: string }
      enabled_school_id_for_email_domain: {
        Args: { candidate_domain: string }
        Returns: string
      }
      hook_restrict_user_to_enabled_school: {
        Args: { event: Json }
        Returns: Json
      }
      is_course_member: { Args: { target_course: string }; Returns: boolean }
      can_access_course_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      can_send_to_course_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      has_completed_onboarding: { Args: never; Returns: boolean }
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
