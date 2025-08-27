export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  wallet: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          currency: string
          details: Json
          id: string
          name: string
          type: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          currency: string
          details: Json
          id?: string
          name: string
          type: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          name?: string
          type?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cashu_receive_quotes: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          currency: string
          description: string | null
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          output_amounts: number[] | null
          payment_request: string
          quote_id: string
          state: string
          transaction_id: string
          type: string
          unit: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          currency: string
          description?: string | null
          expires_at: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number | null
          keyset_id?: string | null
          locking_derivation_path: string
          output_amounts?: number[] | null
          payment_request: string
          quote_id: string
          state: string
          transaction_id: string
          type: string
          unit: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          expires_at?: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number | null
          keyset_id?: string | null
          locking_derivation_path?: string
          output_amounts?: number[] | null
          payment_request?: string
          quote_id?: string
          state?: string
          transaction_id?: string
          type?: string
          unit?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashu_receive_quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_receive_quotes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_receive_quotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cashu_send_quotes: {
        Row: {
          account_id: string
          amount_requested: number
          amount_requested_in_msat: number
          amount_spent: number | null
          amount_to_receive: number
          cashu_fee: number
          created_at: string
          currency: string
          currency_requested: string
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number
          keyset_id: string
          lightning_fee_reserve: number
          number_of_change_outputs: number
          payment_preimage: string | null
          payment_request: string
          proofs: string
          quote_id: string
          state: string
          transaction_id: string
          unit: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          amount_requested: number
          amount_requested_in_msat: number
          amount_spent?: number | null
          amount_to_receive: number
          cashu_fee: number
          created_at?: string
          currency: string
          currency_requested: string
          expires_at: string
          failure_reason?: string | null
          id?: string
          keyset_counter: number
          keyset_id: string
          lightning_fee_reserve: number
          number_of_change_outputs: number
          payment_preimage?: string | null
          payment_request: string
          proofs: string
          quote_id: string
          state?: string
          transaction_id: string
          unit: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          amount_requested?: number
          amount_requested_in_msat?: number
          amount_spent?: number | null
          amount_to_receive?: number
          cashu_fee?: number
          created_at?: string
          currency?: string
          currency_requested?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number
          keyset_id?: string
          lightning_fee_reserve?: number
          number_of_change_outputs?: number
          payment_preimage?: string | null
          payment_request?: string
          proofs?: string
          quote_id?: string
          state?: string
          transaction_id?: string
          unit?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashu_send_quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_send_quotes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_send_quotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cashu_send_swaps: {
        Row: {
          account_id: string
          amount_requested: number
          amount_to_send: number
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          input_amount: number
          input_proofs: string
          keep_output_amounts: number[] | null
          keyset_counter: number | null
          keyset_id: string | null
          proofs_to_send: string | null
          receive_swap_fee: number
          send_output_amounts: number[] | null
          send_swap_fee: number
          state: string
          token_hash: string | null
          total_amount: number
          transaction_id: string
          unit: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          amount_requested: number
          amount_to_send: number
          created_at?: string
          currency: string
          failure_reason?: string | null
          id?: string
          input_amount: number
          input_proofs: string
          keep_output_amounts?: number[] | null
          keyset_counter?: number | null
          keyset_id?: string | null
          proofs_to_send?: string | null
          receive_swap_fee: number
          send_output_amounts?: number[] | null
          send_swap_fee: number
          state: string
          token_hash?: string | null
          total_amount: number
          transaction_id: string
          unit: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          amount_requested?: number
          amount_to_send?: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          input_amount?: number
          input_proofs?: string
          keep_output_amounts?: number[] | null
          keyset_counter?: number | null
          keyset_id?: string | null
          proofs_to_send?: string | null
          receive_swap_fee?: number
          send_output_amounts?: number[] | null
          send_swap_fee?: number
          state?: string
          token_hash?: string | null
          total_amount?: number
          transaction_id?: string
          unit?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashu_send_swaps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_send_swaps_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_send_swaps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cashu_token_swaps: {
        Row: {
          account_id: string
          created_at: string
          currency: string
          failure_reason: string | null
          fee_amount: number
          input_amount: number
          keyset_counter: number
          keyset_id: string
          output_amounts: number[]
          receive_amount: number
          state: string
          token_hash: string
          token_proofs: string
          transaction_id: string
          unit: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          created_at?: string
          currency: string
          failure_reason?: string | null
          fee_amount: number
          input_amount: number
          keyset_counter: number
          keyset_id: string
          output_amounts: number[]
          receive_amount: number
          state?: string
          token_hash: string
          token_proofs: string
          transaction_id: string
          unit: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          currency?: string
          failure_reason?: string | null
          fee_amount?: number
          input_amount?: number
          keyset_counter?: number
          keyset_id?: string
          output_amounts?: number[]
          receive_amount?: number
          state?: string
          token_hash?: string
          token_proofs?: string
          transaction_id?: string
          unit?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cashu_token_swaps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_token_swaps_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_token_swaps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_username_fkey"
            columns: ["username"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["username"]
          },
        ]
      }
      task_processing_locks: {
        Row: {
          expires_at: string
          lead_client_id: string
          user_id: string
        }
        Insert: {
          expires_at: string
          lead_client_id: string
          user_id: string
        }
        Update: {
          expires_at?: string
          lead_client_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_processing_locks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          completed_at: string | null
          created_at: string
          currency: string
          direction: string
          encrypted_transaction_details: string
          failed_at: string | null
          id: string
          pending_at: string | null
          reversed_at: string | null
          reversed_transaction_id: string | null
          seen: boolean
          state: string
          state_sort_order: number | null
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          created_at?: string
          currency: string
          direction: string
          encrypted_transaction_details: string
          failed_at?: string | null
          id?: string
          pending_at?: string | null
          reversed_at?: string | null
          reversed_transaction_id?: string | null
          seen?: boolean
          state: string
          state_sort_order?: number | null
          type: string
          user_id: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          created_at?: string
          currency?: string
          direction?: string
          encrypted_transaction_details?: string
          failed_at?: string | null
          id?: string
          pending_at?: string | null
          reversed_at?: string | null
          reversed_transaction_id?: string | null
          seen?: boolean
          state?: string
          state_sort_order?: number | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_reversed_transaction_id_fkey"
            columns: ["reversed_transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          cashu_locking_xpub: string
          created_at: string
          default_btc_account_id: string | null
          default_currency: string
          default_usd_account_id: string | null
          email: string | null
          email_verified: boolean
          encryption_public_key: string
          id: string
          updated_at: string
          username: string
        }
        Insert: {
          cashu_locking_xpub: string
          created_at?: string
          default_btc_account_id?: string | null
          default_currency?: string
          default_usd_account_id?: string | null
          email?: string | null
          email_verified: boolean
          encryption_public_key: string
          id?: string
          updated_at?: string
          username: string
        }
        Update: {
          cashu_locking_xpub?: string
          created_at?: string
          default_btc_account_id?: string | null
          default_currency?: string
          default_usd_account_id?: string | null
          email?: string | null
          email_verified?: boolean
          encryption_public_key?: string
          id?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_default_btc_account_id_fkey"
            columns: ["default_btc_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_default_usd_account_id_fkey"
            columns: ["default_usd_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_not_self_contact: {
        Args: { contact_username: string; owner_id: string }
        Returns: boolean
      }
      commit_proofs_to_send: {
        Args: {
          p_account_proofs: Json
          p_account_version: number
          p_proofs_to_send: string
          p_swap_id: string
          p_swap_version: number
          p_token_hash: string
        }
        Returns: undefined
      }
      complete_cashu_receive_quote: {
        Args: {
          p_account_version: number
          p_proofs: Json
          p_quote_id: string
          p_quote_version: number
        }
        Returns: {
          account_id: string
          amount: number
          created_at: string
          currency: string
          description: string | null
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          output_amounts: number[] | null
          payment_request: string
          quote_id: string
          state: string
          transaction_id: string
          type: string
          unit: string
          user_id: string
          version: number
        }
      }
      complete_cashu_send_quote: {
        Args: {
          p_account_proofs: string
          p_account_version: number
          p_amount_spent: number
          p_encrypted_transaction_details: string
          p_payment_preimage: string
          p_quote_id: string
          p_quote_version: number
        }
        Returns: Database["wallet"]["CompositeTypes"]["update_cashu_send_quote_result"]
      }
      complete_cashu_send_swap: {
        Args: { p_swap_id: string; p_swap_version: number }
        Returns: undefined
      }
      complete_cashu_token_swap: {
        Args: {
          p_account_version: number
          p_proofs: Json
          p_swap_version: number
          p_token_hash: string
          p_user_id: string
        }
        Returns: undefined
      }
      create_cashu_receive_quote: {
        Args: {
          p_account_id: string
          p_amount: number
          p_currency: string
          p_description?: string
          p_encrypted_transaction_details: string
          p_expires_at: string
          p_locking_derivation_path: string
          p_payment_request: string
          p_quote_id: string
          p_receive_type: string
          p_state: string
          p_unit: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          amount: number
          created_at: string
          currency: string
          description: string | null
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          output_amounts: number[] | null
          payment_request: string
          quote_id: string
          state: string
          transaction_id: string
          type: string
          unit: string
          user_id: string
          version: number
        }
      }
      create_cashu_send_quote: {
        Args: {
          p_account_id: string
          p_account_version: number
          p_amount_requested: number
          p_amount_requested_in_msat: number
          p_amount_to_receive: number
          p_cashu_fee: number
          p_currency: string
          p_currency_requested: string
          p_encrypted_transaction_details: string
          p_expires_at: string
          p_keyset_counter: number
          p_keyset_id: string
          p_lightning_fee_reserve: number
          p_number_of_change_outputs: number
          p_payment_request: string
          p_proofs_to_keep: string
          p_proofs_to_send: string
          p_quote_id: string
          p_unit: string
          p_user_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["create_cashu_send_quote_result"]
      }
      create_cashu_send_swap: {
        Args: {
          p_account_id: string
          p_account_proofs: string
          p_account_version: number
          p_amount_requested: number
          p_amount_to_send: number
          p_currency: string
          p_encrypted_transaction_details: string
          p_input_amount: number
          p_input_proofs: string
          p_keep_output_amounts?: number[]
          p_keyset_counter?: number
          p_keyset_id?: string
          p_proofs_to_send?: string
          p_receive_swap_fee: number
          p_send_output_amounts?: number[]
          p_send_swap_fee: number
          p_state: string
          p_token_hash?: string
          p_total_amount: number
          p_unit: string
          p_updated_keyset_counter?: number
          p_user_id: string
        }
        Returns: {
          account_id: string
          amount_requested: number
          amount_to_send: number
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          input_amount: number
          input_proofs: string
          keep_output_amounts: number[] | null
          keyset_counter: number | null
          keyset_id: string | null
          proofs_to_send: string | null
          receive_swap_fee: number
          send_output_amounts: number[] | null
          send_swap_fee: number
          state: string
          token_hash: string | null
          total_amount: number
          transaction_id: string
          unit: string
          user_id: string
          version: number
        }
      }
      create_cashu_token_swap: {
        Args: {
          p_account_id: string
          p_account_version: number
          p_currency: string
          p_encrypted_transaction_details: string
          p_fee_amount: number
          p_input_amount: number
          p_keyset_counter: number
          p_keyset_id: string
          p_output_amounts: number[]
          p_receive_amount: number
          p_reversed_transaction_id?: string
          p_token_hash: string
          p_token_proofs: string
          p_unit: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          created_at: string
          currency: string
          failure_reason: string | null
          fee_amount: number
          input_amount: number
          keyset_counter: number
          keyset_id: string
          output_amounts: number[]
          receive_amount: number
          state: string
          token_hash: string
          token_proofs: string
          transaction_id: string
          unit: string
          user_id: string
          version: number
        }
      }
      expire_cashu_receive_quote: {
        Args: { p_quote_id: string; p_quote_version: number }
        Returns: {
          account_id: string
          amount: number
          created_at: string
          currency: string
          description: string | null
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          output_amounts: number[] | null
          payment_request: string
          quote_id: string
          state: string
          transaction_id: string
          type: string
          unit: string
          user_id: string
          version: number
        }
      }
      expire_cashu_send_quote: {
        Args: {
          p_account_proofs: string
          p_account_version: number
          p_quote_id: string
          p_quote_version: number
        }
        Returns: Database["wallet"]["CompositeTypes"]["update_cashu_send_quote_result"]
      }
      fail_cashu_receive_quote: {
        Args: {
          p_failure_reason: string
          p_quote_id: string
          p_quote_version: number
        }
        Returns: undefined
      }
      fail_cashu_send_quote: {
        Args: {
          p_account_proofs: string
          p_account_version: number
          p_failure_reason: string
          p_quote_id: string
          p_quote_version: number
        }
        Returns: Database["wallet"]["CompositeTypes"]["update_cashu_send_quote_result"]
      }
      fail_cashu_send_swap: {
        Args: { p_reason: string; p_swap_id: string; p_swap_version: number }
        Returns: undefined
      }
      fail_cashu_token_swap: {
        Args: {
          p_failure_reason: string
          p_swap_version: number
          p_token_hash: string
          p_user_id: string
        }
        Returns: undefined
      }
      find_contact_candidates: {
        Args: { current_user_id: string; partial_username: string }
        Returns: {
          id: string
          username: string
        }[]
      }
      list_transactions: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_cursor_state_sort_order?: number
          p_page_size?: number
          p_user_id: string
        }
        Returns: {
          account_id: string
          completed_at: string | null
          created_at: string
          currency: string
          direction: string
          encrypted_transaction_details: string
          failed_at: string | null
          id: string
          pending_at: string | null
          reversed_at: string | null
          reversed_transaction_id: string | null
          seen: boolean
          state: string
          state_sort_order: number | null
          type: string
          user_id: string
        }[]
      }
      process_cashu_receive_quote_payment: {
        Args: {
          p_account_version: number
          p_keyset_counter: number
          p_keyset_id: string
          p_output_amounts: number[]
          p_quote_id: string
          p_quote_version: number
        }
        Returns: Database["wallet"]["CompositeTypes"]["cashu_receive_quote_payment_result"]
      }
      take_lead: {
        Args: { p_client_id: string; p_user_id: string }
        Returns: boolean
      }
      upsert_user_with_accounts: {
        Args: {
          p_accounts: Json[]
          p_cashu_locking_xpub: string
          p_email: string
          p_email_verified: boolean
          p_encryption_public_key: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      cashu_receive_quote_payment_result: {
        updated_quote:
          | Database["wallet"]["Tables"]["cashu_receive_quotes"]["Row"]
          | null
        updated_account: Database["wallet"]["Tables"]["accounts"]["Row"] | null
      }
      create_cashu_send_quote_result: {
        created_quote:
          | Database["wallet"]["Tables"]["cashu_send_quotes"]["Row"]
          | null
        updated_account: Database["wallet"]["Tables"]["accounts"]["Row"] | null
      }
      update_cashu_send_quote_result: {
        updated_quote:
          | Database["wallet"]["Tables"]["cashu_send_quotes"]["Row"]
          | null
        updated_account: Database["wallet"]["Tables"]["accounts"]["Row"] | null
      }
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
  wallet: {
    Enums: {},
  },
} as const

