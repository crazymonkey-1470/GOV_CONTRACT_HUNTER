import { redirect } from "next/navigation";

// The middleware sends unauthenticated visitors to /login; everyone else
// lands on the dashboard.
export default function Home() {
  redirect("/dashboard");
}
