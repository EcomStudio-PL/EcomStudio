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
      auth_email_log: {
        Row: {
          action: string
          created_at: string
          failure_reason: string | null
          id: string
          locale: string | null
          recipient: string
          sent_at: string | null
          status: string
          template_key: string
          template_source: string
          template_version: number | null
          transport: string | null
          webhook_id: string
        }
        Insert: {
          action: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          locale?: string | null
          recipient: string
          sent_at?: string | null
          status?: string
          template_key: string
          template_source: string
          template_version?: number | null
          transport?: string | null
          webhook_id: string
        }
        Update: {
          action?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          locale?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string
          template_key?: string
          template_source?: string
          template_version?: number | null
          transport?: string | null
          webhook_id?: string
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
      ai_tools: {
        Row: {
          tool_key: string
          service_slug: string | null
          engine_mode: string
          allow_model_choice: boolean
          fallback_enabled: boolean
          timeout_ms: number
          max_attempts: number
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          tool_key: string
          service_slug?: string | null
          engine_mode?: string
          allow_model_choice?: boolean
          fallback_enabled?: boolean
          timeout_ms?: number
          max_attempts?: number
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          tool_key?: string
          service_slug?: string | null
          engine_mode?: string
          allow_model_choice?: boolean
          fallback_enabled?: boolean
          timeout_ms?: number
          max_attempts?: number
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_tool_models: {
        Row: { tool_key: string; model_id: string; role: string; sort_order: number }
        Insert: { tool_key: string; model_id: string; role: string; sort_order?: number }
        Update: { tool_key?: string; model_id?: string; role?: string; sort_order?: number }
        Relationships: []
      }
      ai_tool_prompts: {
        Row: {
          id: string
          tool_key: string
          version: number
          status: string
          body_encrypted: string
          body_iv: string
          body_tag: string
          summary: string | null
          reason: string | null
          source: string
          created_by: string | null
          created_at: string
          published_at: string | null
        }
        Insert: {
          id?: string
          tool_key: string
          version: number
          status?: string
          body_encrypted: string
          body_iv: string
          body_tag: string
          summary?: string | null
          reason?: string | null
          source?: string
          created_by?: string | null
          created_at?: string
          published_at?: string | null
        }
        Update: {
          id?: string
          tool_key?: string
          version?: number
          status?: string
          body_encrypted?: string
          body_iv?: string
          body_tag?: string
          summary?: string | null
          reason?: string | null
          source?: string
          created_by?: string | null
          created_at?: string
          published_at?: string | null
        }
        Relationships: []
      }
      ai_tool_knowledge: {
        Row: { tool_key: string; set_id: string; enabled: boolean; created_at: string }
        Insert: { tool_key: string; set_id: string; enabled?: boolean; created_at?: string }
        Update: { tool_key?: string; set_id?: string; enabled?: boolean; created_at?: string }
        Relationships: []
      }
      ai_provider_budgets: {
        Row: {
          provider_id: string
          monthly_budget_usd_micros: number | null
          warn_percent: number
          critical_percent: number
          max_request_usd_micros: number | null
          failure_rate_percent: number | null
          alerts_enabled: boolean
          last_alert_level: string | null
          last_alert_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          provider_id: string
          monthly_budget_usd_micros?: number | null
          warn_percent?: number
          critical_percent?: number
          max_request_usd_micros?: number | null
          failure_rate_percent?: number | null
          alerts_enabled?: boolean
          last_alert_level?: string | null
          last_alert_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          provider_id?: string
          monthly_budget_usd_micros?: number | null
          warn_percent?: number
          critical_percent?: number
          max_request_usd_micros?: number | null
          failure_rate_percent?: number | null
          alerts_enabled?: boolean
          last_alert_level?: string | null
          last_alert_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_models: {
        Row: {
          active: boolean
          badge: string | null
          badge_tone: string | null
          capabilities: Json
          created_at: string
          credit_cost: number
          description: string | null
          display_name: string | null
          ecom_surcharge_credits: number
          estimated_api_cost: number
          id: string
          internal_cost_usd_micros: number
          max_outputs: number | null
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
          visible_custom: boolean
          visible_managed: boolean
        }
        Insert: {
          active?: boolean
          badge?: string | null
          badge_tone?: string | null
          capabilities?: Json
          created_at?: string
          credit_cost?: number
          description?: string | null
          display_name?: string | null
          ecom_surcharge_credits?: number
          estimated_api_cost?: number
          id?: string
          internal_cost_usd_micros?: number
          max_outputs?: number | null
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
          visible_custom?: boolean
          visible_managed?: boolean
        }
        Update: {
          active?: boolean
          badge?: string | null
          badge_tone?: string | null
          capabilities?: Json
          created_at?: string
          credit_cost?: number
          description?: string | null
          display_name?: string | null
          ecom_surcharge_credits?: number
          estimated_api_cost?: number
          id?: string
          internal_cost_usd_micros?: number
          max_outputs?: number | null
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
          visible_custom?: boolean
          visible_managed?: boolean
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
      app_banners: {
        Row: {
          active: boolean
          banner_key: string
          body: Json
          created_at: string
          cta_label: Json
          cta_url: string | null
          ends_at: string | null
          id: string
          label: Json
          placement: string
          sort_order: number
          starts_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          banner_key: string
          body?: Json
          created_at?: string
          cta_label?: Json
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          label?: Json
          placement?: string
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          banner_key?: string
          body?: Json
          created_at?: string
          cta_label?: Json
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          label?: Json
          placement?: string
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_banners_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      cms_redirects: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          hits: number
          id: string
          last_hit_at: string | null
          note: string | null
          source: string
          status_code: number
          target: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          hits?: number
          id?: string
          last_hit_at?: string | null
          note?: string | null
          source: string
          status_code?: number
          target: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          hits?: number
          id?: string
          last_hit_at?: string | null
          note?: string | null
          source?: string
          status_code?: number
          target?: string
          updated_at?: string
        }
        Relationships: []
      }
      cms_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          payload: Json
          section_type: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          name: string
          payload?: Json
          section_type?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          payload?: Json
          section_type?: string | null
        }
        Relationships: []
      }
      cms_blocks: {
        Row: {
          analytics_id: string | null
          anchor: string | null
          code: Json
          content: Json
          created_at: string
          id: string
          page_id: string
          sort_order: number
          style: Json
          type: string
          updated_at: string
          updated_by: string | null
          visible: boolean
          audience: string
          show_from: string | null
          show_until: string | null
        }
        Insert: {
          analytics_id?: string | null
          anchor?: string | null
          code?: Json
          content?: Json
          created_at?: string
          id?: string
          page_id: string
          sort_order?: number
          style?: Json
          type: string
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
          audience?: string
          show_from?: string | null
          show_until?: string | null
        }
        Update: {
          analytics_id?: string | null
          anchor?: string | null
          code?: Json
          content?: Json
          created_at?: string
          id?: string
          page_id?: string
          sort_order?: number
          style?: Json
          type?: string
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
          audience?: string
          show_from?: string | null
          show_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_blocks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "cms_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_blocks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_global_sections: {
        Row: {
          content: Json
          id: string
          published_at: string | null
          published_snapshot: Json | null
          slot: string
          style: Json
          type: string
          updated_at: string
          updated_by: string | null
          visible: boolean
        }
        Insert: {
          content?: Json
          id?: string
          published_at?: string | null
          published_snapshot?: Json | null
          slot: string
          style?: Json
          type: string
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
        }
        Update: {
          content?: Json
          id?: string
          published_at?: string | null
          published_snapshot?: Json | null
          slot?: string
          style?: Json
          type?: string
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cms_global_sections_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_pages: {
        Row: {
          created_at: string
          id: string
          is_homepage: boolean
          kind: string
          nav_group: string | null
          nav_order: number
          published_at: string | null
          published_snapshot: Json | null
          scheduled_at: string | null
          seo: Json
          slug: string
          sort_order: number
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          footer_mode: string
          header_mode: string
          promo: Json
          template: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_homepage?: boolean
          kind?: string
          nav_group?: string | null
          nav_order?: number
          published_at?: string | null
          published_snapshot?: Json | null
          scheduled_at?: string | null
          seo?: Json
          slug: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          footer_mode?: string
          header_mode?: string
          promo?: Json
          template?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_homepage?: boolean
          kind?: string
          nav_group?: string | null
          nav_order?: number
          published_at?: string | null
          published_snapshot?: Json | null
          scheduled_at?: string | null
          seo?: Json
          slug?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          footer_mode?: string
          header_mode?: string
          promo?: Json
          template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_pages_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_page_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          page_id: string
          reason: string
          seo: Json
          snapshot: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          page_id: string
          reason?: string
          seo?: Json
          snapshot?: Json
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          page_id?: string
          reason?: string
          seo?: Json
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cms_page_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "cms_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          handled_at: string | null
          handled_by: string | null
          id: string
          locale: string
          message: string
          metadata: Json
          name: string
          source: string | null
          status: string
          topic: string
        }
        Insert: {
          created_at?: string
          email: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          locale?: string
          message: string
          metadata?: Json
          name: string
          source?: string | null
          status?: string
          topic?: string
        }
        Update: {
          created_at?: string
          email?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          locale?: string
          message?: string
          metadata?: Json
          name?: string
          source?: string | null
          status?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_messages_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          stripe_price_id: string | null
          stripe_product_id: string | null
                  stripe_price_cents: number | null
          stripe_sync_error: string | null
          stripe_sync_status: string
          stripe_synced_at: string | null
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
          stripe_price_id?: string | null
          stripe_product_id?: string | null
                  stripe_price_cents?: number | null
          stripe_sync_error?: string | null
          stripe_sync_status?: string
          stripe_synced_at?: string | null
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
          stripe_price_id?: string | null
          stripe_product_id?: string | null
                  stripe_price_cents?: number | null
          stripe_sync_error?: string | null
          stripe_sync_status?: string
          stripe_synced_at?: string | null
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
      email_settings: {
        Row: {
          confirmation_body: string
          confirmation_enabled: boolean
          confirmation_subject: string
          from_email: string
          from_name: string
          id: boolean
          last_test_error_safe: string | null
          last_test_status: string | null
          last_tested_at: string | null
          reply_to: string
          smtp_encryption: string
          smtp_host: string
          smtp_port: number
          smtp_secret_auth_tag: string | null
          smtp_secret_ciphertext: string | null
          smtp_secret_iv: string | null
          smtp_user: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          confirmation_body?: string
          confirmation_enabled?: boolean
          confirmation_subject?: string
          from_email?: string
          from_name?: string
          id?: boolean
          last_test_error_safe?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          reply_to?: string
          smtp_encryption?: string
          smtp_host?: string
          smtp_port?: number
          smtp_secret_auth_tag?: string | null
          smtp_secret_ciphertext?: string | null
          smtp_secret_iv?: string | null
          smtp_user?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          confirmation_body?: string
          confirmation_enabled?: boolean
          confirmation_subject?: string
          from_email?: string
          from_name?: string
          id?: boolean
          last_test_error_safe?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          reply_to?: string
          smtp_encryption?: string
          smtp_host?: string
          smtp_port?: number
          smtp_secret_auth_tag?: string | null
          smtp_secret_ciphertext?: string | null
          smtp_secret_iv?: string | null
          smtp_user?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_availability: {
        Row: {
          auto_reenable: boolean
          custom_message: string | null
          custom_title: string | null
          ends_at: string | null
          feature_key: string
          hidden_from_menu: boolean
          starts_at: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_reenable?: boolean
          custom_message?: string | null
          custom_title?: string | null
          ends_at?: string | null
          feature_key: string
          hidden_from_menu?: boolean
          starts_at?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_reenable?: boolean
          custom_message?: string | null
          custom_title?: string | null
          ends_at?: string | null
          feature_key?: string
          hidden_from_menu?: boolean
          starts_at?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
          model_id: string | null
          negative_prompt: string | null
          primary_reference: number | null
          priority: number
          product_id: string | null
          prompt_encrypted: string | null
          prompt_iv: string | null
          prompt_origin: string
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
          model_id?: string | null
          negative_prompt?: string | null
          primary_reference?: number | null
          priority?: number
          product_id?: string | null
          prompt_encrypted?: string | null
          prompt_iv?: string | null
          prompt_origin?: string
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
          model_id?: string | null
          negative_prompt?: string | null
          primary_reference?: number | null
          priority?: number
          product_id?: string | null
          prompt_encrypted?: string | null
          prompt_iv?: string | null
          prompt_origin?: string
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
            foreignKeyName: "generated_prompts_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "ai_models"
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
          parent_job_id: string | null
          product_id: string | null
          prompt_id: string | null
          prompt_origin: string | null
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
          parent_job_id?: string | null
          product_id?: string | null
          prompt_id?: string | null
          prompt_origin?: string | null
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
          parent_job_id?: string | null
          product_id?: string | null
          prompt_id?: string | null
          prompt_origin?: string | null
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
            foreignKeyName: "generation_jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
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
          favorite: boolean
          id: string
          job_id: string
          product_id: string | null
          product_match_score: number | null
          quality_check_data: Json
          quality_notes: string | null
          quality_status: Database["public"]["Enums"]["quality_status"]
          user_note: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          favorite?: boolean
          id?: string
          job_id: string
          product_id?: string | null
          product_match_score?: number | null
          quality_check_data?: Json
          quality_notes?: string | null
          quality_status?: Database["public"]["Enums"]["quality_status"]
          user_note?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          favorite?: boolean
          id?: string
          job_id?: string
          product_id?: string | null
          product_match_score?: number | null
          quality_check_data?: Json
          quality_notes?: string | null
          quality_status?: Database["public"]["Enums"]["quality_status"]
          user_note?: string | null
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
      grovnews_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      grovnews_entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_by: string | null
          id: string
          internal_note: string | null
          source: string
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          internal_note?: string | null
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          internal_note?: string | null
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grovnews_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grovnews_posts: {
        Row: {
          category_id: string | null
          content: string
          cover_url: string | null
          created_at: string
          created_by: string | null
          email_summary: string | null
          estimated_read_minutes: number
          excerpt: string
          id: string
          language: string
          metadata: Json
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          sources: Json
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          content?: string
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          email_summary?: string | null
          estimated_read_minutes?: number
          excerpt?: string
          id?: string
          language?: string
          metadata?: Json
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          sources?: Json
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          content?: string
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          email_summary?: string | null
          estimated_read_minutes?: number
          excerpt?: string
          id?: string
          language?: string
          metadata?: Json
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          sources?: Json
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grovnews_posts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "grovnews_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      grovnews_edition_posts: {
        Row: {
          created_at: string
          edition_id: string
          email_blurb: string | null
          featured: boolean
          position: number
          post_id: string
        }
        Insert: {
          created_at?: string
          edition_id: string
          email_blurb?: string | null
          featured?: boolean
          position: number
          post_id: string
        }
        Update: {
          created_at?: string
          edition_id?: string
          email_blurb?: string | null
          featured?: boolean
          position?: number
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grovnews_edition_posts_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "grovnews_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grovnews_edition_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "grovnews_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      grovnews_editions: {
        Row: {
          auto_generated: boolean
          campaign_id: string | null
          created_at: string
          created_by: string | null
          edition_date: string
          email_body: string | null
          email_prepared_at: string | null
          email_preview: string | null
          email_recipients: number | null
          email_subject: string | null
          failure_reason: string | null
          generated_at: string | null
          id: string
          intro: string
          published_at: string | null
          queued_at: string | null
          sent_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          edition_date: string
          email_body?: string | null
          email_prepared_at?: string | null
          email_preview?: string | null
          email_recipients?: number | null
          email_subject?: string | null
          failure_reason?: string | null
          generated_at?: string | null
          id?: string
          intro?: string
          published_at?: string | null
          queued_at?: string | null
          sent_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          edition_date?: string
          email_body?: string | null
          email_prepared_at?: string | null
          email_preview?: string | null
          email_recipients?: number | null
          email_subject?: string | null
          failure_reason?: string | null
          generated_at?: string | null
          id?: string
          intro?: string
          published_at?: string | null
          queued_at?: string | null
          sent_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grovnews_editions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "newsletter_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      grovnews_research_items: {
        Row: {
          ai_reason: string | null
          ai_summary: string | null
          ai_title: string | null
          analysis_attempts: number
          analysis_error: string | null
          analyzed_at: string | null
          canonical_url: string
          category_id: string | null
          content_hash: string
          created_at: string
          discovered_at: string
          duplicate_of: string | null
          id: string
          importance_score: number | null
          metadata: Json
          normalized_url: string
          post_id: string | null
          relevance_score: number | null
          review_reason: string | null
          review_required: boolean
          selected_at: string | null
          sensitive: boolean
          source_excerpt: string
          source_id: string | null
          source_published_at: string | null
          source_title: string
          status: string
          title_norm: string
          updated_at: string
        }
        Insert: {
          ai_reason?: string | null
          ai_summary?: string | null
          ai_title?: string | null
          analysis_attempts?: number
          analysis_error?: string | null
          analyzed_at?: string | null
          canonical_url: string
          category_id?: string | null
          content_hash: string
          created_at?: string
          discovered_at?: string
          duplicate_of?: string | null
          id?: string
          importance_score?: number | null
          metadata?: Json
          normalized_url: string
          post_id?: string | null
          relevance_score?: number | null
          review_reason?: string | null
          review_required?: boolean
          selected_at?: string | null
          sensitive?: boolean
          source_excerpt?: string
          source_id?: string | null
          source_published_at?: string | null
          source_title: string
          status?: string
          title_norm?: string
          updated_at?: string
        }
        Update: {
          ai_reason?: string | null
          ai_summary?: string | null
          ai_title?: string | null
          analysis_attempts?: number
          analysis_error?: string | null
          analyzed_at?: string | null
          canonical_url?: string
          category_id?: string | null
          content_hash?: string
          created_at?: string
          discovered_at?: string
          duplicate_of?: string | null
          id?: string
          importance_score?: number | null
          metadata?: Json
          normalized_url?: string
          post_id?: string | null
          relevance_score?: number | null
          review_reason?: string | null
          review_required?: boolean
          selected_at?: string | null
          sensitive?: boolean
          source_excerpt?: string
          source_id?: string | null
          source_published_at?: string | null
          source_title?: string
          status?: string
          title_norm?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grovnews_research_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "grovnews_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grovnews_research_items_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "grovnews_research_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grovnews_research_items_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "grovnews_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grovnews_research_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "grovnews_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      grovnews_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          invocations: number
          kind: string
          locked_until: string | null
          run_date: string
          stage: string
          started_at: string
          stats: Json
          status: string
          trigger: string
          updated_at: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          invocations?: number
          kind?: string
          locked_until?: string | null
          run_date: string
          stage?: string
          started_at?: string
          stats?: Json
          status?: string
          trigger?: string
          updated_at?: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          invocations?: number
          kind?: string
          locked_until?: string | null
          run_date?: string
          stage?: string
          started_at?: string
          stats?: Json
          status?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: []
      }
      grovnews_settings: {
        Row: {
          auto_publish_official_sensitive: boolean
          daily_enabled: boolean
          id: boolean
          max_topics: number
          min_importance: number
          min_relevance: number
          mode: string
          run_hour: number
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_publish_official_sensitive?: boolean
          daily_enabled?: boolean
          id?: boolean
          max_topics?: number
          min_importance?: number
          min_relevance?: number
          mode?: string
          run_hour?: number
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_publish_official_sensitive?: boolean
          daily_enabled?: boolean
          id?: boolean
          max_topics?: number
          min_importance?: number
          min_relevance?: number
          mode?: string
          run_hour?: number
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      grovnews_sources: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          language: string
          last_checked_at: string | null
          last_error: string | null
          last_success_at: string | null
          name: string
          official_source: boolean
          priority: number
          source_type: string
          updated_at: string
          url: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          language?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          name: string
          official_source?: boolean
          priority?: number
          source_type: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          language?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          name?: string
          official_source?: boolean
          priority?: number
          source_type?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grovnews_sources_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "grovnews_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_settings: {
        Row: {
          config: Json
          enabled: boolean
          last_error_safe: string | null
          last_tested_at: string | null
          secrets: Json
          status: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          enabled?: boolean
          last_error_safe?: string | null
          last_tested_at?: string | null
          secrets?: Json
          status?: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          enabled?: boolean
          last_error_safe?: string | null
          last_tested_at?: string | null
          secrets?: Json
          status?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_examples: {
        Row: {
          correction: string | null
          created_at: string
          embedding: string | null
          enabled: boolean
          generated_path: string | null
          hint_encrypted: string | null
          hint_iv: string | null
          hint_tag: string | null
          id: string
          prompt_used: string | null
          reference_path: string | null
          result_rating: number | null
          set_id: string
          tags: string[]
          what_failed: string | null
          what_worked: string | null
        }
        Insert: {
          correction?: string | null
          created_at?: string
          embedding?: string | null
          enabled?: boolean
          generated_path?: string | null
          hint_encrypted?: string | null
          hint_iv?: string | null
          hint_tag?: string | null
          id?: string
          prompt_used?: string | null
          reference_path?: string | null
          result_rating?: number | null
          set_id: string
          tags?: string[]
          what_failed?: string | null
          what_worked?: string | null
        }
        Update: {
          correction?: string | null
          created_at?: string
          embedding?: string | null
          enabled?: boolean
          generated_path?: string | null
          hint_encrypted?: string | null
          hint_iv?: string | null
          hint_tag?: string | null
          id?: string
          prompt_used?: string | null
          reference_path?: string | null
          result_rating?: number | null
          set_id?: string
          tags?: string[]
          what_failed?: string | null
          what_worked?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_examples_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sets: {
        Row: {
          created_at: string
          created_by: string | null
          doc_text: string | null
          error: string | null
          file_count: number
          id: string
          model: string | null
          name: string
          notes: string | null
          product_category: string | null
          product_description: string | null
          status: string
          updated_at: string
          version: number
          zip_path: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_text?: string | null
          error?: string | null
          file_count?: number
          id?: string
          model?: string | null
          name: string
          notes?: string | null
          product_category?: string | null
          product_description?: string | null
          status?: string
          updated_at?: string
          version?: number
          zip_path?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_text?: string | null
          error?: string | null
          file_count?: number
          id?: string
          model?: string | null
          name?: string
          notes?: string | null
          product_category?: string | null
          product_description?: string | null
          status?: string
          updated_at?: string
          version?: number
          zip_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      login_security_challenges: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          device_hash: string
          device_label: string
          expires_at: string
          id: string
          ip_hash: string | null
          max_attempts: number
          reason: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          device_hash: string
          device_label?: string
          expires_at: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          reason?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          device_hash?: string
          device_label?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          max_attempts?: number
          reason?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mail_sync_state: {
        Row: {
          folder: string
          id: string
          last_checked_at: string | null
          last_error_safe: string | null
          last_success_at: string | null
          last_uid: number
          uid_validity: number | null
          updated_at: string
        }
        Insert: {
          folder: string
          id?: string
          last_checked_at?: string | null
          last_error_safe?: string | null
          last_success_at?: string | null
          last_uid?: number
          uid_validity?: number | null
          updated_at?: string
        }
        Update: {
          folder?: string
          id?: string
          last_checked_at?: string | null
          last_error_safe?: string | null
          last_success_at?: string | null
          last_uid?: number
          uid_validity?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          alt: string | null
          created_at: string
          created_by: string | null
          external_url: string | null
          folder: string | null
          height: number | null
          id: string
          kind: string
          mime: string | null
          poster_url: string | null
          size_bytes: number | null
          storage_path: string | null
          tags: string[]
          title: string | null
          updated_at: string
          variants: Json
          width: number | null
        }
        Insert: {
          alt?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          folder?: string | null
          height?: number | null
          id?: string
          kind?: string
          mime?: string | null
          poster_url?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          variants?: Json
          width?: number | null
        }
        Update: {
          alt?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          folder?: string | null
          height?: number | null
          id?: string
          kind?: string
          mime?: string | null
          poster_url?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          variants?: Json
          width?: number | null
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
      media_slots: {
        Row: {
          alt_text: string | null
          autoplay: boolean
          controls: boolean
          created_at: string
          enabled: boolean
          entity_id: string
          entity_type: string
          id: string
          loop: boolean
          media_id: string | null
          media_type: string
          mobile_media_id: string | null
          muted: boolean
          object_fit: string
          object_position: string
          poster_media_id: string | null
          slot_key: string
          slot_name: string
          tablet_media_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alt_text?: string | null
          autoplay?: boolean
          controls?: boolean
          created_at?: string
          enabled?: boolean
          entity_id: string
          entity_type: string
          id?: string
          loop?: boolean
          media_id?: string | null
          media_type?: string
          mobile_media_id?: string | null
          muted?: boolean
          object_fit?: string
          object_position?: string
          poster_media_id?: string | null
          slot_key: string
          slot_name: string
          tablet_media_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alt_text?: string | null
          autoplay?: boolean
          controls?: boolean
          created_at?: string
          enabled?: boolean
          entity_id?: string
          entity_type?: string
          id?: string
          loop?: boolean
          media_id?: string | null
          media_type?: string
          mobile_media_id?: string | null
          muted?: boolean
          object_fit?: string
          object_position?: string
          poster_media_id?: string | null
          slot_key?: string
          slot_name?: string
          tablet_media_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_slots_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_slots_mobile_media_id_fkey"
            columns: ["mobile_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_slots_poster_media_id_fkey"
            columns: ["poster_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_slots_tablet_media_id_fkey"
            columns: ["tablet_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_slots_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          channel: string
          draft: Json | null
          event_type: string
          key: string
          published: Json | null
          published_at: string | null
          published_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channel: string
          draft?: Json | null
          event_type: string
          key: string
          published?: Json | null
          published_at?: string | null
          published_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channel?: string
          draft?: Json | null
          event_type?: string
          key?: string
          published?: Json | null
          published_at?: string | null
          published_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      newsletter_attributions: {
        Row: {
          id: string
          campaign_id: string
          contact_id: string | null
          recipient_id: string | null
          click_at: string
          converted_at: string | null
          order_ref: string | null
          amount_cents: number | null
          currency: string | null
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          contact_id?: string | null
          recipient_id?: string | null
          click_at?: string
          converted_at?: string | null
          order_ref?: string | null
          amount_cents?: number | null
          currency?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          contact_id?: string | null
          recipient_id?: string | null
          click_at?: string
          converted_at?: string | null
          order_ref?: string | null
          amount_cents?: number | null
          currency?: string | null
          created_at?: string
        }
        Relationships: []
      }
      newsletter_automations: {
        Row: {
          id: string
          name: string
          enabled: boolean
          trigger_type: string
          trigger_config: Json
          campaign_id: string
          created_at: string
          updated_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          name: string
          enabled?: boolean
          trigger_type: string
          trigger_config?: Json
          campaign_id: string
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          enabled?: boolean
          trigger_type?: string
          trigger_config?: Json
          campaign_id?: string
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      newsletter_campaign_steps: {
        Row: {
          id: string
          campaign_id: string
          step_index: number
          variant: string
          delay_minutes: number
          subject: string
          preheader: string
          editor: string
          blocks: Json
          body_html: string
          body_text: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          step_index?: number
          variant?: string
          delay_minutes?: number
          subject?: string
          preheader?: string
          editor?: string
          blocks?: Json
          body_html?: string
          body_text?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          step_index?: number
          variant?: string
          delay_minutes?: number
          subject?: string
          preheader?: string
          editor?: string
          blocks?: Json
          body_html?: string
          body_text?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      newsletter_campaigns: {
        Row: {
          id: string
          name: string
          kind: string
          status: string
          audience: Json
          scheduled_at: string | null
          started_at: string | null
          finished_at: string | null
          track_opens: boolean
          track_clicks: boolean
          utm: Json
          ab_enabled: boolean
          ab_share_pct: number
          ab_decide_after_hours: number
          ab_metric: string
          ab_winner: string | null
          ab_decided_at: string | null
          stop_on_conversion: boolean
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          name: string
          kind?: string
          status?: string
          audience?: Json
          scheduled_at?: string | null
          started_at?: string | null
          finished_at?: string | null
          track_opens?: boolean
          track_clicks?: boolean
          utm?: Json
          ab_enabled?: boolean
          ab_share_pct?: number
          ab_decide_after_hours?: number
          ab_metric?: string
          ab_winner?: string | null
          ab_decided_at?: string | null
          stop_on_conversion?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          kind?: string
          status?: string
          audience?: Json
          scheduled_at?: string | null
          started_at?: string | null
          finished_at?: string | null
          track_opens?: boolean
          track_clicks?: boolean
          utm?: Json
          ab_enabled?: boolean
          ab_share_pct?: number
          ab_decide_after_hours?: number
          ab_metric?: string
          ab_winner?: string | null
          ab_decided_at?: string | null
          stop_on_conversion?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      newsletter_contacts: {
        Row: {
          id: string
          email: string
          first_name: string | null
          last_name: string | null
          locale: string
          source_key: string
          user_id: string | null
          tags: string[]
          marketing_consent: boolean
          consent_at: string | null
          consent_source: string | null
          consent_version: string | null
          unsubscribed_at: string | null
          unsubscribe_reason: string | null
          unsubscribe_token: string
          last_activity_at: string | null
          last_sent_at: string | null
          last_opened_at: string | null
          last_clicked_at: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          metadata: Json
        }
        Insert: {
          id?: string
          email: string
          first_name?: string | null
          last_name?: string | null
          locale?: string
          source_key?: string
          user_id?: string | null
          tags?: string[]
          marketing_consent?: boolean
          consent_at?: string | null
          consent_source?: string | null
          consent_version?: string | null
          unsubscribed_at?: string | null
          unsubscribe_reason?: string | null
          unsubscribe_token?: string
          last_activity_at?: string | null
          last_sent_at?: string | null
          last_opened_at?: string | null
          last_clicked_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          metadata?: Json
        }
        Update: {
          id?: string
          email?: string
          first_name?: string | null
          last_name?: string | null
          locale?: string
          source_key?: string
          user_id?: string | null
          tags?: string[]
          marketing_consent?: boolean
          consent_at?: string | null
          consent_source?: string | null
          consent_version?: string | null
          unsubscribed_at?: string | null
          unsubscribe_reason?: string | null
          unsubscribe_token?: string
          last_activity_at?: string | null
          last_sent_at?: string | null
          last_opened_at?: string | null
          last_clicked_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      newsletter_events: {
        Row: {
          id: number
          event_type: string
          campaign_id: string | null
          step_index: number | null
          variant: string | null
          contact_id: string | null
          recipient_id: string | null
          link_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: number
          event_type: string
          campaign_id?: string | null
          step_index?: number | null
          variant?: string | null
          contact_id?: string | null
          recipient_id?: string | null
          link_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: number
          event_type?: string
          campaign_id?: string | null
          step_index?: number | null
          variant?: string | null
          contact_id?: string | null
          recipient_id?: string | null
          link_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      newsletter_group_members: {
        Row: {
          group_id: string
          contact_id: string
          added_at: string
        }
        Insert: {
          group_id: string
          contact_id: string
          added_at?: string
        }
        Update: {
          group_id?: string
          contact_id?: string
          added_at?: string
        }
        Relationships: []
      }
      newsletter_groups: {
        Row: {
          id: string
          key: string
          name: string
          description: string | null
          is_dynamic: boolean
          rules: Json
          created_at: string
          updated_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          key: string
          name: string
          description?: string | null
          is_dynamic?: boolean
          rules?: Json
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          key?: string
          name?: string
          description?: string | null
          is_dynamic?: boolean
          rules?: Json
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      newsletter_links: {
        Row: {
          id: string
          campaign_id: string
          url: string
          label: string | null
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          url: string
          label?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          url?: string
          label?: string | null
          created_at?: string
        }
        Relationships: []
      }
      newsletter_recipients: {
        Row: {
          id: string
          campaign_id: string
          step_index: number
          variant: string
          contact_id: string
          email: string
          status: string
          send_after: string
          attempts: number
          claimed_at: string | null
          next_attempt_at: string | null
          sent_at: string | null
          smtp_response: string | null
          message_id: string | null
          last_error_safe: string | null
          personalization: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          step_index?: number
          variant?: string
          contact_id: string
          email: string
          status?: string
          send_after?: string
          attempts?: number
          claimed_at?: string | null
          next_attempt_at?: string | null
          sent_at?: string | null
          smtp_response?: string | null
          message_id?: string | null
          last_error_safe?: string | null
          personalization?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          campaign_id?: string
          step_index?: number
          variant?: string
          contact_id?: string
          email?: string
          status?: string
          send_after?: string
          attempts?: number
          claimed_at?: string | null
          next_attempt_at?: string | null
          sent_at?: string | null
          smtp_response?: string | null
          message_id?: string | null
          last_error_safe?: string | null
          personalization?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      newsletter_sources: {
        Row: {
          key: string
          name: string
          note: string | null
          created_at: string
        }
        Insert: {
          key: string
          name: string
          note?: string | null
          created_at?: string
        }
        Update: {
          key?: string
          name?: string
          note?: string | null
          created_at?: string
        }
        Relationships: []
      }
      newsletter_suppressions: {
        Row: {
          email: string
          reason: string
          note: string | null
          created_at: string
          created_by: string | null
        }
        Insert: {
          email: string
          reason?: string
          note?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          email?: string
          reason?: string
          note?: string | null
          created_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      newsletter_templates: {
        Row: {
          id: string
          key: string | null
          name: string
          category: string
          subject: string
          preheader: string
          editor: string
          blocks: Json
          body_html: string
          is_builtin: boolean
          created_at: string
          updated_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          key?: string | null
          name: string
          category?: string
          subject?: string
          preheader?: string
          editor?: string
          blocks?: Json
          body_html?: string
          is_builtin?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          key?: string | null
          name?: string
          category?: string
          subject?: string
          preheader?: string
          editor?: string
          blocks?: Json
          body_html?: string
          is_builtin?: boolean
          created_at?: string
          updated_at?: string
          created_by?: string | null
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          channel: string
          claimed_at: string | null
          created_at: string
          dedupe_key: string | null
          event_type: string
          id: string
          last_error_safe: string | null
          payload: Json
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          channel?: string
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_type: string
          id?: string
          last_error_safe?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          channel?: string
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_type?: string
          id?: string
          last_error_safe?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          admin_email_enabled: boolean
          category: string
          event_type: string
          sort_order: number
          telegram_enabled: boolean
          updated_at: string
        }
        Insert: {
          admin_email_enabled?: boolean
          category: string
          event_type: string
          sort_order?: number
          telegram_enabled?: boolean
          updated_at?: string
        }
        Update: {
          admin_email_enabled?: boolean
          category?: string
          event_type?: string
          sort_order?: number
          telegram_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
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
      onboarding_survey_responses: {
        Row: {
          answer: string[]
          created_at: string
          id: string
          offer_id: string | null
          question_key: string
          user_id: string
        }
        Insert: {
          answer?: string[]
          created_at?: string
          id?: string
          offer_id?: string | null
          question_key: string
          user_id: string
        }
        Update: {
          answer?: string[]
          created_at?: string
          id?: string
          offer_id?: string | null
          question_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_survey_responses_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "welcome_bonus_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          credit_tx_id: string | null
          credits_granted: number
          currency: string
          id: string
          kind: string | null
          metadata: Json
          package_id: string | null
          plan_id: string | null
          provider: string | null
          provider_payment_id: string | null
          status: string
          stripe_customer_id: string | null
          workspace_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          credit_tx_id?: string | null
          credits_granted?: number
          currency?: string
          id?: string
          kind?: string | null
          metadata?: Json
          package_id?: string | null
          plan_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          workspace_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          credit_tx_id?: string | null
          credits_granted?: number
          currency?: string
          id?: string
          kind?: string | null
          metadata?: Json
          package_id?: string | null
          plan_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          status?: string
          stripe_customer_id?: string | null
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
      payment_events: {
        Row: {
          detail: Json
          event_type: string
          object_id: string | null
          outcome: string
          received_at: string
          stripe_event_id: string
          workspace_id: string | null
        }
        Insert: {
          detail?: Json
          event_type: string
          object_id?: string | null
          outcome: string
          received_at?: string
          stripe_event_id: string
          workspace_id?: string | null
        }
        Update: {
          detail?: Json
          event_type?: string
          object_id?: string | null
          outcome?: string
          received_at?: string
          stripe_event_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accepted_privacy_at: string | null
          accepted_terms_at: string | null
          account_manager_id: string | null
          acquisition_source: string | null
          acquisition_source_other: string | null
          avatar_url: string | null
          blocked: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_note: string | null
          blocked_reason: string | null
          blocked_until: string | null
          company_account: boolean
          company_city: string | null
          company_country: string | null
          company_name: string | null
          company_postal_code: string | null
          company_street: string | null
          created_at: string
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          marketing_consent: boolean
          marketing_consent_at: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          accepted_privacy_at?: string | null
          accepted_terms_at?: string | null
          account_manager_id?: string | null
          acquisition_source?: string | null
          acquisition_source_other?: string | null
          avatar_url?: string | null
          blocked?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_note?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          company_account?: boolean
          company_city?: string | null
          company_country?: string | null
          company_name?: string | null
          company_postal_code?: string | null
          company_street?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          full_name?: string | null
          id: string
          last_name?: string | null
          marketing_consent?: boolean
          marketing_consent_at?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          accepted_privacy_at?: string | null
          accepted_terms_at?: string | null
          account_manager_id?: string | null
          acquisition_source?: string | null
          acquisition_source_other?: string | null
          avatar_url?: string | null
          blocked?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_note?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          company_account?: boolean
          company_city?: string | null
          company_country?: string | null
          company_name?: string | null
          company_postal_code?: string | null
          company_street?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          marketing_consent?: boolean
          marketing_consent_at?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tax_id?: string | null
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
      prompt_engine_rules: {
        Row: {
          content: string
          content_encrypted: string | null
          content_iv: string | null
          content_tag: string | null
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          name: string
          priority: number
          rule_type: string
          updated_at: string
          version: number
        }
        Insert: {
          content: string
          content_encrypted?: string | null
          content_iv?: string | null
          content_tag?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          name: string
          priority?: number
          rule_type?: string
          updated_at?: string
          version?: number
        }
        Update: {
          content?: string
          content_encrypted?: string | null
          content_iv?: string | null
          content_tag?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          name?: string
          priority?: number
          rule_type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_engine_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_engine_versions: {
        Row: {
          active: boolean
          changelog: string | null
          created_at: string
          created_by: string | null
          id: string
          version: string
        }
        Insert: {
          active?: boolean
          changelog?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          version: string
        }
        Update: {
          active?: boolean
          changelog?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_engine_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_sessions: {
        Row: {
          analysis_model: string | null
          analysis_provider: string | null
          aspect_ratio: string
          cache_hit: boolean
          created_at: string
          description: string | null
          engine_version: number | null
          error: string | null
          error_stage: string | null
          extra_info: string | null
          fallback_from: string | null
          fallback_reason: string | null
          feature_manifest: Json
          id: string
          image_analysis: Json
          knowledge_used: Json | null
          latency_ms: number | null
          mode: string
          product_id: string | null
          product_lock: Json
          product_name: string
          reference_hash: string | null
          reference_paths: string[]
          resolution: string | null
          session_type: string | null
          shot_briefs: Json | null
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
          engine_version?: number | null
          error?: string | null
          error_stage?: string | null
          extra_info?: string | null
          fallback_from?: string | null
          fallback_reason?: string | null
          feature_manifest?: Json
          id?: string
          image_analysis?: Json
          knowledge_used?: Json | null
          latency_ms?: number | null
          mode?: string
          product_id?: string | null
          product_lock?: Json
          product_name: string
          reference_hash?: string | null
          reference_paths?: string[]
          resolution?: string | null
          session_type?: string | null
          shot_briefs?: Json | null
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
          engine_version?: number | null
          error?: string | null
          error_stage?: string | null
          extra_info?: string | null
          fallback_from?: string | null
          fallback_reason?: string | null
          feature_manifest?: Json
          id?: string
          image_analysis?: Json
          knowledge_used?: Json | null
          latency_ms?: number | null
          mode?: string
          product_id?: string | null
          product_lock?: Json
          product_name?: string
          reference_hash?: string | null
          reference_paths?: string[]
          resolution?: string | null
          session_type?: string | null
          shot_briefs?: Json | null
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
      search_queries: {
        Row: {
          clicked: boolean
          created_at: string
          id: string
          media_type: string
          query: string
          result_count: number
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          clicked?: boolean
          created_at?: string
          id?: string
          media_type?: string
          query: string
          result_count?: number
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          clicked?: boolean
          created_at?: string
          id?: string
          media_type?: string
          query?: string
          result_count?: number
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      security_login_events: {
        Row: {
          device_id: string | null
          device_summary: string
          event_type: string
          id: string
          ip_hash: string | null
          occurred_at: string
          reason: string | null
          success: boolean | null
          user_id: string
        }
        Insert: {
          device_id?: string | null
          device_summary?: string
          event_type: string
          id?: string
          ip_hash?: string | null
          occurred_at?: string
          reason?: string | null
          success?: boolean | null
          user_id: string
        }
        Update: {
          device_id?: string | null
          device_summary?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
          occurred_at?: string
          reason?: string | null
          success?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_login_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "user_trusted_devices"
            referencedColumns: ["id"]
          },
        ]
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
      signup_events: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip_hash: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip_hash: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip_hash?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stripe_customers: {
        Row: {
          created_at: string
          livemode: boolean
          stripe_customer_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          livemode?: boolean
          stripe_customer_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          livemode?: boolean
          stripe_customer_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
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
          stripe_price_id_annual: string | null
          stripe_price_id_monthly: string | null
          stripe_product_id: string | null
                  stripe_price_annual_cents: number | null
          stripe_price_monthly_cents: number | null
          stripe_sync_error: string | null
          stripe_sync_status: string
          stripe_synced_at: string | null
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
          stripe_price_id_annual?: string | null
          stripe_price_id_monthly?: string | null
          stripe_product_id?: string | null
                  stripe_price_annual_cents?: number | null
          stripe_price_monthly_cents?: number | null
          stripe_sync_error?: string | null
          stripe_sync_status?: string
          stripe_synced_at?: string | null
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
          stripe_price_id_annual?: string | null
          stripe_price_id_monthly?: string | null
          stripe_product_id?: string | null
                  stripe_price_annual_cents?: number | null
          stripe_price_monthly_cents?: number | null
          stripe_sync_error?: string | null
          stripe_sync_status?: string
          stripe_synced_at?: string | null
}
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string
          id: string
          metadata: Json
          plan_id: string
          provider: string | null
          provider_subscription_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          workspace_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          metadata?: Json
          plan_id: string
          provider?: string | null
          provider_subscription_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          workspace_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          metadata?: Json
          plan_id?: string
          provider?: string | null
          provider_subscription_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
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
      user_trusted_devices: {
        Row: {
          created_at: string
          device_hash: string
          device_label: string
          first_verified_at: string
          id: string
          last_ip_hash: string | null
          last_seen_at: string
          last_verified_at: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_hash: string
          device_label?: string
          first_verified_at?: string
          id?: string
          last_ip_hash?: string | null
          last_seen_at?: string
          last_verified_at?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string
          device_label?: string
          first_verified_at?: string
          id?: string
          last_ip_hash?: string | null
          last_seen_at?: string
          last_verified_at?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      waitlist_subscribers: {
        Row: {
          confirmed_at: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          locale: string
          metadata: Json
          phone: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          locale?: string
          metadata?: Json
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          locale?: string
          metadata?: Json
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      welcome_bonus_offers: {
        Row: {
          campaign_version: number
          claimed_at: string | null
          created_at: string
          credit_transaction_id: string | null
          eligible_at: string
          expires_at: string
          id: string
          reward_amount: number
          status: Database["public"]["Enums"]["welcome_bonus_status"]
          user_id: string
        }
        Insert: {
          campaign_version?: number
          claimed_at?: string | null
          created_at?: string
          credit_transaction_id?: string | null
          eligible_at?: string
          expires_at: string
          id?: string
          reward_amount: number
          status?: Database["public"]["Enums"]["welcome_bonus_status"]
          user_id: string
        }
        Update: {
          campaign_version?: number
          claimed_at?: string | null
          created_at?: string
          credit_transaction_id?: string | null
          eligible_at?: string
          expires_at?: string
          id?: string
          reward_amount?: number
          status?: Database["public"]["Enums"]["welcome_bonus_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "welcome_bonus_offers_credit_transaction_id_fkey"
            columns: ["credit_transaction_id"]
            isOneToOne: false
            referencedRelation: "credit_transactions"
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
      stripe_settle_payment: {
        Args: {
          p_token: string | null
          p_event_id: string
          p_event_type: string
          p_workspace_id: string
          p_provider_payment_id: string
          p_amount_cents: number
          p_currency: string
          p_kind: string
          p_credits: number
          p_credit_type: Database["public"]["Enums"]["credit_tx_type"]
          p_description: string
          p_package_id: string | null
          p_plan_id: string | null
          p_stripe_customer_id: string | null
          p_metadata: Json
        }
        Returns: Json
      }
      stripe_sync_subscription: {
        Args: {
          p_token: string | null
          p_event_id: string
          p_event_type: string
          p_workspace_id: string
          p_provider_subscription_id: string
          p_plan_id: string
          p_status: string
          p_current_period_start: string | null
          p_current_period_end: string | null
          p_cancel_at_period_end: boolean
          p_stripe_price_id: string | null
          p_stripe_customer_id: string | null
          p_metadata: Json
        }
        Returns: Json
      }
      stripe_record_refund: {
        Args: {
          p_token: string | null
          p_event_id: string
          p_event_type: string
          p_provider_payment_id: string
          p_amount_cents: number
          p_status: string
          p_metadata: Json
        }
        Returns: Json
      }
      stripe_link_customer: {
        Args: {
          p_token: string | null
          p_workspace_id: string
          p_stripe_customer_id: string
          p_livemode: boolean
        }
        Returns: string
      }
      stripe_workspace_for: {
        Args: { p_token: string | null; p_stripe_customer_id: string }
        Returns: string
      }
      stripe_record_event: {
        Args: {
          p_token: string | null
          p_event_id: string
          p_event_type: string
          p_object_id: string
          p_workspace_id: string | null
          p_outcome: string
          p_detail: Json
        }
        Returns: Json
      }
      stripe_apply_price: {
        Args: {
          p_token: string | null
          p_entity: string
          p_entity_id: string
          p_period: string | null
          p_price_cents: number
          p_currency: string | null
          p_stripe_product_id: string | null
          p_stripe_price_id: string | null
        }
        Returns: Json
      }
      stripe_mark_price_sync: {
        Args: {
          p_token: string | null
          p_entity: string
          p_entity_id: string
          p_status: string
          p_error: string | null
        }
        Returns: Json
      }
      stripe_payment_status: {
        Args: {
          p_token: string | null
          p_workspace_id: string
          p_reference: string
        }
        Returns: Json
      }
      stripe_catalogue: {
        Args: {
          p_token: string | null
          p_package_id: string | null
          p_plan_id: string | null
          p_price_id: string | null
        }
        Returns: Json
      }
      stripe_customer_for: {
        Args: { p_token: string | null; p_workspace_id: string }
        Returns: string
      }
      cms_redirects_active: {
        Args: Record<PropertyKey, never>
        Returns: {
          source: string
          status_code: number
          target: string
        }[]
      }
      cms_redirect_would_loop: {
        Args: { p_ignore_id?: string; p_source: string; p_target: string }
        Returns: boolean
      }
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
      captcha_site_key: { Args: never; Returns: string }
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
      claim_welcome_bonus: { Args: { p_answers: Json }; Returns: Json }
      /* Hands back a free-tool grant when the run it paid for never started
         (migration 0103). Server-token gated — a client cannot reset its own
         allowance. */
      release_free_tool_run: {
        Args: { p_token: string | null; p_workspace_id: string; p_tool_slug: string; p_window_start: string }
        Returns: boolean
      }
      claim_free_tool_run: {
        Args: {
          p_workspace_id: string
          p_tool_slug: string
          p_limit: number
          p_window_start: string
        }
        Returns: number
      }
      free_tool_remaining: {
        Args: {
          p_workspace_id: string
          p_tool_slug: string
          p_limit: number
          p_window_start: string
        }
        Returns: number
      }
      integration_dispatch_read: {
        Args: { p_token: string; p_type: string }
        Returns: Json
      }
      auth_email_claim: {
        Args: {
          p_action: string
          p_locale: string
          p_recipient: string
          p_template_key: string
          p_template_source: string
          p_template_version: number | null
          p_token: string
          p_webhook_id: string
        }
        Returns: string | null
      }
      auth_email_finish: {
        Args: {
          p_failure: string | null
          p_id: string
          p_status: string
          p_token: string
          p_transport: string
        }
        Returns: boolean
      }
      close_out_denied_signup: { Args: Record<PropertyKey, never>; Returns: boolean }
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
      delete_generation: { Args: { gen_id: string }; Returns: string[] }
      email_transport: { Args: never; Returns: Json }
      enqueue_notification: {
        Args: {
          p_dedupe?: string
          p_event: string
          p_payload?: Json
          p_token?: string
        }
        Returns: undefined
      }
      ensure_welcome_bonus_offer: {
        Args: {
          p_amount: number
          p_campaign_version?: number
          p_eligible_at?: string
          p_hours: number
          p_user_id: string
        }
        Returns: {
          campaign_version: number
          claimed_at: string | null
          created_at: string
          credit_transaction_id: string | null
          eligible_at: string
          expires_at: string
          id: string
          reward_amount: number
          status: Database["public"]["Enums"]["welcome_bonus_status"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "welcome_bonus_offers"
          isOneToOne: true
          isSetofReturn: false
        }
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
      admin_hard_delete_user: { Args: { p_user_id: string; p_confirm_email: string }; Returns: Json }
      admin_user_facts: {
        Args: { p_ids: string[] }
        Returns: { id: string; email_confirmed_at: string | null; last_sign_in_at: string | null }[]
      }
      account_blocked: {
        Args: { p_user: string }
        Returns: boolean
      }
      admin_block_user: {
        Args: {
          p_user: string
          p_until?: string | null
          p_reason?: string | null
          p_note?: string | null
        }
        Returns: string | null
      }
      admin_unblock_user: {
        Args: { p_user: string }
        Returns: undefined
      }
      admin_expire_account_blocks: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      admin_customer_rows: {
        Args: {
          p_search?: string | null
          p_role?: string | null
          p_status?: string | null
          p_verified?: string | null
          p_plan?: string | null
          p_since?: string | null
          p_sort?: string | null
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          id: string
          email: string
          full_name: string | null
          role: string
          blocked: boolean
          blocked_until: string | null
          created_at: string
          verified: boolean
          last_sign_in_at: string | null
          workspace_id: string | null
          workspace_name: string | null
          plan: string
          credits: number
          spent_cents: number
          generations: number
          last_active: string | null
          total_count: number
        }[]
      }
      admin_customer_plans: { Args: never; Returns: { plan: string }[] }
      ai_save_tool_prompt: {
        Args: {
          p_tool_key: string
          p_body_encrypted: string
          p_iv: string
          p_tag: string
          p_summary?: string | null
          p_reason?: string | null
          p_source?: string
          p_publish?: boolean
        }
        Returns: Json
      }
      ai_publish_tool_prompt: { Args: { p_id: string; p_reason?: string | null }; Returns: Json }
      ai_restore_tool_prompt: { Args: { p_id: string; p_reason?: string | null }; Returns: Json }
      ai_tool_runtime: {
        Args: { p_tool_key: string; p_token: string | null }
        Returns: {
          tool_key: string
          engine_mode: string
          service_slug: string | null
          allow_model_choice: boolean
          fallback_enabled: boolean
          timeout_ms: number
          max_attempts: number
          primary_model_id: string | null
          fallback_model_id: string | null
          prompt_encrypted: string | null
          prompt_iv: string | null
          prompt_tag: string | null
          prompt_version: number | null
        }[]
      }
      credit_wallets_total: { Args: never; Returns: number }
      generation_credits_total: { Args: never; Returns: number }
      welcome_bonus_stats: {
        Args: never
        Returns: {
          issued: number
          claimed: number
          expired: number
          pending: number
          avg_hours_to_claim: number | null
        }[]
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
      /* Server-gated replacements (migration 0077). The p_token-less originals
         above are still declared because they still exist in the database, but
         EXECUTE on them is revoked from anon and authenticated — only these
         are reachable, and only by a caller holding the dispatch token. */
      provider_credential_read: {
        Args: { p_token: string | null; p_provider_id: string }
        Returns: {
          auth_tag: string
          base_url: string
          encrypted_value: string
          iv: string
        }[]
      }
      engine_rules_read: {
        Args: { p_token: string | null }
        Returns: {
          content_encrypted: string
          content_iv: string
          content_tag: string
          id: string
        }[]
      }
      knowledge_match: {
        Args: { p_token: string | null; p_embedding: string; p_top_k?: number }
        Returns: {
          hint_encrypted: string
          hint_iv: string
          hint_tag: string
          id: string
        }[]
      }
      provider_health_set: {
        Args: {
          p_token: string | null
          p_slug: string
          p_state: string
          p_cooldown_seconds?: number
          p_note?: string | null
        }
        Returns: undefined
      }
      usage_event_charge: {
        Args: {
          p_token: string | null
          p_wallet_id: string
          p_amount: number
          p_description: string
          p_reference_id: string
          p_metadata?: Json
        }
        Returns: string
      }
      usage_event_complete: {
        Args: {
          p_token: string | null
          p_event_id: string
          p_result_count: number
          p_api_cost_usd_micros?: number
          p_request_id?: string | null
        }
        Returns: undefined
      }
      usage_event_fail: {
        Args: {
          p_token: string | null
          p_event_id: string
          p_error: string
          p_api_cost_usd_micros?: number
        }
        Returns: string
      }
      usage_event_refund_partial: {
        Args: { p_token: string | null; p_event_id: string; p_amount: number }
        Returns: string
      }
      /* Closing runs that were charged and then stranded (migration 0102). The
         reconciler is owner-only; this is the server-token gated entry point,
         and it returns counts only — no event id, no workspace. */
      usage_events_reconcile: {
        Args: { p_token: string | null; p_limit?: number }
        Returns: Json
      }
      /* Opening a billable run (migration 0100). The event row and the credit
         debit happen in one transaction or not at all, and usage_events has no
         customer-writable path any more, so this is the ONLY way a billing
         record comes into existence. Business outcomes come back in `status`;
         only authorization failures raise. */
      usage_event_start: {
        Args: {
          p_token: string | null
          p_user_id: string
          p_workspace_id: string
          // No SQL default: the function declares it before the parameters
          // that have one, so every caller must pass it (null for a free run).
          p_wallet_id: string | null
          p_service_slug: string
          p_credits?: number | null
          p_provider_slug?: string | null
          p_model_slug?: string | null
          p_generation_job_id?: string | null
          p_idempotency_key?: string | null
          p_metadata?: Json
        }
        Returns: { event_id: string | null; status: string }[]
      }
      /* The one secret store (migration 0078). Backed by Supabase Vault, so no
         encryption key of ours is involved; writing needs only an admin
         session, which is what makes a lost env var unable to lock an operator
         out of their own panel. secret_read is the only one that yields
         plaintext and it never reaches a browser. */
      secret_put: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      secret_clear: { Args: { p_name: string }; Returns: boolean }
      secret_status: {
        Args: { p_names: string[] }
        Returns: {
          name: string
          configured: boolean
          last_four: string | null
          updated_at: string | null
        }[]
      }
      /* Clears the flag on account blocks that have already expired (migration
         0108). The admin-session sibling admin_expire_account_blocks() stays
         for a human caller; this one is for the daily schedule, which carries
         a bearer secret and no session and so cannot pass an admin guard. */
      server_expire_account_blocks: {
        Args: { p_token: string | null }
        Returns: number
      }
      secret_read: {
        Args: { p_name: string; p_token?: string | null }
        Returns: string | null
      }
      secret_read_many: {
        Args: { p_names: string[]; p_token?: string | null }
        Returns: { name: string; value: string | null }[]
      }
      /* Tool popularity (migration 0082). The counting half is SECURITY DEFINER
         because usage_events is fenced to one workspace by RLS and the ranking
         is product-wide; the storing half is, because the weekly job has no
         admin session. Both are gated by server_call_ok — the same
         proof-of-server token as the rest of this file's definer functions. */
      tool_usage_counts: {
        Args: { p_token: string | null; p_since: string }
        Returns: {
          service_slug: string
          tool: string | null
          operation: string | null
          prompt_origin: string | null
          uses: number
        }[]
      }
      tool_popularity_store: {
        Args: { p_token: string | null; p_value: Json }
        Returns: undefined
      }
      get_engine_rules: {
        Args: never
        Returns: {
          content_encrypted: string
          content_iv: string
          content_tag: string
          id: string
        }[]
      }
      get_welcome_credits: { Args: never; Returns: number }
      grovnews_ai_providers: {
        Args: { p_token: string }
        Returns: { id: string; slug: string }[]
      }
      grovnews_build_edition: {
        Args: { p_date: string; p_published_only: boolean; p_token: string }
        Returns: Json
      }
      grovnews_create_post: {
        Args: { p_item_id: string; p_post: Json; p_publish: boolean; p_token: string }
        Returns: Json
      }
      grovnews_current_edition: { Args: never; Returns: Json }
      grovnews_edition_send: {
        Args: {
          p_body: string
          p_edition_id: string
          p_links: string[]
          p_preview: string
          p_subject: string
          p_token: string
          p_utm: Json
        }
        Returns: Json
      }
      grovnews_edition_arrange: {
        Args: { p_edition_id: string; p_featured: string | null; p_post_ids: string[] }
        Returns: undefined
      }
      grovnews_edition_mail_source: {
        Args: { p_edition_id: string; p_token: string }
        Returns: Json
      }
      grovnews_editions_sync: { Args: { p_token: string }; Returns: number }
      grovnews_group_sync: { Args: { p_token: string }; Returns: Json }
      grovnews_has_access: { Args: never; Returns: boolean }
      grovnews_ingest: {
        Args: {
          p_error: string
          p_items: Json
          p_ok: boolean
          p_source_id: string
          p_token: string
        }
        Returns: Json
      }
      grovnews_job_context: { Args: { p_token: string }; Returns: Json }
      grovnews_run_claim: { Args: { p_token: string; p_trigger: string }; Returns: Json }
      grovnews_run_update: {
        Args: {
          p_error: string | null
          p_release: boolean
          p_run_id: string
          p_stage: string | null
          p_stats: Json
          p_status: string | null
          p_token: string
        }
        Returns: undefined
      }
      grovnews_save_analysis: {
        Args: { p_item_id: string; p_result: Json; p_token: string }
        Returns: string
      }
      grovnews_scheduler_status: { Args: never; Returns: Json }
      grovnews_select_top: { Args: { p_token: string }; Returns: number }
      grovnews_work_items: {
        Args: { p_kind: string; p_limit: number; p_token: string }
        Returns: Json
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
      login_challenge_open: {
        Args: {
          p_code_hash: string
          p_device_hash: string
          p_device_label: string
          p_ip_hash: string
          p_max_attempts: number
          p_reason: string
          p_token: string
          p_ttl_seconds: number
          p_user: string
        }
        Returns: string
      }
      login_challenge_abandon: {
        Args: { p_device_hash: string; p_id: string; p_token: string; p_user: string }
        Returns: boolean
      }
      login_challenge_peek: {
        Args: { p_device_hash: string; p_token: string; p_user: string }
        Returns: Json
      }
      login_challenge_start: {
        Args: {
          p_code_hash: string
          p_device_hash: string
          p_device_label: string
          p_ip_hash: string
          p_max_attempts: number
          p_reason: string
          p_token: string
          p_ttl_seconds: number
          p_user: string
        }
        Returns: Json
      }
      login_challenge_verify: {
        Args: {
          p_code_hash: string
          p_device_hash: string
          p_device_label: string
          p_ip_hash: string
          p_token: string
          p_user: string
        }
        Returns: Json
      }
      login_security_check: {
        Args: {
          p_device_hash: string
          p_ip_hash: string
          p_reverify_days: number
          p_verify_device: boolean
          p_verify_ip: boolean
        }
        Returns: Json
      }
      login_security_token_ok: { Args: { p_token: string }; Returns: boolean }
      mail_sync_commit: {
        Args: {
          p_error?: string
          p_folder: string
          p_last_uid?: number
          p_token: string
          p_uid_validity?: number
        }
        Returns: undefined
      }
      mail_sync_context: { Args: { p_token: string }; Returns: Json }
      match_knowledge_examples: {
        Args: { p_embedding: string; p_top_k?: number }
        Returns: {
          hint_encrypted: string
          hint_iv: string
          hint_tag: string
          id: string
        }[]
      }
      message_template_lookup: {
        Args: { p_channel: string; p_event: string; p_token: string }
        Returns: Json
      }
      notification_dispatch_claim: {
        Args: { p_limit?: number; p_token: string }
        Returns: {
          admin_email_to: string
          attempts: number
          bot_token_ciphertext: Json
          channel: string
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          mail_config: Json
          payload: Json
          smtp_password_ciphertext: Json
          telegram_config: Json
          telegram_enabled: boolean
        }[]
      }
      notification_dispatch_finish: {
        Args: {
          p_error?: string
          p_id: string
          p_status: string
          p_token: string
        }
        Returns: undefined
      }
      platform_signup_open: { Args: never; Returns: boolean }
      providers_with_credentials: { Args: never; Returns: string[] }
      refund_usage_event: { Args: { p_event_id: string }; Returns: string }
      refund_usage_partial: {
        Args: { p_amount: number; p_event_id: string }
        Returns: string
      }
      set_asset_derivatives: {
        Args: { asset_id: string; thumb_path: string; preview_path?: string | null }
        Returns: string
      }
      set_generation_favorite: {
        Args: { gen_id: string; value: boolean }
        Returns: boolean
      }
      set_generation_note: {
        Args: { gen_id: string; note: string }
        Returns: undefined
      }
      set_provider_health: {
        Args: {
          p_cooldown_seconds?: number
          p_note?: string
          p_slug: string
          p_state: string
        }
        Returns: undefined
      }
      signup_ip_allowed: {
        Args: { p_ip_hash: string; p_token: string }
        Returns: boolean
      }
      signup_ip_record: {
        Args: {
          p_email?: string
          p_ip_hash: string
          p_token: string
          p_user_id?: string
        }
        Returns: undefined
      }
      trusted_device_revoke: { Args: { p_device_id: string }; Returns: boolean }
      /* The confirmation mailbox and its sealed password (migration 0106).
         Split out of waitlist_subscribe, which anon can call. */
      waitlist_confirmation_payload: {
        Args: { p_token: string | null }
        Returns: Json
      }
      waitlist_subscribe: {
        Args: {
          p_email: string
          p_locale?: string
          p_metadata?: Json
          p_source?: string
        }
        Returns: Json
      }
      media_usage: {
        Args: { p_media_id: string }
        Returns: {
          usage_key: string
          usage_kind: string
          usage_label: string
        }[]
      }
      media_slots_resolve: {
        Args: { p_keys: string[] }
        Returns: {
          alt_text: string
          autoplay: boolean
          controls: boolean
          desktop_height: number
          desktop_path: string
          desktop_url: string
          desktop_variants: Json
          desktop_width: number
          loop: boolean
          media_type: string
          mobile_path: string
          mobile_url: string
          muted: boolean
          object_fit: string
          object_position: string
          poster_path: string
          poster_url: string
          slot_key: string
          tablet_path: string
          tablet_url: string
        }[]
      }
      submit_contact_message: {
        Args: {
          p_email: string
          p_locale?: string
          p_message: string
          p_metadata?: Json
          p_name: string
          p_source?: string
          p_topic: string
        }
        Returns: Json
      }
      cms_media_meta: {
        Args: { p_paths: string[] }
        Returns: {
          storage_path: string
          external_url: string
          width: number
          height: number
          variants: Json
          alt: string
        }[]
      }
      cms_set_homepage: { Args: { p_page_id: string }; Returns: string }
      cms_slug_is_reserved: { Args: { p_slug: string }; Returns: boolean }
      newsletter_subscribe: {
        Args: {
          p_email: string
          p_first_name?: string
          p_locale?: string
          p_source_key?: string
          p_group_keys?: string[]
          p_consent?: boolean
          p_consent_version?: string
          p_consent_source?: string
        }
        Returns: Json
      }
      newsletter_unsubscribe: {
        Args: { p_token: string; p_reason?: string }
        Returns: Json
      }
      newsletter_resubscribe: {
        Args: { p_token: string; p_consent_version?: string }
        Returns: Json
      }
      newsletter_track: {
        Args: { p_recipient: string; p_event: string; p_link?: string }
        Returns: Json
      }
      newsletter_queue_claim: {
        Args: { p_token: string; p_limit?: number }
        Returns: {
          id: string
          campaign_id: string
          step_index: number
          variant: string
          contact_id: string
          email: string
          attempts: number
          personalization: Json
          first_name: string
          locale: string
          unsubscribe_token: string
        }[]
      }
      newsletter_queue_finish: {
        Args: {
          p_token: string
          p_id: string
          p_status: string
          p_error?: string
          p_message_id?: string
          p_smtp_response?: string
        }
        Returns: undefined
      }
      newsletter_start_due: { Args: { p_token: string }; Returns: number }
      // Admin-only (0095). Json rather than a shape: the function reports that
      // the two vault secrets EXIST and never returns them, and a narrower
      // type here would invite a caller to expect fields it must not have.
      newsletter_scheduler_status: { Args: Record<string, never>; Returns: Json }
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
      welcome_bonus_status: "ELIGIBLE" | "CLAIMED" | "EXPIRED"
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
      welcome_bonus_status: ["ELIGIBLE", "CLAIMED", "EXPIRED"],
      workspace_role: ["owner", "admin", "editor", "viewer", "operator"],
    },
  },
} as const
