export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
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
        ]
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
      ai_models: {
        Row: {
          active: boolean
          capabilities: Json
          created_at: string
          credit_cost: number
          description: string | null
          estimated_api_cost: number
          id: string
          internal_cost_usd_micros: number
          max_reference_images: number
          metadata: Json
          model_identifier: string
          name: string
          provider_id: string
          quality_tier: string
          speed_tier: string
          supported_aspect_ratios: string[]
          supports_reference_images: boolean
          supports_video: boolean
          type: string
        }
        Insert: {
          active?: boolean
          capabilities?: Json
          created_at?: string
          credit_cost?: number
          description?: string | null
          estimated_api_cost?: number
          id?: string
          internal_cost_usd_micros?: number
          max_reference_images?: number
          metadata?: Json
          model_identifier: string
          name: string
          provider_id: string
          quality_tier?: string
          speed_tier?: string
          supported_aspect_ratios?: string[]
          supports_reference_images?: boolean
          supports_video?: boolean
          type?: string
        }
        Update: {
          active?: boolean
          capabilities?: Json
          created_at?: string
          credit_cost?: number
          description?: string | null
          estimated_api_cost?: number
          id?: string
          internal_cost_usd_micros?: number
          max_reference_images?: number
          metadata?: Json
          model_identifier?: string
          name?: string
          provider_id?: string
          quality_tier?: string
          speed_tier?: string
          supported_aspect_ratios?: string[]
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
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          metadata: Json
          reference_id: string | null
          type: Database["public"]["Enums"]["credit_tx_type"]
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          type: Database["public"]["Enums"]["credit_tx_type"]
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          reference_id?: string | null
          type?: Database["public"]["Enums"]["credit_tx_type"]
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
      generated_prompts: {
        Row: {
          concept_name: string
          created_at: string
          format: string
          id: string
          priority: number
          product_id: string
          prompt_text: string
          reference_image_ids: string[]
          reference_rationale: string | null
          shot_type: string
          status: Database["public"]["Enums"]["prompt_status"]
          style: string | null
          workspace_id: string
        }
        Insert: {
          concept_name: string
          created_at?: string
          format?: string
          id?: string
          priority?: number
          product_id: string
          prompt_text: string
          reference_image_ids?: string[]
          reference_rationale?: string | null
          shot_type: string
          status?: Database["public"]["Enums"]["prompt_status"]
          style?: string | null
          workspace_id: string
        }
        Update: {
          concept_name?: string
          created_at?: string
          format?: string
          id?: string
          priority?: number
          product_id?: string
          prompt_text?: string
          reference_image_ids?: string[]
          reference_rationale?: string | null
          shot_type?: string
          status?: Database["public"]["Enums"]["prompt_status"]
          style?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_prompts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
      generation_jobs: {
        Row: {
          aspect_ratio: string
          completed_at: string | null
          created_at: string
          credits_charged: number
          error_message: string | null
          id: string
          material_type: string | null
          model_id: string | null
          product_id: string | null
          prompt_id: string | null
          prompt_text: string | null
          reference_image_ids: string[]
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
          error_message?: string | null
          id?: string
          material_type?: string | null
          model_id?: string | null
          product_id?: string | null
          prompt_id?: string | null
          prompt_text?: string | null
          reference_image_ids?: string[]
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
          error_message?: string | null
          id?: string
          material_type?: string | null
          model_id?: string | null
          product_id?: string | null
          prompt_id?: string | null
          prompt_text?: string | null
          reference_image_ids?: string[]
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
          id: string
          instructions: string | null
          marketplace: string | null
          metadata: Json
          name: string
          owner_id: string
          status: Database["public"]["Enums"]["product_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          marketplace?: string | null
          metadata?: Json
          name: string
          owner_id: string
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          marketplace?: string | null
          metadata?: Json
          name?: string
          owner_id?: string
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
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
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
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
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
    Views: { [_ in never]: never }
    Functions: {
      admin_adjust_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_wallet_id: string
        }
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
      bootstrap_current_user: {
        Args: Record<PropertyKey, never>
        Returns: undefined
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
      job_status: "queued" | "processing" | "completed" | "failed" | "cancelled"
      product_status:
        | "draft"
        | "ready"
        | "processing"
        | "completed"
        | "archived"
      prompt_status: "draft" | "ready" | "used" | "archived"
      quality_status: "pending" | "passed" | "warning" | "failed" | "skipped"
      user_role: "user" | "admin"
      workspace_role: "owner" | "admin" | "editor" | "viewer" | "operator"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]
