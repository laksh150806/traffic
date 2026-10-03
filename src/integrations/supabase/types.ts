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
      cctv_analysis_log: {
        Row: {
          analysis_id: number
          analyzed_at: string
          camera_id: number
          confidence_avg: number | null
          frame_number: number | null
          vehicles_detected: number
        }
        Insert: {
          analysis_id?: number
          analyzed_at?: string
          camera_id: number
          confidence_avg?: number | null
          frame_number?: number | null
          vehicles_detected: number
        }
        Update: {
          analysis_id?: number
          analyzed_at?: string
          camera_id?: number
          confidence_avg?: number | null
          frame_number?: number | null
          vehicles_detected?: number
        }
        Relationships: [
          {
            foreignKeyName: "cctv_analysis_log_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cctv_cameras"
            referencedColumns: ["camera_id"]
          },
        ]
      }
      cctv_cameras: {
        Row: {
          camera_id: number
          camera_name: string | null
          road_id: number
          status: string
        }
        Insert: {
          camera_id?: number
          camera_name?: string | null
          road_id: number
          status?: string
        }
        Update: {
          camera_id?: number
          camera_name?: string | null
          road_id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cctv_cameras_road_id_fkey"
            columns: ["road_id"]
            isOneToOne: false
            referencedRelation: "roads"
            referencedColumns: ["road_id"]
          },
        ]
      }
      junctions: {
        Row: {
          created_at: string
          junction_id: number
          latitude: number
          longitude: number
          name: string
          status: string
          zone: string
        }
        Insert: {
          created_at?: string
          junction_id?: number
          latitude: number
          longitude: number
          name: string
          status?: string
          zone?: string
        }
        Update: {
          created_at?: string
          junction_id?: number
          latitude?: number
          longitude?: number
          name?: string
          status?: string
          zone?: string
        }
        Relationships: []
      }
      model_accuracy: {
        Row: {
          abs_error: number
          accuracy_id: number
          actual_queue: number
          junction_id: number
          predicted_queue: number
          recorded_at: string
          road_id: number
        }
        Insert: {
          abs_error: number
          accuracy_id?: number
          actual_queue: number
          junction_id: number
          predicted_queue: number
          recorded_at?: string
          road_id: number
        }
        Update: {
          abs_error?: number
          accuracy_id?: number
          actual_queue?: number
          junction_id?: number
          predicted_queue?: number
          recorded_at?: string
          road_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "model_accuracy_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "model_accuracy_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "v_junction_congestion"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "model_accuracy_road_id_fkey"
            columns: ["road_id"]
            isOneToOne: false
            referencedRelation: "roads"
            referencedColumns: ["road_id"]
          },
        ]
      }
      model_road_state: {
        Row: {
          arrival_rate_vph: number
          cycle_length_sec: number
          degree_saturation: number
          flow_ratio: number
          green_sec: number
          junction_id: number
          predicted_delay_adaptive_sec: number
          predicted_delay_fixed_sec: number
          predicted_queue_next: number
          queue_clears: boolean
          queue_exact: number
          queue_now: number
          road_id: number
          saturation_flow_vph: number
          updated_at: string
        }
        Insert: {
          arrival_rate_vph?: number
          cycle_length_sec?: number
          degree_saturation?: number
          flow_ratio?: number
          green_sec?: number
          junction_id: number
          predicted_delay_adaptive_sec?: number
          predicted_delay_fixed_sec?: number
          predicted_queue_next?: number
          queue_clears?: boolean
          queue_exact?: number
          queue_now?: number
          road_id: number
          saturation_flow_vph?: number
          updated_at?: string
        }
        Update: {
          arrival_rate_vph?: number
          cycle_length_sec?: number
          degree_saturation?: number
          flow_ratio?: number
          green_sec?: number
          junction_id?: number
          predicted_delay_adaptive_sec?: number
          predicted_delay_fixed_sec?: number
          predicted_queue_next?: number
          queue_clears?: boolean
          queue_exact?: number
          queue_now?: number
          road_id?: number
          saturation_flow_vph?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_road_state_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "model_road_state_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "v_junction_congestion"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "model_road_state_road_id_fkey"
            columns: ["road_id"]
            isOneToOne: true
            referencedRelation: "roads"
            referencedColumns: ["road_id"]
          },
        ]
      }
      roads: {
        Row: {
          direction: string
          junction_id: number
          max_capacity: number
          road_id: number
          road_name: string | null
        }
        Insert: {
          direction: string
          junction_id: number
          max_capacity?: number
          road_id?: number
          road_name?: string | null
        }
        Update: {
          direction?: string
          junction_id?: number
          max_capacity?: number
          road_id?: number
          road_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roads_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "roads_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "v_junction_congestion"
            referencedColumns: ["junction_id"]
          },
        ]
      }
      signal_history: {
        Row: {
          allocated_green_sec: number
          arrival_rate_vph: number | null
          baseline_fixed_sec: number
          cycle_length_sec: number | null
          cycle_number: number | null
          decided_at: string
          degree_saturation: number | null
          estimated_wait_saved_sec: number
          history_id: number
          junction_id: number
          predicted_delay_adaptive_sec: number | null
          predicted_delay_fixed_sec: number | null
          predicted_queue_next: number | null
          road_id: number
          saturation_flow_vph: number | null
          vehicle_count_at_decision: number | null
        }
        Insert: {
          allocated_green_sec: number
          arrival_rate_vph?: number | null
          baseline_fixed_sec?: number
          cycle_length_sec?: number | null
          cycle_number?: number | null
          decided_at?: string
          degree_saturation?: number | null
          estimated_wait_saved_sec?: number
          history_id?: number
          junction_id: number
          predicted_delay_adaptive_sec?: number | null
          predicted_delay_fixed_sec?: number | null
          predicted_queue_next?: number | null
          road_id: number
          saturation_flow_vph?: number | null
          vehicle_count_at_decision?: number | null
        }
        Update: {
          allocated_green_sec?: number
          arrival_rate_vph?: number | null
          baseline_fixed_sec?: number
          cycle_length_sec?: number | null
          cycle_number?: number | null
          decided_at?: string
          degree_saturation?: number | null
          estimated_wait_saved_sec?: number
          history_id?: number
          junction_id?: number
          predicted_delay_adaptive_sec?: number | null
          predicted_delay_fixed_sec?: number | null
          predicted_queue_next?: number | null
          road_id?: number
          saturation_flow_vph?: number | null
          vehicle_count_at_decision?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_history_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "signal_history_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "v_junction_congestion"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "signal_history_road_id_fkey"
            columns: ["road_id"]
            isOneToOne: false
            referencedRelation: "roads"
            referencedColumns: ["road_id"]
          },
        ]
      }
      signal_timings: {
        Row: {
          green_duration_sec: number
          is_currently_green: boolean
          junction_id: number
          road_id: number
          timing_id: number
          timing_mode: string
          updated_at: string
        }
        Insert: {
          green_duration_sec?: number
          is_currently_green?: boolean
          junction_id: number
          road_id: number
          timing_id?: number
          timing_mode?: string
          updated_at?: string
        }
        Update: {
          green_duration_sec?: number
          is_currently_green?: boolean
          junction_id?: number
          road_id?: number
          timing_id?: number
          timing_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_timings_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "signal_timings_junction_id_fkey"
            columns: ["junction_id"]
            isOneToOne: false
            referencedRelation: "v_junction_congestion"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "signal_timings_road_id_fkey"
            columns: ["road_id"]
            isOneToOne: true
            referencedRelation: "roads"
            referencedColumns: ["road_id"]
          },
        ]
      }
      vehicle_counts: {
        Row: {
          reading_id: number
          recorded_at: string
          road_id: number
          source: string
          vehicle_count: number
        }
        Insert: {
          reading_id?: number
          recorded_at?: string
          road_id: number
          source?: string
          vehicle_count: number
        }
        Update: {
          reading_id?: number
          recorded_at?: string
          road_id?: number
          source?: string
          vehicle_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_counts_road_id_fkey"
            columns: ["road_id"]
            isOneToOne: false
            referencedRelation: "roads"
            referencedColumns: ["road_id"]
          },
        ]
      }
    }
    Views: {
      v_junction_congestion: {
        Row: {
          arrival_rate_vph: number | null
          avg_saturation: number | null
          avg_vehicle_count: number | null
          congestion_level: string | null
          junction_id: number | null
          last_reading_at: string | null
          latitude: number | null
          longitude: number | null
          name: string | null
          predicted_delay_sec: number | null
          total_vehicle_count: number | null
          zone: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
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
