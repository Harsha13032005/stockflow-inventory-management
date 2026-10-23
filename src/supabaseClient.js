import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

console.log("Supabase URL:", supabaseUrl);
console.log("Supabase key loaded:", Boolean(supabaseKey));

export const supabase = createClient(
  supabaseUrl || "https://invalid.supabase.co",
  supabaseKey || "missing-key"
);