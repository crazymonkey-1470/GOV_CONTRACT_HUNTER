"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// A plain username (e.g. "hello") is mapped to "<username>@quant-agents.org"
// so the single user can sign in without typing a full email address.
const LOGIN_EMAIL_DOMAIN = "quant-agents.org";

export async function login(
  _prevState: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Please enter your username and password." };
  }

  // Accept either a plain username ("hello") or a full email address.
  const email = username.includes("@")
    ? username.toLowerCase()
    : `${username.toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Keep the message generic so we don't reveal whether the account exists.
    return { error: "Invalid username or password. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
