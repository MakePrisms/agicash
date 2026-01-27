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
          purpose: string
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
          purpose?: string
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
          purpose?: string
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
      cashu_proofs: {
        Row: {
          account_id: string
          amount: string
          cashu_receive_quote_id: string | null
          cashu_send_quote_id: string | null
          cashu_send_swap_id: string | null
          cashu_token_swap_token_hash: string | null
          created_at: string
          dleq: Json | null
          id: string
          keyset_id: string
          public_key_y: string
          reserved_at: string | null
          secret: string
          spending_cashu_send_quote_id: string | null
          spending_cashu_send_swap_id: string | null
          spent_at: string | null
          state: string
          unblinded_signature: string
          user_id: string
          version: number
          witness: Json | null
        }
        Insert: {
          account_id: string
          amount: string
          cashu_receive_quote_id?: string | null
          cashu_send_quote_id?: string | null
          cashu_send_swap_id?: string | null
          cashu_token_swap_token_hash?: string | null
          created_at?: string
          dleq?: Json | null
          id?: string
          keyset_id: string
          public_key_y: string
          reserved_at?: string | null
          secret: string
          spending_cashu_send_quote_id?: string | null
          spending_cashu_send_swap_id?: string | null
          spent_at?: string | null
          state?: string
          unblinded_signature: string
          user_id: string
          version?: number
          witness?: Json | null
        }
        Update: {
          account_id?: string
          amount?: string
          cashu_receive_quote_id?: string | null
          cashu_send_quote_id?: string | null
          cashu_send_swap_id?: string | null
          cashu_token_swap_token_hash?: string | null
          created_at?: string
          dleq?: Json | null
          id?: string
          keyset_id?: string
          public_key_y?: string
          reserved_at?: string | null
          secret?: string
          spending_cashu_send_quote_id?: string | null
          spending_cashu_send_swap_id?: string | null
          spent_at?: string | null
          state?: string
          unblinded_signature?: string
          user_id?: string
          version?: number
          witness?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "cashu_proofs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_proofs_cashu_receive_quote_id_fkey"
            columns: ["cashu_receive_quote_id"]
            isOneToOne: false
            referencedRelation: "cashu_receive_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_proofs_cashu_send_quote_id_fkey"
            columns: ["cashu_send_quote_id"]
            isOneToOne: false
            referencedRelation: "cashu_send_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_proofs_cashu_send_swap_id_fkey"
            columns: ["cashu_send_swap_id"]
            isOneToOne: false
            referencedRelation: "cashu_send_swaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_proofs_spending_cashu_send_quote_id_fkey"
            columns: ["spending_cashu_send_quote_id"]
            isOneToOne: false
            referencedRelation: "cashu_send_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_proofs_spending_cashu_send_swap_id_fkey"
            columns: ["spending_cashu_send_swap_id"]
            isOneToOne: false
            referencedRelation: "cashu_send_swaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cashu_proofs_token_swap_fkey"
            columns: ["cashu_token_swap_token_hash", "user_id"]
            isOneToOne: false
            referencedRelation: "cashu_token_swaps"
            referencedColumns: ["token_hash", "user_id"]
          },
          {
            foreignKeyName: "cashu_proofs_user_id_fkey"
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
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          payment_hash: string
          quote_id_hash: string
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          cashu_token_melt_initiated?: boolean | null
          created_at?: string
          encrypted_data: string
          expires_at: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number | null
          keyset_id?: string | null
          locking_derivation_path: string
          payment_hash: string
          quote_id_hash: string
          state: string
          transaction_id: string
          type: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          cashu_token_melt_initiated?: boolean | null
          created_at?: string
          encrypted_data?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number | null
          keyset_id?: string | null
          locking_derivation_path?: string
          payment_hash?: string
          quote_id_hash?: string
          state?: string
          transaction_id?: string
          type?: string
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
          created_at: string
          currency_requested: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number
          keyset_id: string
          number_of_change_outputs: number
          payment_hash: string
          quote_id_hash: string
          state: string
          transaction_id: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          created_at?: string
          currency_requested: string
          encrypted_data: string
          expires_at: string
          failure_reason?: string | null
          id?: string
          keyset_counter: number
          keyset_id: string
          number_of_change_outputs: number
          payment_hash: string
          quote_id_hash: string
          state?: string
          transaction_id: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          currency_requested?: string
          encrypted_data?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number
          keyset_id?: string
          number_of_change_outputs?: number
          payment_hash?: string
          quote_id_hash?: string
          state?: string
          transaction_id?: string
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
          created_at: string
          encrypted_data: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          requires_input_proofs_swap: boolean
          state: string
          token_hash: string | null
          transaction_id: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          created_at?: string
          encrypted_data: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number | null
          keyset_id?: string | null
          requires_input_proofs_swap?: boolean
          state: string
          token_hash?: string | null
          transaction_id: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          encrypted_data?: string
          failure_reason?: string | null
          id?: string
          keyset_counter?: number | null
          keyset_id?: string | null
          requires_input_proofs_swap?: boolean
          state?: string
          token_hash?: string | null
          transaction_id?: string
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
          encrypted_data: string
          failure_reason: string | null
          keyset_counter: number
          keyset_id: string
          state: string
          token_hash: string
          transaction_id: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          created_at?: string
          encrypted_data: string
          failure_reason?: string | null
          keyset_counter: number
          keyset_id: string
          state?: string
          token_hash: string
          transaction_id: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          encrypted_data?: string
          failure_reason?: string | null
          keyset_counter?: number
          keyset_id?: string
          state?: string
          token_hash?: string
          transaction_id?: string
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
      spark_receive_quotes: {
        Row: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          payment_hash: string
          receiver_identity_pubkey: string | null
          spark_id: string
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          cashu_token_melt_initiated?: boolean | null
          created_at?: string
          encrypted_data: string
          expires_at: string
          failure_reason?: string | null
          id?: string
          payment_hash: string
          receiver_identity_pubkey?: string | null
          spark_id: string
          spark_transfer_id?: string | null
          state?: string
          transaction_id: string
          type: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          cashu_token_melt_initiated?: boolean | null
          created_at?: string
          encrypted_data?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          payment_hash?: string
          receiver_identity_pubkey?: string | null
          spark_id?: string
          spark_transfer_id?: string | null
          state?: string
          transaction_id?: string
          type?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "spark_receive_quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spark_receive_quotes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spark_receive_quotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      spark_send_quotes: {
        Row: {
          account_id: string
          created_at: string
          encrypted_data: string
          expires_at: string | null
          failure_reason: string | null
          id: string
          payment_hash: string
          payment_request_is_amountless: boolean
          spark_id: string | null
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          user_id: string
          version: number
        }
        Insert: {
          account_id: string
          created_at?: string
          encrypted_data: string
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          payment_hash: string
          payment_request_is_amountless?: boolean
          spark_id?: string | null
          spark_transfer_id?: string | null
          state?: string
          transaction_id: string
          user_id: string
          version?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          encrypted_data?: string
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          payment_hash?: string
          payment_request_is_amountless?: boolean
          spark_id?: string | null
          spark_transfer_id?: string | null
          state?: string
          transaction_id?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "spark_send_quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spark_send_quotes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spark_send_quotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
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
          acknowledgment_status: string | null
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
          state: string
          state_sort_order: number | null
          transaction_details: Json | null
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          acknowledgment_status?: string | null
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
          state: string
          state_sort_order?: number | null
          transaction_details?: Json | null
          type: string
          user_id: string
        }
        Update: {
          account_id?: string
          acknowledgment_status?: string | null
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
          state?: string
          state_sort_order?: number | null
          transaction_details?: Json | null
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
          spark_identity_public_key: string
          terms_accepted_at: string
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
          spark_identity_public_key: string
          terms_accepted_at?: string
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
          spark_identity_public_key?: string
          terms_accepted_at?: string
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
      add_cashu_proofs: {
        Args: {
          p_account_id: string
          p_cashu_receive_quote_id?: string
          p_cashu_send_quote_id?: string
          p_cashu_send_swap_id?: string
          p_cashu_token_swap_token_hash?: string
          p_proofs: Database["wallet"]["CompositeTypes"]["cashu_proof_input"][]
          p_proofs_state?: string
          p_spending_cashu_send_swap_id?: string
          p_user_id: string
        }
        Returns: Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
      }
      add_cashu_proofs_and_update_account: {
        Args: {
          p_account_id: string
          p_cashu_receive_quote_id?: string
          p_cashu_send_quote_id?: string
          p_cashu_send_swap_id?: string
          p_cashu_token_swap_token_hash?: string
          p_proofs: Database["wallet"]["CompositeTypes"]["cashu_proof_input"][]
          p_proofs_state?: string
          p_spending_cashu_send_swap_id?: string
          p_user_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["add_cashu_proofs_and_update_account_result"]
        SetofOptions: {
          from: "*"
          to: "add_cashu_proofs_and_update_account_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_not_self_contact: {
        Args: { contact_username: string; owner_id: string }
        Returns: boolean
      }
      commit_proofs_to_send: {
        Args: {
          p_change_proofs: Database["wallet"]["CompositeTypes"]["cashu_proof_input"][]
          p_proofs_to_send: Database["wallet"]["CompositeTypes"]["cashu_proof_input"][]
          p_swap_id: string
          p_token_hash: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["commit_proofs_to_send_result"]
        SetofOptions: {
          from: "*"
          to: "commit_proofs_to_send_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_cashu_receive_quote: {
        Args: {
          p_proofs: Database["wallet"]["CompositeTypes"]["cashu_proof_input"][]
          p_quote_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["complete_cashu_receive_quote_result"]
        SetofOptions: {
          from: "*"
          to: "complete_cashu_receive_quote_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_cashu_send_quote: {
        Args: {
          p_change_proofs: Database["wallet"]["CompositeTypes"]["cashu_proof_input"][]
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_quote_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["complete_cashu_send_quote_result"]
        SetofOptions: {
          from: "*"
          to: "complete_cashu_send_quote_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_cashu_send_swap: {
        Args: { p_swap_id: string }
        Returns: Database["wallet"]["CompositeTypes"]["complete_cashu_send_swap_result"]
        SetofOptions: {
          from: "*"
          to: "complete_cashu_send_swap_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_cashu_token_swap: {
        Args: {
          p_proofs: Database["wallet"]["CompositeTypes"]["cashu_proof_input"][]
          p_token_hash: string
          p_user_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["complete_cashu_token_swap_result"]
        SetofOptions: {
          from: "*"
          to: "complete_cashu_token_swap_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_spark_receive_quote: {
        Args: {
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_quote_id: string
          p_spark_transfer_id: string
        }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          payment_hash: string
          receiver_identity_pubkey: string | null
          spark_id: string
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_spark_send_quote: {
        Args: {
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_quote_id: string
        }
        Returns: {
          account_id: string
          created_at: string
          encrypted_data: string
          expires_at: string | null
          failure_reason: string | null
          id: string
          payment_hash: string
          payment_request_is_amountless: boolean
          spark_id: string | null
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_send_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_cashu_receive_quote: {
        Args: {
          p_account_id: string
          p_currency: string
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_expires_at: string
          p_locking_derivation_path: string
          p_payment_hash: string
          p_quote_id_hash: string
          p_receive_type: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          payment_hash: string
          quote_id_hash: string
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "cashu_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_cashu_send_quote: {
        Args: {
          p_account_id: string
          p_currency: string
          p_currency_requested: string
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_expires_at: string
          p_keyset_id: string
          p_number_of_change_outputs: number
          p_payment_hash: string
          p_proofs_to_send: string[]
          p_quote_id_hash: string
          p_user_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["create_cashu_send_quote_result"]
        SetofOptions: {
          from: "*"
          to: "create_cashu_send_quote_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_cashu_send_swap: {
        Args: {
          p_account_id: string
          p_currency: string
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_input_proofs: string[]
          p_keyset_id?: string
          p_number_of_outputs?: number
          p_requires_input_proofs_swap: boolean
          p_token_hash?: string
          p_user_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["create_cashu_send_swap_result"]
        SetofOptions: {
          from: "*"
          to: "create_cashu_send_swap_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_cashu_token_swap: {
        Args: {
          p_account_id: string
          p_currency: string
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_keyset_id: string
          p_number_of_outputs: number
          p_reversed_transaction_id?: string
          p_token_hash: string
          p_user_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["create_cashu_token_swap_result"]
        SetofOptions: {
          from: "*"
          to: "create_cashu_token_swap_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_spark_receive_quote: {
        Args: {
          p_account_id: string
          p_currency: string
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_expires_at: string
          p_payment_hash: string
          p_receive_type: string
          p_receiver_identity_pubkey: string
          p_spark_id: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          payment_hash: string
          receiver_identity_pubkey: string | null
          spark_id: string
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_spark_send_quote: {
        Args: {
          p_account_id: string
          p_currency: string
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_expires_at?: string
          p_payment_hash: string
          p_payment_request_is_amountless: boolean
          p_user_id: string
        }
        Returns: {
          account_id: string
          created_at: string
          encrypted_data: string
          expires_at: string | null
          failure_reason: string | null
          id: string
          payment_hash: string
          payment_request_is_amountless: boolean
          spark_id: string | null
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_send_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_cashu_receive_quote: {
        Args: { p_quote_id: string }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          payment_hash: string
          quote_id_hash: string
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "cashu_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_cashu_send_quote: {
        Args: { p_quote_id: string }
        Returns: Database["wallet"]["CompositeTypes"]["expire_cashu_send_quote_result"]
        SetofOptions: {
          from: "*"
          to: "expire_cashu_send_quote_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_spark_receive_quote: {
        Args: { p_quote_id: string }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          payment_hash: string
          receiver_identity_pubkey: string | null
          spark_id: string
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_cashu_receive_quote: {
        Args: { p_failure_reason: string; p_quote_id: string }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          payment_hash: string
          quote_id_hash: string
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "cashu_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_cashu_send_quote: {
        Args: { p_failure_reason: string; p_quote_id: string }
        Returns: Database["wallet"]["CompositeTypes"]["fail_cashu_send_quote_result"]
        SetofOptions: {
          from: "*"
          to: "fail_cashu_send_quote_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_cashu_send_swap: {
        Args: { p_reason: string; p_swap_id: string }
        Returns: Database["wallet"]["CompositeTypes"]["fail_cashu_send_swap_result"]
        SetofOptions: {
          from: "*"
          to: "fail_cashu_send_swap_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_cashu_token_swap: {
        Args: {
          p_failure_reason: string
          p_token_hash: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          created_at: string
          encrypted_data: string
          failure_reason: string | null
          keyset_counter: number
          keyset_id: string
          state: string
          token_hash: string
          transaction_id: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "cashu_token_swaps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_spark_receive_quote: {
        Args: { p_failure_reason: string; p_quote_id: string }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          payment_hash: string
          receiver_identity_pubkey: string | null
          spark_id: string
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_spark_send_quote: {
        Args: { p_failure_reason: string; p_quote_id: string }
        Returns: {
          account_id: string
          created_at: string
          encrypted_data: string
          expires_at: string | null
          failure_reason: string | null
          id: string
          payment_hash: string
          payment_request_is_amountless: boolean
          spark_id: string | null
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_send_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      find_contact_candidates: {
        Args: { current_user_id: string; partial_username: string }
        Returns: {
          id: string
          username: string
        }[]
      }
      get_account_proofs: {
        Args: { p_account_id: string }
        Returns: Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
      }
      get_account_with_proofs: { Args: { p_account_id: string }; Returns: Json }
      list_transactions: {
        Args: {
          p_account_id?: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_cursor_state_sort_order?: number
          p_page_size?: number
          p_user_id: string
        }
        Returns: {
          account_id: string
          acknowledgment_status: string | null
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
          state: string
          state_sort_order: number | null
          transaction_details: Json | null
          type: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_cashu_receive_quote_cashu_token_melt_initiated: {
        Args: { p_quote_id: string }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          keyset_counter: number | null
          keyset_id: string | null
          locking_derivation_path: string
          payment_hash: string
          quote_id_hash: string
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "cashu_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_cashu_send_quote_as_pending: {
        Args: { p_quote_id: string }
        Returns: Database["wallet"]["CompositeTypes"]["mark_cashu_send_quote_as_pending_result"]
        SetofOptions: {
          from: "*"
          to: "mark_cashu_send_quote_as_pending_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_spark_receive_quote_cashu_token_melt_initiated: {
        Args: { p_quote_id: string }
        Returns: {
          account_id: string
          cashu_token_melt_initiated: boolean | null
          created_at: string
          encrypted_data: string
          expires_at: string
          failure_reason: string | null
          id: string
          payment_hash: string
          receiver_identity_pubkey: string | null
          spark_id: string
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          type: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_receive_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_spark_send_quote_as_pending: {
        Args: {
          p_encrypted_data: string
          p_encrypted_transaction_details: string
          p_quote_id: string
          p_spark_id: string
          p_spark_transfer_id: string
        }
        Returns: {
          account_id: string
          created_at: string
          encrypted_data: string
          expires_at: string | null
          failure_reason: string | null
          id: string
          payment_hash: string
          payment_request_is_amountless: boolean
          spark_id: string | null
          spark_transfer_id: string | null
          state: string
          transaction_id: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "spark_send_quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      process_cashu_receive_quote_payment: {
        Args: {
          p_encrypted_data: string
          p_keyset_id: string
          p_number_of_outputs: number
          p_quote_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["cashu_receive_quote_payment_result"]
        SetofOptions: {
          from: "*"
          to: "cashu_receive_quote_payment_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      take_lead: {
        Args: { p_client_id: string; p_user_id: string }
        Returns: boolean
      }
      to_account_with_proofs: {
        Args: { p_account: Database["wallet"]["Tables"]["accounts"]["Row"] }
        Returns: Json
      }
      upsert_user_with_accounts: {
        Args: {
          p_accounts: Database["wallet"]["CompositeTypes"]["account_input"][]
          p_cashu_locking_xpub: string
          p_email: string
          p_email_verified: boolean
          p_encryption_public_key: string
          p_spark_identity_public_key: string
          p_user_id: string
        }
        Returns: Database["wallet"]["CompositeTypes"]["upsert_user_with_accounts_result"]
        SetofOptions: {
          from: "*"
          to: "upsert_user_with_accounts_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      account_input: {
        type: string | null
        currency: string | null
        name: string | null
        details: Json | null
        is_default: boolean | null
        purpose: string | null
      }
      add_cashu_proofs_and_update_account_result: {
        account: Json | null
        added_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      cashu_proof_input: {
        keysetId: string | null
        amount: string | null
        secret: string | null
        unblindedSignature: string | null
        publicKeyY: string | null
        dleq: Json | null
        witness: Json | null
      }
      cashu_receive_quote_payment_result: {
        quote:
          | Database["wallet"]["Tables"]["cashu_receive_quotes"]["Row"]
          | null
        account: Json | null
      }
      commit_proofs_to_send_result: {
        swap: Database["wallet"]["Tables"]["cashu_send_swaps"]["Row"] | null
        account: Json | null
        spent_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
        reserved_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
        change_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      complete_cashu_receive_quote_result: {
        quote:
          | Database["wallet"]["Tables"]["cashu_receive_quotes"]["Row"]
          | null
        account: Json | null
        added_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      complete_cashu_send_quote_result: {
        quote: Database["wallet"]["Tables"]["cashu_send_quotes"]["Row"] | null
        account: Json | null
        spent_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
        change_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      complete_cashu_send_swap_result: {
        result: string | null
        swap: Database["wallet"]["Tables"]["cashu_send_swaps"]["Row"] | null
        account: Json | null
        spent_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
        failure_reason: string | null
      }
      complete_cashu_token_swap_result: {
        swap: Database["wallet"]["Tables"]["cashu_token_swaps"]["Row"] | null
        account: Json | null
        added_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      create_cashu_send_quote_result: {
        quote: Database["wallet"]["Tables"]["cashu_send_quotes"]["Row"] | null
        account: Json | null
        reserved_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      create_cashu_send_swap_result: {
        swap: Database["wallet"]["Tables"]["cashu_send_swaps"]["Row"] | null
        account: Json | null
        reserved_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      create_cashu_token_swap_result: {
        swap: Database["wallet"]["Tables"]["cashu_token_swaps"]["Row"] | null
        account: Json | null
      }
      expire_cashu_send_quote_result: {
        quote: Database["wallet"]["Tables"]["cashu_send_quotes"]["Row"] | null
        account: Json | null
        released_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      fail_cashu_send_quote_result: {
        quote: Database["wallet"]["Tables"]["cashu_send_quotes"]["Row"] | null
        account: Json | null
        released_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      fail_cashu_send_swap_result: {
        swap: Database["wallet"]["Tables"]["cashu_send_swaps"]["Row"] | null
        account: Json | null
        released_proofs:
          | Database["wallet"]["Tables"]["cashu_proofs"]["Row"][]
          | null
      }
      mark_cashu_send_quote_as_pending_result: {
        quote: Database["wallet"]["Tables"]["cashu_send_quotes"]["Row"] | null
        proofs: Database["wallet"]["Tables"]["cashu_proofs"]["Row"][] | null
      }
      upsert_user_with_accounts_result: {
        user: Database["wallet"]["Tables"]["users"]["Row"] | null
        accounts: Json[] | null
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

