import { redirect } from "next/navigation";

// The old dashboard became Mi Día.
export default function DashboardPage() {
  redirect("/mi-dia");
}