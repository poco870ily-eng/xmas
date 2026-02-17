import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .limit(1);

    if (error) console.log("❌ Supabase error:", error);
    else console.log("✅ Connection OK, data:", data);
  } catch (err) {
    console.error("❌ Unexpected error:", err);
  }
})();
