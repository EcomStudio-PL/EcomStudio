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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          on_behalf_of: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          on_behalf_of?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          on_behalf_of?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_on_behalf_of_fkey"
            columns: ["on_behalf_of"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          active: boolean
          badge: string | null
          capabilities: Json
          created_at: string
          credit_cost: number
          description: string | null
          display_name: string | null
          estimated_api_cost: number
          id: string
          internal_cost_usd_micros: number
          max_prompt_length: number
          max_reference_images: number
          metadata: Json
          model_identifier: string
          name: string
          pricing: Json
          provider_id: string
          quality_tier: string
          sort_order: number
          speed_tier: string
          supported_aspect_ratios: string[]
          supported_resolutions: string[]
          supports_negative_prompt: boolean
          supports_reference_images: boolean
          supports_video: boolean
          type: string
        }
        Insert: {
          active?: boolean
          badge?: string | null
          capabilities?: Json
          created_at?: string
          credit_cost?: number
          description?: string | null
          display_name?: string | null
          estimated_api_cost?: number
          id?: string
          internal_cost_usd_micros?: number
          max_prompt_length?: number
          max_reference_images?: number
          metadata?: Json
          model_identifier: string
          name: string
          pricing?: Json
          provider_id: string
          quality_tier?: string
          sort_order?: number
          speed_tier?: string
          supported_aspect_ratios?: string[]
          supported_resolutions?: string[]
          supports_negative_prompt?: boolean
          supports_reference_images?: boolean
          supports_video?: boolean
          type?: string
        }
        Update: {
          active?: boolean
          badge?: string | null
          capabilities?: Json
          created_at?: string
          credit_cost?: number
          description?: string | null
          display_name?: string | null
          estimated_api_cost?: number
          id?: string
          internal_cost_usd_micros?: number
          max_prompt_length?: number
          max_reference_images?: number
          metadata?: Json
          model_identifier?: string
          name?: string
          pricing?: Json
          provider_id?: string
          quality_tier?: string
          sort_order?: number
          speed_tier?: string
          supported_aspect_ratios?: string[]
          supported_resolutions?: string[]
          supports_negative_prompt?: boolean
          supports_reference_images?: boolean
          supports_video?: boolean
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_credentials: {
        Row: {
          active: boolean
          auth_tag: string
          base_url: string | null
          created_at: string
          credential_name: string
          encrypted_value: string
          id: string
          iv: string
          last_four: string
          last_image_test_at: string | null
          last_image_test_error_safe: string | null
          last_image_test_status: string | null
          last_test_error_safe: string | null
          last_test_status: string | null
          last_tested_at: string | null
          provider_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          auth_tag: string
          base_url?: string | null
          created_at?: string
          credential_name?: string
          encrypted_value: string
          id?: string
          iv: string
          last_four?: string
          last_image_test_at?: string | null
          last_image_test_error_safe?: string | null
          last_image_test_status?: string | null
          last_test_error_safe?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          provider_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          auth_tag?: string
          base_url?: string | null
          created_at?: string
          credential_name?: string
          encrypted_value?: string
          id?: string
          iv?: string
          last_four?: string
          last_image_test_at?: string | null
          last_image_test_error_safe?: string | null
          last_image_test_status?: string | null
          last_test_error_safe?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          provider_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_provider_credentials_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_provider_credentials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          metadata: Json
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          slug?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_profiles: {
        Row: {
          address_line: string | null
          billing_email: string | null
          city: string | null
          company_name: string | null
          contact_person: string | null
          country: string | null
          created_at: string
          id: string
          phone: string | null
          postal_code: string | null
          regon: string | null
          updated_at: string
          vat_id: string | null
          workspace_id: string
        }
        Insert: {
          address_line?: string | null
          billing_email?: string | null
          city?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          id?: string
          phone?: string | null
          postal_code?: string | null
          regon?: string | null
          updated_at?: string
          vat_id?: string | null
          workspace_id: string
        }
        Update: {
          address_line?: string | null
          billing_email?: string | null
          city?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          id?: string
          phone?: string | null
          postal_code?: string | null
          regon?: string | null
          updated_at?: string
          vat_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_blocks: {
        Row: {
          content: Json
          created_at: string
          id: string
          page_id: string
          sort_order: number
          type: string
          updated_at: string
          visible: boolean
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          page_id: string
          sort_order?: number
          type: string
          updated_at?: string
          visible?: boolean
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          page_id?: string
          sort_order?: number
          type?: string
          updated_at?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cms_blocks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "cms_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_pages: {
        Row: {
          created_at: string
          id: string
          published_at: string | null
          published_snapshot: Json | null
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          published_at?: string | null
          published_snapshot?: Json | null
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          published_at?: string | null
          published_snapshot?: Json | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_packages: {
        Row: {
          active: boolean
          badge: string | null
          bonus_credits: number
          created_at: string
          credits: number
          currency: string
          description: string | null
          featured: boolean
          id: string
          name: string
          price_cents: number
          sort_order: number
        }
        Insert: {
          active?: boolean
          badge?: string | null
          bonus_credits?: number
          created_at?: string
          credits: number
          currency?: string
          description?: string | null
          featured?: boolean
          id?: string
          name: string
          price_cents: number
          sort_order?: number
        }
        Update: {
          active?: boolean
          badge?: string | null
          bonus_credits?: number
          created_at?: string
          credits?: number
          currency?: string
          description?: string | null
          featured?: boolean
          id?: string
          name?: string
          price_cents?: number
          sort_order?: number
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          balance_before: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          metadata: Json
          reference_id: string | null
          type: Database["public"]["Enums"]["credit_tx_type"]
          usage_event_id: string | null
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          type: Database["public"]["Enums"]["credit_tx_type"]
          usage_event_id?: string | null
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          type?: Database["public"]["Enums"]["credit_tx_type"]
          usage_event_id?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_usage_event_id_fkey"
            columns: ["usage_event_id"]
            isOneToOne: false
            referencedRelation: "usage_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "credit_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_wallets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          pinned: boolean
          reminder_date: string | null
          user_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          pinned?: boolean
          reminder_date?: string | null
          user_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          pinned?: boolean
          reminder_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          flag: string
          id: string
          plans: string[] | null
          roles: string[] | null
          rollout_percent: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          flag: string
          id?: string
          plans?: string[] | null
          roles?: string[] | null
          rollout_percent?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          flag?: string
          id?: string
          plans?: string[] | null
          roles?: string[] | null
          rollout_percent?: number | null
        }
        Relationships: []
      }
      generated_prompts: {
        Row: {
          concept_name: string
          created_at: string
          customer_description: string | null
          customer_title: string | null
          format: string
          generation_count: number
          id: string
          last_job_id: string | null
          lock_strength: string
          negative_prompt: string | null
          primary_reference: number | null
          priority: number
          product_id: string
          prompt_encrypted: string | null
          prompt_iv: string | null
          prompt_tag: string | null
          prompt_text: string
          reference_image_ids: string[]
          reference_indices: number[]
          reference_rationale: string | null
          scene_type: string | null
          session_id: string | null
          shot_type: string
          status: Database["public"]["Enums"]["prompt_status"]
          style: string | null
          supporting_references: Json
          workspace_id: string
        }
        Insert: {
          concept_name: string
          created_at?: string
          customer_description?: string | null
          customer_title?: string | null
          format?: string
          generation_count?: number
          id?: string
          last_job_id?: string | null
          lock_strength?: string
          negative_prompt?: string | null
          primary_reference?: number | null
          priority?: number
          product_id: string
          prompt_encrypted?: string | null
          prompt_iv?: string | null
          prompt_tag?: string | null
          prompt_text: string
          reference_image_ids?: string[]
          reference_indices?: number[]
          reference_rationale?: string | null
          scene_type?: string | null
          session_id?: string | null
          shot_type: string
          status?: Database["public"]["Enums"]["prompt_status"]
          style?: string | null
          supporting_references?: Json
          workspace_id: string
        }
        Update: {
          concept_name?: string
          created_at?: string
          customer_description?: string | null
          customer_title?: string | null
          format?: string
          generation_count?: number
          id?: string
          last_job_id?: string | null
          lock_strength?: string
          negative_prompt?: string | null
          primary_reference?: number | null
          priority?: number
          product_id?: string
          prompt_encrypted?: string | null
          prompt_iv?: string | null
          prompt_tag?: string | null
          prompt_text?: string
          reference_image_ids?: string[]
          reference_indices?: number[]
          reference_rationale?: string | null
          scene_type?: string | null
          session_id?: string | null
          shot_type?: string
          status?: Database["public"]["Enums"]["prompt_status"]
          style?: string | null
          supporting_references?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_prompts_last_job_id_fkey"
            columns: ["last_job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_prompts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_prompts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_prompts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_assets: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          generation_id: string
          height: number | null
          id: string
          metadata: Json
          storage_path: string
          width: number | null
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          generation_id: string
          height?: number | null
          id?: string
          metadata?: Json
          storage_path: string
          width?: number | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          generation_id?: string
          height?: number | null
          id?: string
          metadata?: Json
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_assets_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "generations"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_feedback: {
        Row: {
          asset_path: string | null
          comment: string | null
          created_at: string
          generation_job_id: string
          id: string
          issues: string[]
          user_id: string
          verdict: string
          workspace_id: string
        }
        Insert: {
          asset_path?: string | null
          comment?: string | null
          created_at?: string
          generation_job_id: string
          id?: string
          issues?: string[]
          user_id: string
          verdict: string
          workspace_id: string
        }
        Update: {
          asset_path?: string | null
          comment?: string | null
          created_at?: string
          generation_job_id?: string
          id?: string
          issues?: string[]
          user_id?: string
          verdict?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_feedback_generation_job_id_fkey"
            columns: ["generation_job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_feedback_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          aspect_ratio: string
          completed_at: string | null
          created_at: string
          credits_charged: number
          error_class: string | null
          error_message: string | null
          id: string
          latency_ms: number | null
          material_type: string | null
          model_id: string | null
          negative_prompt: string | null
          product_id: string | null
          prompt_id: string | null
          prompt_session_id: string | null
          prompt_text: string | null
          provider_slug: string | null
          quantity: number
          reference_image_ids: string[]
          request_id: string | null
          resolution: string | null
          settings: Json
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          aspect_ratio?: string
          completed_at?: string | null
          created_at?: string
          credits_charged?: number
          error_class?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          material_type?: string | null
          model_id?: string | null
          negative_prompt?: string | null
          product_id?: string | null
          prompt_id?: string | null
          prompt_session_id?: string | null
          prompt_text?: string | null
          provider_slug?: string | null
          quantity?: number
          reference_image_ids?: string[]
          request_id?: string | null
          resolution?: string | null
          settings?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          user_id: string
          workspace_id: string
        }
        Update: {
          aspect_ratio?: string
          completed_at?: string | null
          created_at?: string
          credits_charged?: number
          error_class?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          material_type?: string | null
          model_id?: string | null
          negative_prompt?: string | null
          product_id?: string | null
          prompt_id?: string | null
          prompt_session_id?: string | null
          prompt_text?: string | null
          provider_slug?: string | null
          quantity?: number
          reference_image_ids?: string[]
          request_id?: string | null
          resolution?: string | null
          settings?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "generated_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_prompt_session_id_fkey"
            columns: ["prompt_session_id"]
            isOneToOne: false
            referencedRelation: "prompt_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generations: {
        Row: {
          created_at: string
          id: string
          job_id: string
          product_id: string | null
          product_match_score: number | null
          quality_check_data: Json
          quality_notes: string | null
          quality_status: Database["public"]["Enums"]["quality_status"]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          product_id?: string | null
          product_match_score?: number | null
          quality_check_data?: Json
          quality_notes?: string | null
          quality_status?: Database["public"]["Enums"]["quality_status"]
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          product_id?: string | null
          product_match_score?: number | null
          quality_check_data?: Json
          quality_notes?: string | null
          quality_status?: Database["public"]["Enums"]["quality_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inspirations: {
        Row: {
          after_urls: string[]
          before_url: string | null
          category: string
          created_at: string
          description: string | null
          featured: boolean
          format: string | null
          id: string
          locale: string | null
          model_slug: string | null
          negative_prompt: string | null
          premium: boolean
          prompt: string
          sort_order: number
          status: string
          tags: string[]
          title: string
          updated_at: string
          use_case: string | null
          video_url: string | null
        }
        Insert: {
          after_urls?: string[]
          before_url?: string | null
          category?: string
          created_at?: string
          description?: string | null
          featured?: boolean
          format?: string | null
          id?: string
          locale?: string | null
          model_slug?: string | null
          negative_prompt?: string | null
          premium?: boolean
          prompt: string
          sort_order?: number
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
          use_case?: string | null
          video_url?: string | null
        }
        Update: {
          after_urls?: string[]
          before_url?: string | null
          category?: string
          created_at?: string
          description?: string | null
          featured?: boolean
          format?: string | null
          id?: string
          locale?: string | null
          model_slug?: string | null
          negative_prompt?: string | null
          premium?: boolean
          prompt?: string
          sort_order?: number
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          use_case?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          alt: string | null
          created_at: string
          created_by: string | null
          external_url: string | null
          id: string
          kind: string
          mime: string | null
          poster_url: string | null
          size_bytes: number | null
          storage_path: string | null
          title: string | null
        }
        Insert: {
          alt?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          id?: string
          kind?: string
          mime?: string | null
          poster_url?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          title?: string | null
        }
        Update: {
          alt?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          id?: string
          kind?: string
          mime?: string | null
          poster_url?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          href: string | null
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          metadata: Json
          provider: string | null
          provider_payment_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          provider?: string | null
          provider_payment_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          provider?: string | null
          provider_payment_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_analysis_cache: {
        Row: {
          analysis_model: string | null
          created_at: string
          engine_version: number
          feature_manifest: Json
          hits: number
          id: string
          image_analysis: Json
          product_id: string | null
          product_lock: Json
          reference_hash: string
          workspace_id: string
        }
        Insert: {
          analysis_model?: string | null
          created_at?: string
          engine_version: number
          feature_manifest: Json
          hits?: number
          id?: string
          image_analysis: Json
          product_id?: string | null
          product_lock: Json
          reference_hash: string
          workspace_id: string
        }
        Update: {
          analysis_model?: string | null
          created_at?: string
          engine_version?: number
          feature_manifest?: Json
          hits?: number
          id?: string
          image_analysis?: Json
          product_id?: string | null
          product_lock?: Json
          reference_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_analysis_cache_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_analysis_cache_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          ai_description: string | null
          created_at: string
          id: string
          image_type: string
          is_primary: boolean
          metadata: Json
          product_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          ai_description?: string | null
          created_at?: string
          id?: string
          image_type?: string
          is_primary?: boolean
          metadata?: Json
          product_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          ai_description?: string | null
          created_at?: string
          id?: string
          image_type?: string
          is_primary?: boolean
          metadata?: Json
          product_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          extra_info: string | null
          id: string
          instructions: string | null
          marketplace: string | null
          metadata: Json
          name: string
          owner_id: string
          sku: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["product_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          extra_info?: string | null
          id?: string
          instructions?: string | null
          marketplace?: string | null
          metadata?: Json
          name: string
          owner_id: string
          sku?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          extra_info?: string | null
          id?: string
          instructions?: string | null
          marketplace?: string | null
          metadata?: Json
          name?: string
          owner_id?: string
          sku?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_manager_id: string | null
          avatar_url: string | null
          blocked: boolean
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          account_manager_id?: string | null
          avatar_url?: string | null
          blocked?: boolean
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          account_manager_id?: string | null
          avatar_url?: string | null
          blocked?: boolean
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_account_manager_id_fkey"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_blocks: {
        Row: {
          active: boolean
          category: string
          content: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          category: string
          content: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          category?: string
          content?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      prompt_sessions: {
        Row: {
          analysis_model: string | null
          analysis_provider: string | null
          aspect_ratio: string
          cache_hit: boolean
          created_at: string
          description: string | null
          error: string | null
          error_stage: string | null
          extra_info: string | null
          fallback_from: string | null
          fallback_reason: string | null
          feature_manifest: Json
          id: string
          image_analysis: Json
          latency_ms: number | null
          product_id: string | null
          product_lock: Json
          product_name: string
          reference_hash: string | null
          reference_paths: string[]
          status: string
          style: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          analysis_model?: string | null
          analysis_provider?: string | null
          aspect_ratio?: string
          cache_hit?: boolean
          created_at?: string
          description?: string | null
          error?: string | null
          error_stage?: string | null
          extra_info?: string | null
          fallback_from?: string | null
          fallback_reason?: string | null
          feature_manifest?: Json
          id?: string
          image_analysis?: Json
          latency_ms?: number | null
          product_id?: string | null
          product_lock?: Json
          product_name: string
          reference_hash?: string | null
          reference_paths?: string[]
          status?: string
          style?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          analysis_model?: string | null
          analysis_provider?: string | null
          aspect_ratio?: string
          cache_hit?: boolean
          created_at?: string
          description?: string | null
          error?: string | null
          error_stage?: string | null
          extra_info?: string | null
          fallback_from?: string | null
          fallback_reason?: string | null
          feature_manifest?: Json
          id?: string
          image_analysis?: Json
          latency_ms?: number | null
          product_id?: string | null
          product_lock?: Json
          product_name?: string
          reference_hash?: string | null
          reference_paths?: string[]
          status?: string
          style?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_sessions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_templates: {
        Row: {
          active: boolean
          created_at: string
          format: string
          id: string
          name: string
          priority: number
          shot_type: string
          style: string | null
          template: string
          workspace_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          format?: string
          id?: string
          name: string
          priority?: number
          shot_type: string
          style?: string | null
          template: string
          workspace_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          format?: string
          id?: string
          name?: string
          priority?: number
          shot_type?: string
          style?: string | null
          template?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_health: {
        Row: {
          cooldown_until: string | null
          note: string | null
          provider_slug: string
          state: string
          updated_at: string
        }
        Insert: {
          cooldown_until?: string | null
          note?: string | null
          provider_slug: string
          state?: string
          updated_at?: string
        }
        Update: {
          cooldown_until?: string | null
          note?: string | null
          provider_slug?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_catalog: {
        Row: {
          api_cost_usd_micros: number
          category: string
          cost_currency: string
          created_at: string
          credits_cost: number
          enabled: boolean
          featured: boolean
          id: string
          maintenance_mode: boolean
          markup_percent: number | null
          metadata: Json
          min_margin_percent: number
          model_id: string | null
          name: string
          plan_slugs: string[] | null
          provider_id: string | null
          sale_currency: string
          sale_value_cents: number
          service_type: string
          slug: string
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          api_cost_usd_micros?: number
          category?: string
          cost_currency?: string
          created_at?: string
          credits_cost?: number
          enabled?: boolean
          featured?: boolean
          id?: string
          maintenance_mode?: boolean
          markup_percent?: number | null
          metadata?: Json
          min_margin_percent?: number
          model_id?: string | null
          name: string
          plan_slugs?: string[] | null
          provider_id?: string | null
          sale_currency?: string
          sale_value_cents?: number
          service_type?: string
          slug: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          api_cost_usd_micros?: number
          category?: string
          cost_currency?: string
          created_at?: string
          credits_cost?: number
          enabled?: boolean
          featured?: boolean
          id?: string
          maintenance_mode?: boolean
          markup_percent?: number | null
          metadata?: Json
          min_margin_percent?: number
          model_id?: string | null
          name?: string
          plan_slugs?: string[] | null
          provider_id?: string | null
          sale_currency?: string
          sale_value_cents?: number
          service_type?: string
          slug?: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_catalog_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_catalog_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      service_price_history: {
        Row: {
          changed_by: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_values: Json
          old_values: Json
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          entity_id: string
          entity_type?: string
          id?: string
          new_values: Json
          old_values: Json
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_values?: Json
          old_values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "service_price_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          active: boolean
          annual_price_cents: number
          bonus_credits: number
          created_at: string
          currency: string
          description: string | null
          featured: boolean
          features: Json
          id: string
          limits: Json
          monthly_credits: number
          name: string
          price_cents: number
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          annual_price_cents?: number
          bonus_credits?: number
          created_at?: string
          currency?: string
          description?: string | null
          featured?: boolean
          features?: Json
          id?: string
          limits?: Json
          monthly_credits?: number
          name: string
          price_cents?: number
          slug: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          annual_price_cents?: number
          bonus_credits?: number
          created_at?: string
          currency?: string
          description?: string | null
          featured?: boolean
          features?: Json
          id?: string
          limits?: Json
          monthly_credits?: number
          name?: string
          price_cents?: number
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string
          id: string
          metadata: Json
          plan_id: string
          provider: string | null
          provider_subscription_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          metadata?: Json
          plan_id: string
          provider?: string | null
          provider_subscription_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          metadata?: Json
          plan_id?: string
          provider?: string | null
          provider_subscription_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          is_staff: boolean
          read_at: string | null
          thread_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          is_staff?: boolean
          read_at?: string | null
          thread_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          is_staff?: boolean
          read_at?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      support_threads: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          status: string
          subject: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          subject: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          subject?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_threads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_results: {
        Row: {
          created_at: string
          file_size: number
          id: string
          metadata: Json
          mime_type: string
          product_id: string | null
          storage_path: string
          tool_slug: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          file_size?: number
          id?: string
          metadata?: Json
          mime_type?: string
          product_id?: string | null
          storage_path: string
          tool_slug: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          file_size?: number
          id?: string
          metadata?: Json
          mime_type?: string
          product_id?: string | null
          storage_path?: string
          tool_slug?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_results_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          actual_api_cost_usd_micros: number
          api_cost_usd_micros_snapshot: number
          created_at: string
          credit_tx_id: string | null
          credits_charged: number
          error: string | null
          finished_at: string | null
          generation_job_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          model_slug: string | null
          provider_request_id: string | null
          provider_slug: string | null
          refund_tx_id: string | null
          result_count: number
          sale_value_cents_snapshot: number
          service_id: string | null
          service_slug: string
          started_at: string
          status: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          actual_api_cost_usd_micros?: number
          api_cost_usd_micros_snapshot?: number
          created_at?: string
          credit_tx_id?: string | null
          credits_charged?: number
          error?: string | null
          finished_at?: string | null
          generation_job_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          model_slug?: string | null
          provider_request_id?: string | null
          provider_slug?: string | null
          refund_tx_id?: string | null
          result_count?: number
          sale_value_cents_snapshot?: number
          service_id?: string | null
          service_slug: string
          started_at?: string
          status?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          actual_api_cost_usd_micros?: number
          api_cost_usd_micros_snapshot?: number
          created_at?: string
          credit_tx_id?: string | null
          credits_charged?: number
          error?: string | null
          finished_at?: string | null
          generation_job_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          model_slug?: string | null
          provider_request_id?: string | null
          provider_slug?: string | null
          refund_tx_id?: string | null
          result_count?: number
          sale_value_cents_snapshot?: number
          service_id?: string | null
          service_slug?: string
          started_at?: string
          status?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_credit_tx_id_fkey"
            columns: ["credit_tx_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_generation_job_id_fkey"
            columns: ["generation_job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_refund_tx_id_fkey"
            columns: ["refund_tx_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          quantity: number
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          quantity?: number
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          quantity?: number
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          locale: string
          metadata: Json
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          locale?: string
          metadata?: Json
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          locale?: string
          metadata?: Json
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          brand_color: string | null
          company_name: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          brand_color?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          brand_color?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_adjust_credits: {
        Args: { p_amount: number; p_description?: string; p_wallet_id: string }
        Returns: string
      }
      admin_adjust_credits_v2: {
        Args: {
          p_amount: number
          p_description?: string
          p_metadata?: Json
          p_type: Database["public"]["Enums"]["credit_tx_type"]
          p_wallet_id: string
        }
        Returns: string
      }
      apply_credit_transaction: {
        Args: {
          p_amount: number
          p_created_by?: string
          p_description?: string
          p_metadata?: Json
          p_reference_id?: string
          p_type: Database["public"]["Enums"]["credit_tx_type"]
          p_wallet_id: string
        }
        Returns: string
      }
      bootstrap_current_user: { Args: never; Returns: undefined }
      charge_usage_credits: {
        Args: {
          p_amount: number
          p_description: string
          p_metadata?: Json
          p_reference_id: string
          p_wallet_id: string
        }
        Returns: string
      }
      complete_usage_event:
        | {
            Args: { p_event_id: string; p_result_count: number }
            Returns: undefined
          }
        | {
            Args: {
              p_api_cost_usd_micros?: number
              p_event_id: string
              p_request_id?: string
              p_result_count: number
            }
            Returns: undefined
          }
      fail_usage_event:
        | { Args: { p_error: string; p_event_id: string }; Returns: string }
        | {
            Args: {
              p_api_cost_usd_micros?: number
              p_error: string
              p_event_id: string
            }
            Returns: string
          }
      get_active_provider_credential: {
        Args: { p_provider_id: string }
        Returns: {
          auth_tag: string
          base_url: string
          encrypted_value: string
          iv: string
        }[]
      }
      get_welcome_credits: { Args: never; Returns: number }
      is_admin: { Args: { uid?: string }; Returns: boolean }
      is_workspace_manager: {
        Args: { uid?: string; ws_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { uid?: string; ws_id: string }
        Returns: boolean
      }
      log_activity: {
        Args: {
          p_action: string
          p_entity_id?: string
          p_entity_type?: string
          p_metadata?: Json
          p_on_behalf_of?: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      providers_with_credentials: { Args: never; Returns: string[] }
      refund_usage_event: { Args: { p_event_id: string }; Returns: string }
      set_provider_health: {
        Args: {
          p_cooldown_seconds?: number
          p_note?: string
          p_slug: string
          p_state: string
        }
        Returns: undefined
      }
    }
    Enums: {
      asset_type: "image" | "video" | "text"
      credit_tx_type:
        | "subscription"
        | "topup"
        | "generation"
        | "refund"
        | "bonus"
        | "admin_adjustment"
        | "purchase"
        | "promotion"
        | "admin_grant"
        | "manual_adjustment"
      job_status: "queued" | "processing" | "completed" | "failed" | "cancelled"
      product_status:
        | "draft"
        | "ready"
        | "processing"
        | "completed"
        | "archived"
      prompt_status: "draft" | "ready" | "used" | "archived"
      quality_status: "pending" | "passed" | "warning" | "failed" | "skipped"
      user_role: "user" | "admin" | "manager"
      workspace_role: "owner" | "admin" | "editor" | "viewer" | "operator"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      asset_type: ["image", "video", "text"],
      credit_tx_type: [
        "subscription",
        "topup",
        "generation",
        "refund",
        "bonus",
        "admin_adjustment",
        "purchase",
        "promotion",
        "admin_grant",
        "manual_adjustment",
      ],
      job_status: ["queued", "processing", "completed", "failed", "cancelled"],
      product_status: ["draft", "ready", "processing", "completed", "archived"],
      prompt_status: ["draft", "ready", "used", "archived"],
      quality_status: ["pending", "passed", "warning", "failed", "skipped"],
      user_role: ["user", "admin", "manager"],
      workspace_role: ["owner", "admin", "editor", "viewer", "operator"],
    },
  },
} as const
