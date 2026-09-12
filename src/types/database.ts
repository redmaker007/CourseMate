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
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: NonNullable<Json>
          id: number
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: NonNullable<Json>
          id?: never
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: NonNullable<Json>
          id?: never
          target?: string | null
        }
        Relationships: []
      }
      behavior_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      conversation_members: {
        Row: {
          cleared_at: string | null
          cleared_through_message_id: number | null
          conversation_id: string
          joined_at: string
          last_read_message_id: number | null
          user_id: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_through_message_id?: number | null
          conversation_id: string
          joined_at?: string
          last_read_message_id?: number | null
          user_id: string
        }
        Update: {
          cleared_at?: string | null
          cleared_through_message_id?: number | null
          conversation_id?: string
          joined_at?: string
          last_read_message_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
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
          code_normalized?: never
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
          code_normalized?: never
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
          code_normalized?: never
          created_at?: string
          created_by?: string | null
          id?: string
          school_id: string
          term: string
          title: string
        }
        Update: {
          code?: string
          code_normalized?: never
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
      direct_message_cleanup_eligibility: {
        Row: {
          conversation_id: string
          eligible_since: string
          message_id: number
        }
        Insert: {
          conversation_id: string
          eligible_since: string
          message_id: number
        }
        Update: {
          conversation_id?: string
          eligible_since?: string
          message_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "direct_message_cleanup_eligibility_message_fkey"
            columns: ["conversation_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["conversation_id", "id"]
          },
        ]
      }
      direct_message_cleanup_runs: {
        Row: {
          batch_size: number
          candidate_count: number
          candidate_message_ids: number[]
          deleted_count: number
          deleted_message_ids: number[]
          error_details: string | null
          evaluated_at: string
          finished_at: string | null
          id: string
          result_status: string
          run_mode: string
          started_at: string
        }
        Insert: {
          batch_size: number
          candidate_count?: number
          candidate_message_ids?: number[]
          deleted_count?: number
          deleted_message_ids?: number[]
          error_details?: string | null
          evaluated_at: string
          finished_at?: string | null
          id?: string
          result_status: string
          run_mode: string
          started_at?: string
        }
        Update: {
          batch_size?: number
          candidate_count?: number
          candidate_message_ids?: number[]
          deleted_count?: number
          deleted_message_ids?: number[]
          error_details?: string | null
          evaluated_at?: string
          finished_at?: string | null
          id?: string
          result_status?: string
          run_mode?: string
          started_at?: string
        }
        Relationships: []
      }
      direct_message_clear_ranges: {
        Row: {
          after_message_id: number
          cleared_at: string
          conversation_id: string
          id: number
          member_id: string
          through_message_id: number
        }
        Insert: {
          after_message_id: number
          cleared_at: string
          conversation_id: string
          id?: never
          member_id: string
          through_message_id: number
        }
        Update: {
          after_message_id?: number
          cleared_at?: string
          conversation_id?: string
          id?: never
          member_id?: string
          through_message_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "direct_message_clear_ranges_member_fkey"
            columns: ["conversation_id", "member_id"]
            isOneToOne: false
            referencedRelation: "conversation_members"
            referencedColumns: ["conversation_id", "user_id"]
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
          client_message_id: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: number
          sender_id: string | null
          source_friend_request_id: string | null
        }
        Insert: {
          body: string
          client_message_id?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: never
          sender_id?: string | null
          source_friend_request_id?: string | null
        }
        Update: {
          body?: string
          client_message_id?: string | null
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
      platform_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
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
      report_evidence: {
        Row: {
          captured_at: string
          report_id: string
          reported_user_id: string
          snapshot: NonNullable<Json>
        }
        Insert: {
          captured_at?: string
          report_id: string
          reported_user_id: string
          snapshot: NonNullable<Json>
        }
        Update: {
          captured_at?: string
          report_id?: string
          reported_user_id?: string
          snapshot?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "report_evidence_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "behavior_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_source_retention: {
        Row: {
          message_id: number | null
          report_id: string
          source_id: string
          source_type: string
        }
        Insert: {
          message_id?: never
          report_id: string
          source_id: string
          source_type: string
        }
        Update: {
          message_id?: never
          report_id?: string
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_source_retention_message_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_source_retention_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "behavior_reports"
            referencedColumns: ["id"]
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
      admin_add_school_domain: {
        Args: { new_domain: string; target_school: string }
        Returns: undefined
      }
      admin_grant_admin: { Args: { target_email: string }; Returns: string }
      admin_import_catalog_batch: {
        Args: { entries: Json; target_school: string }
        Returns: number
      }
      admin_list_audit_log: {
        Args: { max_rows?: number }
        Returns: {
          action: string
          actor_email: string
          actor_name: string
          created_at: string
          details: Json
          id: number
          target: string
        }[]
      }
      admin_list_schools: {
        Args: Record<PropertyKey, never>
        Returns: {
          catalog_count: number
          current_course_count: number
          current_term: string
          domains: string[]
          enabled: boolean
          member_count: number
          name_en: string
          name_zh: string
          school_id: string
        }[]
      }
      admin_list_staff: {
        Args: Record<PropertyKey, never>
        Returns: {
          display_name: string
          email: string
          granted_at: string
          role: string
          user_id: string
        }[]
      }
      admin_materialize_catalog: {
        Args: { target_school: string }
        Returns: {
          created_count: number
          existing_count: number
          invalid_count: number
          materialized_term: string
        }[]
      }
      admin_remove_school_domain: {
        Args: { target_domain: string }
        Returns: undefined
      }
      admin_revoke_admin: { Args: { target_user: string }; Returns: undefined }
      admin_save_catalog_course: {
        Args: {
          course_code: string
          course_title: string
          target_school: string
        }
        Returns: string
      }
      admin_save_school: {
        Args: {
          new_name_en: string
          new_name_zh: string
          target_school: string
        }
        Returns: undefined
      }
      admin_set_current_term: {
        Args: { new_term: string; target_school: string }
        Returns: {
          created_count: number
          existing_count: number
          invalid_count: number
          materialized_term: string
        }[]
      }
      admin_set_school_enabled: {
        Args: { should_enable: boolean; target_school: string }
        Returns: undefined
      }
      can_access_course_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      can_access_direct_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      can_send_to_course_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      can_send_to_direct_conversation: {
        Args: { target_conversation: string }
        Returns: boolean
      }
      clear_direct_conversation: {
        Args: { target_conversation_id: string; through_message_id: number }
        Returns: string
      }
      consume_friend_rate_limit: {
        Args: { target_action: string }
        Returns: boolean
      }
      create_behavior_report: {
        Args: {
          report_details?: string
          report_reason: string
          target_id: string
          target_type: string
        }
        Returns: {
          report_id: string
          result_status: string
        }[]
      }
      current_platform_role: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      current_school_id: { Args: Record<PropertyKey, never>; Returns: string }
      eligible_direct_message_cleanup: {
        Args: { evaluation_time: string }
        Returns: {
          conversation_id: string
          eligible_since: string
          message_id: number
        }[]
      }
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
      get_direct_conversation_view: {
        Args: { target_conversation_id: string }
        Returns: {
          conversation_id: string
          hidden: boolean
          other_display_name: string
          other_member_id: string
          send_status: string
        }[]
      }
      get_direct_unread_counts: {
        Args: Record<PropertyKey, never>
        Returns: {
          hidden_unread: number
          visible_unread: number
        }[]
      }
      get_own_profile: {
        Args: Record<PropertyKey, never>
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
      has_completed_onboarding: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      hook_restrict_user_to_enabled_school: {
        Args: { event: Json }
        Returns: Json
      }
      is_course_member: { Args: { target_course: string }; Returns: boolean }
      list_blocked_members: {
        Args: Record<PropertyKey, never>
        Returns: {
          active_friendship: boolean
          avatar_url: string
          conversation_id: string
          display_name: string
          member_id: string
        }[]
      }
      list_direct_conversation_unread: {
        Args: { include_hidden?: boolean }
        Returns: {
          conversation_id: string
          unread_count: number
        }[]
      }
      list_direct_messages: {
        Args: {
          cursor_direction?: string
          cursor_message_id?: number
          page_size?: number
          target_conversation_id: string
        }
        Returns: {
          body: string
          client_message_id: string
          conversation_id: string
          created_at: string
          message_id: number
          sender_display_name: string
          sender_id: string
        }[]
      }
      list_friend_requests: {
        Args: Record<PropertyKey, never>
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
      mark_direct_conversation_read: {
        Args: { target_conversation_id: string; through_message_id: number }
        Returns: string
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
      member_block_status: {
        Args: { target_member_id: string }
        Returns: string
      }
      members_are_blocked: {
        Args: { first_member: string; second_member: string }
        Returns: boolean
      }
      preview_direct_message_cleanup: {
        Args: { evaluation_time?: string; requested_batch_size?: number }
        Returns: {
          audit_id: string
          candidate_count: number
          message_ids: number[]
        }[]
      }
      remove_friend: { Args: { target_member_id: string }; Returns: string }
      require_platform_role: { Args: { minimum_role: string }; Returns: string }
      respond_to_friend_request: {
        Args: { decision: string; target_request_id: string }
        Returns: {
          conversation_id: string
          result_status: string
        }[]
      }
      run_direct_message_cleanup: {
        Args: { requested_batch_size?: number }
        Returns: {
          audit_id: string
          candidate_count: number
          deleted_count: number
          message_ids: number[]
          result_status: string
        }[]
      }
      send_conversation_message: {
        Args: {
          client_message_id: string
          message_body: string
          target_conversation_id: string
        }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          message_id: number
          result_status: string
          sender_display_name: string
          sender_id: string
        }[]
      }
      send_direct_message: {
        Args: {
          client_message_id?: string
          message_body: string
          target_conversation_id: string
        }
        Returns: {
          message_id: number
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
      write_admin_audit: {
        Args: {
          action_name: string
          actor: string
          detail: Json
          target_name: string
        }
        Returns: undefined
      }
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
  public: {
    Enums: {},
  },
} as const
